#!/usr/bin/env python3
"""「このあたり」——チャットに同送する地図の範囲が**見えている部分**であること、地図の範囲の図が同じ範囲で開くことを、
実ブラウザで確かめる（2026-10-09 B3・`docs/261001_fix_user_feedback_ui.md` §6.4）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.map-context.smoke.py [出力ディレクトリ] [BASE]

## 見ること

1. 広い画面（1440px）：チャット欄は左の 432px（余白＋420px）を覆う。送信の範囲はその裏を含まない
   ——地図の初期表示（ズーム 9）で、幅は「(1440 − 432) px × 1px あたりの経度」に近い（以前は地図全体の 1440px 分）。
   1px あたりの経度は 360 ÷ (512 × 2^ズーム)（MapLibre のズームは 512px のタイルで決まる）
2. 駅を選ぶと右に駅詳細が開く。そのあとの送信の範囲は、左右のパネルのあいだだけ（ズーム 12・576px 分）
3. 携帯（390px）はパネルを横から重ねないので、地図全体
4. 「このあたり」の答え（題「（地図の表示範囲・上位）」・⤢ の条件に送った範囲）は、キャンバスの図が**送った範囲そのもの**
   （`bbox=`）で取りに行き、外せるチップ「地図の表示範囲」が出る

`/api/chat` は差し替える（モデルには触らない）。図のデータ（`/api/ranking`）は本物のサーバから取る。
"""

import json
import sys
from urllib.parse import parse_qs, quote, urlparse

from playwright.sync_api import Browser, Page, Request, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
#: 左右のパネルが覆う幅（余白 12px＋パネル 420px）。
SIDE_PX = 432
#: 1px あたりの経度（ズーム z）。MapLibre のズームは 512px のタイルで決まる（世界の幅＝512 × 2^z px）。
def deg_per_px(zoom: int) -> float:
    return 360 / (512 * 2**zoom)


#: 外向きの丸め（小数 2 桁を両端で）と、ピクセルの端の誤差を見込む。
TOLERANCE_DEG = 0.03
METRIC = "lp_gr_2026_2025_1km"
TITLE = "地価増減率（2025→2026年・1km圏）（地図の表示範囲・上位）"

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def sse(chunks: list[dict]) -> str:
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks]
    return "".join(lines) + "data: [DONE]\n\n"


def text_answer() -> str:
    return sse(
        [
            {"type": "start", "messageId": "smoke"},
            {"type": "start-step"},
            {"type": "text-start", "id": "t1"},
            {"type": "text-delta", "id": "t1", "delta": "確かめのための応答です。"},
            {"type": "text-end", "id": "t1"},
            {"type": "finish-step"},
            {"type": "finish"},
        ]
    )


def area_answer(bbox: list[float]) -> str:
    """rankStations を inMapView で 1 回呼んだときの応答（条件を図より先に送る・サーバと同じ並び）。"""
    west, south, east, north = bbox
    promotion = {
        "kind": "ranking",
        "metricKey": METRIC,
        "order": "desc",
        "prefectures": [],
        "operators": [],
        "routes": [],
        "routeTypes": [],
        "lines": [],
        "municipality": "",
        "bbox": {"west": west, "south": south, "east": east, "north": north},
        "near": None,
        "excludeLowN": False,
    }
    panel = {"type": "rankingTable", "title": TITLE, "metricKey": METRIC, "unit": "%", "rows": []}
    return sse(
        [
            {"type": "start", "messageId": "smoke-area"},
            {"type": "start-step"},
            {"type": "tool-input-start", "toolCallId": "c1", "toolName": "rankStations"},
            {
                "type": "tool-input-available",
                "toolCallId": "c1",
                "toolName": "rankStations",
                "input": {"metric": "lp_gr", "inMapView": True},
            },
            {"type": "data-promotions", "id": "promotions", "data": [promotion]},
            {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": [], "panels": [panel]}},
            {"type": "tool-output-available", "toolCallId": "c1", "output": {"place": "地図の表示範囲", "total": 3}},
            {"type": "finish-step"},
            {"type": "start-step"},
            {"type": "text-start", "id": "t1"},
            {"type": "text-delta", "id": "t1", "delta": "地図に表示中の範囲で、地価が上がっている駅です。"},
            {"type": "text-end", "id": "t1"},
            {"type": "finish-step"},
            {"type": "finish"},
        ]
    )


class Chat:
    """送信の本文を記録し、応答を差し替える。"""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.bodies: list[dict] = []
        self.next_answer = text_answer()
        page.route("**/api/chat", self.fulfill)

    def fulfill(self, route) -> None:
        self.bodies.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, headers=STREAM_HEADERS, body=self.next_answer)

    def send(self, question: str) -> list[float]:
        textarea = self.page.locator('textarea[aria-label="チャット入力"]')
        if not textarea.is_visible():
            self.page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
        textarea.wait_for(state="visible")
        textarea.fill(question)
        self.page.locator('button[aria-label="送信"]').click()
        self.page.wait_for_timeout(2500)
        bbox = self.bodies[-1].get("bbox") if self.bodies else None
        return bbox if isinstance(bbox, list) and len(bbox) == 4 else []


def map_width(page: Page) -> int:
    return page.evaluate("() => document.querySelector('canvas.maplibregl-canvas').clientWidth")


def width_of(bbox: list[float]) -> float:
    return bbox[2] - bbox[0] if bbox else 0.0


def near(actual: float, expected: float) -> bool:
    return expected - 0.005 <= actual <= expected + TOLERANCE_DEG


def scenario_wide(browser: Browser) -> None:
    print("[広い画面（1440px）：送信の範囲はチャット欄・駅詳細の裏を含まない]")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    chat = Chat(page)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(2500)
    width = map_width(page)
    first = chat.send("このあたりで地価が上がっている駅は？")
    full = width * deg_per_px(9)
    expected = (width - SIDE_PX) * deg_per_px(9)
    check("送信に範囲が載る", len(first) == 4, json.dumps(first))
    check(
        f"チャット欄の裏（左 {SIDE_PX}px）を含まない：幅 ≈ {expected:.3f}°（地図全体なら {full:.3f}°）",
        near(width_of(first), expected),
        f"{width_of(first):.3f}° {first}",
    )
    context.close()

    # 駅を選んだ状態で開く（駅詳細が右に開き、地図はズーム 12 で駅へ寄る）。
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    chat = Chat(page)
    page.goto(f"{BASE}/?grp={quote('東京#0')}", wait_until="networkidle")
    page.wait_for_timeout(4000)
    width = map_width(page)
    second = chat.send("このあたりで地価が上がっている駅は？")
    expected = (width - 2 * SIDE_PX) * deg_per_px(12)
    check(
        f"駅詳細も開くと、左右のパネルのあいだだけ：幅 ≈ {expected:.3f}°",
        near(width_of(second), expected),
        f"{width_of(second):.3f}° {second}",
    )
    tokyo = (139.7671, 35.6812)
    inside = bool(second) and second[0] <= tokyo[0] <= second[2] and second[1] <= tokyo[1] <= second[3]
    check("選んだ駅（東京）は範囲の中", inside, json.dumps(second))
    page.screenshot(path=f"{OUT}/map-context-wide-selected.png")
    context.close()


def scenario_phone(browser: Browser) -> None:
    print("[携帯（390px）：パネルを横から重ねないので、地図全体]")
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    chat = Chat(page)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(2500)
    width = map_width(page)
    bbox = chat.send("このあたりで地価が上がっている駅は？")
    expected = width * deg_per_px(9)
    check(f"幅 ≈ 地図全体（{expected:.3f}°）", near(width_of(bbox), expected), f"{width_of(bbox):.3f}° {bbox}")
    context.close()


def scenario_answer(browser: Browser) -> None:
    print("[「このあたり」の答え：キャンバスの図が送った範囲そのもので取りに行き、チップで見せる]")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    chat = Chat(page)
    rankings: list[str] = []
    page.on("request", lambda request: rankings.append(request.url) if "/api/ranking?" in request.url else None)
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(2500)
    # 1 回目で送られる範囲を知り、2 回目の応答をその範囲で作る（サーバの inMapView と同じ）。
    sent = chat.send("このあたりを確かめる")
    chat.next_answer = area_answer(sent)
    again = chat.send("このあたりで地価が上がっている駅は？")
    check("同じ地図なら、送る範囲も同じ", again == sent, f"{sent} / {again}")
    page.wait_for_timeout(2500)
    canvas = page.locator('aside[aria-label="キャンバス"]')
    check("キャンバスに図が開く", canvas.count() == 1 and canvas.is_visible())
    query = {key: values[0] for key, values in parse_qs(urlparse(rankings[-1]).query).items()} if rankings else {}
    expected_bbox = ",".join(str(value) for value in sent)
    check("図は送った範囲そのもの（bbox=）で取りに行く", query.get("bbox") == expected_bbox, json.dumps(query, ensure_ascii=False))
    chips = canvas.get_by_role("group", name="場所で絞り込み中")
    check("外せるチップ「地図の表示範囲」", chips.count() == 1 and "地図の表示範囲" in chips.inner_text(), chips.inner_text() if chips.count() else "無い")
    page.screenshot(path=f"{OUT}/map-context-answer.png")
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    scenario_wide(browser)
    scenario_phone(browser)
    scenario_answer(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
