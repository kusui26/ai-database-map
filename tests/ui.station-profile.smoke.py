#!/usr/bin/env python3
"""駅周辺のプロフィール——駅詳細の「概要」タブと、チャットの回答（`getStationProfile`）を実ブラウザで確かめる
（2026-10-09 B4・`docs/261001_fix_user_feedback_ui.md` §6.4・§12-7）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.station-profile.smoke.py [出力ディレクトリ] [BASE]

## 見ること

1. 記憶の無い端末で駅を開くと「概要」タブ（先頭）。性格の目安・位置の凡例・11 指標・「見ていないこと」が出て、
   災害は出さない（ヘッダのバッジが出している）。「災害」タブへの入口がある
2. 位置（目盛り＋「県内 上位 19%」＋順位/駅数）は 1 行に収まり、文字が切れない（広い画面・携帯・会話の中の図とも）。
   横にはみ出さない
3. 集計半径を替えると、その半径のプロフィールを取り直す（題が「（2km圏）」に）
4. 駅を替えた直後に、前の駅のプロフィールを出さない（新しい駅の応答を遅らせて確かめる）
5. チャットの回答（駅カード＋プロフィール・⤢ は概要タブ）：広い画面は駅詳細が**概要タブ**で開き（覚えたタブが所得でも）、
   チップは「横浜 の概要」。携帯は会話の中にプロフィールが出て、⤢ でシートが概要タブで開く

`/api/chat` は差し替える（モデルには触らない）。プロフィールの中身は本物の API（`/api/stations/[grp]/profile`）から取って
回答に載せる——サーバの `stationProfilePanel` と同じ形に写す。
"""

import json
import sys
import urllib.parse
import urllib.request

from playwright.sync_api import Browser, BrowserContext, Page, Route, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

STORAGE_KEY = "ai-database-map:detail-tab"
YOKOHAMA = "横浜#0"
WIDE = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}
WAIT_MS = 20_000
#: 前の駅を出さないことを見るために、新しい駅のプロフィールを遅らせる時間。
SLOW_PROFILE_MS = 3_000
#: 位置 1 つの行の高さの上限（11px の 1 行＋余白。2 行に折り返すと 30px を超える）。
ONE_LINE_PX = 22
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def quote(grp: str) -> str:
    return urllib.parse.quote(grp, safe="")


def fetch_profile(grp: str, radius_m: int = 1000) -> dict:
    with urllib.request.urlopen(f"{BASE}/api/stations/{quote(grp)}/profile?radiusM={radius_m}", timeout=60) as response:
        return json.load(response)


def radius_label(radius_m: int) -> str:
    return f"{radius_m // 1000}km" if radius_m >= 1000 else f"{radius_m}m"


def profile_panel(profile: dict) -> dict:
    """サーバの `stationProfilePanel(profile, 'compact')` と同じ形（チャットの回答に載る）。"""
    station = profile["station"]
    return {
        "type": "stationProfile",
        "grp": station["grp"],
        "title": f"{station['label']}の周辺（{radius_label(profile['radiusM'])}圏）",
        "placeJa": station["label"],
        "radiusM": profile["radiusM"],
        "areaJa": profile["area"],
        "positionsLegendJa": profile["positionsLegendJa"],
        "character": profile["character"],
        "sections": profile["sections"],
        "hazard": profile["hazard"],
        "notCoveredJa": profile["notCoveredJa"],
        "notesJa": profile["notesJa"],
        "sources": [{"labelJa": s["source"], "url": None, "license": s["license"], "forJa": None} for s in profile["sources"]],
        "placement": "inline",
        "size": "compact",
    }


def profile_answer(profile: dict) -> str:
    """getStationProfile を 1 回呼んだときの応答（条件を図より先に送る・サーバと同じ並び）。"""
    station = profile["station"]
    card = {
        "type": "stationCard",
        "grp": station["grp"],
        "stationName": station["stationName"],
        "label": station["label"],
        "prefecture": station["prefecture"],
        "operators": station["operators"],
        "paxLatest": station["paxLatest"],
        "badges": [],
        "placement": "inline",
        "size": "compact",
    }
    actions = [
        {"type": "flyTo", "lon": station["lon"], "lat": station["lat"], "zoom": 12},
        {"type": "selectStation", "grp": station["grp"], "radiusM": profile["radiusM"]},
    ]
    promotion = {"kind": "detail", "grp": station["grp"], "category": None, "tab": "overview"}
    text = "横浜駅の 1km 圏は業務地型です。"
    chunks = [
        {"type": "start", "messageId": "smoke-profile"},
        {"type": "start-step"},
        {"type": "data-promotions", "id": "promotions", "data": [promotion, None]},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": actions, "panels": [card, profile_panel(profile)]}},
        {"type": "finish-step"},
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"


# --- 画面の読み取り ----------------------------------------------------------

ACTIVE_TAB_JS = """() => {
  const active = [...document.querySelectorAll('button.border-b-2')].find((b) => b.className.includes('border-indigo-600'));
  return active ? active.textContent.trim() : '(なし)';
}"""

DETAIL_TEXT_JS = """() => {
  const tab = document.querySelector('button.border-b-2');
  return (tab?.closest('aside') ?? tab?.closest('[data-vaul-drawer]'))?.innerText ?? '';
}"""


def active_tab(page: Page) -> str:
    return page.evaluate(ACTIVE_TAB_JS)


def wait_for_tab(page: Page, label: str) -> bool:
    try:
        page.wait_for_function(f"() => ({ACTIVE_TAB_JS})() === {json.dumps(label)}", timeout=WAIT_MS)
        return True
    except Exception:  # noqa: BLE001 — 待ちきれなかったことを判定に使う
        return False


def wait_for_text(page: Page, needle: str) -> bool:
    try:
        page.wait_for_function(f"() => ({DETAIL_TEXT_JS})().includes({json.dumps(needle)})", timeout=WAIT_MS)
        return True
    except Exception:  # noqa: BLE001
        return False


def detail_text(page: Page) -> str:
    return page.evaluate(DETAIL_TEXT_JS)


def params(page: Page) -> dict[str, str]:
    return {key: values[0] for key, values in urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).items()}


def position_heights(page: Page) -> list[float]:
    """位置（目盛り＋文字）1 つずつの高さ。"""
    return page.evaluate(
        """() => [...document.querySelectorAll('[title*="駅中"]')].map((el) => el.getBoundingClientRect().height)"""
    )


def truncated_positions(page: Page) -> list[str]:
    """文字が切れている位置（「13/3…」）。目盛りの隣の文字が、箱より広い。"""
    return page.evaluate(
        """() => [...document.querySelectorAll('[title*="駅中"]')]
          .map((el) => el.lastElementChild)
          .filter((text) => text && text.scrollWidth > text.clientWidth + 1)
          .map((text) => text.textContent)"""
    )


def overflows_horizontally(page: Page) -> bool:
    return page.evaluate(
        """() => {
          const tab = document.querySelector('button.border-b-2');
          const root = tab?.closest('aside') ?? tab?.closest('[data-vaul-drawer]');
          const body = root?.querySelector('.overflow-y-auto');
          return body ? body.scrollWidth > body.clientWidth + 1 : true;
        }"""
    )


def open_page(browser: Browser, viewport: dict, remembered: str | None = None) -> tuple[BrowserContext, Page, list[str]]:
    phone = viewport["width"] < 640
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone)
    if remembered is not None:
        context.add_init_script(f"localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(remembered)})")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page, errors


def send_chat(page: Page, question: str) -> None:
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


# --- 場面 --------------------------------------------------------------------


def scenario_overview(browser: Browser, viewport: dict, name: str) -> None:
    print(f"[概要タブ：記憶の無い端末は概要で開く・中身・1 行の位置・{name}]")
    context, page, errors = open_page(browser, viewport)
    page.goto(f"{BASE}/?grp={quote(YOKOHAMA)}", wait_until="networkidle")
    check("記憶が無ければ概要タブ（先頭）で開く", wait_for_tab(page, "概要"), f"タブ={active_tab(page)}")
    check("題「横浜の周辺（1km圏）」", wait_for_text(page, "横浜の周辺（1km圏）"))
    text = detail_text(page)
    for needle in ["業務地型", "位置は 県内＝神奈川県、市内＝横浜市", "人口", "地価（中央値）", "乗降客数（この駅）", "このプロフィールで見ていないこと", "治安（犯罪の件数）"]:
        check(f"「{needle}」が出る", needle in text)
    check("市内では比べない所得には、その理由が出る", "市全体の平均が主" in text)
    check("概要タブは災害の要約を出さない（ヘッダのバッジが出している）", "区域図が無い災害" not in text)
    heights = position_heights(page)
    check(f"位置は {len(heights)} 個・どれも 1 行（{ONE_LINE_PX}px 以下）", len(heights) >= 15 and max(heights, default=99) <= ONE_LINE_PX, f"最大 {max(heights, default=0):.1f}px")
    check("横にはみ出さない", not overflows_horizontally(page))
    cut = truncated_positions(page)
    check("位置の文字が切れない（順位/駅数まで読める）", not cut, " / ".join(cut[:3]))
    page.screenshot(path=f"{OUT}/profile-overview-{name}.png")
    page.get_by_role("button", name="「災害」タブで詳しく見る").click()
    check("「災害」タブへの入口が効く", wait_for_tab(page, "災害"), f"タブ={active_tab(page)}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_radius(browser: Browser) -> None:
    print("[概要タブ：集計半径を替えると、その半径で取り直す]")
    context, page, errors = open_page(browser, WIDE)
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url) if "/profile?" in request.url else None)
    page.goto(f"{BASE}/?grp={quote(YOKOHAMA)}&tab=overview", wait_until="networkidle")
    wait_for_text(page, "横浜の周辺（1km圏）")
    page.locator("aside").get_by_role("button", name="2km", exact=True).click()
    check("題が「横浜の周辺（2km圏）」になる", wait_for_text(page, "横浜の周辺（2km圏）"))
    check("URL は r=2000", params(page).get("r") == "2000", str(params(page)))
    check("radiusM=2000 で取り直す", any("radiusM=2000" in url for url in requests), "\n".join(requests))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_switch_station(browser: Browser) -> None:
    print("[概要タブ：駅を替えた直後に、前の駅のプロフィールを出さない]")
    context, page, errors = open_page(browser, WIDE)
    page.goto(f"{BASE}/?grp={quote(YOKOHAMA)}&tab=overview", wait_until="networkidle")
    wait_for_text(page, "横浜の周辺（1km圏）")

    def slow(route: Route) -> None:
        page.wait_for_timeout(SLOW_PROFILE_MS)
        route.continue_()

    page.route("**/api/stations/%E6%9D%B1%E4%BA%AC*/profile*", slow)
    box = page.get_by_placeholder("駅名で検索…")
    box.click()
    box.fill("東京")
    page.locator("[cmdk-item]").first.wait_for(state="visible", timeout=WAIT_MS)
    page.locator("[cmdk-item]").first.click()
    page.wait_for_timeout(800)
    during = detail_text(page)
    check("東京の応答を待つあいだ、横浜のプロフィールを出さない", "横浜の周辺" not in during, during[:120])
    check("東京のプロフィールが出る", wait_for_text(page, "東京の周辺（1km圏）"))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_chat_wide(browser: Browser, profile: dict) -> None:
    print("[チャット（広い画面）：駅詳細は概要タブで開き、チップは「横浜 の概要」]")
    context, page, errors = open_page(browser, WIDE, remembered="income")
    body = profile_answer(profile)
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=body))
    page.goto(BASE, wait_until="networkidle")
    send_chat(page, "横浜駅の周辺はどんなエリア？")
    check("覚えたタブが所得でも、概要タブで開く", wait_for_tab(page, "概要"), f"タブ={active_tab(page)}")
    check("URL は駅と概要タブ", params(page).get("grp") == YOKOHAMA and params(page).get("tab") == "overview", str(params(page)))
    chip = page.get_by_role("button", name="横浜 の概要")
    check("チップは「横浜 の概要」", chip.count() == 1)
    check("駅詳細にプロフィール", wait_for_text(page, "横浜の周辺（1km圏）"))
    page.screenshot(path=f"{OUT}/profile-chat-wide.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_chat_phone(browser: Browser, profile: dict) -> None:
    print("[チャット（携帯）：会話の中にプロフィール、⤢ で概要タブのシート]")
    context, page, errors = open_page(browser, PHONE)
    body = profile_answer(profile)
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=body))
    page.goto(BASE, wait_until="networkidle")
    send_chat(page, "横浜駅の周辺はどんなエリア？")
    page.wait_for_function("() => new URL(location.href).searchParams.get('sheet') === 'closed'", timeout=WAIT_MS)
    figure = page.get_by_text("横浜の周辺（1km圏）")
    figure.first.wait_for(state="visible", timeout=WAIT_MS)
    conversation = page.locator("main, body").first.inner_text()
    check("会話の中に性格の目安と見ていないこと", "業務地型" in conversation and "このプロフィールで見ていないこと" in conversation)
    check("会話の中では災害の要約も出す（もし起きたら）", "もし起きたら" in conversation and "区域図が無い災害" in conversation)
    cut = truncated_positions(page)
    check("会話の中の図（約 320px）でも位置の文字が切れない", not cut, " / ".join(cut[:3]))
    page.screenshot(path=f"{OUT}/profile-chat-phone.png", full_page=False)
    page.get_by_role("button", name="横浜 の概要 を拡大").click()
    check("⤢ でシートが概要タブで開く", wait_for_tab(page, "概要"), f"タブ={active_tab(page)}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    PROFILE = fetch_profile(YOKOHAMA)
    scenario_overview(browser, WIDE, "wide")
    scenario_overview(browser, PHONE, "phone")
    scenario_radius(browser)
    scenario_switch_station(browser)
    scenario_chat_wide(browser, PROFILE)
    scenario_chat_phone(browser, PROFILE)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
