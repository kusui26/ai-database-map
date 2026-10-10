#!/usr/bin/env python3
"""エリアの要約のパネル（`areaSummary`・推移・内訳）を実ブラウザで確かめる
（2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.7・§6.12.9）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.area-summary.smoke.py [出力ディレクトリ] [BASE]

B5b では、パネルを出す道具（AI の `getAreaSummary`・B5d）と画面（エリアの図・B5e）はまだ無い。そこで `/api/chat` を差し替え、
**本物の共通 API（`/api/areas/summary`）の応答**から作ったパネルを回答に載せて描かせる——パネルはサーバの `areaSummaryPanels`
（`src/domain/area-summary/panel.ts`）と同じ形に写す。

## 見ること（広い画面・狭い画面・携帯の 3 つの幅）

1. 横浜市：区域の値（2025 年 3,750,952 人・作り方の札・推計の山と当たり具合）、駅の周り（1km 圏・137 駅）、凡例、
   見ていないこと。推移の図は人口の色。内訳は 18 区で、**0 を真ん中に**減った区（金沢区）は左・増えた区（西区）は右へ伸び、
   区の名前（保土ケ谷区）が切れない。横にはみ出さない
2. 横浜市と川崎市：比べる表（項目と値を折り返し、2 つなら携帯でも横に送らずに収まる）と、エリアごとの色（#0072b2・#e69f00）の
   推移。内訳は出さない
3. 東急東横線の沿線：内訳は路線の駅の順（渋谷 → 横浜）・増減はすべて正なので左から伸びる・長い駅名が切れない
4. 竹橋から 3km（6 つ以外の半径）：区域の値の代わりに理由。推移・内訳は出さない
5. 紋別市（駅が無い）：駅の周りを出さず、色分けしない理由を出す
6. 既存の棒（駅詳細の地価・半径別）は以前のまま：名前の列は 3.25rem・0 の線を引かない
"""

import json
import sys
import urllib.parse
import urllib.request

from playwright.sync_api import Browser, BrowserContext, Locator, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

WIDE = {"width": 1440, "height": 900}
NARROW = {"width": 1024, "height": 800}
PHONE = {"width": 390, "height": 844}
VIEWPORTS = [("wide", WIDE), ("narrow", NARROW), ("phone", PHONE)]
WAIT_MS = 20_000
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}

#: サーバと同じ定数（`src/shared/constants.ts` の人口の色・`src/domain/style/palette.ts`・`panel.ts`）。
POPULATION_COLOR = "#2563eb"
AREA_SERIES_COLORS = ["#0072b2", "#e69f00", "#009e73", "#cc79a7"]
MAX_BREAKDOWN_BARS = 30
BREAKDOWN_EDGE_BARS = 10
#: 以前の棒の名前の列（3.25rem・16px）。
SHORT_LABEL_COLUMN_PX = 52

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def fetch_summary(*areas: str) -> dict:
    query = urllib.parse.urlencode([("area", area) for area in areas])
    with urllib.request.urlopen(f"{BASE}/api/areas/summary?{query}", timeout=60) as response:
        return json.load(response)


# --- サーバの areaSummaryPanels と同じ形 ----------------------------------------------------


def card_of(area: dict) -> dict:
    totals = [{key: value for key, value in total.items() if key != "points"} for total in area["totals"]]
    return {**{key: value for key, value in area.items() if key not in ("breakdown", "totals")}, "totals": totals}


def summary_panel(response: dict) -> dict:
    areas = response["areas"]
    title = f"{areas[0]['labelJa']}の要約" if len(areas) == 1 else f"{'・'.join(a['nameJa'] for a in areas)}の比較"
    comparison = response["comparison"]
    return {
        "type": "areaSummary",
        "title": title,
        "areas": [card_of(area) for area in areas],
        "comparison": None if comparison is None else {k: v for k, v in comparison.items() if k != "index"},
        "legend": response["legend"],
        "radiusM": response["radiusM"],
        "notesJa": response["notesJa"],
        "notIncludedJa": response["notIncludedJa"],
        "sources": [{"labelJa": s["source"], "url": None, "license": s["license"], "forJa": None} for s in response["sources"]],
        "placement": "inline",
        "size": "compact",
    }


def xy(points: list[dict]) -> list[dict]:
    return [{"x": point["year"], "y": point["value"]} for point in points]


def total_of(area: dict, total_id: str) -> dict | None:
    return next((total for total in area["totals"] if total["id"] == total_id), None)


def population_trend(area: dict) -> dict | None:
    actual = total_of(area, "population")
    future = total_of(area, "populationFuture")
    series = []
    if actual is not None:
        series.append({"label": "実績", "points": xy(actual["points"]), "color": POPULATION_COLOR})
    if future is not None:
        series.append({"label": "R6推計", "points": xy(future["points"]), "color": POPULATION_COLOR, "dashed": True})
    if sum(len(each["points"]) for each in series) < 2:
        return None
    stats = []
    if actual is not None and actual["changes"]:
        change = actual["changes"][0]
        stats.append({"label": f"{change['fromYear']}→{change['toYear']}年", "value": change["rateJa"], "flagged": False})
    if future is not None and future["changes"]:
        change = future["changes"][0]
        stats.append({"label": f"{change['fromYear']}→{change['toYear']}年（推計）", "value": change["rateJa"], "flagged": False})
    return {
        "type": "trendChart",
        "title": f"{area['labelJa']}の人口の推移（実績・将来推計）",
        "unit": "人",
        "format": "int",
        "category": "population",
        "flags": [],
        "series": series,
        "stats": stats,
        "placement": "inline",
        "size": "compact",
    }


def index_trend(comparison: dict) -> dict | None:
    series = []
    for index, each in enumerate(comparison["index"]):
        color = AREA_SERIES_COLORS[index % len(AREA_SERIES_COLORS)]
        actual = [point for point in each["points"] if point["kind"] == "actual"]
        projected = [point for point in each["points"] if point["kind"] == "projection"]
        if actual:
            series.append({"label": each["nameJa"], "points": xy(actual), "color": color})
        if projected:
            series.append({"label": f"{each['nameJa']}（推計）", "points": xy(projected), "color": color, "dashed": True})
    if not series:
        return None
    return {
        "type": "trendChart",
        "title": f"人口の推移（{comparison['baseYear']}年＝100）",
        "unit": None,
        "format": "decimal1",
        "flags": [],
        "series": series,
        "legend": True,
        "placement": "inline",
        "size": "compact",
    }


def breakdown_bars(area: dict) -> dict | None:
    breakdown = area["breakdown"]
    if breakdown is None or not breakdown["rows"]:
        return None
    rows = breakdown["rows"]
    trimmed = len(rows) > MAX_BREAKDOWN_BARS
    if trimmed:
        ranked = sorted((row for row in rows if row["change"] is not None), key=lambda row: -row["change"])
        rows = ranked if len(ranked) <= BREAKDOWN_EDGE_BARS * 2 else ranked[:BREAKDOWN_EDGE_BARS] + ranked[-BREAKDOWN_EDGE_BARS:]
    note_parts = []
    if trimmed:
        note_parts.append(f"全 {len(breakdown['rows'])} のうち、増減の大きい {BREAKDOWN_EDGE_BARS} と小さい {BREAKDOWN_EDGE_BARS}。")
    if breakdown["noteJa"] is not None:
        note_parts.append(breakdown["noteJa"])
    return {
        "type": "barChart",
        "title": f"{area['nameJa']}の{breakdown['byJa']}ごとの人口の{breakdown['changeLabelJa']}",
        "unit": "%",
        "format": "percent1",
        "category": "population",
        "bars": [{"label": row["nameJa"], "value": row["change"], "formatted": row["changeJa"], "flagged": False} for row in rows],
        "flags": [],
        "note": "".join(note_parts) or None,
        "placement": "inline",
        "size": "compact",
    }


def area_panels(response: dict) -> list[dict]:
    single = response["areas"][0] if len(response["areas"]) == 1 else None
    if single is not None:
        trend = population_trend(single)
    else:
        trend = None if response["comparison"] is None else index_trend(response["comparison"])
    bars = None if single is None else breakdown_bars(single)
    return [panel for panel in [summary_panel(response), trend, bars] if panel is not None]


def answer(panels: list[dict], text: str) -> str:
    """道具を 1 回呼んだときの応答（図を本文より先に送る・サーバと同じ並び）。"""
    chunks = [
        {"type": "start", "messageId": "smoke-area"},
        {"type": "start-step"},
        {"type": "data-promotions", "id": "promotions", "data": [None] * len(panels)},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": [], "panels": panels}},
        {"type": "finish-step"},
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"


# --- 画面 ---------------------------------------------------------------------------------


def open_page(browser: Browser, viewport: dict) -> tuple[BrowserContext, Page, list[str]]:
    phone = viewport["width"] < 640
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone, device_scale_factor=2)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page, errors


def ask(browser: Browser, viewport: dict, panels: list[dict], question: str) -> tuple[BrowserContext, Page, list[str]]:
    context, page, errors = open_page(browser, viewport)
    body = answer(panels, "エリアの要約です。")
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=body))
    page.goto(BASE, wait_until="networkidle")
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()
    page.get_by_text(panels[0]["title"], exact=True).first.wait_for(state="visible", timeout=WAIT_MS)
    return context, page, errors


def section_of(page: Page, title: str) -> Locator:
    """見出しの文字から、そのパネルの <section>。"""
    return page.locator("section", has=page.get_by_role("heading", name=title, exact=True)).first


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


def bar_geometry(section: Locator) -> list[dict]:
    """棒 1 本ずつの名前・名前の欄の幅・切れたか・塗りと 0 の線の位置。"""
    return section.evaluate(
        """(el) => [...el.querySelectorAll('li')].map((li) => {
          const [label, track] = li.children
          const spans = [...track.querySelectorAll('span')]
          const zero = spans.find((span) => span.className.includes('left-1/2'))
          const fill = spans.find((span) => span !== zero)
          const box = (node) => node ? node.getBoundingClientRect() : null
          return {
            label: label.textContent,
            labelWidth: label.getBoundingClientRect().width,
            cut: label.scrollWidth > label.clientWidth + 1,
            fill: box(fill),
            zero: box(zero),
            track: box(track),
          }
        })"""
    )


def canvas_colors(section: Locator, colors: list[str]) -> dict[str, int]:
    """図（Chart.js の 2D canvas）の画素のうち、各色に近いものの数。"""
    return section.evaluate(
        """(el, colors) => {
          const canvas = el.querySelector('canvas')
          if (!canvas) return Object.fromEntries(colors.map((c) => [c, -1]))
          const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
          const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
          const targets = colors.map(rgb)
          const counts = colors.map(() => 0)
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 200) continue
            targets.forEach(([r, g, b], k) => {
              if (Math.abs(data[i] - r) < 12 && Math.abs(data[i + 1] - g) < 12 && Math.abs(data[i + 2] - b) < 12) counts[k] += 1
            })
          }
          return Object.fromEntries(colors.map((c, k) => [c, counts[k]]))
        }""",
        colors,
    )


# --- 場面 ---------------------------------------------------------------------------------


def scenario_single(browser: Browser, name: str, viewport: dict, response: dict) -> None:
    print(f"[横浜市：区域の値・駅の周り・凡例・推移・0 を真ん中にした区の増減・{name}]")
    panels = area_panels(response)
    check("パネルは要約・推移・内訳の 3 つ", [panel["type"] for panel in panels] == ["areaSummary", "trendChart", "barChart"])
    context, page, errors = ask(browser, viewport, panels, "横浜市全体の人口は増えている？")
    summary = section_of(page, "神奈川県横浜市の要約")
    text = summary.inner_text()
    for needle in [
        "エリア全体の値",
        "3,750,952 人（2025年）・2020→2025年で -0.7%（2015→2020年は +1.4%）",
        "公表値",
        "推計の山：2025年 3,786,702 人",
        "2025年の実績は推計より 0.9% 少ない",
        "駅の周り（1km圏・137 駅）",
        "中央値",
        "上位",
        "⚠ 40 駅は参考値なので除いた",
        "地図の色分け：人口増減率（2015→2020年・1km圏）",
        "-5%未満",
        "この要約で見ていないこと",
        "増えた・減った理由",
    ]:
        check(f"要約に「{needle}」", needle in text)
    trend = section_of(page, "神奈川県横浜市の人口の推移（実績・将来推計）")
    trend.locator("canvas").wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(300)
    colors = canvas_colors(trend, [POPULATION_COLOR])
    check("推移の線は人口の色", colors[POPULATION_COLOR] > 200, str(colors))
    bars = section_of(page, "横浜市の区ごとの人口の増減（2020→2025年）")
    geometry = bar_geometry(bars)
    by_label = {bar["label"]: bar for bar in geometry}
    check("区は 18", len(geometry) == 18, str(len(geometry)))
    west, kanazawa = by_label.get("西区"), by_label.get("金沢区")
    zeros = [bar["zero"]["x"] for bar in geometry if bar["zero"] is not None]
    check("0 の線はすべての行で同じ位置（列をそろえた）", len(zeros) == 18 and max(zeros) - min(zeros) <= 0.5, f"{min(zeros, default=0):.2f}〜{max(zeros, default=0):.2f}")
    if west and kanazawa and west["zero"] and kanazawa["zero"]:
        center = kanazawa["zero"]["x"] + kanazawa["zero"]["width"] / 2
        check("0 の線は棒の欄の真ん中", abs(center - (kanazawa["track"]["x"] + kanazawa["track"]["width"] / 2)) <= 1.5)
        check("減った区（金沢区）は 0 から左へ", abs(kanazawa["fill"]["x"] + kanazawa["fill"]["width"] - center) <= 1.5 and kanazawa["fill"]["width"] > 5)
        check("増えた区（西区）は 0 から右へ", abs(west["fill"]["x"] - center) <= 1.5 and west["fill"]["width"] > 5)
    else:
        check("0 の線と塗りがある", False, str(by_label.get("金沢区")))
    check("区の名前が切れない（保土ケ谷区）", not any(bar["cut"] for bar in geometry), " / ".join(bar["label"] for bar in geometry if bar["cut"]))
    check("ページは横にはみ出さない", not page_overflows(page))
    check("会話の欄は横にはみ出さない", not chat_overflows(summary))
    summary.screenshot(path=f"{OUT}/area-single-summary-{name}.png")
    bars.screenshot(path=f"{OUT}/area-single-bars-{name}.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_compare(browser: Browser, name: str, viewport: dict, response: dict) -> None:
    print(f"[横浜市と川崎市：比べる表・エリアごとの色の推移・内訳なし・{name}]")
    panels = area_panels(response)
    check("パネルは要約と推移の 2 つ（内訳なし）", [panel["type"] for panel in panels] == ["areaSummary", "trendChart"])
    context, page, errors = ask(browser, viewport, panels, "横浜市と川崎市の人口の伸びを比べて")
    summary = section_of(page, "横浜市・川崎市の比較")
    text = summary.inner_text()
    for needle in ["神奈川県横浜市", "神奈川県川崎市", "人口の増減（2020→2025年）", "-0.7%", "+1.4%", "推計の当たり具合：2025年の実績は推計より 1.6% 多い", "推移は 2020年を 100 とした指数"]:
        check(f"比較に「{needle}」", needle in text)
    fits = summary.locator("table").evaluate("(el) => el.scrollWidth <= el.parentElement.clientWidth + 1")
    check("2 つのエリアの比べる表は横に送らずに収まる（携帯でも両方の列が見える）", fits)
    collapsed = summary.locator("details")
    check("比較のときは駅の周りを畳む", collapsed.count() == 2 and not collapsed.first.evaluate("(el) => el.open"))
    trend = section_of(page, "人口の推移（2020年＝100）")
    trend.locator("canvas").wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(300)
    colors = canvas_colors(trend, AREA_SERIES_COLORS[:2])
    check("推移はエリアごとの色（横浜市 #0072b2・川崎市 #e69f00）", all(count > 100 for count in colors.values()), str(colors))
    check("ページは横にはみ出さない", not page_overflows(page))
    check("会話の欄は横にはみ出さない（表は表の中で送る）", not chat_overflows(summary))
    summary.screenshot(path=f"{OUT}/area-compare-summary-{name}.png")
    trend.screenshot(path=f"{OUT}/area-compare-trend-{name}.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_line(browser: Browser, response: dict) -> None:
    print("[東急東横線の沿線：路線の駅の順・正の増減は左から・長い駅名が切れない（携帯）]")
    panels = area_panels(response)
    context, page, errors = ask(browser, PHONE, panels, "東急東横線沿線の人口は 2050 年までにどれだけ減る？")
    summary = section_of(page, "東急東横線の沿線（駅から 1km）の要約")
    text = summary.inner_text()
    check("推計は 2050年 787,122 人・メッシュの按分", "2050年 787,122 人（推計・2020年比 +4.9%）" in text and "メッシュの按分" in text)
    check("2025 年が無い理由", "国勢調査のメッシュが未公表" in text)
    bars = section_of(page, "東急東横線の駅（路線の順）ごとの人口の増減（2015→2020年）")
    geometry = bar_geometry(bars)
    labels = [bar["label"] for bar in geometry]
    check("路線の駅の順（渋谷 → 横浜）", labels[:1] == ["渋谷"] and labels[-1:] == ["横浜"], " → ".join(labels))
    check("増減がすべて正なら 0 の線を引かない（左から）", all(bar["zero"] is None for bar in geometry))
    starts = [bar["fill"]["x"] for bar in geometry]
    widths = [bar["track"]["width"] for bar in geometry]
    check("棒の欄はすべての行で同じ位置と幅（列をそろえた）", max(starts) - min(starts) <= 0.5 and max(widths) - min(widths) <= 0.5, f"幅 {min(widths):.1f}〜{max(widths):.1f}")
    check("長い駅名が切れない（大倉山（東急電鉄））", not any(bar["cut"] for bar in geometry), " / ".join(bar["label"] for bar in geometry if bar["cut"]))
    check("ページは横にはみ出さない", not page_overflows(page))
    bars.screenshot(path=f"{OUT}/area-line-bars-phone.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_no_totals(browser: Browser, response: dict) -> None:
    print("[竹橋から 3km：区域の値の代わりに理由・推移と内訳は出さない]")
    panels = area_panels(response)
    check("パネルは要約だけ", [panel["type"] for panel in panels] == ["areaSummary"])
    context, page, errors = ask(browser, NARROW, panels, "竹橋から 3km の範囲はどんなエリア？")
    text = section_of(page, "竹橋から 3kmの要約").inner_text()
    check("出せる半径を添えた理由", "駅から 3km の区域の値は出していない（出せる半径：500m・1km・2km・5km・10km・20km）" in text)
    check("エリア全体の値の見出しを出さない", section_of(page, "竹橋から 3kmの要約").locator("h4", has_text="エリア全体の値").count() == 0)
    check("駅の周り（70 駅）は出す", "駅の周り（1km圏・70 駅）" in text)
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_no_stations(browser: Browser, response: dict) -> None:
    print("[紋別市（駅が無い）：駅の周りを出さず、色分けしない理由]")
    panels = area_panels(response)
    context, page, errors = ask(browser, NARROW, panels, "紋別市の人口は？")
    text = section_of(page, "北海道紋別市の要約").inner_text()
    check("区域の値は出す（2025年 19,424 人）", "19,424 人（2025年）" in text)
    check("駅の周りを出さない", section_of(page, "北海道紋別市の要約").locator("h4, summary", has_text="駅の周り（").count() == 0)
    check("色分けしない理由", "値のある駅が 0 しかないので色分けしない" in text)
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_existing_bars(browser: Browser) -> None:
    print("[既存の棒（駅詳細の地価・半径別）は以前のまま]")
    context, page, errors = open_page(browser, WIDE)
    page.goto(f"{BASE}/?grp={urllib.parse.quote('横浜#0', safe='')}&tab=land_price", wait_until="networkidle")
    bars = section_of(page, "地価中央値（半径別・最新年）")
    bars.wait_for(state="visible", timeout=WAIT_MS)
    geometry = bar_geometry(bars)
    check("半径の棒が出る", len(geometry) >= 4, str(len(geometry)))
    check("名前の列は以前の 3.25rem", all(abs(bar["labelWidth"] - SHORT_LABEL_COLUMN_PX) <= 1 for bar in geometry), str([round(bar["labelWidth"], 1) for bar in geometry]))
    check("0 の線を引かず、左から伸ばす", all(bar["zero"] is None and abs(bar["fill"]["x"] - bar["track"]["x"]) <= 1 for bar in geometry))
    bars.screenshot(path=f"{OUT}/area-existing-bars.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    YOKOHAMA = fetch_summary("muni:14100")
    COMPARE = fetch_summary("muni:14100", "muni:14130")
    for name, viewport in VIEWPORTS:
        scenario_single(browser, name, viewport, YOKOHAMA)
        scenario_compare(browser, name, viewport, COMPARE)
    scenario_line(browser, fetch_summary("line:26001@1000"))
    scenario_no_totals(browser, fetch_summary("near:竹橋#0@3000"))
    scenario_no_stations(browser, fetch_summary("muni:01219"))
    scenario_existing_bars(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
