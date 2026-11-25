#!/usr/bin/env python3
"""チャットの中の人口タブ（駅詳細・compact）に、**人口増減率の表が 1 行に畳んで出る**ことを、実ブラウザの 3 幅で確かめる
（2026-11-25・人口の年齢 PR-3・計画書 261122 §6.8・D-5）。

AI への要約（道具の返却）は、チャットに出すパネル（`panelsForStationDetail`）から作る。最初の実装はチャットの中で表を
出さなかったため、AI が人口増減率の 9 組を読めなくなっていた（レビューで見つけた）。表は畳んで出し、チャットに足すのは 1 行だけにする。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.chat-population.smoke.py [出力ディレクトリ] [BASE]

## 見ること（1440／1024／390 の 3 幅）

1. 図 2 枚（人口の推移・年齢別の人口）の下に「人口増減率（9）」の 1 行がある。畳んであって、行は見えない
2. 押すと 9 行が開く
3. 横にはみ出さない・画面のエラーなし

`/api/chat` は差し替える（本番で流れる並び：ツールのパーツ・data-promotions・data-map）。モデルには触らない。
パネルは本物：同じサーバの MCP `get_station_detail` の `structuredContent.panels`（チャットと同じ組み立て）を流す。
"""

import json
import sys
import urllib.request

from playwright.sync_api import Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
TOOL_INPUT = {"grp": "武蔵小杉#0", "category": "population"}
QUESTION = "武蔵小杉駅の周りの生産年齢人口は？"
GROWTH_ROWS = 9
VIEWPORTS = {
    "wide": {"width": 1440, "height": 900},
    "mid": {"width": 1024, "height": 800},
    "phone": {"width": 390, "height": 844},
}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def station_detail_panels() -> list[dict]:
    """MCP の get_station_detail の図（チャットの駅詳細と同じ `panelsForStationDetail`）。"""
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "get_station_detail", "arguments": TOOL_INPUT}}
    request = urllib.request.Request(f"{BASE}/api/mcp", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json",
                                              "Accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode()
    if raw.startswith(("event:", "data:")):
        raw = "\n".join(line[5:].strip() for line in raw.splitlines() if line.startswith("data:"))
    return json.loads(raw)["result"]["structuredContent"]["panels"]


def answer(panels: list[dict]) -> str:
    """ツールの呼び出し → 図（条件を先に）→ 出力 → 本文、の並び。"""
    text = "武蔵小杉駅の1km圏の15〜64歳（2020年）は55,863人で、人口の74.1%です。"
    figures = [
        {"type": "data-promotions", "id": "promotions", "data": [None] * len(panels)},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": [], "panels": panels}},
    ]
    chunks = [
        {"type": "start", "messageId": "smoke"},
        {"type": "start-step"},
        {"type": "tool-input-start", "toolCallId": "c1", "toolName": "getStationDetail"},
        {"type": "tool-input-available", "toolCallId": "c1", "toolName": "getStationDetail", "input": TOOL_INPUT},
        *figures,
        {"type": "tool-output-available", "toolCallId": "c1", "output": {"ok": True}},
        {"type": "finish-step"},
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"


def open_chat_and_send(page: Page) -> None:
    """広い画面は横の枠（既定で開いている）、携帯の幅は下からのシート（既定で閉じている）。"""
    page.goto(BASE, wait_until="networkidle")
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(QUESTION)
    page.locator('button[aria-label="送信"]').click()
    page.wait_for_timeout(3000)


def run(browser, name: str, viewport: dict, body: str) -> None:
    print(f"■ {name}（{viewport['width']}×{viewport['height']}）")
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=body))
    open_chat_and_send(page)
    summary = page.locator("summary", has_text=f"人口増減率（{GROWTH_ROWS}）")
    check(f"[{name}] 図の下に「人口増減率（{GROWTH_ROWS}）」の 1 行", summary.count() == 1, f"{summary.count()} 個")
    check(f"[{name}] 年齢別の人口の図もある", page.get_by_text("年齢別の人口（1km圏）").count() >= 1)
    details = summary.locator("xpath=..")
    check(f"[{name}] 畳んである（行は見えない）", not details.locator("dd").first.is_visible())
    summary.scroll_into_view_if_needed()
    page.screenshot(path=f"{OUT}/chat-population-{name}-folded.png")
    summary.click()
    page.wait_for_timeout(300)
    rows = details.locator("dd")
    check(f"[{name}] 押すと {GROWTH_ROWS} 行が開く", rows.count() == GROWTH_ROWS and rows.first.is_visible(), f"{rows.count()} 行")
    page.screenshot(path=f"{OUT}/chat-population-{name}-open.png")
    width = page.evaluate("document.documentElement.scrollWidth")
    check(f"[{name}] 横にはみ出さない", width <= viewport["width"], f"{width}px")
    check(f"[{name}] 画面のエラーなし", not errors, "; ".join(errors)[:200])
    context.close()


body = answer(station_detail_panels())
with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for name, viewport in VIEWPORTS.items():
        run(browser, name, viewport, body)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
