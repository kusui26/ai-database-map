#!/usr/bin/env python3
"""順位の図の**注意の印（※）**を、実ブラウザの 3 幅で確かめる（2026-11-25・計画書 261122 §8.2）。

年齢の順位では、都心の駅（年齢不詳が多く、年齢の構成の多くを補った値）が上に並ぶ。⚠（信頼性が低い・除外できる）は
そのままにして、年齢不詳の注意だけを値の右の ※ と、題のすぐ下の 1 行で出す（図は 50 駅を並べるので、表の下だと送らないと読めない）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.ranking-notice.smoke.py [出力ディレクトリ] [BASE]

## 見ること（1440／1024／390 の 3 幅）

1. 愛知県の「生産年齢人口の割合」の順位：応答の印のある行と、画面の ※ の数が同じ。題のすぐ下（表の上）に印の意味の 1 行
2. 印のある行の ※ は ⚠ と別の色（⚠ は琥珀色・※ は灰色）
3. 秋田県の「高齢化率」の順位（上位 50 駅に年齢不詳の多い駅が無い）：※ も印の意味の行も出ない
4. 岡山県の「高齢化率」の順位（印のある駅は 51 位から）：最初は ※ も意味の行も無く、「もっと見る」で 51〜100 位を読むと、
   ※ と意味の行が出る（意味は 2 ページ目の応答にだけある。1 ページ目の応答だけを見ると ※ だけが出る）
5. 横にはみ出さない・画面のエラーなし
"""

import sys

from playwright.sync_api import Page, Response, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

VIEWPORTS = {
    "wide": {"width": 1440, "height": 900},
    "mid": {"width": 1024, "height": 800},
    "phone": {"width": 390, "height": 844},
}
NOTICED_QUERY = "fig=ranking&figM=pop15_64_share_2020_1km&figPref=愛知県"
#: 上位 50 駅に年齢不詳の多い駅が無い年齢の順位（2026-11-25 に API で確かめた。神奈川県は 21〜50 位に 1 駅ある）。
PLAIN_QUERY = "fig=ranking&figM=pop65_share_2020_1km&figPref=秋田県"
#: 1 ページ目（50 駅）に印が無く、2 ページ目に印がある順位（2026-11-25 に API で確かめた。⚠ 除外で 58・79・88・93 位）。
LATER_QUERY = "fig=ranking&figM=pop65_share_2020_1km&figPref=岡山県"
NOTICE_PREFIX = "※ 年齢不詳が多い駅"
WAIT_MS = 30_000
SETTLE_MS = 1_500

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def open_ranking(page: Page, query: str) -> Response:
    """順位の図を開き、順位の API の応答を待つ。"""
    with page.expect_response(lambda response: "/api/ranking" in response.url, timeout=WAIT_MS) as info:
        page.goto(f"{BASE}/?{query}", wait_until="domcontentloaded")
    page.wait_for_timeout(SETTLE_MS)
    return info.value


def marks_on_screen(page: Page) -> dict[str, object]:
    """画面の順位表の ※ の数と色・⚠ の数・印の意味の行。"""
    return page.evaluate(
        """(prefix) => {
          const spans = [...document.querySelectorAll('ol li button span')].filter((s) => s.textContent.trim() === '※')
          const colors = [...new Set(spans.map((s) => getComputedStyle(s).color))]
          const warn = [...document.querySelectorAll('ol li button span')].filter((s) => s.textContent.includes('⚠')).length
          const noteNode = [...document.querySelectorAll('p')].find((p) => p.textContent.trim().startsWith(prefix))
          const note = noteNode !== undefined
          const noteColor = noteNode === undefined ? null : getComputedStyle(noteNode).color
          const list = document.querySelector('ol')
          const above = noteNode !== undefined && list !== null
            && noteNode.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 1
          return { notices: spans.length, colors, warn, note, noteColor, above }
        }""",
        NOTICE_PREFIX,
    )


def noticed_ranking(page: Page, name: str) -> None:
    """見ること 1・2：印のある順位。"""
    body = open_ranking(page, NOTICED_QUERY).json()
    noticed = [row["name"] for row in body.get("rows", []) if row.get("noticed") is True]
    check(f"[{name}] 応答：愛知県の生産年齢人口の割合に印のある行と印の意味",
          len(noticed) > 0 and str(body.get("noticeJa", "")).startswith(NOTICE_PREFIX), f"{noticed[:5]}")
    marks = marks_on_screen(page)
    visible = page.locator("ol li").count()
    expected = sum(1 for row in body.get("rows", [])[:visible] if row.get("noticed") is True)
    check(f"[{name}] 画面の ※ の数＝見えている行のうち印のある行", marks["notices"] == expected,
          f"※ {marks['notices']}・印のある行 {expected}・行 {visible}")
    # 色は lab() で返る（Tailwind 4）。※ と印の意味の行は同じ灰色（text-slate-400）で、⚠ の琥珀色とは別。
    check(f"[{name}] ※ は灰色（印の意味の行と同じ・⚠ の琥珀色と別）",
          marks["colors"] == [marks["noteColor"]], f"※ {marks['colors']}・意味の行 {marks['noteColor']}")
    check(f"[{name}] 題のすぐ下（表の上）に印の意味の 1 行", marks["note"] is True and marks["above"] is True,
          f"note={marks['note']}・above={marks['above']}")
    page.screenshot(path=f"{OUT}/ranking-notice-{name}.png")


def plain_ranking(page: Page, name: str) -> None:
    """見ること 3：印の無い順位。"""
    plain = open_ranking(page, PLAIN_QUERY).json()
    plain_marks = marks_on_screen(page)
    check(f"[{name}] 印の無い順位（秋田県の高齢化率）は応答に印が無い",
          "noticeJa" not in plain and not any("noticed" in row for row in plain.get("rows", [])))
    check(f"[{name}] 印の無い順位は ※ も意味の行も出ない",
          plain_marks["notices"] == 0 and plain_marks["note"] is False, f"{plain_marks}")


def later_ranking(page: Page, name: str) -> None:
    """見ること 4：印のある駅が 2 ページ目から現れる順位（もっと見る）。"""
    first = open_ranking(page, LATER_QUERY).json()
    before = marks_on_screen(page)
    check(f"[{name}] 岡山県の高齢化率：1 ページ目は印も意味も無い",
          "noticeJa" not in first and before["notices"] == 0 and before["note"] is False, f"{before}")
    with page.expect_response(lambda response: "/api/ranking" in response.url and "offset=50" in response.url,
                              timeout=WAIT_MS) as info:
        page.get_by_role("button", name="もっと見る").click()
    page.wait_for_timeout(SETTLE_MS)
    second = info.value.json()
    expected = sum(1 for row in second.get("rows", []) if row.get("noticed") is True)
    after = marks_on_screen(page)
    check(f"[{name}] もっと見る：2 ページ目の印の数だけ ※", expected > 0 and after["notices"] == expected,
          f"※ {after['notices']}・印のある行 {expected}")
    check(f"[{name}] もっと見る：題のすぐ下に印の意味の行が出る", after["note"] is True and after["above"] is True,
          f"note={after['note']}・above={after['above']}")


def run(browser, name: str, viewport: dict) -> None:
    print(f"■ {name}（{viewport['width']}×{viewport['height']}）")
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    noticed_ranking(page, name)
    plain_ranking(page, name)
    later_ranking(page, name)
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
