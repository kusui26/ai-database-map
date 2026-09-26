#!/usr/bin/env python3
"""⤢（チャットの図を大きく開く）とキャンバスの自動表示が、**その図を生んだ条件**で開くことを
実ブラウザで確かめる（2026-09-26）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.chat-promotion.smoke.py [出力ディレクトリ] [BASE]

## きっかけ

画面は ⤢ とキャンバスの条件を、パネルとツール呼び出しを照合して推し量っていた（「ラベルが合う最初の
呼び出し」）。そのため 2 つの形で、チャットの図とは違う条件で開いた。

1. 失敗を返した呼び出し（存在しない都道府県名「千葉市」）が先にあると、「千葉県」で呼び直した図も
   「千葉市」で開き、「データがありません」になった（PR #164 で照合から外した）
2. 同じ指標で成功した呼び出しが 2 つあると（事業者名に「新幹線」を渡して 0 件の図 → 絞り込みを外して
   呼び直した図）、どちらの図も最初の呼び出しの条件で開いた

いまはサーバが、図を生んだ副産物から条件を作り、パネルと同じ並びで送る（data-promotions）。
画面は推し量らない。

## やり方

`/api/chat` を差し替え、**本番で流れる並び**（ツールのパーツ・data-promotions・data-map）を返す。
モデルには触らない。判定は見た目ではなく、開いた図が取りに行く条件（`/api/growth`・`/api/ranking` の
クエリ）で行う。修正前のコード（照合で推し量る画面）に当てると、どの場面も最初の呼び出しの条件で取りに行く。
"""

import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
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
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
# tool-specs.ts の構造化エラー（存在しない都道府県名）。状態は output-available のまま届く。
UNKNOWN_PREFECTURE = {
    "error": "未知の都道府県: 千葉市",
    "hint": "都道府県は正式名（例「神奈川県」「東京都」）で指定してください。",
}
NO_FILTERS = {"prefectures": [], "operators": [], "routes": [], "routeTypes": [], "excludeLowN": False}


@dataclass(frozen=True)
class Call:
    """1 回のツール呼び出し。図を生んだなら panel と promotion（サーバが付ける条件）を持つ。"""

    tool: str
    tool_input: dict
    output: dict
    panel: dict | None = None
    promotion: dict | None = None


def sse(chunks: list[dict]) -> str:
    """UI メッセージストリーム（本番と同じ `data: …` の並び）。"""
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks]
    return "".join(lines) + "data: [DONE]\n\n"


def figures(panels: list[dict], promotions: list[dict | None], text: str | None = None) -> list[dict]:
    """サーバと同じく、条件（data-promotions）を図（data-map）より先に送る。"""
    messages = [] if text is None else [{"role": "assistant", "text": text}]
    return [
        {"type": "data-promotions", "id": "promotions", "data": promotions},
        {"type": "data-map", "id": "map", "data": {"messages": messages, "mapActions": [], "panels": panels}},
    ]


def answer(calls: list[Call]) -> str:
    """呼び出しを 1 手順ずつ（パネルは出力より先に届く）→ 本文、の並び。"""
    text = "表示しました。"
    chunks: list[dict] = [{"type": "start", "messageId": "smoke"}]
    panels: list[dict] = []
    promotions: list[dict | None] = []
    for index, call in enumerate(calls, start=1):
        call_id = f"c{index}"
        chunks += [
            {"type": "start-step"},
            {"type": "tool-input-start", "toolCallId": call_id, "toolName": call.tool},
            {"type": "tool-input-delta", "toolCallId": call_id, "inputTextDelta": json.dumps(call.tool_input, ensure_ascii=False)},
            {"type": "tool-input-available", "toolCallId": call_id, "toolName": call.tool, "input": call.tool_input},
        ]
        if call.panel is not None:
            panels.append(call.panel)
            promotions.append(call.promotion)
            chunks += figures(panels, promotions)
        chunks += [
            {"type": "tool-output-available", "toolCallId": call_id, "output": call.output},
            {"type": "finish-step"},
        ]
    chunks += [
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        *figures(panels, promotions, text),
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return sse(chunks)


def scatter_panel(title_suffix: str, points: int) -> dict:
    return {
        "type": "scatter",
        "title": f"{LABELS[X]} × {LABELS[Y]}（{title_suffix}）",
        "xLabel": LABELS[X],
        "yLabel": LABELS[Y],
        "xUnit": "%",
        "yUnit": "%",
        "points": [],
        "clusterCount": 4 if points > 0 else 0,
    }


def scatter_promotion(**filters) -> dict:
    return {"kind": "scatter", "xKey": X, "yKey": Y, **NO_FILTERS, **filters}


def scatter_output(points: int, **filters) -> dict:
    return {"resolvedMetrics": {"x": X, "y": Y}, **NO_FILTERS, **filters, "pointCount": points, "clusterCount": 4 if points > 0 else 0}


# 1. 失敗を返した呼び出し → 呼び直して成功（PR #164 の形）
RETRY_SCATTER_PANEL = scatter_panel("千葉県", 3)
RETRY_SCATTER = answer(
    [
        Call("compareGrowth", {"x": X, "y": Y, "prefectures": ["千葉市"]}, UNKNOWN_PREFECTURE),
        Call(
            "compareGrowth",
            {"x": X, "y": Y, "prefectures": ["千葉県"]},
            scatter_output(3, prefectures=["千葉県"]),
            RETRY_SCATTER_PANEL,
            scatter_promotion(prefectures=["千葉県"]),
        ),
    ]
)
RANKING_PANEL = {
    "type": "rankingTable",
    "title": f"{LABELS[METRIC]}（千葉県・上位）",
    "metricKey": METRIC,
    "unit": "%",
    "rows": [],
}
RETRY_RANKING = answer(
    [
        Call("rankStations", {"metric": METRIC, "prefectures": ["千葉市"]}, UNKNOWN_PREFECTURE),
        Call(
            "rankStations",
            {"metric": METRIC, "prefectures": ["千葉県"]},
            {"resolvedMetric": METRIC, "prefectures": ["千葉県"], "order": "desc"},
            RANKING_PANEL,
            {"kind": "ranking", "metricKey": METRIC, "order": "desc", **NO_FILTERS, "prefectures": ["千葉県"]},
        ),
    ]
)

# 2. 同じ指標で成功した呼び出しが 2 つ（本物の応答で起きた形）
EMPTY_PANEL = scatter_panel("全国・新幹線・新幹線", 0)
TWO_FIGURES_LAST_PANEL = scatter_panel("全国・新幹線", 100)
TWO_FIGURES = answer(
    [
        Call(
            "compareGrowth",
            {"x": X, "y": Y, "operators": ["新幹線"], "routeTypes": [1]},
            scatter_output(0, operators=["新幹線"], routeTypes=["新幹線"]),
            EMPTY_PANEL,
            scatter_promotion(operators=["新幹線"], routeTypes=[1]),
        ),
        Call(
            "compareGrowth",
            {"x": X, "y": Y, "routeTypes": [1]},
            scatter_output(100, routeTypes=["新幹線"]),
            TWO_FIGURES_LAST_PANEL,
            scatter_promotion(routeTypes=[1]),
        ),
    ]
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


def queries_of(urls: list[str]) -> list[dict[str, str]]:
    return [{key: values[0] for key, values in parse_qs(urlparse(url).query).items()} for url in urls]


def only_chiba_prefecture(query: dict[str, str]) -> bool:
    return query.get("prefecture") == "千葉県"


def retried_figure_conditions(query: dict[str, str]) -> bool:
    """呼び直した図の条件：事業者の絞り込みなし・種別は新幹線（コード 1）。"""
    return query.get("operators") is None and query.get("routeTypes") == "1"


@dataclass(frozen=True)
class Scenario:
    name: str
    viewport: dict
    body: str
    api_path: str
    chip_title: str | None
    # 判定するのは**最後に**取りに行った条件（キャンバスが最終的に出す図・チップで開いた図）。
    # キャンバスは図が届くたびに最新の図へ切り替わるので、途中で先の図を開くのは正しい動き。
    judge: Callable[[dict[str, str]], bool]
    expectation: str


def run(browser, scenario: Scenario) -> None:
    print(f"[{scenario.name}]")
    context = browser.new_context(viewport=scenario.viewport)
    page = context.new_page()
    requested: list[str] = []

    def record(request: Request) -> None:
        if scenario.api_path in request.url:
            requested.append(request.url)

    page.on("request", record)
    page.route(
        "**/api/chat",
        lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=scenario.body),
    )
    open_chat_and_send(page, "図にして")
    page.wait_for_timeout(2500)
    if scenario.chip_title is not None:
        page.locator(f'button[title="{scenario.chip_title}"]').first.click()
        page.wait_for_timeout(2500)
    queries = queries_of(requested)
    check("開いた図がデータを取りに行った", len(queries) > 0, f"{len(queries)} 件")
    last = queries[-1] if queries else {}
    shown = {key: last.get(key) for key in ("prefecture", "operators", "routeTypes")}
    check(scenario.expectation, bool(queries) and scenario.judge(last), f"最後の条件 {shown}／全 {len(queries)} 件")
    page.screenshot(path=f"{OUT}/chat-promotion-{scenario.name}.png")
    context.close()


WIDE = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}
SCENARIOS = [
    Scenario("失敗→呼び直し・散布・広い画面", WIDE, RETRY_SCATTER, "/api/growth", None, only_chiba_prefecture, "呼び直した方（千葉県）で開く"),
    Scenario("失敗→呼び直し・ランキング・広い画面", WIDE, RETRY_RANKING, "/api/ranking", None, only_chiba_prefecture, "呼び直した方（千葉県）で開く"),
    Scenario("失敗→呼び直し・散布・携帯（チップ）", PHONE, RETRY_SCATTER, "/api/growth", RETRY_SCATTER_PANEL["title"], only_chiba_prefecture, "呼び直した方（千葉県）で開く"),
    Scenario("同じ指標の図が2つ・広い画面", WIDE, TWO_FIGURES, "/api/growth", None, retried_figure_conditions, "キャンバスは最後の図を、その図の条件で開く"),
    Scenario("同じ指標の図が2つ・携帯（2枚目のチップ）", PHONE, TWO_FIGURES, "/api/growth", TWO_FIGURES_LAST_PANEL["title"], retried_figure_conditions, "2 枚目のチップは 2 枚目の条件で開く"),
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for scenario in SCENARIOS:
        run(browser, scenario)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
