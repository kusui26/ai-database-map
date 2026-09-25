#!/usr/bin/env python3
"""チャットが失敗したとき、**画面に本当の理由が出る**ことを実ブラウザで確かめる（2026-09-25）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.chat-errors.smoke.py [出力ディレクトリ] [BASE]

## きっかけ

Gemini が一時的に応答しなくなったとき、画面に出たのは「応答の取得に失敗しました」だけだった。
サーバは理由を言い分けていたのに、**画面が 429 以外をすべて自前の 1 文で上書きしていた**。
さらに、こちらの 50 秒打ち切りでは本文もエラーも出ず、**無言**だった（サーバが用意した一文を
画面が一度も描いていなかった）。

## なぜユニットで足りないのか

文の選び方は `tests/chat-error-message.test.ts`、サーバが送るものは `tests/api-chat-errors.test.ts`
が固定している。ここで見るのは**その文が実際に画面へ出るか**——`useChat` が失敗をどの経路で
画面に渡し、どの部品がそれを描くか（G7 の教訓：ユニットは関数までしか見ない）。

## やり方

`/api/chat` を差し替え、**本番で実際に流れる形**（ストリームの並び・HTTP の本文）を返す。
モデルには触らない（無料枠を使わない・結果が揺れない）。オフラインだけは差し替えではなく
ブラウザを実際にオフラインにする（`navigator.onLine` を本物にするため）。
"""

import json
import sys

from playwright.sync_api import Page, Route, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

# 文の正は src/shared/chat-errors.ts と src/shared/platform-error.ts。変えたらここも変える。
UNAVAILABLE = "AI（Gemini）が一時的に応答できない状態です。少し時間をおいて再度お試しください。"
RATE_LIMITED = "ただいま混雑しています（無料枠の上限の可能性があります）。少し時間をおいて再度お試しください。"
REJECTED = "チャットの設定に問題があり、応答できませんでした。時間をおいても直らない可能性があります。"
BLOCKED = "アクセスが集中したため、一時的に制限しています。最大 10 分ほどおいてから、もう一度お試しください。"
UNREACHABLE = "サーバに接続できませんでした。時間をおいて再度お試しください。"
OFFLINE = "オフラインのため送信できませんでした。接続を確認してから、もう一度お試しください。"
OLD_GENERIC = "応答の取得に失敗しました"
# 本番の打ち切りで data-map に載る一文（src/ai/assemble.ts の textOrFallback）
TIMED_OUT = "時間内に取得できませんでした。もう一度お試しください。"
EMPTY_OK = "うまく取得できませんでした。指標や地域を変えて、もう一度お試しください。"

# 2026-09-24 に本番の WAF で実測した本文
WAF_BODY = '{"error":{"code":"403","message":"Forbidden","id":"hnd1::2z8j8-1790257960406-d619c6ead9e9"}}'


def sse(*chunks: dict) -> str:
    """UI メッセージストリーム（本番と同じ `data: …` の並び）。"""
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks]
    return "".join(lines) + "data: [DONE]\n\n"


def data_map(text: str | None) -> dict:
    messages = [] if text is None else [{"role": "assistant", "text": text}]
    return {"type": "data-map", "id": "map", "data": {"messages": messages, "mapActions": [], "panels": []}}


START = {"type": "start", "messageId": "smoke"}
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}


def stream_of(*chunks: dict):
    return lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=sse(*chunks))


def http_of(status: int, body: str):
    return lambda route: route.fulfill(status=status, headers={"content-type": "application/json"}, body=body)


def network_failure(route: Route) -> None:
    route.abort("failed")


# (名前, 差し替え, 枠に出るべき文 or None, 吹き出しに出るべき文 or None)
SCENARIOS = [
    ("ストリーム：一時的な不調（5xx）", stream_of(START, {"type": "error", "errorText": UNAVAILABLE}), UNAVAILABLE, None),
    ("ストリーム：無料枠の上限（429）", stream_of(START, {"type": "error", "errorText": RATE_LIMITED}), RATE_LIMITED, None),
    ("ストリーム：設定の問題（4xx）", stream_of(START, {"type": "error", "errorText": REJECTED}), REJECTED, None),
    (
        "HTTP 429：アプリの制限（待つ秒数つき）",
        http_of(429, json.dumps({"error": {"code": "RATE_LIMITED", "message": "リクエストが多すぎます。37秒後に再試行してください。"}}, ensure_ascii=False)),
        "リクエストが多すぎます。37秒後に再試行してください。",
        None,
    ),
    ("HTTP 403：WAF の遮断", http_of(403, WAF_BODY), BLOCKED, None),
    ("通信そのものの失敗", network_failure, UNREACHABLE, None),
    ("打ち切り（start → abort → data-map）", stream_of(START, {"type": "abort"}, data_map(TIMED_OUT)), None, TIMED_OUT),
    ("本文なしの正常終了", stream_of(START, data_map(EMPTY_OK), {"type": "finish"}), None, EMPTY_OK),
]

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def open_chat_and_send(page: Page, question: str) -> None:
    page.goto(BASE, wait_until="networkidle")
    panel = page.locator('aside[aria-label="AI チャット"]')
    if panel.get_attribute("aria-hidden") == "true":
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    page.locator('textarea[aria-label="チャット入力"]').fill(question)
    page.locator('button[aria-label="送信"]').click()


def settled_texts(page: Page) -> tuple[str, str]:
    """エラー枠と、アシスタントの吹き出しの文（出るまで少し待つ）。"""
    page.wait_for_timeout(1500)
    panel = page.locator('aside[aria-label="AI チャット"]')
    alert = panel.locator('[role="alert"]')
    alert_text = alert.inner_text() if alert.count() > 0 else ""
    return alert_text, panel.inner_text()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for index, (name, handler, alert_expected, bubble_expected) in enumerate(SCENARIOS, start=1):
        print(f"[{index}] {name}")
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        page.route("**/api/chat", handler)
        open_chat_and_send(page, "横浜駅の乗降客数は？")
        alert_text, panel_text = settled_texts(page)
        if alert_expected is None:
            check("エラー枠は出ない", alert_text == "", alert_text[:40])
        else:
            check("枠に本当の理由が出る", alert_text == alert_expected, alert_text[:60])
        if bubble_expected is not None:
            check("吹き出しにサーバの一文が出る（無言にならない）", bubble_expected in panel_text)
        check("古い一律の文は出ない", OLD_GENERIC not in panel_text)
        check("英語の Forbidden は出ない", "Forbidden" not in panel_text)
        page.screenshot(path=f"{OUT}/chat-error-{index}.png")
        context.close()

    # オフライン：差し替えではなく、ブラウザを実際にオフラインにする（navigator.onLine が本物になる）。
    print(f"[{len(SCENARIOS) + 1}] 端末がオフライン")
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    page.goto(BASE, wait_until="networkidle")
    panel = page.locator('aside[aria-label="AI チャット"]')
    if panel.get_attribute("aria-hidden") == "true":
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    context.set_offline(True)
    page.locator('textarea[aria-label="チャット入力"]').fill("横浜駅の乗降客数は？")
    page.locator('button[aria-label="送信"]').click()
    alert_text, _ = settled_texts(page)
    check("「オフライン」と言うのは端末がそう言っているときだけ", alert_text == OFFLINE, alert_text[:60])
    page.screenshot(path=f"{OUT}/chat-error-offline.png")
    context.close()
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
