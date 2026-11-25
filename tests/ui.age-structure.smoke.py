#!/usr/bin/env python3
"""人口タブの「年齢別の人口」を実ブラウザで確かめる（2026-11-25・人口の年齢 PR-3）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う。station_age_profiles を投入済みであること）
    pip install playwright pillow && playwright install chromium
    python3 tests/ui.age-structure.smoke.py [出力ディレクトリ] [BASE] [main の BASE（任意）]

計画書 `docs/261122_PLAN_population_improvement.md` §9 PR-3 の受け入れ。3 幅（広い 1440・中 1024・携帯 390）で：

1. 人口タブの並び：人口の推移（今のまま）→ 年齢別の人口 → 人口増減率（9）（畳む）
2. チップ 3 つの文（武蔵小杉 1km 圏：15〜64歳 55,863 人・74.1% ／ 高齢化率 12.7%→25.2% ／ 15〜64歳 -7.2%）
3. 図の画素：凡例の 4 色が左から 0〜14 → 15〜64 → 65〜74 → 75 歳以上・実績の 2 本は濃い色、推計の 6 本は淡い色
   （不透明度 0.6 を白に重ねた色）・実績と推計の境に破線・合計の数字は 2020 年と 2050 年の上だけ
4. 注意：武蔵小杉は出ない・矢場町は「年齢不詳が多い地域です（2020年 30.4%）」
5. 人口増減率の表は畳んである（行は見えない）→ 押すと 9 行が開く
6. 半径を 500m に替えると題と数が替わり、駅詳細を取り直さない
7. 人口タブの高さを記録する（main の BASE を渡すと、main との差と、人口の推移の図が画素まで同じかも見る）
8. 横にはみ出さない・画面のエラーなし
"""

import io
import json
import sys
from urllib.parse import quote

from PIL import Image
from playwright.sync_api import Browser, Locator, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"
BASE_MAIN = sys.argv[3] if len(sys.argv) > 3 else None

VIEWPORTS = {"wide": {"width": 1440, "height": 900}, "mid": {"width": 1024, "height": 800}, "phone": {"width": 390, "height": 844}}
WAIT_MS = 30_000
SETTLE_MS = 1_200
KOSUGI = "武蔵小杉#0"
YABACHO = "矢場町#0"
#: 区分の色（`src/domain/stations/age-structure.ts` の AGE_BAND_COLORS）と、推計の棒の不透明度（PROJECTED_OPACITY）。
BAND_COLORS = ["#60a5fa", "#2563eb", "#1e40af", "#172554"]
PROJECTED_OPACITY = 0.6
RULE_COLOR = "#94a3b8"
TOTAL_LABEL_COLOR = "#475569"
COLOR_TOLERANCE = 10
#: 凡例の段（canvas の下から）。Chart.js の凡例（箱 10px・余白 12px）がこの中に入る。
LEGEND_BAND_PX = 26
CHIPS_1KM = ["15〜64歳（2020年） 55,863 人・74.1%", "高齢化率 2020→2050 12.7%→25.2%", "15〜64歳 2020→2050 -7.2%"]

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# --- 画面の読み取り ----------------------------------------------------------

DETAIL_ROOT_JS = """() => {
  const tab = document.querySelector('button.border-b-2');
  return tab?.closest('aside') ?? tab?.closest('[data-vaul-drawer]') ?? null;
}"""


def detail_root(page: Page) -> Locator:
    """駅詳細（広い画面は右のパネル・携帯はシート）。"""
    aside = page.locator("aside").filter(has=page.locator("button.border-b-2"))
    return aside.first if aside.count() > 0 else page.locator("[data-vaul-drawer]").first


def open_population(page: Page, grp: str, radius_m: int = 1000) -> None:
    page.goto(f"{BASE_OF[page]}/?grp={quote(grp)}&tab=population&r={radius_m}", wait_until="networkidle")
    detail_root(page).locator("h3", has_text="人口の推移").first.wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)


def panel_titles(page: Page) -> list[str]:
    """人口タブの見出しと、畳んだ表の summary（上からの順）。"""
    return detail_root(page).evaluate(
        """(root) => [...root.querySelectorAll('h3, summary')].map((el) => el.textContent.trim())"""
    )


def age_section(page: Page, radius_label: str = "1km") -> Locator:
    return detail_root(page).locator("section").filter(
        has=page.locator("h3", has_text=f"年齢別の人口（{radius_label}圏）")
    ).first


def chips_of(section: Locator) -> list[str]:
    """要点のチップ（折り返す 1 列の ul。注意の ul は縦に並ぶ別の ul）。"""
    return [text.replace("\n", " ").strip() for text in section.locator("ul.flex-wrap > li").all_inner_texts()]


def tab_height(page: Page) -> float:
    """
    人口タブの本文の高さ（スクロールする箱の**中身**の要素の高さ）。箱の scrollHeight は、中身が箱より短いと箱の高さを
    返すので使わない（main の人口タブは箱より短い）。
    """
    return detail_root(page).evaluate(
        "(root) => root.querySelector('.overflow-y-auto > div')?.getBoundingClientRect().height ?? 0"
    )


def overflows(page: Page) -> bool:
    return detail_root(page).evaluate(
        "(root) => { const body = root.querySelector('.overflow-y-auto'); return body ? body.scrollWidth > body.clientWidth + 1 : true }"
    )


# --- 画素 ---------------------------------------------------------------------


def rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[index : index + 2], 16) for index in (1, 3, 5))


def faint(hex_color: str) -> tuple[int, int, int]:
    """不透明度 PROJECTED_OPACITY で白に重ねた色。"""
    return tuple(round(channel * PROJECTED_OPACITY + 255 * (1 - PROJECTED_OPACITY)) for channel in rgb(hex_color))


def near(pixel: tuple[int, int, int], target: tuple[int, int, int], tolerance: int = COLOR_TOLERANCE) -> bool:
    return all(abs(channel - goal) <= tolerance for channel, goal in zip(pixel, target, strict=True))


def canvas_image(canvas: Locator) -> Image.Image:
    canvas.scroll_into_view_if_needed()
    return Image.open(io.BytesIO(canvas.screenshot())).convert("RGB")


def columns_with(image: Image.Image, target: tuple[int, int, int], rows: range) -> list[int]:
    pixels = image.load()
    return [x for x in range(image.size[0]) if any(near(pixels[x, y], target) for y in rows)]


def clusters(columns: list[int]) -> list[tuple[int, int]]:
    """連続する列のまとまり（棒 1 本＝1 つ）。"""
    groups: list[tuple[int, int]] = []
    for x in columns:
        if groups and x - groups[-1][1] <= 1:
            groups[-1] = (groups[-1][0], x)
        else:
            groups.append((x, x))
    return [group for group in groups if group[1] - group[0] >= 3]


def legend_centers(image: Image.Image) -> list[float | None]:
    """凡例の段で、区分の色ごとの画素の x の中心（無ければ None）。"""
    pixels = image.load()
    width, height = image.size
    centers = []
    for color in BAND_COLORS:
        xs = [x for y in range(height - LEGEND_BAND_PX, height) for x in range(width) if near(pixels[x, y], rgb(color))]
        centers.append(sum(xs) / len(xs) if xs else None)
    return centers


def count_darker(image: Image.Image, xs: range, ys: range, threshold: int) -> int:
    """どの色の成分も threshold より小さい画素の数（白と罫線〔#f1f5f9〕より濃い＝線や文字）。"""
    pixels = image.load()
    return sum(1 for x in xs for y in ys if max(pixels[x, y]) < threshold)


def bar_top(image: Image.Image, bar: tuple[int, int]) -> int | None:
    """
    棒のいちばん上の行＝75 歳以上の色（濃い・淡い）が棒の幅の 9 割以上を占める最初の行。
    1 点で見ると、合計の数字のふちのぼかしが淡い 75 歳以上の色に近く、数字の中を棒の上と取り違える。
    """
    pixels = image.load()
    targets = (rgb(BAND_COLORS[3]), faint(BAND_COLORS[3]))
    columns = range(bar[0], bar[1] + 1)

    def filled(y: int) -> bool:
        hits = sum(1 for x in columns if any(near(pixels[x, y], target) for target in targets))
        return hits >= 0.9 * len(columns)

    return next((y for y in range(image.size[1]) if filled(y)), None)


def label_pixels(image: Image.Image, bar: tuple[int, int]) -> int:
    """棒の上の 20px（合計の数字の居場所）の濃い画素の数。"""
    top = bar_top(image, bar)
    if top is None:
        return -1
    return count_darker(image, range(bar[0], bar[1] + 1), range(max(0, top - 20), max(0, top - 2)), 160)


def check_pixels(page: Page, name: str) -> None:
    canvas = age_section(page).locator("canvas").first
    image = canvas_image(canvas)
    image.save(f"{OUT}/age-structure-{name}-canvas.png")
    width, height = image.size
    plot_rows = range(0, height - LEGEND_BAND_PX - 18)  # 凡例と年の目盛りより上
    centers = legend_centers(image)
    check(f"[{name}] 凡例に 4 色（左から 0〜14 → 15〜64 → 65〜74 → 75 歳以上）",
          all(center is not None for center in centers) and centers == sorted(centers), f"{centers}")
    solid = clusters(columns_with(image, rgb(BAND_COLORS[1]), plot_rows))
    projected = clusters(columns_with(image, faint(BAND_COLORS[1]), plot_rows))
    check(f"[{name}] 15〜64 歳：実績の棒 2 本は濃い色", len(solid) == 2, f"{solid}")
    check(f"[{name}] 15〜64 歳：推計の棒 6 本は淡い色（不透明度 0.6）・実績より右", len(projected) == 6
          and bool(solid) and min(group[0] for group in projected) > max(group[1] for group in solid), f"{projected}")
    oldest = clusters(columns_with(image, faint(BAND_COLORS[3]), plot_rows))
    check(f"[{name}] 75 歳以上も推計の 6 本は淡い色", len(oldest) == 6, f"{oldest}")
    if len(solid) == 2 and len(projected) == 6:
        # 境の破線（1px・slate-400）。画素の境にかかると 2 列に薄く分かれるので、色ではなく「罫線より濃い」で数える。
        gap = range(solid[1][1] + 2, projected[0][0] - 1)
        rule = count_darker(image, gap, plot_rows, 235)
        check(f"[{name}] 実績と推計の境に破線", rule >= 20, f"{rule} 画素（列 {gap.start}〜{gap.stop}）")
        caption = count_darker(image, range(gap.start, min(width, gap.stop + 30)), range(0, 14), 200)
        check(f"[{name}] 破線の右上に「推計」", caption >= 10, f"{caption} 画素")
        labels = [label_pixels(image, bar) for bar in (solid[0], solid[1], projected[0], projected[-1])]
        check(f"[{name}] 合計の数字は 2020 年と 2050 年の上だけ（2015・2025 年は書かない）",
              labels[0] == 0 and labels[1] > 10 and labels[2] == 0 and labels[3] > 10, f"2015/2020/2025/2050 の画素 {labels}")


# --- 場面 ---------------------------------------------------------------------

BASE_OF: dict[Page, str] = {}


def new_page(browser: Browser, viewport: dict, base: str) -> tuple[Page, list[str]]:
    phone = viewport["width"] < 640
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone)
    page = context.new_page()
    BASE_OF[page] = base
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return page, errors


def scenario_kosugi(browser: Browser, name: str, viewport: dict) -> float:
    page, errors = new_page(browser, viewport, BASE)
    open_population(page, KOSUGI)
    titles = panel_titles(page)
    expected = ["人口の推移（実績・将来推計・1km圏）", "年齢別の人口（1km圏）", "人口増減率（9）"]
    check(f"[{name}] 並び：人口の推移 → 年齢別の人口 → 人口増減率（9）", [t for t in titles if t in expected] == expected, f"{titles}")
    section = age_section(page)
    check(f"[{name}] チップ 3 つ（値の表の指標の数と書式）", chips_of(section) == CHIPS_1KM, f"{chips_of(section)}")
    check(f"[{name}] 武蔵小杉は注意を出さない", "⚠" not in section.inner_text(), section.inner_text()[:80])
    check_pixels(page, name)
    details = detail_root(page).locator("details").filter(has=page.locator("summary", has_text="人口増減率")).first
    check(f"[{name}] 人口増減率の表は畳んである（行は見えない）",
          details.evaluate("(el) => !el.open") and not details.locator("dl").first.is_visible())
    height = tab_height(page)
    page.screenshot(path=f"{OUT}/age-structure-{name}-tab.png", full_page=False)
    details.locator("summary").click()
    page.wait_for_timeout(300)
    rows = details.locator("dl > div").count()
    check(f"[{name}] 押すと 9 行が開く", details.evaluate("(el) => el.open") and rows == 9, f"{rows} 行")
    check(f"[{name}] 横にはみ出さない", not overflows(page))
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url) if "/api/stations/" in request.url else None)
    detail_root(page).get_by_role("button", name="500m", exact=True).click()
    age_section(page, "500m").wait_for(state="visible", timeout=WAIT_MS)
    chips = chips_of(age_section(page, "500m"))
    check(f"[{name}] 500m に替えると題と数が替わる", bool(chips) and chips[0].startswith("15〜64歳（2020年） 18,865 人"), f"{chips}")
    check(f"[{name}] 半径を替えても駅詳細を取り直さない", not requests, f"{requests}")
    check(f"[{name}] 画面のエラーなし", not errors, "; ".join(errors))
    page.context.close()
    return height


def scenario_yabacho(browser: Browser, name: str, viewport: dict) -> None:
    page, errors = new_page(browser, viewport, BASE)
    open_population(page, YABACHO)
    text = age_section(page).inner_text()
    check(f"[{name}] 矢場町：「⚠ 年齢不詳が多い地域です（2020年 30.4%）」", "年齢不詳が多い地域です（2020年 30.4%）" in text, text[-80:])
    check(f"[{name}] 矢場町：チップに ⚠", text.count("⚠") >= 4, f"⚠ {text.count('⚠')} 個")
    age_section(page).screenshot(path=f"{OUT}/age-structure-{name}-yabacho.png")
    check(f"[{name}] 画面のエラーなし（矢場町）", not errors, "; ".join(errors))
    page.context.close()


def main_comparison(browser: Browser, name: str, viewport: dict, height: float) -> None:
    """main のビルドとの比べ（人口タブの高さの差・人口の推移の図が画素まで同じ）。"""
    if BASE_MAIN is None:
        return
    images = []
    heights = []
    for base in (BASE_MAIN, BASE):
        page, _ = new_page(browser, viewport, base)
        open_population(page, KOSUGI)
        heights.append(tab_height(page))
        trend = detail_root(page).locator("section").filter(has=page.locator("h3", has_text="人口の推移")).first.locator("canvas").first
        images.append(canvas_image(trend).tobytes())
        page.context.close()
    print(f"  記録 [{name}] 人口タブの高さ main {heights[0]:.0f}px → 枝 {heights[1]:.0f}px（{heights[1] - heights[0]:+.0f}px・枝の初回 {height:.0f}px）")
    check(f"[{name}] 人口の推移の図は main と画素まで同じ", images[0] == images[1])


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for viewport_name, size in VIEWPORTS.items():
        print(f"■ {viewport_name}（{size['width']}×{size['height']}）")
        measured = scenario_kosugi(browser, viewport_name, size)
        print(f"  記録 [{viewport_name}] 人口タブの高さ {measured:.0f}px（表は畳んだまま）")
        scenario_yabacho(browser, viewport_name, size)
        main_comparison(browser, viewport_name, size, measured)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
