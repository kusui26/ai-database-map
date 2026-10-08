#!/usr/bin/env python3
"""チャットの送信に**地図の表示範囲**が載ること、チャットの図を ⤢ で開くと**同じ路線（運行系統）**で
開き、その絞り込みが見えて外せることを、実ブラウザで確かめる（2026-10-08 L3）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.chat-lines.smoke.py [出力ディレクトリ] [BASE]

## 見ること

1. 送信の本文に `bbox`（[west, south, east, north]・小数 2 桁）が載り、地図の初期表示（東京駅中心）を含む。
   地図を拡大すると、次の送信の範囲が狭くなる（地図が止まるたびに持ち直している）
2. チャットの図（`lines: [11302]`＝JR山手線）を開くと、開いた図が `lines=11302` で取りに行く
   ——以前の条件の形（都道府県・会社・路線・種別）だけだと、全国の図に化ける
3. 開いた図の絞り込みに「JR山手線」のチップが出て、✕ で外すと路線なしで取り直す

`/api/chat` は差し替える（本番で流れる並び：ツールのパーツ・data-promotions・data-map）。モデルには触らない。
開いた図のデータ（`/api/ranking`）は本物のサーバから取る。
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

METRIC = "lp_near_price"
YAMANOTE = 11302
TOKYO_STATION = (139.7671, 35.6812)
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
TITLE = f"{LABELS[METRIC]}（全国・JR山手線・上位）"
PANEL = {"type": "rankingTable", "title": TITLE, "metricKey": METRIC, "unit": "円/㎡", "rows": []}
PROMOTION = {
    "kind": "ranking",
    "metricKey": METRIC,
    "order": "desc",
    "prefectures": [],
    "operators": [],
    "routes": [],
    "routeTypes": [],
    "lines": [YAMANOTE],
    "excludeLowN": False,
}


def sse(chunks: list[dict]) -> str:
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks]
    return "".join(lines) + "data: [DONE]\n\n"


def answer() -> str:
    """rankStations を 1 回呼んで図を出す応答（条件を図より先に送る・サーバと同じ並び）。"""
    tool_input = {"metric": METRIC, "routes": ["山手線"]}
    figures = [
        {"type": "data-promotions", "id": "promotions", "data": [PROMOTION]},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": [], "panels": [PANEL]}},
    ]
    return sse(
        [
            {"type": "start", "messageId": "smoke"},
            {"type": "start-step"},
            {"type": "tool-input-start", "toolCallId": "c1", "toolName": "rankStations"},
            {"type": "tool-input-available", "toolCallId": "c1", "toolName": "rankStations", "input": tool_input},
            *figures,
            {"type": "tool-output-available", "toolCallId": "c1", "output": {"routes": ["JR山手線"], "total": 30}},
            {"type": "finish-step"},
            {"type": "start-step"},
            {"type": "text-start", "id": "t1"},
            {"type": "text-delta", "id": "t1", "delta": "地図に表示中の範囲から、JR山手線で集計しました。"},
            {"type": "text-end", "id": "t1"},
            {"type": "finish-step"},
            {"type": "finish"},
        ]
    )


failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def send(page: Page, question: str) -> None:
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


def is_rounded(value: float) -> bool:
    return abs(value * 100 - round(value * 100)) < 1e-6


def check_bbox(label: str, bbox: object) -> list[float]:
    ok = isinstance(bbox, list) and len(bbox) == 4 and all(isinstance(v, (int, float)) for v in bbox)
    check(f"{label}：送信に bbox（4 つの数）が載る", ok, json.dumps(bbox))
    if not ok:
        return []
    west, south, east, north = bbox
    check(f"{label}：西 < 東・南 < 北", west < east and south < north)
    check(f"{label}：小数 2 桁に丸めてある", all(is_rounded(v) for v in bbox))
    return [west, south, east, north]


def ranking_queries(urls: list[str]) -> list[dict[str, str]]:
    return [{key: values[0] for key, values in parse_qs(urlparse(url).query).items()} for url in urls]


def run_wide(browser) -> None:
    print("[広い画面：送信の範囲・キャンバスの図・チップ]")
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    bodies: list[dict] = []
    rankings: list[str] = []

    def record(request: Request) -> None:
        if "/api/ranking" in request.url:
            rankings.append(request.url)

    def fulfill_chat(route) -> None:
        bodies.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, headers=STREAM_HEADERS, body=answer())

    page.on("request", record)
    page.route("**/api/chat", fulfill_chat)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1500)
    send(page, "山手線の駅で地価が高い順は？")
    page.wait_for_timeout(3000)

    first = check_bbox("初期表示", bodies[0].get("bbox") if bodies else None)
    if first:
        west, south, east, north = first
        inside = west <= TOKYO_STATION[0] <= east and south <= TOKYO_STATION[1] <= north
        check("初期表示：範囲に東京駅が入る（首都圏の地図）", inside, json.dumps(first))

    queries = ranking_queries(rankings)
    check("キャンバスの図がデータを取りに行った", len(queries) > 0, f"{len(queries)} 件")
    last = queries[-1] if queries else {}
    check("開いた図は lines=11302（JR山手線）で取りに行く", last.get("lines") == str(YAMANOTE), json.dumps(last, ensure_ascii=False))

    chip = page.get_by_role("button", name="JR山手線の絞り込みを外す")
    chip.wait_for(state="visible", timeout=8000)
    check("絞り込みに「JR山手線」のチップが出る", chip.is_visible())
    page.screenshot(path=f"{OUT}/chat-lines-wide.png")

    before = len(rankings)
    chip.click()
    page.wait_for_timeout(2500)
    after = ranking_queries(rankings[before:])
    check("✕ で外すと路線なしで取り直す", bool(after) and "lines" not in after[-1], json.dumps(after[-1] if after else {}, ensure_ascii=False))
    check("チップが消える", page.get_by_role("button", name="JR山手線の絞り込みを外す").count() == 0)

    # 地図を拡大すると、次の送信の範囲が狭くなる（地図が止まるたびに持ち直している）。
    # キャンバスは地図の上に開くので、閉じてから地図の上でホイールを回す。
    page.get_by_role("button", name="キャンバスを閉じる").click()
    page.wait_for_timeout(800)
    page.mouse.move(900, 450)
    for _ in range(4):
        page.mouse.wheel(0, -400)
        page.wait_for_timeout(250)
    page.wait_for_timeout(2000)
    send(page, "山手線の駅で地価が高い順は？")
    page.wait_for_timeout(2500)
    second = check_bbox("拡大のあと", bodies[-1].get("bbox") if len(bodies) > 1 else None)
    if first and second:
        narrower = (second[2] - second[0]) < (first[2] - first[0])
        check("拡大のあとの範囲は狭い", narrower, f"{first} → {second}")
    context.close()


def run_phone(browser) -> None:
    print("[携帯の幅：会話の中の図の ⤢ → 同じ路線で開く]")
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    rankings: list[str] = []
    page.on("request", lambda request: rankings.append(request.url) if "/api/ranking" in request.url else None)
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=answer()))
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1500)
    send(page, "山手線の駅で地価が高い順は？")
    page.wait_for_timeout(2500)
    page.locator(f'button[title="{TITLE} を拡大"], button[title="{TITLE}"]').first.click()
    page.wait_for_timeout(3000)
    queries = ranking_queries(rankings)
    last = queries[-1] if queries else {}
    check("⤢ で開いた図は lines=11302 で取りに行く", last.get("lines") == str(YAMANOTE), json.dumps(last, ensure_ascii=False))
    chip = page.get_by_role("button", name="JR山手線の絞り込みを外す")
    chip.wait_for(state="visible", timeout=8000)
    check("絞り込みに「JR山手線」のチップが出る", chip.is_visible())
    page.screenshot(path=f"{OUT}/chat-lines-phone.png")
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    run_wide(browser)
    run_phone(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
