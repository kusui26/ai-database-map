#!/usr/bin/env python3
"""警報のカードが、**実ブラウザで**注意書きつきで出ることを確かめる（2026-10-15・`docs/261001_fix_user_feedback_ui.md` §6.23）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（.env の SUPABASE_* が要る）
    pip install playwright && playwright install chromium
    python3 tests/ui.hazard-alert-card.smoke.py [BASE] [出力ディレクトリ]

## 何を見るか

1. **チャットの警報のカード**（3 つの幅）。カードの中身は**本物のサーバが作ったもの**を MCP（`get_hazard_alerts` に名前だけ）
   から受け取り、チャットの応答に載せて描かせる——名前の解決 → 気象庁 → カードまで本物のコードを通し、モデルは使わない
   - 名前で引けた（横浜市・札幌市）：バッジは「発表なし」「注意報あり」など（**「想定区域外」と出さない**）
   - 名前で場所を決められなかった（府中市＝東京都・広島県）：「未確認」と「調べていません」
   - どのカードにも、市町村の避難情報に従う旨（注意書き）と、警報の限界（避難情報は市町村が出す）が出る
   - ページも会話の欄も横にはみ出さない
2. **駅の災害タブの「いま」**（警戒中・`/api/hazard/alerts` を警戒レベル3相当に差し替え）：画面が自分で組むカードの
   バッジも「警戒レベル3相当」（以前は「警戒」で、警戒バナーと言い方が違った）

気象庁の発表はその日で変わる（平時は「発表なし」が多い）。1 は見出しとバッジが**同じカードの中で食い違わない**ことを見る。
"""

import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from playwright.sync_api import Browser, BrowserContext, Locator, Page, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3399"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
WAIT_MS = 30_000
WIDE = {"width": 1440, "height": 900}
NARROW = {"width": 1024, "height": 800}
PHONE = {"width": 390, "height": 844}
VIEWPORTS = [("wide", WIDE), ("narrow", NARROW), ("phone", PHONE)]
#: これより狭いと携帯の作り（チャットは最初は閉じたシート）。
PHONE_MAX_WIDTH = 640
#: 画面の準備（React）を待つ回数（1 秒ずつ）。地図の読み込みが重い・マシンの負荷が高いと準備が遅れる（負荷平均 20 で 30 秒を超えた）。
SEND_ATTEMPTS = 60
#: MCP の get_hazard_alerts は 1 分に 10 回まで（気象庁・国土地理院を守る）。間を空ける。
MCP_INTERVAL_S = 7
#: 文の正は src/shared/hazard/hazard-catalog.json（注意書き）と src/domain/hazard/level.ts（限界）。
DISCLAIMER = "市町村が発表する避難情報に従ってください"
LIMITATION = "避難情報（警戒レベル4「避難指示」など）を出すのは市町村"
STATIC_LABEL = "想定区域外"
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'OK  ' if condition else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# --- サーバが作るカード（MCP） ---------------------------------------------------------------


def mcp_alert_card(place: str) -> dict:
    """MCP の get_hazard_alerts に名前だけを渡し、サーバが作ったカード（パネル）を受け取る。"""
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get_hazard_alerts", "arguments": {"placeJa": place}},
        }
    ).encode()
    request = urllib.request.Request(
        f"{BASE}/api/mcp",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode()
    lines = [line[6:] for line in text.splitlines() if line.startswith("data: ")]
    result = json.loads(lines[-1] if lines else text)["result"]
    panels = (result.get("structuredContent") or {}).get("panels", [])
    if not panels:
        raise RuntimeError(f"{place}：カードが返らない（{json.dumps(result, ensure_ascii=False)[:300]}）")
    return panels[0]


def answer(panel: dict, text: str) -> str:
    """道具を 1 回呼んだときの応答（図を本文より先に送る・サーバと同じ並び）。"""
    chunks = [
        {"type": "start", "messageId": "smoke-alert"},
        {"type": "start-step"},
        {"type": "data-promotions", "id": "promotions", "data": [None]},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": [], "panels": [panel]}},
        {"type": "finish-step"},
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"


# --- 画面 ---------------------------------------------------------------------------------------


def open_page(browser: Browser, viewport: dict) -> tuple[BrowserContext, Page, list[str]]:
    phone = viewport["width"] < PHONE_MAX_WIDTH
    # 倍率 1：地図（WebGL）の描画の負担を減らす（ここで見るのは文字とはみ出しで、細かい描画ではない）
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone, device_scale_factor=1)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page, errors


def send_question(page: Page, question: str, phone: bool) -> None:
    """チャットを開いて送る。画面の準備（React）より先に入れた文字は落ちるので、送信ボタンが押せるまで入れ直す。

    ⚠ 読み込み直後は入力欄がまだ描かれていない。そこで「見えない＝閉じている」と決めて開閉ボタンを押すと、最初から開いている
    広い画面ではチャットを**閉じてしまう**（2026-10-15 に実測）。チャットが最初は閉じている携帯だけ、開閉ボタンを押す。
    """
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if phone:
        toggle = page.get_by_role("button", name="AI チャットを開閉（⌘K）")
        toggle.wait_for(state="visible", timeout=WAIT_MS)
        toggle.click()
    textarea.wait_for(state="visible", timeout=WAIT_MS)
    send = page.locator('button[aria-label="送信"]')
    for _attempt in range(SEND_ATTEMPTS):
        # 一度空にしてから入れる（同じ文字の入れ直しでは、入力の出来事が React に届かないことがある）
        textarea.fill("")
        textarea.fill(question)
        page.wait_for_timeout(1000)
        if send.is_enabled():
            break
    send.click()


def card_section(page: Page, place: str) -> Locator:
    """見出し（地点・市区町村の呼び名）から、そのカードの <section>。"""
    return page.locator("section", has=page.get_by_role("heading", name=place, exact=True)).first


def page_overflows(page: Page) -> bool:
    return page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")


def chat_overflows(section: Locator) -> bool:
    """会話の欄（縦に送る箱）が横にはみ出すか。"""
    return section.evaluate(
        """(el) => {
          let box = el.parentElement
          while (box && getComputedStyle(box).overflowY !== 'auto') box = box.parentElement
          return box ? box.scrollWidth > box.clientWidth + 1 : false
        }"""
    )


def badge_text(section: Locator) -> str:
    """カードのバッジ（見出しの隣の色つきの札）の文字。"""
    return section.locator("h2 + span").first.inner_text().replace("\n", " ").strip()


def scenario_chat(browser: Browser, name: str, viewport: dict, panel: dict, question: str) -> None:
    label = f"{name}・{panel['placeJa']}"
    context, page, errors = open_page(browser, viewport)
    body = answer(panel, "いまの警戒状況です。")
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=body))
    # 地図のタイル（国土地理院）が遅いと networkidle に届かない（2026-10-15 に実測）。読み込みを待ち、入力欄が使えるまで待つ。
    page.goto(BASE, wait_until="load")
    send_question(page, question, phone=viewport["width"] < PHONE_MAX_WIDTH)
    section = card_section(page, panel["placeJa"])
    section.wait_for(state="visible", timeout=WAIT_MS)
    text = section.inner_text()
    badge = badge_text(section)
    check(f"{label}：バッジはサーバの言い方（{panel.get('levelLabelJa')}）", badge.endswith(panel.get("levelLabelJa", "")), badge)
    check(f"{label}：「{STATIC_LABEL}」と出さない", STATIC_LABEL not in text)
    check(f"{label}：注意書き（市町村の避難情報に従う）が出る", DISCLAIMER in text)
    check(f"{label}：限界（避難情報は市町村が出す）が出る", LIMITATION in text)
    check(f"{label}：見出しが出る", panel["headlineJa"] in text, panel["headlineJa"])
    check(f"{label}：ページが横にはみ出さない", not page_overflows(page))
    check(f"{label}：会話の欄が横にはみ出さない", not chat_overflows(section))
    check(f"{label}：画面のエラーなし", errors == [], "; ".join(errors))
    section.scroll_into_view_if_needed()
    page.screenshot(path=f"{OUT}/alert-card-{name}-{panel['placeJa']}.png")
    context.close()


# --- 駅の災害タブ（警戒中） ------------------------------------------------------------------


def warning_alerts() -> dict:
    """警戒レベル3相当の「いま」（`/api/hazard/alerts` の形・発表時刻は 5 分前）。"""
    reported = (datetime.now(timezone(timedelta(hours=9))) - timedelta(minutes=5)).isoformat(timespec="seconds")
    return {
        "placeJa": "この地点",
        "point": {"lon": 139.847, "lat": 35.7645, "placeJa": "この地点"},
        "area": {
            "municipalityCode": "13122",
            "municipalityJa": "葛飾区",
            "prefectureJa": "東京都",
            "areas": [{"code": "1312200", "nameJa": "葛飾区"}],
        },
        "alertLevel": 3,
        "level": "warning",
        "headlineJa": "葛飾区に大雨警報（警戒レベル3相当）が発表されています。",
        "warnings": [
            {
                "code": "03",
                "nameJa": "大雨警報",
                "kindJa": "警報",
                "alertLevel": 3,
                "areaJa": "葛飾区",
                "statusJa": "発表",
                "detailJa": None,
            }
        ],
        "floodForecasts": [],
        "reasonsJa": ["葛飾区：大雨警報（警戒レベル3相当・発表）"],
        "reportedAt": reported,
        "limitationsJa": [
            "ここに出るのは気象庁が発表しているものだけです。避難情報（警戒レベル4「避難指示」など）を出すのは市町村で、この画面では分かりません。"
        ],
        "sources": [],
        "notesJa": [],
        "disclaimerJa": "この地図は災害リスクの目安を示すものです。実際の避難は、お住まいの市町村が発表する避難情報に従ってください。",
    }


def scenario_station_tab(browser: Browser, name: str, viewport: dict) -> None:
    context, page, errors = open_page(browser, viewport)
    body = json.dumps(warning_alerts(), ensure_ascii=False)
    page.route(
        "**/api/hazard/alerts**",
        lambda route: route.fulfill(status=200, headers={"content-type": "application/json"}, body=body),
    )
    page.goto(f"{BASE}/?grp={quote('亀有#0')}&tab=hazard", wait_until="load")
    section = card_section(page, "この地点")
    section.wait_for(state="visible", timeout=WAIT_MS)
    badge = badge_text(section)
    check(f"駅の災害タブ・{name}：警戒中のカードのバッジは「警戒レベル3相当」（バナーと同じ言い方）", badge.endswith("警戒レベル3相当"), badge)
    check(f"駅の災害タブ・{name}：注意書きが出る", DISCLAIMER in section.inner_text())
    check(f"駅の災害タブ・{name}：ページが横にはみ出さない", not page_overflows(page))
    check(f"駅の災害タブ・{name}：画面のエラーなし", errors == [], "; ".join(errors))
    section.scroll_into_view_if_needed()
    page.screenshot(path=f"{OUT}/alert-station-tab-{name}.png")
    context.close()


def main() -> int:
    cards: list[tuple[dict, str]] = []
    for place, question in [
        ("横浜市", "横浜市はいま警報が出ていますか？"),
        ("札幌市", "札幌市はいま避難した方がいいですか？"),
        ("府中市", "府中市はいま避難した方がいいですか？"),
    ]:
        cards.append((mcp_alert_card(place), question))
        time.sleep(MCP_INTERVAL_S)
    print("サーバが作ったカード:")
    for panel, _question in cards:
        print(f"  {panel['placeJa']} [{panel.get('levelLabelJa')}] {panel['headlineJa']}")
    unlocated = cards[2][0]
    check("決められなかった名前のカードは「未確認」", unlocated.get("levelLabelJa") == "未確認", str(unlocated.get("levelLabelJa")))
    check("決められなかった名前のカードは「調べていません」", "調べていません" in unlocated["headlineJa"])
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for name, viewport in VIEWPORTS:
            print(f"[{name}]")
            for panel, question in cards:
                scenario_chat(browser, name, viewport, panel, question)
            scenario_station_tab(browser, name, viewport)
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
