#!/usr/bin/env python3
"""図（ランキング・散布・エリア）の半径が、地図で選んでいる半径に合うことを実ブラウザで確かめる（2026-11-14）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.figure-radius.smoke.py [出力ディレクトリ] [BASE]

## きっかけ

ユーザーの報告（2026-11-14）：「地図は 1km で、ランキングも 1km が選ばれるのに、散布図にすると 2km が選ばれる」。
図の既定の半径が決め打ち（ランキング 1km・散布 2km・エリア 1km）で、地図の半径（`?r`）を見ていなかった。
ランキングとエリアは、地図が 1km（既定）のときに偶然そろっていただけ。

## 約束

- FAB で開いた図は、地図の半径で始まる（ランキングの指標・散布の X 軸・エリアの半径）
- 開いている間に地図の半径を替えたら、図も同じ半径に替わる（指標がその半径を持たなければ近い半径）。
  履歴は増やさず、図の中身も作り直さない
- 図の中でカテゴリ・指標を替えても半径は保つ（以前はカテゴリの先頭＝多くは 500m に飛んだ）。
  半径の無い指標から替えるときは地図の半径
- 開いた図に指標があれば（共有リンク・戻る・チャットの ⤢）、開いた時点の地図の半径で上書きしない
- 狭い画面（モーダル）でも同じ
"""

import json
import re
import sys

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

WIDE = {"width": 1280, "height": 900}
NARROW = {"width": 1024, "height": 800}
URL_TIMEOUT_MS = 15_000
SETTLE_MS = 1_500

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# 足された <select> を（すぐ外されても）数える。図の中身を作り直したかを見る（ui.history.smoke.py と同じ方法）。
DOM_PROBE = """
(() => {
  window.__selects = new Set();
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('select')) window.__selects.add(node);
      for (const el of node.querySelectorAll('select')) window.__selects.add(el);
    }
  }).observe(document, { childList: true, subtree: true });
})();
"""


class Session:
    """1 つのタブ。画面のエラーを集める。"""

    def __init__(self, browser: Browser, viewport: dict):
        self.context: BrowserContext = browser.new_context(viewport=viewport)
        self.context.add_init_script(DOM_PROBE)
        self.page: Page = self.context.new_page()
        self.errors: list[str] = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def open(self, query: str) -> None:
        # 地図のタイルが遅いと networkidle は来ない。FAB が出れば操作できる。
        self.page.goto(f"{BASE}/{query}", wait_until="load")
        self.page.locator('button[aria-label="散布図"]').wait_for(state="visible", timeout=30_000)
        self.page.wait_for_timeout(SETTLE_MS)

    def params(self) -> dict[str, str]:
        return self.page.evaluate("() => Object.fromEntries(new URL(location.href).searchParams)")

    def wait_params(self, expected: dict[str, str]) -> bool:
        """URL がそうなるまで待つ（nuqs の書き換えは画面より遅れる）。"""
        script = """(expected) => {
          const params = new URL(location.href).searchParams;
          return Object.entries(expected).every(([key, value]) => params.get(key) === value);
        }"""
        try:
            self.page.wait_for_function(script, arg=expected, timeout=URL_TIMEOUT_MS)
            return True
        except PlaywrightTimeoutError:
            return False

    def expect_params(self, label: str, expected: dict[str, str]) -> None:
        ok = self.wait_params(expected)
        actual = {key: self.params().get(key) for key in expected}
        check(label, ok, json.dumps(actual, ensure_ascii=False))

    def history_length(self) -> int:
        return self.page.evaluate("() => history.length")

    def finish(self, name: str) -> None:
        check("画面のエラーなし", not self.errors, "; ".join(self.errors))
        self.page.screenshot(path=f"{OUT}/figure-radius-{name}.png")
        self.context.close()


def canvas(page: Page):
    return page.locator('aside[aria-label="キャンバス"]')


def open_fab(page: Page, label: str) -> None:
    page.locator(f'button[aria-label="{label}"]').click()


def map_radius_button(page: Page, label: str):
    """地図の上の半径（ラベルの無いボタン。図の中の半径はどれも aria-label を持つ）。"""
    return page.locator("button:not([aria-label])").filter(has_text=re.compile(rf"^{re.escape(label)}$"))


def click_map_radius(session: Session, label: str) -> None:
    button = map_radius_button(session.page, label)
    check(f"地図の半径「{label}」のボタンは 1 つ", button.count() == 1, f"{button.count()} 個")
    button.first.click()


def segment_selected(scope, aria_label: str) -> bool:
    """図の中の半径のボタンが選ばれているか（選ばれたボタンだけが藍色の文字）。"""
    button = scope.locator(f'button[aria-label="{aria_label}"]')
    if button.count() != 1:
        return False
    return "text-indigo-700" in (button.get_attribute("class") or "")


def selects_added(page: Page, action) -> tuple[int, int]:
    """action のあいだに足された <select> の数と、そのうち残っている数。"""
    page.evaluate("() => window.__selects.clear()")
    action()
    page.wait_for_timeout(2_000)
    return page.evaluate("() => [window.__selects.size, [...window.__selects].filter((el) => el.isConnected).length]")


def close_canvas(page: Page) -> None:
    page.get_by_role("button", name="キャンバスを閉じる").click()
    page.wait_for_function("() => !new URL(location.href).searchParams.has('fig')", timeout=URL_TIMEOUT_MS)


# --- 場面 --------------------------------------------------------------------


def user_report(browser: Browser) -> None:
    print("■ 報告の場面：地図は既定の 1km。ランキングも散布図も 1km で開く")
    s = Session(browser, WIDE)
    s.open("")
    open_fab(s.page, "ランキング")
    s.expect_params("ランキングは 1km で開く", {"fig": "ranking", "figM": "pop_gr_2020_2015_1km"})
    close_canvas(s.page)
    open_fab(s.page, "散布図")
    s.expect_params(
        "散布図の X 軸も 1km で開く（以前は 2km）",
        {"fig": "scatter", "figX": "pop_gr_2020_2015_1km", "figY": "rate_covid"},
    )
    c = canvas(s.page)
    check("散布図の X 軸の半径の表示も 1km", segment_selected(c, "X軸 半径 1km"))
    s.finish("report")


def open_at_map_radius(browser: Browser) -> None:
    print("■ 地図が 5km：FAB で開いた図は、どれも 5km で始まる")
    s = Session(browser, WIDE)
    s.open("?r=5000")
    open_fab(s.page, "ランキング")
    s.expect_params("ランキングは 5km で開く（以前は 1km）", {"fig": "ranking", "figM": "pop_gr_2020_2015_5km"})
    check("ランキングの半径の表示も 5km", segment_selected(canvas(s.page), "半径 5km"))
    close_canvas(s.page)
    open_fab(s.page, "散布図")
    s.expect_params("散布図の X 軸は 5km で開く（以前は 2km）", {"fig": "scatter", "figX": "pop_gr_2020_2015_5km"})
    close_canvas(s.page)
    open_fab(s.page, "エリア")
    s.expect_params("エリアの図は 5km で開く（以前は 1km）", {"fig": "area", "figR": "5000"})
    area_button = canvas(s.page).locator('button[aria-label="駅の周り 5km"]')
    check("エリアの図の半径の表示も 5km", area_button.get_attribute("aria-pressed") == "true")
    s.finish("open-5km")


def scatter_follows_map(browser: Browser) -> None:
    print("■ 散布図を開いたまま地図の半径を替える・カテゴリと指標を替える（広い画面のキャンバス）")
    s = Session(browser, WIDE)
    s.open("")
    open_fab(s.page, "散布図")
    s.expect_params("1km で開く", {"fig": "scatter", "figX": "pop_gr_2020_2015_1km"})
    before = s.history_length()
    added, kept = selects_added(s.page, lambda: click_map_radius(s, "10km"))
    s.expect_params(
        "地図を 10km にすると X 軸も 10km（Y 軸の半径なしの指標はそのまま）",
        {"r": "10000", "figX": "pop_gr_2020_2015_10km", "figY": "rate_covid"},
    )
    check("X 軸の半径の表示も 10km", segment_selected(canvas(s.page), "X軸 半径 10km"))
    check("履歴は増えない（半径は調整＝replace）", s.history_length() == before, f"{before} → {s.history_length()}")
    check("図の中身を作り直さない（<select> を足し直さない）", added == 0, f"足した {added}・残った {kept}")

    c = canvas(s.page)
    c.get_by_label("X軸 カテゴリ", exact=True).select_option("establishment")
    s.expect_params("X 軸のカテゴリを替えても 10km のまま（以前は 500m）", {"figX": "estab_n_2021_10km"})
    c.get_by_label("Y軸 カテゴリ", exact=True).select_option("population")
    s.expect_params("半径なしの Y 軸からカテゴリを替えると地図の 10km（以前は 500m）", {"figY": "pop_2020_10km"})
    c.get_by_label("X軸 カテゴリ", exact=True).select_option("land_price")
    s.expect_params("地価の先頭（最寄の地価公示・半径なし）", {"figX": "lp_near_price"})
    c.get_by_label("X軸 指標", exact=True).select_option("lp_med|2026||")
    s.expect_params("半径なしの指標から地価の中央値へ：地図の 10km（以前は 500m）", {"figX": "lp_med_2026_10km"})

    click_map_radius(s, "20km")
    s.expect_params(
        "地図を 20km に：地価の中央値は 20km が無いので 10km、Y 軸の人口は 20km",
        {"r": "20000", "figX": "lp_med_2026_10km", "figY": "pop_2020_20km"},
    )
    s.finish("scatter-follow")


def ranking_follows_map(browser: Browser) -> None:
    print("■ ランキングを開いたまま地図の半径を替える・指標を替える（無い半径は近い半径）")
    s = Session(browser, WIDE)
    s.open("?r=5000")
    open_fab(s.page, "ランキング")
    s.expect_params("5km で開く", {"fig": "ranking", "figM": "pop_gr_2020_2015_5km"})
    c = canvas(s.page)
    c.get_by_label("カテゴリ", exact=True).select_option("land_price")
    s.expect_params("地価の先頭（半径なし）", {"figM": "lp_near_price"})
    c.get_by_label("指標", exact=True).select_option("lp_gr|2026|2025|")
    s.expect_params("地価の増減率へ：地図の 5km（以前は先頭の 1km）", {"figM": "lp_gr_2026_2025_5km"})
    click_map_radius(s, "20km")
    s.expect_params("地図を 20km に：地価の増減率は 20km が無いので 10km", {"r": "20000", "figM": "lp_gr_2026_2025_10km"})
    click_map_radius(s, "500m")
    s.expect_params("地図を 500m に：500m も無いので 1km", {"r": "500", "figM": "lp_gr_2026_2025_1km"})
    check("ランキングの半径の表示は 1km", segment_selected(c, "半径 1km"))
    s.finish("ranking-follow")


def area_follows_map(browser: Browser) -> None:
    print("■ エリアの図を開いたまま地図の半径を替える")
    s = Session(browser, WIDE)
    s.open("?r=2000")
    open_fab(s.page, "エリア")
    s.expect_params("2km で開く（以前は 1km）", {"fig": "area", "figR": "2000"})
    click_map_radius(s, "5km")
    s.expect_params("地図を 5km にするとエリアの図も 5km", {"r": "5000", "figR": "5000"})
    button = canvas(s.page).locator('button[aria-label="駅の周り 5km"]')
    check("エリアの図の半径の表示も 5km", button.get_attribute("aria-pressed") == "true")
    s.finish("area-follow")


def opened_figure_kept(browser: Browser) -> None:
    print("■ 開いた図に指標があれば（共有リンク・戻る・チャットの ⤢）、地図の半径で上書きしない")
    s = Session(browser, WIDE)
    s.open("?r=1000&fig=scatter&figX=pop_gr_2020_2015_2km&figY=rate_covid")
    canvas(s.page).get_by_label("X軸 カテゴリ", exact=True).wait_for(state="visible", timeout=30_000)
    s.page.wait_for_timeout(SETTLE_MS)
    params = s.params()
    check("散布図の X 軸は 2km のまま（地図は 1km）", params.get("figX") == "pop_gr_2020_2015_2km", str(params.get("figX")))
    check("X 軸の半径の表示も 2km", segment_selected(canvas(s.page), "X軸 半径 2km"))
    click_map_radius(s, "5km")
    s.expect_params("そのあと地図を 5km にすると、図も 5km に合わせる", {"r": "5000", "figX": "pop_gr_2020_2015_5km"})
    s.finish("opened-kept")

    s = Session(browser, WIDE)
    s.open("?r=1000&fig=ranking&figM=pop_gr_2020_2015_5km")
    canvas(s.page).get_by_label("カテゴリ", exact=True).wait_for(state="visible", timeout=30_000)
    s.page.wait_for_timeout(SETTLE_MS)
    params = s.params()
    check("ランキングも 5km のまま（地図は 1km）", params.get("figM") == "pop_gr_2020_2015_5km", str(params.get("figM")))
    s.finish("opened-kept-ranking")


def narrow_modal(browser: Browser) -> None:
    print("■ 狭い画面（モーダル）：地図が 5km なら散布図も 5km で開く")
    s = Session(browser, NARROW)
    s.open("?r=5000")
    open_fab(s.page, "散布図")
    dialog = s.page.get_by_role("dialog", name="散布図")
    dialog.wait_for(state="visible", timeout=30_000)
    s.expect_params("散布図の X 軸は 5km（以前は 2km）", {"fig": "scatter", "figX": "pop_gr_2020_2015_5km"})
    check("モーダルの X 軸の半径の表示も 5km", segment_selected(dialog, "X軸 半径 5km"))
    s.finish("narrow")


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for scene in (
            user_report,
            open_at_map_radius,
            scatter_follows_map,
            ranking_follows_map,
            area_follows_map,
            opened_figure_kept,
            narrow_modal,
        ):
            try:
                scene(browser)
            except Exception as error:  # noqa: BLE001 — 1 つの場面が壊れても残りは流す
                check(f"{scene.__name__} が最後まで動く", False, repr(error)[:300])
        browser.close()
    print()
    if failures:
        print(f"FAILED {len(failures)} 項目")
        for failure in failures:
            print(f"  - {failure}")
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
