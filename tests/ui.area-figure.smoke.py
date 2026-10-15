#!/usr/bin/env python3
"""エリアの図（FAB「エリア」・チャットの ⤢）を実ブラウザで確かめる（2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright pillow && playwright install chromium
    python3 tests/ui.area-figure.smoke.py [出力ディレクトリ] [BASE]

## 見ること（広い画面・狭い画面・携帯の 3 つの幅）

1. FAB：5 つのボタンがどれも画面の中で重ならない（チャットを開いた狭い幅でも外に押し出さない）
2. 開いた直後のエリア：選択中の駅が無ければ地図の中心に近い駅の都道府県（初期表示は広いので都道府県）、駅があればその市区町村。
   決めた手がかりを添える。地図の色分け（`?color&colorIn`）が図のエリアと同じ
3. 入れ物：広い画面はチャットの右の列（420px・FAB の行の上で止まり、FAB は列の下に見える）、狭い画面・携帯はモーダル。
   広い画面では、色分けしたエリアの駅が列の裏に入らない（寄せる余白が列を避ける・地図の画素で数える）
4. 選び方：都道府県 → 市区町村（横浜市）・「＋比べる」（川崎市・札の色は推移の図の系列の色）・外す・沿線（東横線 2km）・地図の範囲
5. 色分けの指標と半径：地価にすると図と地図の色分けが替わる・半径 2km・「色分けしない」で地図の色分けが消える
6. 履歴：閉じる（色分けは残る）→ 戻るで同じ条件の図 → もう一度戻ると開く前（色分けも無い）→ 進む
7. 深いリンク（比較・500m）はそのまま開き、URL を書き換え続けない。壊れたリンク（知らないエリア）は理由を出し、札は文字列のまま
8. チャットの回答：エリアの答えは会話の中（compact・自動では図を開かない）に「拡大」付きで出て、押すと同じ条件の図が開く
9. 駅を選んだ広い画面（1440px）では、地図の凡例が列の右に入らないので出さない（列の要約が同じ凡例を出す）。駅詳細を閉じれば出る
10. 横にはみ出さない・画面のエラーが無い・地図が「収まらない」と言わない
"""

import io
import json
import re
import sys
import urllib.parse
import urllib.request

from PIL import Image
from playwright.sync_api import Browser, BrowserContext, Locator, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

WIDE = {"width": 1440, "height": 900}
NARROW = {"width": 1024, "height": 800}
PHONE = {"width": 390, "height": 844}
VIEWPORTS = [("wide", WIDE), ("narrow", NARROW), ("phone", PHONE)]
WAIT_MS = 60_000
SETTLE_MS = 2_000
CANNOT_FIT = "Map cannot fit"
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}

#: サーバと同じ定数（`src/hooks/useIsWide.ts`・`src/domain/style/palette.ts`・`src/shared/constants.ts`）。
AREA_COLUMN_WIDTH_PX = 420
AREA_SERIES_COLORS = ["#0072b2", "#e69f00", "#009e73", "#cc79a7"]
DEFAULT_COLOR = "pop_gr_2020_2015_1km"
POPULATION_COLOR = "#2563eb"
#: 増減の段の色のうち、地図の地色に無い 4 色（真ん中の灰色は数えない）。
DIVERGING_SATURATED = ["#0571b0", "#92c5de", "#f4a582", "#ca0020"]
COLOR_TOLERANCE = 6
FAB_LABELS = ["現在地", "ランキング", "散布図", "エリア", "おすすめ"]
SHIN_YOKOHAMA = "新横浜#0"

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def fetch_json(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=60) as response:
        return json.load(response)


def fetch_summary(*areas: str) -> dict:
    return fetch_json("/api/areas/summary?" + urllib.parse.urlencode([("area", area) for area in areas]))


# --- チャットの回答（サーバの areaSummaryPanels と同じ形・compact） ----------------------------------


def card_of(area: dict) -> dict:
    totals = [{key: value for key, value in total.items() if key != "points"} for total in area["totals"]]
    return {**{key: value for key, value in area.items() if key not in ("breakdown", "totals")}, "totals": totals}


def summary_panel(response: dict) -> dict:
    area = response["areas"][0]
    return {
        "type": "areaSummary",
        "title": f"{area['labelJa']}の要約",
        "areas": [card_of(area)],
        "comparison": None,
        "legend": response["legend"],
        "radiusM": response["radiusM"],
        "notesJa": response["notesJa"],
        "notIncludedJa": response["notIncludedJa"],
        "sources": [{"labelJa": s["source"], "url": None, "license": s["license"], "forJa": None} for s in response["sources"]],
        "placement": "inline",
        "size": "compact",
    }


def trend_panel(response: dict) -> dict:
    area = response["areas"][0]
    actual = next(total for total in area["totals"] if total["id"] == "population")
    return {
        "type": "trendChart",
        "title": f"{area['labelJa']}の人口の推移（実績・将来推計）",
        "unit": "人",
        "format": "int",
        "category": "population",
        "flags": [],
        "series": [{"label": "実績", "points": [{"x": p["year"], "y": p["value"]} for p in actual["points"]], "color": POPULATION_COLOR}],
        "stats": [],
        "placement": "inline",
        "size": "compact",
    }


def chat_answer(response: dict, text: str) -> dict:
    """エリアの要約の回答（⤢ の条件 → 図 → 本文・サーバと同じ並び）。"""
    ref = response["areas"][0]["ref"]
    panels = [summary_panel(response), trend_panel(response)]
    promotion = {"kind": "area", "areas": [ref], "radiusM": response["radiusM"], "colorBy": response["legend"]["metricKey"]}
    actions = [{"type": "colorStations", "metricKey": response["coloring"]["metricKey"], "areas": response["coloring"]["areas"]}]
    chunks = [
        {"type": "start", "messageId": "smoke-area-figure"},
        {"type": "start-step"},
        {"type": "data-promotions", "id": "promotions", "data": [promotion, None]},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": actions, "panels": panels}},
        {"type": "finish-step"},
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return {"body": "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"}


def chat_script(plan: dict) -> str:
    """/api/chat だけを差し替える fetch（ほかの API は本物）。"""
    return f"""
    (() => {{
      const original = window.fetch.bind(window);
      const plan = {json.dumps(plan, ensure_ascii=False)};
      window.fetch = async (input, init) => {{
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/api/chat')) return original(input, init);
        return new Response(plan.body, {{ status: 200, headers: {json.dumps(STREAM_HEADERS)} }});
      }};
    }})();
    """


# --- 画面 ---------------------------------------------------------------------------------


def open_page(browser: Browser, viewport: dict, plan: dict | None = None) -> tuple[BrowserContext, Page, list[str]]:
    phone = viewport["width"] < 640
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone, device_scale_factor=1)
    if plan is not None:
        context.add_init_script(chat_script(plan))
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if CANNOT_FIT in message.text else None)
    return context, page, errors


def goto(page: Page, query: str = "") -> None:
    page.goto(f"{BASE}/{query}", wait_until="domcontentloaded")
    page.locator("canvas.maplibregl-canvas").wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)


def is_wide(page: Page) -> bool:
    return page.viewport_size is not None and page.viewport_size["width"] >= 1128


def figure(page: Page) -> Locator:
    """図の入れ物（広い画面はキャンバスの列、狭い画面・携帯はモーダル）。"""
    return page.locator('aside[aria-label="キャンバス"]') if is_wide(page) else page.get_by_role("dialog", name="エリア")


def wait_heading(page: Page, title: str) -> None:
    figure(page).get_by_role("heading", name=title, exact=True).first.wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)


def params(page: Page) -> dict[str, list[str]]:
    return urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)


def wait_url(page: Page, predicate: str) -> None:
    """URL（`location.search`）が条件を満たすまで待つ（画面が先に変わり、URL の書き換えは少し遅れて来る）。"""
    page.wait_for_function(f"() => {{ const q = new URLSearchParams(location.search); return {predicate} }}", timeout=WAIT_MS)


def open_area_fab(page: Page) -> None:
    page.get_by_role("button", name="エリア", exact=True).click()
    figure(page).wait_for(state="visible", timeout=WAIT_MS)


def close_figure(page: Page) -> None:
    name = "キャンバスを閉じる" if is_wide(page) else "閉じる"
    figure(page).get_by_role("button", name=name, exact=True).click()
    page.wait_for_timeout(SETTLE_MS)


def legend(page: Page) -> Locator:
    return page.locator('section[aria-label="色分けの凡例"]')


def page_overflows(page: Page) -> bool:
    return page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")


def box(locator: Locator) -> dict | None:
    return locator.bounding_box() if locator.count() > 0 and locator.first.is_visible() else None


def overlaps(a: dict, b: dict) -> bool:
    return not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])


def fab_boxes(page: Page) -> list[dict | None]:
    return [box(page.locator(f'button[aria-label="{label}"]')) for label in FAB_LABELS]


def picker(page: Page) -> Locator:
    return figure(page).locator("section").filter(has=page.get_by_role("button", name="やめる"))


def pick_admin(page: Page, prefecture: str, area_ref: str, submit: str) -> None:
    """選び方（行政区域）で都道府県と市区町村を選んで決める。"""
    section = picker(page)
    section.get_by_label("都道府県").wait_for(state="visible", timeout=WAIT_MS)
    section.get_by_label("都道府県").select_option(label=prefecture)
    section.get_by_label("市区町村").select_option(value=area_ref)
    section.get_by_role("button", name=submit, exact=True).click()


# --- 地図の画素 -----------------------------------------------------------------------------


def rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[index : index + 2], 16) for index in (1, 3, 5))


HIDE_OVERLAYS = """(hidden) => {
  const targets = [
    ...document.querySelectorAll('aside, header, section[aria-label="色分けの凡例"], nextjs-portal'),
    ...[...document.querySelectorAll('button')].filter((b) => ['現在地','ランキング','散布図','エリア','おすすめ'].includes(b.getAttribute('aria-label') ?? '')),
  ]
  for (const el of targets) el.style.visibility = hidden ? 'hidden' : ''
}"""


def colored_xs(page: Page) -> list[int]:
    """色分けの印（増減の濃い 4 色）の画素の x（パネル・凡例・FAB を隠した地図の写真）。"""
    page.evaluate(HIDE_OVERLAYS, True)
    try:
        image = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    finally:
        page.evaluate(HIDE_OVERLAYS, False)
    pixels = image.load()
    width, height = image.size
    targets = [rgb(color) for color in DIVERGING_SATURATED]
    xs: list[int] = []
    for y in range(0, height, 2):
        for x in range(0, width, 2):
            pixel = pixels[x, y]
            if any(all(abs(c - t) <= COLOR_TOLERANCE for c, t in zip(pixel, target, strict=True)) for target in targets):
                xs.append(x)
    return xs


# --- 場面 -----------------------------------------------------------------------------------


def scenario_fab_default(browser: Browser, name: str, viewport: dict) -> None:
    print(f"\n[{name}] FAB と開いた直後のエリア")
    context, page, errors = open_page(browser, viewport)
    goto(page)
    boxes = fab_boxes(page)
    inside = all(b is not None and b["x"] >= 0 and b["x"] + b["width"] <= viewport["width"] and b["y"] + b["height"] <= viewport["height"] for b in boxes)
    check("FAB の 5 つが画面の中に出る", inside, str([None if b is None else (round(b["x"]), round(b["x"] + b["width"])) for b in boxes]))
    present = [b for b in boxes if b is not None]
    check("FAB どうしが重ならない", not any(overlaps(a, b) for i, a in enumerate(present) for b in present[i + 1 :]))
    open_area_fab(page)
    figure(page).get_by_role("heading", name=re.compile("の要約$")).first.wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)
    query = params(page)
    areas = query.get("figAreas", [])
    check("開いた直後のエリアは都道府県（初期表示は広い）", len(areas) == 1 and areas[0].startswith("pref:"), str(query))
    check("地図の色分けは図のエリアと同じ（既定の人口の増減）", query.get("color") == [DEFAULT_COLOR] and query.get("colorIn") == areas, str(query))
    basis = figure(page).get_by_text(re.compile("地図の中心に近い駅（.+）の都道府県を開きました"))
    check("決めた手がかりを添える", basis.count() == 1 and basis.first.is_visible())
    check("要約・区域の値が出る", figure(page).get_by_text("エリア全体の値").first.is_visible())
    if is_wide(page):
        column = box(figure(page))
        check("広い画面は列（420px）", column is not None and abs(column["width"] - AREA_COLUMN_WIDTH_PX) <= 1, str(column))
        fabs = [b for b in fab_boxes(page) if b is not None]
        below = column is not None and all(b["y"] >= column["y"] + column["height"] for b in fabs)
        check("列は FAB の行の上で止まり、FAB が見える", below and len(fabs) == 5)
        on_top = page.evaluate(
            """() => ['ランキング','散布図','エリア'].every((label) => {
              const b = document.querySelector(`button[aria-label="${label}"]`); const r = b.getBoundingClientRect()
              return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) })"""
        )
        check("FAB を押せる（列に覆われない）", on_top)
        check("地図の凡例が列の右に出る（1440px・駅詳細なし）", legend(page).is_visible())
        xs = colored_xs(page)
        column_right = 0 if column is None else column["x"] + column["width"]
        check("色分けした駅が地図に出る", len(xs) > 50, str(len(xs)))
        check("色分けした駅は列の裏に入らない（寄せる余白が列を避ける）", bool(xs) and min(xs) >= column_right, f"左端 {min(xs) if xs else None} / 列の右端 {round(column_right)}")
    else:
        check("狭い画面・携帯はモーダル", page.get_by_role("dialog", name="エリア").is_visible())
    check("横にはみ出さない", not page_overflows(page))
    page.screenshot(path=f"{OUT}/area-figure-fab-{name}.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_picker(browser: Browser, name: str, viewport: dict) -> None:
    print(f"\n[{name}] 選び方（市区町村・比べる・外す・沿線・地図の範囲）")
    context, page, errors = open_page(browser, viewport)
    goto(page, "?fig=area&figAreas=pref:14")
    wait_heading(page, "神奈川県の要約")
    figure(page).get_by_role("button", name="神奈川県（押すとエリアを替える）").click()
    pick_admin(page, "神奈川県", "muni:14100", "このエリアにする")
    wait_heading(page, "神奈川県横浜市の要約")
    query = params(page)
    check("横浜市に替わる（図と地図の色分け）", query.get("figAreas") == ["muni:14100"] and query.get("colorIn") == ["muni:14100"], str(query))
    check("区の内訳が出る", figure(page).get_by_text("横浜市の区ごとの人口の増減").first.is_visible())
    figure(page).get_by_role("button", name="＋比べる").click()
    pick_admin(page, "神奈川県", "muni:14130", "比べる")
    wait_heading(page, "横浜市・川崎市の比較")
    query = params(page)
    check("比べる（2 つのエリア・1 つの色分け）", query.get("figAreas") == ["muni:14100", "muni:14130"] and query.get("colorIn") == ["muni:14100", "muni:14130"], str(query))
    dots = figure(page).locator('[role="group"][aria-label="エリア"] span.rounded-full')
    colors = [dots.nth(index).evaluate("(el) => getComputedStyle(el).backgroundColor") for index in range(dots.count())]
    expected = [f"rgb({r}, {g}, {b})" for r, g, b in (rgb(color) for color in AREA_SERIES_COLORS[:2])]
    check("札の色は推移の図の系列の色", colors == expected, str(colors))
    check("比べるときは内訳を出さない", figure(page).get_by_text("横浜市の区ごとの人口の増減").count() == 0)
    page.screenshot(path=f"{OUT}/area-figure-compare-{name}.png")
    figure(page).get_by_role("button", name="神奈川県川崎市を外す").click()
    wait_heading(page, "神奈川県横浜市の要約")
    check("外すと 1 つに戻る", params(page).get("figAreas") == ["muni:14100"], str(params(page)))
    figure(page).get_by_role("button", name="神奈川県横浜市（押すとエリアを替える）").click()
    section = picker(page)
    section.get_by_role("button", name="沿線", exact=True).click()
    section.get_by_label("路線を検索").fill("東急東横線")
    section.get_by_role("radio", name=re.compile("東急東横線")).first.click()
    section.get_by_role("button", name="駅から 2km").click()
    section.get_by_role("button", name="このエリアにする", exact=True).click()
    wait_heading(page, "東急東横線の沿線（駅から 2km）の要約")
    check("沿線と幅", params(page).get("figAreas") == ["line:26001@2000"], str(params(page)))
    figure(page).get_by_role("button", name="東急東横線の沿線（駅から 2km）（押すとエリアを替える）").click()
    section = picker(page)
    section.get_by_role("button", name="地図の表示範囲", exact=True).click()
    section.get_by_role("button", name="このエリアにする", exact=True).click()
    wait_heading(page, "地図の範囲の要約")
    areas = params(page).get("figAreas", [])
    check("いまの地図の範囲", len(areas) == 1 and areas[0].startswith("bbox:"), str(areas))
    check("横にはみ出さない", not page_overflows(page))
    page.screenshot(path=f"{OUT}/area-figure-picker-{name}.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_color(browser: Browser, name: str, viewport: dict) -> None:
    print(f"\n[{name}] 色分けの指標と半径")
    context, page, errors = open_page(browser, viewport)
    goto(page, "?fig=area&figAreas=muni:14100")
    wait_heading(page, "神奈川県横浜市の要約")
    check("既定の色分け（URL の figColor は書かない）", params(page).get("color") == [DEFAULT_COLOR] and "figColor" not in params(page), str(params(page)))
    figure(page).get_by_label("色分けのカテゴリ").select_option(value="land_price")
    wait_url(page, "(q.get('figColor') ?? '').startsWith('lp_') && q.get('color') === q.get('figColor')")
    query = params(page)
    check("地価にすると図と地図の色分けが替わる", query.get("color") == query.get("figColor"), str(query))
    figure(page).get_by_role("button", name="駅の周り 2km").click()
    wait_url(page, "q.get('figR') === '2000'")
    page.wait_for_timeout(SETTLE_MS)
    check("駅の周りを 2km に", figure(page).get_by_text(re.compile("駅の周り（2km圏")).first.is_visible())
    figure(page).get_by_label("色分けのカテゴリ").select_option(value="none")
    wait_url(page, "q.get('figColor') === 'none' && !q.has('color')")
    page.wait_for_timeout(SETTLE_MS)
    check("色分けしないと地図の色分けが消える", legend(page).count() == 0, str(params(page)))
    check("図の凡例も出さない", figure(page).get_by_text("地図の色分け：").count() == 0)
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_history(browser: Browser, name: str, viewport: dict) -> None:
    print(f"\n[{name}] 閉じる・戻る・進む")
    context, page, errors = open_page(browser, viewport)
    goto(page)
    open_area_fab(page)
    figure(page).get_by_role("heading", name=re.compile("の要約$")).first.wait_for(state="visible", timeout=WAIT_MS)
    wait_url(page, "q.has('color') && q.has('figAreas')")
    opened = params(page)
    close_figure(page)
    closed = params(page)
    check("閉じると図は消え、地図の色分けは残る", "fig" not in closed and closed.get("color") == opened.get("color"), str(closed))
    page.go_back(wait_until="commit")
    page.wait_for_timeout(SETTLE_MS)
    check("戻ると同じ条件の図", figure(page).is_visible() and params(page).get("figAreas") == opened.get("figAreas"), str(params(page)))
    page.go_back(wait_until="commit")
    page.wait_for_timeout(SETTLE_MS)
    check("もう一度戻ると開く前（色分けも無い）", "fig" not in params(page) and "color" not in params(page), str(params(page)))
    page.go_forward(wait_until="commit")
    page.wait_for_timeout(SETTLE_MS)
    check("進むと図と色分けが戻る", figure(page).is_visible() and params(page).get("color") == opened.get("color"), str(params(page)))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_links(browser: Browser, name: str, viewport: dict) -> None:
    print(f"\n[{name}] 深いリンク・壊れたリンク")
    context, page, errors = open_page(browser, viewport)
    goto(page, "?fig=area&figAreas=muni:14100&figAreas=muni:14130&figR=500")
    wait_heading(page, "横浜市・川崎市の比較")
    before = page.url
    page.wait_for_timeout(SETTLE_MS * 2)
    check("比べるリンクはそのまま開き、URL を書き換え続けない", page.url == before and params(page).get("figR") == ["500"], page.url)
    goto(page, "?fig=area&figAreas=muni:99999")
    figure(page).get_by_text(re.compile("知らないエリアです: muni:99999")).first.wait_for(state="visible", timeout=WAIT_MS)
    check("壊れたリンクは API の理由を出す", True)
    check("札はエリアの文字列（読み込み中と出し続けない）", figure(page).get_by_role("button", name="muni:99999（押すとエリアを替える）").is_visible())
    figure(page).get_by_role("button", name="muni:99999（押すとエリアを替える）").click()
    pick_admin(page, "神奈川県", "muni:14100", "このエリアにする")
    wait_heading(page, "神奈川県横浜市の要約")
    check("選び直せる（行き止まりにしない）", params(page).get("figAreas") == ["muni:14100"])
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_station(browser: Browser, name: str, viewport: dict) -> None:
    print(f"\n[{name}] 選択中の駅の市区町村・凡例の置き場所")
    context, page, errors = open_page(browser, viewport)
    goto(page, "?grp=" + urllib.parse.quote(SHIN_YOKOHAMA))
    open_area_fab(page)
    wait_heading(page, "神奈川県横浜市港北区の要約")
    check("選択中の駅の市区町村（政令市は区）", params(page).get("figAreas") == ["muni:14109"], str(params(page)))
    check("手がかりを添える", figure(page).get_by_text("選択中の駅（新横浜）の市区町村を開きました").first.is_visible())
    if is_wide(page):
        check("駅詳細も開いた 1440px では地図の凡例を出さない（列の下に隠さない）", legend(page).count() == 0)
        page.locator("aside").filter(has_text="最新乗降客数").get_by_role("button", name="閉じる", exact=True).click()
        page.wait_for_timeout(SETTLE_MS)
        check("駅詳細を閉じると地図の凡例が出る", legend(page).is_visible(), str(params(page)))
    page.screenshot(path=f"{OUT}/area-figure-station-{name}.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_chat(browser: Browser, name: str, viewport: dict, response: dict) -> None:
    print(f"\n[{name}] チャットの回答 → 拡大")
    plan = chat_answer(response, "横浜市の人口は 2020→2025 年で減りました。")
    context, page, errors = open_page(browser, viewport, plan)
    goto(page)
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill("横浜市全体の人口は増えている？")
    page.locator('button[aria-label="送信"]').click()
    expand = page.get_by_role("button", name="神奈川県横浜市の要約 を拡大")
    expand.wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)
    check("会話の中に「拡大」付きで出る", expand.is_visible())
    # 携帯のチャットはシート（これも dialog）なので、図のモーダルは名前で見分ける。
    check("図は自動で開かない（地図の色分けを覆わない）", page.locator('aside[aria-label="キャンバス"]').count() == 0 and page.get_by_role("dialog", name="エリア").count() == 0)
    check("回答の色分けが地図に出る", params(page).get("colorIn") == ["muni:14100"], str(params(page)))
    expand.click()
    wait_heading(page, "神奈川県横浜市の要約")
    query = params(page)
    check("同じ条件の図が開く（既定は書かない）", query.get("fig") == ["area"] and query.get("figAreas") == ["muni:14100"] and "figColor" not in query and "figR" not in query, str(query))
    check("地図の色分けはそのまま", query.get("color") == [DEFAULT_COLOR] and query.get("colorIn") == ["muni:14100"], str(query))
    if is_wide(page):
        # 回答の色分けは列の無い地図で寄せてある。列を開いたら、列を避けて寄せ直す（エリアが同じでも）。
        column = box(figure(page))
        column_right = 0 if column is None else column["x"] + column["width"]
        xs = colored_xs(page)
        check("拡大して列を開くと、色分けした駅が列の裏に入らないよう寄せ直す", bool(xs) and min(xs) >= column_right, f"左端 {min(xs) if xs else None} / 列の右端 {round(column_right)}")
    check("横にはみ出さない", not page_overflows(page))
    page.screenshot(path=f"{OUT}/area-figure-chat-{name}.png")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    YOKOHAMA = fetch_summary("muni:14100")
    for name, viewport in VIEWPORTS:
        scenario_fab_default(browser, name, viewport)
        scenario_picker(browser, name, viewport)
        scenario_color(browser, name, viewport)
        scenario_history(browser, name, viewport)
        scenario_links(browser, name, viewport)
        if name != "phone":
            scenario_station(browser, name, viewport)
        scenario_chat(browser, name, viewport, YOKOHAMA)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
