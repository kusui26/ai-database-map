#!/usr/bin/env python3
"""人口の年齢の指標を、ランキング・散布図・地図の色分けで選べることを実ブラウザで確かめる（2026-11-24・人口の年齢 PR-2）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う。年齢の列を投入済みであること）
    pip install playwright && playwright install chromium
    python3 tests/ui.age-metrics.smoke.py [出力ディレクトリ] [BASE]

計画書 `docs/261122_PLAN_population_improvement.md` §9 PR-2 の受け入れ。3 幅（広い 1440・中 1024・携帯 390）で：

1. ランキング：人口のカテゴリの指標の一覧に年齢の 6 ファミリ、将来推計人口に 3 ファミリが並ぶ（既存のファミリが先）。
   高齢化率で開くと行があり、値は % で 0〜100
2. 将来の年の変種は 2030 → 2040 → 2050 の順。2040 年を選ぶと、その年のランキングになる
3. 散布図：15〜64 歳の将来増減率 × 65 歳以上の将来増減率で点が出る
4. 地図の色分け：高齢化率で横浜市の駅を色分けすると、凡例に「高齢化率」と % が出る
"""

import re
import sys
import urllib.parse

from playwright.sync_api import Browser, Page, Response, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

VIEWPORTS = {"wide": {"width": 1440, "height": 900}, "mid": {"width": 1024, "height": 800}, "phone": {"width": 390, "height": 844}}
WAIT_MS = 30_000
SETTLE_MS = 1_500
#: 人口のカテゴリと将来推計人口のカテゴリの、ファミリの日本語名の並び（既存のファミリが先・年齢は末尾）。
POPULATION_GROUPS = [
    "人口", "人口増減率", "生産年齢人口（15〜64歳）", "生産年齢人口の割合（15〜64歳）", "高齢化率（65歳以上の割合）",
    "75歳以上の割合", "年少人口の割合（0〜14歳）", "生産年齢人口増減率（15〜64歳）",
]
FORECAST_GROUPS = [
    "将来推計人口", "将来人口増減率", "人口予測誤差率", "生産年齢人口の将来増減率（15〜64歳）", "65歳以上人口の将来増減率",
    "将来の高齢化率（65歳以上の割合）",
]
WORKING_FUTURE = "生産年齢人口の将来増減率（15〜64歳）"
PERCENT = re.compile(r"^-?\d+(?:\.\d)?%$")

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def open_page(browser: Browser, viewport: dict) -> tuple[Page, list[str]]:
    phone = viewport["width"] < 640
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return page, errors


def goto_waiting(page: Page, query: str, api: str) -> Response:
    """URL を開き、その図の API の応答を待つ。"""
    with page.expect_response(lambda response: api in response.url, timeout=WAIT_MS) as info:
        page.goto(f"{BASE}/?{query}", wait_until="domcontentloaded")
    page.wait_for_timeout(SETTLE_MS)
    return info.value


def groups_of(page: Page, label: str) -> list[str]:
    """指標の選択肢のファミリ（optgroup）の並び。"""
    return page.locator(f'select[aria-label="{label}"]').first.evaluate(
        "(select) => [...select.querySelectorAll('optgroup')].map((group) => group.label)"
    )


def variants_of(page: Page, label: str, group: str) -> list[tuple[str, str]]:
    """1 つのファミリの変種（value, 表示）。"""
    return page.locator(f'select[aria-label="{label}"]').first.evaluate(
        """(select, group) => [...select.querySelectorAll('optgroup')]
             .filter((g) => g.label === group)
             .flatMap((g) => [...g.querySelectorAll('option')].map((o) => [o.value, o.textContent.trim()]))""",
        group,
    )


def ranking(page: Page, name: str) -> None:
    response = goto_waiting(page, "fig=ranking&figM=pop65_share_2020_1km", "/api/ranking")
    body = response.json()
    rows = body.get("rows", [])
    check(f"[{name}] 高齢化率のランキングが返る（行あり・題は高齢化率）", response.status == 200 and len(rows) > 0
          and "高齢化率" in body.get("metric", {}).get("labelJa", ""), f"HTTP {response.status}・{len(rows)} 行")
    values = [row.get("formatted", "") for row in rows]
    check(f"[{name}] 値は % で 0〜100", bool(values) and all(PERCENT.match(v) for v in values)
          and all(0 <= float(v.rstrip("%")) <= 100 for v in values), f"{values[:3]}")
    shown = page.locator("text=/^\\d+(\\.\\d)?%$/").count()
    check(f"[{name}] 画面の順位表に % の値が出る", shown > 0, f"{shown} 個")
    groups = groups_of(page, "指標")
    check(f"[{name}] 人口のカテゴリの指標：既存が先・年齢の 6 ファミリ", groups == POPULATION_GROUPS, f"{groups}")


def future_years(page: Page, name: str) -> None:
    category = page.locator('select[aria-label="カテゴリ"]').first
    category.select_option("population_forecast")
    page.wait_for_timeout(SETTLE_MS)
    groups = groups_of(page, "指標")
    check(f"[{name}] 将来推計人口のカテゴリの指標：既存が先・年齢の 3 ファミリ", groups == FORECAST_GROUPS, f"{groups}")
    variants = variants_of(page, "指標", WORKING_FUTURE)
    labels = [label for _, label in variants]
    check(f"[{name}] 15〜64 歳の将来の年は 2030 → 2040 → 2050 の順",
          [re.sub(r"\D+", " ", label).split()[-1] for label in labels] == ["2030", "2040", "2050"], f"{labels}")
    token = next((value for value, label in variants if "2040" in label), None)
    if token is None:
        check(f"[{name}] 2040 年を選べる", False, "変種が無い")
        return
    with page.expect_response(lambda response: "/api/ranking" in response.url and "2040" in response.url,
                              timeout=WAIT_MS) as info:
        page.locator('select[aria-label="指標"]').first.select_option(token)
    rows = info.value.json().get("rows", [])
    check(f"[{name}] 2040 年を選ぶと、その年のランキング（行あり）", info.value.status == 200 and len(rows) > 0,
          f"HTTP {info.value.status}・{len(rows)} 行")
    page.wait_for_function("() => new URL(location.href).searchParams.get('figM')?.includes('pop15_64_gr_pred_2024_2040')",
                           timeout=WAIT_MS)


def scatter(page: Page, name: str) -> None:
    query = "fig=scatter&figX=pop15_64_gr_pred_2024_2050_2km&figY=pop65_gr_pred_2024_2050_2km"
    response = goto_waiting(page, query, "/api/growth")
    points = response.json().get("points", [])
    check(f"[{name}] 散布図：15〜64 歳の将来 × 65 歳以上の将来で点が出る", response.status == 200 and len(points) > 100,
          f"HTTP {response.status}・{len(points)} 点")
    groups_x = groups_of(page, "X軸 指標")
    check(f"[{name}] 散布図の X 軸の選択肢にも年齢の将来がある", WORKING_FUTURE in groups_x, f"{groups_x}")


def coloring(page: Page, name: str) -> None:
    query = urllib.parse.urlencode([("color", "pop65_share_2020_1km"), ("colorIn", "muni:14100")])
    response = goto_waiting(page, query, "/api/stations/classes")
    check(f"[{name}] 地図の色分け：高齢化率で横浜市の駅を色分けできる", response.status == 200, f"HTTP {response.status}")
    legend = page.locator('section[aria-label="色分けの凡例"]')
    legend.wait_for(state="visible", timeout=WAIT_MS)
    toggle = legend.locator("button[aria-expanded]")
    if toggle.count() > 0 and toggle.first.get_attribute("aria-expanded") == "false":
        toggle.first.click()
        page.wait_for_timeout(SETTLE_MS)
    text = legend.inner_text()
    check(f"[{name}] 凡例に「高齢化率」と % が出る", "高齢化率" in text and "%" in text, text.replace("\n", " ")[:120])


def run(browser: Browser, name: str, viewport: dict) -> None:
    print(f"■ {name}（{viewport['width']}×{viewport['height']}）")
    page, errors = open_page(browser, viewport)
    ranking(page, name)
    future_years(page, name)
    page.screenshot(path=f"{OUT}/age-metrics-{name}-ranking.png")
    scatter(page, name)
    page.screenshot(path=f"{OUT}/age-metrics-{name}-scatter.png")
    coloring(page, name)
    page.screenshot(path=f"{OUT}/age-metrics-{name}-coloring.png")
    check(f"[{name}] 画面のエラーなし", not errors, "; ".join(errors))
    page.context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for viewport_name, size in VIEWPORTS.items():
        run(browser, viewport_name, size)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
