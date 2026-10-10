#!/usr/bin/env python3
"""駅を替えた直後に、**前の駅の災害リスクを出さない**ことを、実ブラウザで確かめる（2026-10-10）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.hazard-station-switch.smoke.py [出力ディレクトリ] [BASE]

## きっかけ（`docs/261001_fix_user_feedback_ui.md` §6.11 の「見つけたこと」）

横浜から東京へ駅を替えたとき、**東京の名前の下に横浜の「⛔ 河岸侵食…」が数秒出ていた**。地点のハザードを取るフック
（`useHazardPoint`）が、新しい駅の結果が届くまで前の駅の結果を返していた（SWR の `keepPreviousData`）。同じ結果を使う
「災害」タブの「もし起きたら」と、「逃げる」で探す**災害の種別**も、前の駅のものになっていた。

## やり方

新しい駅（東京）の `/api/hazard/point` を遅らせ、その間の画面を何度も読む。どの時点でも

1. ヘッダが東京なら、災害バッジは横浜の結果ではない（「確認しています…」か、東京の結果）
2. 「災害」タブが東京なら、「もし起きたら」に横浜のカードが無く、「逃げる」は東京の結果が届くまで出ない
3. 現在地は**同じ「現在地」の移動**なので、新しい位置の結果が届くまで前の結果を出し続ける（ちらつかせない・従来どおり）
"""

import json
import sys
from urllib.parse import quote

from playwright.sync_api import Browser, Page, Route, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

YOKOHAMA = "横浜#0"
#: 新しい駅の地点のハザードを遅らせる時間（その間の画面を読む）。
SLOW_MS = 5_000
#: 画面を読む間隔。
SAMPLE_MS = 150
WAIT_MS = 30_000
SKELETON_JA = "災害リスクを確認しています…"
WIDE = {"width": 1440, "height": 900}
#: 東京駅の近く（現在地の場面）。動かす量は約 110m（丸めの 11m より大きく、別のキーになる）。
TOKYO_POINT = {"latitude": 35.6812, "longitude": 139.7671, "accuracy": 20}
MOVE_DEG = 0.001

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def delay_point(page: Page, place_ja: str) -> None:
    """その地点名の `/api/hazard/point` だけを遅らせる（ほかはそのまま）。"""
    needle = f"placeJa={quote(place_ja)}"

    def handler(route: Route) -> None:
        if needle in route.request.url:
            page.wait_for_timeout(SLOW_MS)
        route.continue_()

    page.route("**/api/hazard/point*", handler)


#: ヘッダの駅名と、災害バッジの文（駅カードの見出しと、バッジの本文の span）。
HEADER_JS = """() => {
  const header = document.querySelector('aside header');
  if (!header) return { name: '', badge: '', text: '' };
  const name = header.querySelector('h2')?.textContent?.trim() ?? '';
  const badge = [...header.querySelectorAll('span')].find((s) => s.className.includes('break-words'))?.textContent?.trim() ?? '';
  return { name, badge, text: header.innerText };
}"""

#: 「災害」タブの本文：「もし起きたら」のカードの見出し（地点名）と、「逃げる」のボタンの有無。
HAZARD_TAB_JS = """() => {
  const aside = document.querySelector('aside');
  const body = aside?.querySelector('.overflow-y-auto');
  if (!body) return { card: '', escape: false, text: '' };
  const card = body.querySelector('section h2')?.textContent?.trim() ?? '';
  const escape = [...body.querySelectorAll('button')].some((b) => b.textContent.includes('避難先と向きを調べる'));
  return { card, escape, text: body.innerText };
}"""


def header(page: Page) -> dict:
    return page.evaluate(HEADER_JS)


def hazard_tab(page: Page) -> dict:
    return page.evaluate(HAZARD_TAB_JS)


def close(page: Page) -> None:
    """遅らせている途中の差し替えを外してから閉じる（閉じたページで待つと落ちる）。"""
    page.unroute_all(behavior="ignoreErrors")
    page.context.close()


def switch_station(page: Page, name: str) -> None:
    box = page.get_by_placeholder("駅名で検索…")
    box.click()
    box.fill(name)
    page.locator("[cmdk-item]").first.wait_for(state="visible", timeout=WAIT_MS)
    page.locator("[cmdk-item]").first.click()


def sample(page: Page, read, duration_ms: int) -> list[dict]:
    """duration_ms のあいだ、SAMPLE_MS ごとに画面を読む。"""
    seen = []
    for _ in range(duration_ms // SAMPLE_MS):
        seen.append(read(page))
        page.wait_for_timeout(SAMPLE_MS)
    return seen


def wait_until(page: Page, read, predicate, timeout_ms: int = WAIT_MS) -> dict:
    """predicate を満たすまで読む（満たした時の値・満たさなければ最後の値）。"""
    value = read(page)
    for _ in range(timeout_ms // SAMPLE_MS):
        if predicate(value):
            return value
        page.wait_for_timeout(SAMPLE_MS)
        value = read(page)
    return value


def scenario_badge(browser: Browser) -> None:
    print("[ヘッダの災害バッジ：東京の名前の下に横浜の結果を出さない]")
    context = browser.new_context(viewport=WIDE)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{BASE}/?grp={quote(YOKOHAMA)}", wait_until="networkidle")
    first = wait_until(page, header, lambda h: h["name"] == "横浜" and h["badge"] != "")
    yokohama_badge = first["badge"]
    check("横浜の災害バッジが出る", yokohama_badge != "", yokohama_badge)
    delay_point(page, "東京")
    switch_station(page, "東京")
    seen = sample(page, header, SLOW_MS - 1_000)
    under_tokyo = [h for h in seen if h["name"] == "東京"]
    wrong = [h for h in under_tokyo if h["badge"] == yokohama_badge]
    check("遅らせているあいだにヘッダが東京になる（確かめる時間がある）", len(under_tokyo) > 0, f"{len(under_tokyo)}/{len(seen)} 回")
    check("東京の名前の下に、横浜の結果を一度も出さない", not wrong, f"{len(wrong)} 回: {yokohama_badge}")
    check("その間は「確認しています…」", any(SKELETON_JA in h["text"] for h in under_tokyo), "")
    done = wait_until(page, header, lambda h: h["name"] == "東京" and h["badge"] not in ("", yokohama_badge))
    check("東京の結果が届けば、東京の結果を出す", done["badge"] not in ("", yokohama_badge), done["badge"])
    page.screenshot(path=f"{OUT}/station-switch-badge.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    close(page)


def scenario_hazard_tab(browser: Browser) -> None:
    print("[「災害」タブ：「もし起きたら」と「逃げる」に横浜の結果を持ち越さない]")
    context = browser.new_context(viewport=WIDE)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{BASE}/?grp={quote(YOKOHAMA)}&tab=hazard", wait_until="networkidle")
    first = wait_until(page, hazard_tab, lambda t: t["card"] == "横浜")
    check("横浜の「もし起きたら」のカード", first["card"] == "横浜", first["card"])
    check("横浜は「逃げる」が出る（該当がある駅）", first["escape"], "")
    delay_point(page, "東京")
    switch_station(page, "東京")
    seen = []
    for _ in range((SLOW_MS - 1_000) // SAMPLE_MS):
        seen.append({**hazard_tab(page), "name": header(page)["name"]})
        page.wait_for_timeout(SAMPLE_MS)
    under_tokyo = [t for t in seen if t["name"] == "東京"]
    check("遅らせているあいだにヘッダが東京になる", len(under_tokyo) > 0, f"{len(under_tokyo)}/{len(seen)} 回")
    check("東京の画面に、横浜の「もし起きたら」を一度も出さない", not [t for t in under_tokyo if t["card"] == "横浜"], "")
    check(
        "東京の結果が届くまで「逃げる」を出さない（横浜の災害の種別で探させない）",
        not [t for t in under_tokyo if t["escape"]],
        f"{sum(1 for t in under_tokyo if t['escape'])} 回",
    )
    done = wait_until(page, hazard_tab, lambda t: t["card"] == "東京")
    check("東京の結果が届けば、東京のカード", done["card"] == "東京", done["card"])
    page.screenshot(path=f"{OUT}/station-switch-hazard-tab.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    close(page)


#: 現在地のカード（「現在地の災害リスク」の中の hazardCard の見出し）と、調べている最中の文。
CURRENT_JS = """() => {
  const panel = [...document.querySelectorAll('aside')].find((a) => a.innerText.includes('現在地の災害リスク'));
  if (!panel) return { card: '', loading: false };
  const card = panel.querySelector('section h2')?.textContent?.trim() ?? '';
  return { card, loading: panel.innerText.includes('災害リスクを調べています…') };
}"""


def current(page: Page) -> dict:
    return page.evaluate(CURRENT_JS)


def scenario_current_position(browser: Browser) -> None:
    print("[現在地：同じ「現在地」の移動では、新しい結果が届くまで前の結果を出し続ける（従来どおり）]")
    context = browser.new_context(viewport=WIDE, geolocation=TOKYO_POINT, permissions=["geolocation"])
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    requested: list[str] = []
    page.on("request", lambda request: requested.append(request.url) if "/api/hazard/point" in request.url else None)
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("button", name="現在地").first.click()
    first = wait_until(page, current, lambda c: c["card"] == "現在地")
    check("現在地のカードが出る", first["card"] == "現在地", json.dumps(first, ensure_ascii=False))
    delay_point(page, "現在地")
    moved = {**TOKYO_POINT, "latitude": TOKYO_POINT["latitude"] + MOVE_DEG}
    context.set_geolocation(moved)
    seen = sample(page, current, SLOW_MS - 1_000)
    moved_lat = f"lat={moved['latitude']:.4f}"
    check("動いた位置を問い合わせている（確かめが空振りしていない）", any(moved_lat in url for url in requested), moved_lat)
    check("移動しても、前の結果を出し続ける（「調べています…」に戻らない）", all(c["card"] == "現在地" and not c["loading"] for c in seen), f"{sum(1 for c in seen if c['loading'])} 回")
    check("画面のエラーなし", not errors, "; ".join(errors))
    close(page)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    scenario_badge(browser)
    scenario_hazard_tab(browser)
    scenario_current_position(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
