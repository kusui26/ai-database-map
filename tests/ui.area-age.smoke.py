#!/usr/bin/env python3
"""エリアの図の**年齢**（生産年齢人口・高齢化率の 2 行と、比べる表の 3 行）を実ブラウザの 3 幅で確かめる
（2026-11-25・計画書 `docs/261122_PLAN_population_improvement.md` §8.4・PR-5b）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う・区域の年齢を入れた後）
    pip install playwright && playwright install chromium
    python3 tests/ui.area-age.smoke.py [出力ディレクトリ] [BASE]

## 見ること（1440／1024／390 の 3 幅）

1. 横浜市：「エリア全体の値」が 人口 → 将来推計人口 → 生産年齢人口 → 高齢化率 → 事業所 → 従業者 の順。年齢の 2 行は応答の文の
   まま（「2,388,942 人（2020年）→ 2050年 …」「25.1%（2020年）→ 34.4%（2050年・推計）」）で、札は「公表値と推計」
2. 東急東横線の沿線（1km）：年齢の 2 行の札は「メッシュの按分」
3. 横浜市と東急東横線：比べる表に 3 行（生産年齢人口・その将来の増減・高齢化率）が応答のセルのまま並ぶ
4. 浜松市中央区：年齢の 2 行は出ず、出せない値に「年齢別の人口（2015〜2050年）」と理由
5. 横にはみ出さない・画面のエラーなし
"""

import sys
import urllib.parse

from playwright.sync_api import Page, Response, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

VIEWPORTS = {
    "wide": {"width": 1440, "height": 900},
    "mid": {"width": 1024, "height": 800},
    "phone": {"width": 390, "height": 844},
}
TOTAL_ORDER = ["人口", "将来推計人口", "生産年齢人口（15〜64歳）", "高齢化率（65歳以上の割合）", "事業所（民営）", "従業者（民営）"]
AGE_LABELS = ["生産年齢人口（15〜64歳）", "高齢化率（65歳以上の割合）"]
AGE_ROWS = ["生産年齢人口（2020年）", "生産年齢人口の将来の増減（2020→2050年・推計）", "高齢化率（2020年 → 2050年）"]
WAIT_MS = 45_000
SETTLE_MS = 1_500

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'OK  ' if condition else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def open_area(page: Page, *refs: str) -> dict:
    """エリアの図を開き、要約の API の応答（JSON）を返す。"""
    query = "&".join(f"figAreas={urllib.parse.quote(ref)}" for ref in refs)
    with page.expect_response(lambda response: "/api/areas/summary" in response.url, timeout=WAIT_MS) as info:
        page.goto(f"{BASE}/?fig=area&{query}", wait_until="domcontentloaded")
    page.wait_for_timeout(SETTLE_MS)
    response: Response = info.value
    return response.json()


def total_rows(page: Page) -> list[dict[str, str]]:
    """画面の「エリア全体の値」の行（名前・札・文）。"""
    return page.evaluate(
        """() => {
          const head = [...document.querySelectorAll('h4')].find((h) => h.textContent.trim() === 'エリア全体の値')
          const list = head?.parentElement?.querySelector('ul')
          return [...(list?.querySelectorAll(':scope > li') ?? [])].map((li) => ({
            label: li.querySelector('div p')?.textContent.trim() ?? '',
            badge: li.querySelector('div span')?.textContent.trim() ?? '',
            headline: li.querySelector(':scope > p')?.textContent.trim() ?? '',
          }))
        }"""
    )


def comparison_rows(page: Page) -> dict[str, list[str]]:
    """画面の比べる表（行の名前 → セル）。"""
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('table tbody tr')].map((tr) => [
          tr.querySelector('th')?.textContent.trim() ?? '',
          [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()),
        ]))"""
    )


def yokohama(page: Page, name: str) -> None:
    body = open_area(page, "muni:14100")
    totals = {total["id"]: total for total in body["areas"][0]["totals"]}
    rows = total_rows(page)
    check(f"[{name}] 横浜市：エリア全体の値の並び", [row["label"] for row in rows] == TOTAL_ORDER,
          f"{[row['label'] for row in rows]}")
    by_label = {row["label"]: row for row in rows}
    for total_id, label in (("workingAge", AGE_LABELS[0]), ("agingRate", AGE_LABELS[1])):
        row = by_label.get(label, {})
        want = totals.get(total_id, {}).get("headlineJa")
        check(f"[{name}] 横浜市：{label} は応答の文のまま・札は公表値と推計",
              row.get("headline") == want and row.get("badge") == "公表値と推計", f"{row}／応答 {want}")
    page.screenshot(path=f"{OUT}/area-age-yokohama-{name}.png", full_page=False)


def toyoko(page: Page, name: str) -> None:
    open_area(page, "line:26001@1000")
    by_label = {row["label"]: row for row in total_rows(page)}
    badges = [by_label.get(label, {}).get("badge") for label in AGE_LABELS]
    check(f"[{name}] 東急東横線の沿線：年齢の 2 行の札はメッシュの按分", badges == ["メッシュの按分"] * 2, f"{badges}")


def compare(page: Page, name: str) -> None:
    body = open_area(page, "muni:14100", "line:26001@1000")
    want = {row["labelJa"]: row["cells"] for row in body["comparison"]["rows"] if row["labelJa"] in AGE_ROWS}
    shown = {label: cells for label, cells in comparison_rows(page).items() if label in AGE_ROWS}
    check(f"[{name}] 比べる表：年齢の 3 行が応答のセルのまま", list(shown) == AGE_ROWS and shown == want, f"{shown}")
    table = page.locator("table").first
    table.scroll_into_view_if_needed()
    page.screenshot(path=f"{OUT}/area-age-compare-{name}.png", full_page=False)


def hamamatsu(page: Page, name: str) -> None:
    open_area(page, "muni:22138")
    labels = [row["label"] for row in total_rows(page)]
    note = page.locator("li", has_text="年齢別の人口（2015〜2050年）")
    check(f"[{name}] 浜松市中央区：年齢の 2 行は出ず、出せない値に年齢別の人口と理由",
          not any(label in labels for label in AGE_LABELS) and note.count() == 1, f"{labels}・出せない値 {note.count()}")


def run(browser, name: str, viewport: dict) -> None:
    print(f"■ {name}（{viewport['width']}×{viewport['height']}）")
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    yokohama(page, name)
    toyoko(page, name)
    compare(page, name)
    hamamatsu(page, name)
    width = page.evaluate("document.documentElement.scrollWidth")
    check(f"[{name}] 横にはみ出さない", width <= viewport["width"], f"{width}px")
    check(f"[{name}] 画面のエラーなし", not errors, "; ".join(errors)[:200])
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for name, viewport in VIEWPORTS.items():
        run(browser, name, viewport)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
