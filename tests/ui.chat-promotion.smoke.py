#!/usr/bin/env python3
"""⤢（チャットの図を大きく開く）とキャンバスの自動表示が、**図を生んだ呼び出しの条件**で開くことを
実ブラウザで確かめる（2026-09-26）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.chat-promotion.smoke.py [出力ディレクトリ] [BASE]

## きっかけ

モデルが存在しない都道府県名（「千葉市」）でツールを呼び、ツールは失敗を結果として返した
（`{ error, hint }`）。モデルは「千葉県」で呼び直し、チャットには正しい図が出た。ところが ⤢ と
キャンバスは**失敗した方の条件（千葉市）**で開いていた——失敗した呼び出しも照合に残り、指標のキーが
同じなので先に拾われていた（`src/components/chat/panelGroups.ts` の `toolCallsOf`）。

## なぜユニットで足りないのか

照合は `tests/chat-panel-groups.test.ts`・`tests/chat-canvas-target.test.ts` が固定している。
ここで見るのは、**画面が実際にその条件で図を開き、データを取りに行くか**——`useChat` が組み立てる
メッセージ、キャンバスの自動表示（広い画面）、チップ（携帯の幅）の 3 つを通ったあとで。

## やり方

`/api/chat` を差し替え、**本番で流れる並び**（ツールが失敗を返す → 呼び直して成功 → 図）を返す。
モデルには触らない。判定は見た目ではなく、開いた図が取りに行く条件（`/api/growth`・`/api/ranking` の
`prefecture`）で行う。修正前のコード（本番）に当てると、3 場面とも「千葉市」で取りに行く。
"""

import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Page, Request, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

CATALOG = json.loads(
    (Path(__file__).resolve().parent.parent / "src/shared/catalog/catalog.json").read_text()
)
LABELS = {entry["key"]: entry["labelJa"] for entry in CATALOG["entries"]}

X, Y = "pop_gr_2020_2015_2km", "rate_covid"
METRIC = "pop_gr_2020_2015_1km"
WRONG, RIGHT = "千葉市", "千葉県"
# tool-specs.ts の構造化エラー（存在しない都道府県名）。状態は output-available のまま届く。
UNKNOWN_PREFECTURE = {
    "error": f"未知の都道府県: {WRONG}",
    "hint": "都道府県は正式名（例「神奈川県」「東京都」）で指定してください。",
}
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}


def sse(chunks: list[dict]) -> str:
    """UI メッセージストリーム（本番と同じ `data: …` の並び）。"""
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks]
    return "".join(lines) + "data: [DONE]\n\n"


def data_map(panels: list[dict], text: str | None = None) -> dict:
    messages = [] if text is None else [{"role": "assistant", "text": text}]
    return {"type": "data-map", "id": "map", "data": {"messages": messages, "mapActions": [], "panels": panels}}


def call_until_input(call_id: str, tool: str, tool_input: dict) -> list[dict]:
    """呼び出しの前半（Google のプロバイダは引数を start → delta の順に流す）。"""
    return [
        {"type": "tool-input-start", "toolCallId": call_id, "toolName": tool},
        {"type": "tool-input-delta", "toolCallId": call_id, "inputTextDelta": json.dumps(tool_input, ensure_ascii=False)},
        {"type": "tool-input-available", "toolCallId": call_id, "toolName": tool, "input": tool_input},
    ]


def answer(tool: str, wrong_input: dict, right_input: dict, right_output: dict, panel: dict) -> str:
    """失敗を返す呼び出し → 呼び直して成功（パネルは出力より先に届く）→ 本文、の並び。"""
    text = "条件を直して表示しました。"
    return sse(
        [
            {"type": "start", "messageId": "smoke"},
            {"type": "start-step"},
            *call_until_input("c1", tool, wrong_input),
            {"type": "tool-output-available", "toolCallId": "c1", "output": UNKNOWN_PREFECTURE},
            {"type": "finish-step"},
            {"type": "start-step"},
            *call_until_input("c2", tool, right_input),
            data_map([panel]),
            {"type": "tool-output-available", "toolCallId": "c2", "output": right_output},
            {"type": "finish-step"},
            {"type": "start-step"},
            {"type": "text-start", "id": "t1"},
            {"type": "text-delta", "id": "t1", "delta": text},
            {"type": "text-end", "id": "t1"},
            data_map([panel], text),
            {"type": "finish-step"},
            {"type": "finish"},
        ]
    )


SCATTER_PANEL = {
    "type": "scatter",
    "title": f"{LABELS[X]} × {LABELS[Y]}（{RIGHT}）",
    "xLabel": LABELS[X],
    "yLabel": LABELS[Y],
    "xUnit": "%",
    "yUnit": "%",
    "points": [],
    "clusterCount": 0,
}
SCATTER_ANSWER = answer(
    "compareGrowth",
    {"x": X, "y": Y, "prefectures": [WRONG]},
    {"x": X, "y": Y, "prefectures": [RIGHT]},
    {"resolvedMetrics": {"x": X, "y": Y}, "prefectures": [RIGHT], "pointCount": 0, "clusterCount": 0},
    SCATTER_PANEL,
)

RANKING_PANEL = {
    "type": "rankingTable",
    "title": f"{LABELS[METRIC]}（{RIGHT}・上位）",
    "metricKey": METRIC,
    "unit": "%",
    "rows": [],
}
RANKING_ANSWER = answer(
    "rankStations",
    {"metric": METRIC, "prefectures": [WRONG]},
    {"metric": METRIC, "prefectures": [RIGHT]},
    {"resolvedMetric": METRIC, "prefectures": [RIGHT], "order": "desc"},
    RANKING_PANEL,
)

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def open_chat_and_send(page: Page, question: str) -> None:
    """広い画面は横の枠（既定で開いている）、携帯の幅は下からのシート（既定で閉じている）。"""
    page.goto(BASE, wait_until="networkidle")
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


def prefectures_requested(urls: list[str]) -> list[str]:
    """開いた図が取りに行った条件（`prefecture` はカンマ区切り）。"""
    values = [parse_qs(urlparse(url).query).get("prefecture", [""])[0] for url in urls]
    return [value for value in values if value]


def run(name: str, viewport: dict, answer_body: str, api_path: str, open_by_chip: str | None) -> None:
    print(f"[{name}]")
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    requested: list[str] = []

    def record(request: Request) -> None:
        if api_path in request.url:
            requested.append(request.url)

    page.on("request", record)
    page.route(
        "**/api/chat",
        lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=answer_body),
    )
    open_chat_and_send(page, f"{RIGHT}で表示して")
    page.wait_for_timeout(2500)
    if open_by_chip is not None:
        page.locator(f'button[title="{open_by_chip}"]').first.click()
        page.wait_for_timeout(2500)
    prefectures = prefectures_requested(requested)
    check("開いた図がデータを取りに行った", len(requested) > 0, f"{len(requested)} 件")
    check(f"条件は呼び直した方（{RIGHT}）", prefectures != [] and all(p == RIGHT for p in prefectures), str(prefectures))
    check(f"失敗した方（{WRONG}）では取りに行かない", all(WRONG not in p for p in prefectures))
    page.screenshot(path=f"{OUT}/chat-promotion-{name}.png")
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    wide = {"width": 1280, "height": 900}
    phone = {"width": 390, "height": 844}
    run("広い画面・散布（キャンバスに自動で開く）", wide, SCATTER_ANSWER, "/api/growth", None)
    run("広い画面・ランキング（キャンバスに自動で開く）", wide, RANKING_ANSWER, "/api/ranking", None)
    run("携帯の幅・散布（チップから開く）", phone, SCATTER_ANSWER, "/api/growth", SCATTER_PANEL["title"])
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
