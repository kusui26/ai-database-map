#!/usr/bin/env python3
"""駅の色分け（`colorStations`・`?color&colorIn`）を実ブラウザで確かめる（2026-10-11 B5c・
`docs/261001_fix_user_feedback_ui.md` §6.12.6）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright pillow && playwright install chromium
    python3 tests/ui.station-coloring.smoke.py [出力ディレクトリ] [BASE]

地図は WebGL なので、画面の写真（凡例を隠したもの）から**段の色の画素**を数える。さらにその画素の上にマウスを置き、
ホバーに出る段の名前が、その色の凡例の段と同じかを見る（色と凡例が食い違わない）。

## 見ること（広い画面・狭い画面・携帯の 3 つの幅）

1. 横浜市 × 人口の増減（URL を開く）：凡例（題・「神奈川県横浜市の 137 駅」・段と駅の数が共通 API と同じ・注意・出典）。
   携帯は畳んで始まり、押すと開く。段の 5 色が地図に出る。✕ で消すと色が消え（同じカメラで比べる・URL からも外れる）、
   戻るで戻る（同じ範囲へ寄り直し、画素の数が消す前とそろう）
2. ホバー（マウスのある幅）：段の色の駅に乗せると「駅名」と「値・段」。段は色の凡例と同じ。駅を押すと選べ、凡例は駅詳細の左へ退く。
   **駅を選んで閉じたあとでも**、色分けを消して戻せば横浜市の範囲へ寄り直す（MapLibre は flyTo の余白を地図に残し、
   fitBounds はそれに渡した余白を足すので、以前は「収まらない」と判断して寄らなかった・`components/map/camera.ts`）
3. 東急東横線 × 人口（水準）：淡い→濃いの色・「東急東横線の沿線の 21 駅」
4. 浸水の面（`hz`）と重ねても、段の色はそのまま（印は面の上）
5. 竹橋から 500m（値のある駅が 5 未満）：色分けしない理由と、強調の色で出す
6. 知らない指標：凡例が理由を出す（✕ で消せる）
7. チャット（`/api/chat` を差し替え）：回答の `colorStations` が URL に入り（1 回の回答で履歴 1 つ）、`clearOverlays` で消える。
   ランキングのハイライトも、駅を選んで閉じたあとで上位の駅へ寄る（同じ不具合の再発を見る）
8. どの幅でも横にはみ出さない・凡例が FAB・出典と重ならない・ページの JS エラーと「収まらない」の警告が無い
"""

import io
import json
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
DSF = 2
WAIT_MS = 30_000
#: 寄せる動き（0.8 秒）とタイルの読み込みを待つ。
SETTLE_MS = 3_500
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}

POP_GR = "pop_gr_2020_2015_1km"
POP = "pop_2020_1km"
YOKOHAMA = "muni:14100"
KAWASAKI = "muni:14130"
TOYOKO = "line:26001"
TAKEBASHI_500M = "near:竹橋#0@500"
#: サーバと同じ定数（`src/shared/constants.ts` の ACCENT_COLOR・`src/components/coloring/ColoringHost.tsx`）。
ACCENT_COLOR = "#4f46e5"
PANEL_WIDTH_PX = 420
PANEL_GAP_PX = 12
#: 色の画素とみなす差（各チャンネル）。印の内側は塗りの色そのもの（縁と地図の境目だけが混ざる）。
COLOR_TOLERANCE = 6
#: 1 色に要る画素の数（2 倍の解像度で、印 1 つの内側だけでも 100 を超える）。
MIN_COLOR_PIXELS = 60
#: 「ほぼ横ばい」の灰色（#d4d4d4）は、淡色の地図の建物・道路にも同じ色がある。消えたかは「減ったか」で見る。
NEUTRAL_GREY = "#d4d4d4"
#: 同じ範囲へ寄り直したときの画素の数の揺れ（タイルの読み込みの差）。
SAME_VIEW_TOLERANCE = 0.1
#: MapLibre が範囲へ寄せられなかったときの警告（余白が画面より大きい）。
CANNOT_FIT = "Map cannot fit within canvas"

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def fetch_classes(metric: str, *areas: str) -> dict:
    query = urllib.parse.urlencode([("metric", metric), *[("area", area) for area in areas]])
    with urllib.request.urlopen(f"{BASE}/api/stations/classes?{query}", timeout=60) as response:
        return json.load(response)


def coloring_url(metric: str, *areas: str, extra: str = "") -> str:
    query = urllib.parse.urlencode([("color", metric), *[("colorIn", area) for area in areas]])
    return f"{BASE}/?{query}{extra}"


# --- 画面 ---------------------------------------------------------------------------------


def open_page(browser: Browser, viewport: dict) -> tuple[BrowserContext, Page, list[str]]:
    phone = viewport["width"] < 640
    context = browser.new_context(viewport=viewport, is_mobile=phone, has_touch=phone, device_scale_factor=DSF)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    # 範囲へ寄せられなかった（余白が画面より大きい）ことも、黙って起きる失敗として数える。
    page.on("console", lambda message: errors.append(message.text) if CANNOT_FIT in message.text else None)
    return context, page, errors


def legend_of(page: Page) -> Locator:
    return page.locator('section[aria-label="色分けの凡例"]')


def goto_colored(page: Page, url: str) -> None:
    """色分けの URL を開き、色分けの応答と地図の寄せが落ち着くまで待つ。"""
    with page.expect_response(lambda response: "/api/stations/classes" in response.url, timeout=WAIT_MS):
        page.goto(url, wait_until="domcontentloaded")
    page.locator("canvas.maplibregl-canvas").wait_for(state="visible", timeout=WAIT_MS)
    legend_of(page).wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)


def open_legend(page: Page) -> None:
    """畳まれていれば開く（携帯は畳んで始まる）。"""
    toggle = legend_of(page).locator("button[aria-expanded]")
    if toggle.get_attribute("aria-expanded") == "false":
        toggle.click()


def query_of(page: Page) -> dict[str, list[str]]:
    return urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)


def wait_uncolored_url(page: Page) -> None:
    """URL から色分けが外れるのを待つ（画面は先に変わり、URL の書き換えは少し遅れて来る）。"""
    page.wait_for_function("() => !new URLSearchParams(location.search).has('color')", timeout=5_000)


def page_overflows(page: Page) -> bool:
    return page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")


def box_of(locator: Locator) -> dict | None:
    return locator.bounding_box() if locator.count() > 0 and locator.first.is_visible() else None


def overlaps(a: dict | None, b: dict | None) -> bool:
    if a is None or b is None:
        return False
    return not (
        a["x"] + a["width"] <= b["x"]
        or b["x"] + b["width"] <= a["x"]
        or a["y"] + a["height"] <= b["y"]
        or b["y"] + b["height"] <= a["y"]
    )


# --- 地図の画素 -----------------------------------------------------------------------------


def rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[index : index + 2], 16) for index in (1, 3, 5))


def map_image(page: Page) -> Image.Image:
    """凡例を隠した画面の写真（凡例の色見本を数えない）。"""
    legend_of(page).evaluate("(el) => { el.style.visibility = 'hidden' }")
    try:
        return Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    finally:
        legend_of(page).evaluate("(el) => { el.style.visibility = '' }")


def near(pixel: tuple[int, int, int], target: tuple[int, int, int]) -> bool:
    return all(abs(channel - goal) <= COLOR_TOLERANCE for channel, goal in zip(pixel, target, strict=True))


def color_census(image: Image.Image, colors: list[str]) -> dict[str, dict]:
    """色ごとの画素の数と、印の内側の 1 点（上下左右 2 画素も同じ色＝縁ではない・CSS の座標）。"""
    width, height = image.size
    pixels = image.load()
    targets = {color: rgb(color) for color in colors}
    census = {color: {"count": 0, "center": None} for color in colors}
    for y in range(2, height - 2):
        for x in range(2, width - 2):
            pixel = pixels[x, y]
            for color, target in targets.items():
                if not near(pixel, target):
                    continue
                entry = census[color]
                entry["count"] += 1
                if entry["center"] is None and all(
                    near(pixels[x + dx, y + dy], target) for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2))
                ):
                    entry["center"] = (x / DSF, y / DSF)
    return census


def hover_detail(page: Page, point: tuple[float, float]) -> tuple[str, str]:
    """その点にマウスを置いたときのホバー（駅名・2 行目）。"""
    page.mouse.move(point[0], point[1])
    tooltip = page.locator("div.pointer-events-none.absolute.z-10").filter(has=page.locator("span.tabular-nums"))
    try:
        tooltip.first.wait_for(state="visible", timeout=4_000)
    except Exception:  # noqa: BLE001 — 出なければ空で返し、検査で落とす
        return "", ""
    detail = tooltip.first.locator("span.tabular-nums").inner_text()
    whole = tooltip.first.inner_text()
    return whole.replace(detail, "").strip(), detail.strip()


# --- 場面 -----------------------------------------------------------------------------------


def legend_rows(legend: Locator) -> list[str]:
    return [text.replace("\n", " ") for text in legend.locator('ul[aria-label="色の段"] li').all_inner_texts()]


def counts_of(census: dict[str, dict]) -> dict[str, int]:
    return {color: entry["count"] for color, entry in census.items()}


def same_view(before: dict[str, int], after: dict[str, int]) -> bool:
    """同じ範囲を描いたか（色ごとの画素の数が揺れの内でそろう）。"""
    return all(abs(after[color] - count) <= max(count * SAME_VIEW_TOLERANCE, 30) for color, count in before.items())


def clear_and_compare(
    page: Page, colors: list[str], before: dict[str, int], label: str, *, grey_visible: bool
) -> None:
    """✕ で消す（カメラは動かない）→ 同じ範囲で、消す前に見えていた段の色が消えたか。

    灰色（ほぼ横ばい）は地図の建物・道路にも同じ色があるので「減ったか」で見る。灰色の駅が画面にあると分かっているとき
    （横浜市の全体を見ているとき）だけ見る。
    """
    legend_of(page).get_by_role("button", name="色分けを消す").click()
    legend_of(page).wait_for(state="detached", timeout=WAIT_MS)
    wait_uncolored_url(page)
    page.wait_for_timeout(800)
    check(f"{label}：✕ で URL から外れる", "color" not in query_of(page) and "colorIn" not in query_of(page), page.url)
    after = counts_of(color_census(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), colors))
    shown = [color for color in colors if color != NEUTRAL_GREY and before[color] >= MIN_COLOR_PIXELS]
    grey_gone = not grey_visible or after[NEUTRAL_GREY] < before[NEUTRAL_GREY] - MIN_COLOR_PIXELS
    check(
        f"{label}：✕ で地図の色が消える（見えていた色は 1 割未満・灰色は減る）",
        shown != [] and all(after[color] < before[color] * 0.1 for color in shown) and grey_gone,
        f"{before} → {after}",
    )


def restore_and_compare(page: Page, colors: list[str], expected: dict[str, int], label: str) -> None:
    """戻る → 色分けが戻り、横浜市の範囲へ寄り直す（画素の数が最初とそろう）。"""
    page.go_back()
    legend_of(page).wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)
    query = query_of(page)
    check(f"{label}：戻るで色分けが戻る", query.get("color") == [POP_GR] and query.get("colorIn") == [YOKOHAMA], page.url)
    back = counts_of(color_census(map_image(page), colors))
    check(f"{label}：横浜市の範囲へ寄り直し、色も戻る（画素の数が最初とそろう）", same_view(expected, back), f"{expected} → {back}")


def check_yokohama(browser: Browser, name: str, viewport: dict) -> None:
    print(f"[{name}] 1. 横浜市 × 人口の増減（URL を開く）")
    expected = fetch_classes(POP_GR, YOKOHAMA)
    classes = expected["legend"]["classes"]
    context, page, errors = open_page(browser, viewport)
    goto_colored(page, coloring_url(POP_GR, YOKOHAMA))
    legend = legend_of(page)
    phone = viewport["width"] < 640
    toggle = legend.locator("button[aria-expanded]")
    check("携帯は畳んで始まり、広い画面は開いて始まる", toggle.get_attribute("aria-expanded") == ("false" if phone else "true"))
    open_legend(page)
    check("題は指標の名前", "人口増減率（2015→2020年・1km圏）" in legend.inner_text(), legend.inner_text()[:60])
    check("どこの何駅か", "神奈川県横浜市の 137 駅" in legend.inner_text())
    rows = legend_rows(legend)
    wanted = [f"{cls['labelJa']} {cls['count']} 駅" for cls in classes]
    check("段と駅の数は共通 API と同じ（5 段）", rows == wanted, f"{rows}")
    check("注意：エリア全体の値ではない", "エリア全体の値ではない" in legend.inner_text())
    check("色の意味（赤は増加…）と出典", "赤は増加" in legend.inner_text() and "出典: 総務省" in legend.inner_text())
    check("横にはみ出さない", not page_overflows(page))
    legend_box = box_of(legend)
    check(
        "凡例が画面に収まる",
        legend_box is not None
        and legend_box["x"] >= 0
        and legend_box["x"] + legend_box["width"] <= viewport["width"] + 0.5
        and legend_box["y"] + legend_box["height"] <= viewport["height"] + 0.5,
        f"{legend_box}",
    )
    fab = page.locator('button[aria-label="ランキング"]')
    attribution = page.locator(".maplibregl-ctrl-attrib")
    check("凡例が FAB・出典と重ならない", not overlaps(legend_box, box_of(fab)) and not overlaps(legend_box, box_of(attribution)))
    page.screenshot(path=f"{OUT}/coloring-yokohama-{name}.png")

    colors = [cls["color"] for cls in classes]
    census = color_census(map_image(page), colors)
    initial = counts_of(census)
    check("段の 5 色が地図に出る", all(count >= MIN_COLOR_PIXELS for count in initial.values()), f"{initial}")
    clear_and_compare(page, colors, initial, "そのまま", grey_visible=True)
    restore_and_compare(page, colors, initial, "そのまま")

    if not phone:
        print(f"[{name}] 2. ホバーと選択・選んで閉じたあとの寄り直し")
        census = color_census(map_image(page), colors)
        for cls in classes:
            center = census[cls["color"]]["center"]
            station, detail = ("", "") if center is None else hover_detail(page, center)
            check(
                f"{cls['color']} の駅のホバーは段「{cls['labelJa']}」",
                station != "" and detail.endswith(f"・{cls['labelJa']}"),
                f"{station}｜{detail}",
            )
        target = census[classes[-1]["color"]]["center"]
        if target is not None:
            page.mouse.click(target[0], target[1])
            page.wait_for_timeout(1_500)
            grp = query_of(page).get("grp", [""])[0]
            check("色の付いた駅を押すと選べる", grp != "", page.url)
            moved = box_of(legend_of(page))
            limit = viewport["width"] - (PANEL_WIDTH_PX + PANEL_GAP_PX * 2) + 1
            check(
                "駅詳細が開くと、凡例はその左へ退く",
                moved is not None and moved["x"] + moved["width"] <= limit,
                f"{moved} ≤ {limit}",
            )
            page.go_back()
            page.wait_for_timeout(1_000)
            zoomed = counts_of(color_census(map_image(page), colors))
            clear_and_compare(page, colors, zoomed, "選んで閉じたあと", grey_visible=False)
            restore_and_compare(page, colors, initial, "選んで閉じたあと")
    check("ページの JS エラーと「収まらない」の警告なし", errors == [], f"{errors}")
    context.close()


def check_toyoko(browser: Browser, name: str, viewport: dict) -> None:
    print(f"[{name}] 3. 東急東横線 × 人口（水準）・4. 浸水の面と重ねる")
    expected = fetch_classes(POP, TOYOKO)
    classes = expected["legend"]["classes"]
    context, page, errors = open_page(browser, viewport)
    goto_colored(page, coloring_url(POP, TOYOKO))
    open_legend(page)
    legend = legend_of(page)
    check("どこの何駅か（沿線は幅を書かない）", "東急東横線の沿線の 21 駅" in legend.inner_text())
    check("色の意味は「濃いほど大きい」", "色が濃いほど値が大きい" in legend.inner_text())
    colors = [cls["color"] for cls in classes]
    plain = color_census(map_image(page), colors)
    check(
        "水準の色が地図に出る",
        all(plain[color]["count"] >= MIN_COLOR_PIXELS for color in colors),
        f"{ {color: plain[color]['count'] for color in colors} }",
    )
    goto_colored(page, coloring_url(POP, TOYOKO, extra="&hz=flood_l2"))
    page.wait_for_timeout(3_000)
    flooded = color_census(map_image(page), colors)
    check(
        "浸水の面と重ねても段の色はそのまま（印は面の上）",
        all(flooded[color]["count"] >= MIN_COLOR_PIXELS for color in colors),
        f"{ {color: flooded[color]['count'] for color in colors} }",
    )
    page.screenshot(path=f"{OUT}/coloring-toyoko-flood-{name}.png")
    check("ページの JS エラーと「収まらない」の警告なし", errors == [], f"{errors}")
    context.close()


def check_reason_and_error(browser: Browser, name: str, viewport: dict) -> None:
    print(f"[{name}] 5. 色分けしない（駅が少ない）・6. 知らない指標")
    expected = fetch_classes(POP_GR, TAKEBASHI_500M)
    reason = expected["legend"]["reasonJa"]
    context, page, errors = open_page(browser, viewport)
    goto_colored(page, coloring_url(POP_GR, TAKEBASHI_500M))
    open_legend(page)
    legend = legend_of(page)
    check("理由を出す", reason is not None and reason in legend.inner_text(), f"{reason}")
    check("段は出さない", legend.locator('ul[aria-label="色の段"]').count() == 0)
    check("強調して出していると言う", "強調して出している" in legend.inner_text())
    accent = color_census(map_image(page), [ACCENT_COLOR])[ACCENT_COLOR]["count"]
    check("駅は強調の色で出る", accent >= MIN_COLOR_PIXELS, f"{accent}")
    page.screenshot(path=f"{OUT}/coloring-reason-{name}.png")

    with page.expect_response(lambda response: "/api/stations/classes" in response.url, timeout=WAIT_MS):
        page.goto(coloring_url("nope", YOKOHAMA), wait_until="domcontentloaded")
    legend_of(page).wait_for(state="visible", timeout=WAIT_MS)
    open_legend(page)
    page.wait_for_timeout(500)
    text = legend_of(page).inner_text()
    check("知らない指標は理由を出す", "色分けできませんでした" in text and "色分けできない指標です: nope" in text, text[:80])
    legend_of(page).get_by_role("button", name="色分けを消す").click()
    legend_of(page).wait_for(state="detached", timeout=WAIT_MS)
    wait_uncolored_url(page)
    check("✕ で消せる", "color" not in query_of(page))
    check("ページの JS エラーと「収まらない」の警告なし", errors == [], f"{errors}")
    context.close()


def chat_answer(actions: list[dict], text: str) -> str:
    """地図の操作だけを持つ回答（図は無し）。"""
    chunks = [
        {"type": "start", "messageId": "smoke-coloring"},
        {"type": "start-step"},
        {"type": "data-promotions", "id": "promotions", "data": []},
        {"type": "data-map", "id": "map", "data": {"messages": [], "mapActions": actions, "panels": []}},
        {"type": "finish-step"},
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"


def send(page: Page, actions: list[dict], question: str, reply: str) -> None:
    body = chat_answer(actions, reply)
    page.unroute("**/api/chat")
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=body))
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()
    page.get_by_text(reply, exact=True).first.wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(1_500)


def check_chat(browser: Browser, name: str, viewport: dict) -> None:
    print(f"[{name}] 7. チャットの回答の色分け（履歴 1 つ・clearOverlays で消える）")
    context, page, errors = open_page(browser, viewport)
    page.goto(BASE, wait_until="networkidle")
    page.locator("canvas.maplibregl-canvas").wait_for(state="visible", timeout=WAIT_MS)
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    before = page.evaluate("() => history.length")
    coloring = {"type": "colorStations", "metricKey": POP_GR, "areas": [KAWASAKI]}
    send(page, [coloring], "川崎市の駅を人口の増減で色分けして", "川崎市の駅を、人口の増減で色分けしました。")
    legend_of(page).wait_for(state="visible", timeout=WAIT_MS)
    query = query_of(page)
    check("回答の色分けが URL に入る", query.get("color") == [POP_GR] and query.get("colorIn") == [KAWASAKI], page.url)
    check("1 回の回答で履歴は 1 つ", page.evaluate("() => history.length") == before + 1)
    legend_of(page).locator("text=神奈川県川崎市の 53 駅").wait_for(state="visible", timeout=WAIT_MS)
    check("凡例は川崎市の 53 駅", True)
    send(page, [{"type": "clearOverlays"}], "地図をリセットして", "地図の表示をリセットしました。")
    legend_of(page).wait_for(state="detached", timeout=WAIT_MS)
    wait_uncolored_url(page)
    check("clearOverlays で色分けも消える", "color" not in query_of(page), page.url)
    page.go_back()
    legend_of(page).wait_for(state="visible", timeout=WAIT_MS)
    check("戻るで、色分けした回答の地図に戻る", query_of(page).get("colorIn") == [KAWASAKI], page.url)
    check("ページの JS エラーと「収まらない」の警告なし", errors == [], f"{errors}")
    context.close()


#: 横浜から遠い駅（寄らなければ、横浜駅に寄った画面には枠が 1 つも出ない）。
CHIBA_GRPS = ["千葉#0", "西船橋#0", "船橋#0", "津田沼#0", "稲毛#0"]
#: ハイライトの枠（アクセントの色・不透明度 0.95 の線）を拾う差。
RING_TOLERANCE = 18


def ring_pixels(page: Page) -> int:
    """地図の上のハイライトの枠の画素（チャット欄・ヘッダ・FAB の帯を除く：送信ボタンや半径の札も同じ色）。"""
    chat = page.locator("aside").filter(has=page.locator('textarea[aria-label="チャット入力"]'))
    chat_box = box_of(chat)
    left = 0 if chat_box is None else chat_box["x"] + chat_box["width"]
    image = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    width, height = image.size
    pixels = image.load()
    target = rgb(ACCENT_COLOR)
    top, bottom = 100 * DSF, height - 90 * DSF
    return sum(
        1
        for y in range(top, bottom)
        for x in range(int(left * DSF), width)
        if all(abs(channel - goal) <= RING_TOLERANCE for channel, goal in zip(pixels[x, y], target, strict=True))
    )


def check_highlight_after_selection(browser: Browser, name: str, viewport: dict) -> None:
    print(f"[{name}] 7′. ランキングのハイライトも、駅を選んで閉じたあとで上位の駅へ寄る")
    context, page, errors = open_page(browser, viewport)
    page.goto(f"{BASE}/?grp=%E6%A8%AA%E6%B5%9C%230", wait_until="networkidle")
    page.locator("canvas.maplibregl-canvas").wait_for(state="visible", timeout=WAIT_MS)
    page.wait_for_timeout(SETTLE_MS)
    page.locator('aside button[aria-label="閉じる"]').first.click()
    page.wait_for_timeout(1_000)
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    before = ring_pixels(page)
    send(page, [{"type": "highlightStations", "grps": CHIBA_GRPS}], "千葉の駅を出して", "千葉の駅をハイライトしました。")
    page.wait_for_timeout(SETTLE_MS)
    after = ring_pixels(page)
    page.screenshot(path=f"{OUT}/highlight-after-selection-{name}.png")
    check("横浜駅に寄った画面には千葉の枠が無い（寄らなければ出ない）", before < MIN_COLOR_PIXELS, f"{before}")
    check("ハイライトした千葉の駅へ寄り、枠が出る", after >= MIN_COLOR_PIXELS * 5, f"{after}")
    check("ページの JS エラーと「収まらない」の警告なし", errors == [], f"{errors}")
    context.close()


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for name, viewport in VIEWPORTS:
            check_yokohama(browser, name, viewport)
            check_toyoko(browser, name, viewport)
            check_reason_and_error(browser, name, viewport)
            if viewport["width"] >= 640:
                check_chat(browser, name, viewport)
                check_highlight_after_selection(browser, name, viewport)
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
