#!/usr/bin/env python3
"""駅の「災害」タブの描き直しを、**実ブラウザで**確かめる（2026-11-11・`docs/261110_fix_PLAN.md` §8・§10.2 PR-5）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（.env の SUPABASE_* が要る）
    pip install playwright && playwright install chromium
    python3 tests/ui.hazard-tab.smoke.py [BASE] [出力ディレクトリ]

## 何を見るか（3 つの幅：1440×900・1280×700・390×844）

地点のカードは、その場所に固有の注意を見せ、一般論を「根拠と注意（N）」に畳む。確かめるのは
1. **何も押さずに**「安全という意味ではありません」が見え、該当しなかった種類（応答の `groupStates`）が
   状態ごとの行に全部出る（該当の種類は該当の行が出す）
2. 畳んだ中の注意の数が、応答の注意（`notesJa`＋`coverageNotesJa`）の数と同じ（**1 行も捨てていない**）。
   根拠は、行のすぐ下に出した川の到達・継続のぶんを除いて全部入る
3. 免責はタブに **1 回**——「逃げる」を閉じた状態でも、開いた状態でも
4. 配備の切り替わりの間にキャッシュに残る**古い応答**（3 項目が無い）でも、今までの描き方で落ちずに描ける
5. ページが横にはみ出さない・画面のエラーが無い

応答は画面と同じ `/api/hazard/point` の返事を横で読み、画面の数と突き合わせる。警戒中の「いま」（警報のカード）は
`tests/ui.hazard-alert-card.smoke.py` が見る。浸水ナビは分間 24 本までなので、駅の間を空けて開く。
"""

import json
import sys
import time
from urllib.parse import quote

from playwright.sync_api import Browser, Page, Response, Route, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3399"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
WAIT_MS = 60_000
#: 浸水ナビ（分間 24 本）を守る間隔。
GAP_S = 4
VIEWPORTS = [
    ("wide", {"width": 1440, "height": 900}),
    ("short", {"width": 1280, "height": 700}),
    ("phone", {"width": 390, "height": 844}),
]
#: 亀有＝該当 4 件・図なしの種類がある／立川＝該当なし・隣のメッシュが区域。
STATIONS = [("亀有", "亀有#0"), ("立川", "立川#0")]
NOT_SAFE = "安全という意味ではありません"
#: 文の正は src/shared/hazard/hazard-catalog.json（注意書き）。
DISCLAIMER = "市町村が発表する避難情報に従ってください"
PHONE_MAX_WIDTH = 640

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'OK  ' if condition else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


#: 災害タブの本文（スクロールする箱）。「もし起きたら」の見出しから上へたどる。
TAB_JS = """() => {
  const heading = [...document.querySelectorAll('h3')].find(
    (h) => h.getBoundingClientRect().width > 0 && h.textContent.trim() === 'もし起きたら')
  let box = heading?.parentElement ?? null
  while (box && !['auto', 'scroll'].includes(getComputedStyle(box).overflowY)) box = box.parentElement
  if (!box) return null
  const count = (selector) => box.querySelectorAll(selector).length
  return {
    text: box.innerText,
    overflowX: box.scrollWidth > box.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
    details: count('details'),
    notes: count('details ul[aria-label="注意"] > li'),
    reasons: count('details ul[aria-label="根拠"] > li'),
    summary: box.querySelector('details > summary')?.textContent?.trim() ?? null,
    loading: box.innerText.includes('災害リスクを調べています'),
  }
}"""


def tab(page: Page) -> dict:
    return page.evaluate(TAB_JS) or {}


def wait_tab(page: Page) -> dict:
    """「もし起きたら」のカードが出るまで待つ（初めての地点は外部の API を引くので遅い）。"""
    deadline = time.time() + WAIT_MS / 1000
    state = tab(page)
    while time.time() < deadline:
        state = tab(page)
        if state and not state.get("loading") and "もし起きたら" in state.get("text", "") and DISCLAIMER in state.get("text", ""):
            return state
        page.wait_for_timeout(500)
    return state


def wait_escape(page: Page) -> dict:
    """「逃げる」を開いたあと、避難先の一覧（または出せない理由）が出るまで待つ。"""
    deadline = time.time() + WAIT_MS / 1000
    state = tab(page)
    while time.time() < deadline:
        state = tab(page)
        text = state.get("text", "")
        if "避難場所を探しています" not in text and ("指定緊急避難場所" in text or "取得できませんでした" in text):
            return state
        page.wait_for_timeout(500)
    return state


def open_page(browser: Browser, viewport: dict) -> tuple[Page, list[str], dict]:
    phone = viewport["width"] < PHONE_MAX_WIDTH
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone, device_scale_factor=1)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    seen: dict = {}

    def keep(response: Response) -> None:
        if "/api/hazard/point" in response.url and response.ok:
            try:
                seen["point"] = response.json()
            except Exception:  # noqa: BLE001 — 読めない返事は「見ていない」として扱う
                pass

    page.on("response", keep)
    return page, errors, seen


def expected_counts(point: dict) -> tuple[int, int]:
    """畳んだ中に入るべき注意と根拠の数（根拠は、外に出した川の到達・継続を除く）。"""
    highlights = set(point.get("highlightsJa") or [])
    reasons = [reason for reason in point["verdict"]["reasonsJa"] if reason not in highlights]
    return len(point["notesJa"]) + len(point["coverageNotesJa"]), len(reasons)


def scenario_station(browser: Browser, name: str, viewport: dict, station: str, grp: str) -> None:
    label = f"{name}・{station}"
    page, errors, seen = open_page(browser, viewport)
    page.goto(f"{BASE}/?grp={quote(grp)}&tab=hazard", wait_until="load")
    shown = wait_tab(page)
    point = seen.get("point")
    check(f"{label}：応答を読めた", point is not None)
    if point is None:
        page.context.close()
        return
    text = shown.get("text", "")
    # 1. 何も押さずに見えるもの
    check(f"{label}：押さなくても「{NOT_SAFE}」が見える", NOT_SAFE in text)
    for state in point["groupStates"]:
        if state["state"] == "hit":
            continue
        check(f"{label}：{state['labelJa']}（{state['stateJa']}）が状態の行に見える", f"{state['stateJa']}：" in text and state["labelJa"] in text)
    for item in point["hazards"]:
        check(f"{label}：該当の行（{item['labelJa']}）が見える", item["labelJa"] in text)
    for fact in point.get("highlightsJa") or []:
        check(f"{label}：川の到達・継続が見える", fact in text, fact)
    # 2. 畳んだ中身（1 行も捨てない）
    notes, reasons = expected_counts(point)
    check(f"{label}：見出しは「根拠と注意（{notes + reasons}）」", shown.get("summary") == f"根拠と注意（{notes + reasons}）", str(shown.get("summary")))
    page.locator("details > summary", has_text="根拠と注意").first.click()
    opened = tab(page)
    check(f"{label}：畳んだ中の注意の数が応答と同じ（{notes}）", opened.get("notes") == notes, str(opened.get("notes")))
    check(f"{label}：畳んだ中の根拠の数が応答と同じ（{reasons}）", opened.get("reasons") == reasons, str(opened.get("reasons")))
    # 3. 免責はタブに 1 回（閉じた状態）
    check(f"{label}：免責はタブに 1 回（「逃げる」を閉じた状態）", text.count(DISCLAIMER) == 1, f"{text.count(DISCLAIMER)} 回")
    check(f"{label}：「安全です」とは書かない", "安全です" not in opened.get("text", ""))
    check(f"{label}：横にはみ出さない", not opened.get("overflowX"))
    page.screenshot(path=f"{OUT}/hazard-tab-{name}-{station}.png")
    # 3'. 「逃げる」を開いた状態（該当がある駅だけ段が出る）
    escape = page.locator("button[aria-expanded]", has_text="の避難先")
    if escape.count() > 0:
        check(f"{label}：「逃げる」のボタンがどの災害の話かを言う", escape.first.inner_text().startswith(("洪水", "内水", "高潮", "津波", "崖崩れ")), escape.first.inner_text())
        escape.first.click()
        after = wait_escape(page)
        check(f"{label}：免責はタブに 1 回（「逃げる」を開いた状態）", after.get("text", "").count(DISCLAIMER) == 1, f"{after.get('text', '').count(DISCLAIMER)} 回")
        check(f"{label}：避難先の限界は畳まない（開設されているとは限らない）", "開設" in after.get("text", ""))
        check(f"{label}：開いても横にはみ出さない", not after.get("overflowX"))
        page.screenshot(path=f"{OUT}/hazard-tab-{name}-{station}-escape.png")
    check(f"{label}：画面のエラーなし", errors == [], "; ".join(errors))
    page.context.close()


def scenario_legacy(browser: Browser, viewport: dict) -> None:
    """配備の切り替わりの間：3 項目の無い古い応答（キャッシュ）を、新しい画面が受けたとき。"""
    page, errors, _seen = open_page(browser, viewport)

    def strip(route: Route) -> None:
        response = route.fetch()
        body = response.json()
        for key in ("groupStates", "keyNotesJa", "highlightsJa"):
            body.pop(key, None)
        route.fulfill(response=response, body=json.dumps(body, ensure_ascii=False))

    page.route("**/api/hazard/point*", strip)
    page.goto(f"{BASE}/?grp={quote('亀有#0')}&tab=hazard", wait_until="load")
    shown = wait_tab(page)
    check("古い応答：今までの描き方で描ける（畳まない）", shown.get("details") == 0, str(shown.get("details")))
    check("古い応答：網羅性の注記が見える", "白い場所は" in shown.get("text", "") or "想定区域図がありません" in shown.get("text", ""))
    check("古い応答：免責はタブに 1 回", shown.get("text", "").count(DISCLAIMER) == 1)
    check("古い応答：画面のエラーなし", errors == [], "; ".join(errors))
    page.screenshot(path=f"{OUT}/hazard-tab-legacy.png")
    page.context.close()


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for name, viewport in VIEWPORTS:
            print(f"[{name}]")
            for station, grp in STATIONS:
                scenario_station(browser, name, viewport, station, grp)
                time.sleep(GAP_S)
        print("[古い応答]")
        scenario_legacy(browser, VIEWPORTS[0][1])
        browser.close()
    print()
    if failures:
        print(f"FAIL {len(failures)} 件")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
