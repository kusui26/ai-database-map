#!/usr/bin/env python3
"""場所の条件（市区町村・起点から N km・地図の範囲）を、実ブラウザで確かめる（2026-10-08 B2）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.area-filters.smoke.py [出力ディレクトリ] [BASE]

## 見ること

1. ランキング（広い画面＝キャンバス）：都道府県を 1 つ選ぶまで市区町村は選べない（選べないセレクタ・理由はホバー）。神奈川県を選ぶと
   市区町村のセレクタが都道府県の隣に出て、「横浜市（全区）」を選ぶと `/api/ranking?municipality=横浜市`・
   題「（神奈川県・横浜市・上位）」・URL の figMuni=横浜市。都道府県を替えると市区町村は外れる
2. チャットの図の ⤢ と同じ URL（figNear=竹橋#0&figWithin=5000）で開くと、`nearStation=竹橋#0&withinM=5000` で取りに行き、
   外せるチップ「竹橋から 5km」・題「（竹橋から 5km・上位）」・各行に起点からの距離（新宿三丁目 4.9km）。✕ で外れる
3. 散布：地図の範囲（figBbox）は `bbox=` で取りに行き、チップ「地図の表示範囲」・題に出る。✕ で外れる
4. 都道府県が 2 つのときの市区町村（チャットの条件）は、選択の部品が出ないのでチップで見せ、✕ で外せる
5. 選択肢に無い市区町村（手で書き換えた URL）は「（駅なし）」として選択に出る（「全域」と見せたまま絞らない）
6. 散布：市区町村を選ぶと `/api/growth?municipality=`・題に出る
7. おすすめ：同じ部品の市区町村で `/api/recommend?municipality=`・URL の recMuni
8. 狭いパソコン 1024px（モーダル）：市区町村を選ぶと題に出て、横にはみ出さない
9. 携帯 390px（モーダル）：起点・市区町村の条件つきの図で、チップとセレクタが画面に収まり、横にスクロールしない
"""

import json
import sys
from urllib.parse import parse_qs, quote, urlparse

from playwright.sync_api import Browser, Locator, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

WIDE = {"width": 1280, "height": 900}
NARROW = {"width": 1024, "height": 800}
PHONE = {"width": 390, "height": 844}
SETTLE_MS = 2000
TAKEBASHI = "竹橋#0"
BBOX = "139.5,35.4,139.8,35.8"

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def query_of(url: str) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}


class Session:
    """1 つの画面と、そこで出た API の呼び出し・エラー。"""

    def __init__(self, browser: Browser, viewport: dict[str, int]) -> None:
        self.context = browser.new_context(viewport=viewport)
        self.page = self.context.new_page()
        self.calls: list[str] = []
        self.errors: list[str] = []
        self.page.on("request", lambda request: self.calls.append(request.url) if "/api/" in request.url else None)
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def open(self, path: str = "") -> None:
        self.page.goto(f"{BASE}/{path}", wait_until="networkidle")
        self.page.wait_for_timeout(1200)

    def last(self, api: str) -> dict[str, str]:
        hits = [url for url in self.calls if f"/api/{api}?" in url]
        return query_of(hits[-1]) if hits else {}

    def params(self) -> dict[str, str]:
        return query_of(self.page.url)

    def close(self) -> None:
        check("画面のエラーが出ていない", not self.errors, json.dumps(self.errors, ensure_ascii=False)[:300])
        self.context.close()


def canvas(page: Page) -> Locator:
    return page.locator('aside[aria-label="キャンバス"]')


def open_picker(scope: Locator, button_label: str) -> Locator:
    button = scope.get_by_role("button", name=button_label, exact=True)
    if button.get_attribute("aria-expanded") != "true":
        button.click()
    popover = button.locator("xpath=following-sibling::div[1]")
    popover.wait_for(state="visible")
    return popover


def close_picker(scope: Locator, button_label: str) -> None:
    button = scope.get_by_role("button", name=button_label, exact=True)
    if button.get_attribute("aria-expanded") == "true":
        button.click()


def choose_prefectures(scope: Locator, check_names: list[str], uncheck_names: list[str] = []) -> None:
    popover = open_picker(scope, "都道府県")
    for name in uncheck_names:
        popover.locator("label", has_text=name).locator("input").uncheck()
    for name in check_names:
        popover.locator("label", has_text=name).locator("input").check()
    close_picker(scope, "都道府県")


def municipality_select(scope: Locator) -> Locator:
    return scope.locator('select[aria-label="市区町村"]')


def wait_options(scope: Locator, value: str) -> None:
    scope.locator(f'select[aria-label="市区町村"] option[value="{value}"]').wait_for(state="attached", timeout=20000)


def title_of(scope: Locator) -> str:
    heading = scope.locator("h3").first
    return heading.inner_text().strip() if heading.count() > 0 else ""


def chips(scope: Locator) -> list[str]:
    group = scope.get_by_role("group", name="場所で絞り込み中")
    if group.count() == 0:
        return []
    return [chip.inner_text().strip() for chip in group.locator("span > span").all()]


def fig_url(**params: str) -> str:
    return "?" + "&".join(f"{key}={quote(value, safe=',')}" for key, value in params.items())


def inside(box: dict[str, float] | None, width: int) -> bool:
    return box is not None and box["x"] >= 0 and box["x"] + box["width"] <= width + 0.5


def scenario_ranking_municipality(browser: Browser) -> None:
    print("[ランキング（広い画面）：市区町村のセレクタは都道府県の隣・選ぶと題と URL に出る・県を替えると外れる]")
    session = Session(browser, WIDE)
    page = session.page
    session.open()
    page.get_by_role("button", name="ランキング").click()
    scope = canvas(page)
    scope.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)

    waiting = municipality_select(scope)
    check("都道府県を選ぶまでは、市区町村は選べない（理由はホバー）", waiting.count() == 1 and waiting.is_disabled() and waiting.get_attribute("title") == "都道府県を 1 つ選ぶと市区町村を選べます", str(waiting.get_attribute("title")) if waiting.count() else "無い")

    choose_prefectures(scope, ["神奈川県"])
    wait_options(scope, "横浜市")
    select = municipality_select(scope)
    options = [option.inner_text() for option in select.locator("option").all()]
    check("選択肢は実データ（「横浜市（全区）・N 駅」）", any(text.startswith("横浜市（全区）・") for text in options), f"{len(options)} 件")
    prefecture_box = scope.get_by_role("button", name="都道府県", exact=True).bounding_box()
    operator_box = scope.get_by_role("button", name="運営会社", exact=True).bounding_box()
    select_box = select.bounding_box()
    order_ok = (
        prefecture_box is not None and operator_box is not None and select_box is not None
        and prefecture_box["x"] < select_box["x"] < operator_box["x"]
    )
    check("市区町村は都道府県と運営会社のあいだ", order_ok, json.dumps([prefecture_box, select_box, operator_box]))

    select.select_option("横浜市")
    page.wait_for_timeout(SETTLE_MS)
    ranking = session.last("ranking")
    check("municipality=横浜市・prefecture=神奈川県 で取りに行く", ranking.get("municipality") == "横浜市" and ranking.get("prefecture") == "神奈川県", json.dumps(ranking, ensure_ascii=False))
    check("題は「（神奈川県・横浜市・上位）」", "（神奈川県・横浜市・上位）" in title_of(scope), title_of(scope))
    check("URL に figMuni=横浜市", session.params().get("figMuni") == "横浜市", json.dumps(session.params(), ensure_ascii=False))
    page.screenshot(path=f"{OUT}/area-ranking-municipality.png")

    choose_prefectures(scope, ["東京都"], uncheck_names=["神奈川県"])
    page.wait_for_timeout(SETTLE_MS)
    ranking = session.last("ranking")
    check("都道府県を替えると市区町村は外れる（取りに行かない）", "municipality" not in ranking and ranking.get("prefecture") == "東京都", json.dumps(ranking, ensure_ascii=False))
    check("URL からも figMuni が消える", "figMuni" not in session.params(), json.dumps(session.params(), ensure_ascii=False))
    wait_options(scope, "千代田区")
    check("セレクタは「東京都（全域）」に戻る", municipality_select(scope).input_value() == "")
    session.close()


def scenario_ranking_near(browser: Browser) -> None:
    print("[ランキング：チャットの図の ⤢ と同じ URL（起点から 5km）→ チップ・題・距離。✕ で外れる]")
    session = Session(browser, WIDE)
    page = session.page
    session.open(fig_url(fig="ranking", figM="lp_near_price", figNear=TAKEBASHI, figWithin="5000"))
    scope = canvas(page)
    scope.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    ranking = session.last("ranking")
    check("nearStation=竹橋#0・withinM=5000 で取りに行く", ranking.get("nearStation") == TAKEBASHI and ranking.get("withinM") == "5000", json.dumps(ranking, ensure_ascii=False))
    check("チップ「竹橋から 5km」", chips(scope) == ["竹橋から 5km"], json.dumps(chips(scope), ensure_ascii=False))
    check("題は「（竹橋から 5km・上位）」（「全国」と言わない）", "（竹橋から 5km・上位）" in title_of(scope), title_of(scope))
    first_row = scope.locator("li button, ol button").first
    row_text = first_row.inner_text() if first_row.count() > 0 else ""
    check("1 位は新宿三丁目で、起点からの距離「4.9km」が出る", "新宿三丁目" in row_text and "4.9km" in row_text, row_text.replace("\n", " "))
    page.screenshot(path=f"{OUT}/area-ranking-near.png")

    scope.get_by_role("button", name="竹橋から 5kmの絞り込みを外す").click()
    page.wait_for_timeout(SETTLE_MS)
    check("✕ で URL から figNear・figWithin が消える", "figNear" not in session.params() and "figWithin" not in session.params(), json.dumps(session.params(), ensure_ascii=False))
    check("✕ で起点なしで取りに行く", "nearStation" not in session.last("ranking"), json.dumps(session.last("ranking"), ensure_ascii=False))
    check("題は「（全国・上位）」に戻る", "（全国・上位）" in title_of(scope), title_of(scope))
    check("チップは消える", chips(scope) == [], json.dumps(chips(scope), ensure_ascii=False))
    session.close()


def scenario_scatter_bbox(browser: Browser) -> None:
    print("[散布：地図の範囲（figBbox）→ bbox= で取りに行き、チップと題。✕ で外れる]")
    session = Session(browser, WIDE)
    page = session.page
    session.open(fig_url(fig="scatter", figX="pop_gr_2020_2015_1km", figY="rate_covid", figBbox=BBOX))
    scope = canvas(page)
    scope.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    growth = session.last("growth")
    check("bbox=139.5,35.4,139.8,35.8 で取りに行く", growth.get("bbox") == BBOX, json.dumps(growth, ensure_ascii=False))
    check("チップ「地図の表示範囲」", chips(scope) == ["地図の表示範囲"], json.dumps(chips(scope), ensure_ascii=False))
    check("題に「（地図の表示範囲）」", "（地図の表示範囲）" in title_of(scope), title_of(scope))
    page.screenshot(path=f"{OUT}/area-scatter-bbox.png")
    scope.get_by_role("button", name="地図の表示範囲の絞り込みを外す").click()
    page.wait_for_timeout(SETTLE_MS)
    check("✕ で URL から figBbox が消える", "figBbox" not in session.params(), json.dumps(session.params(), ensure_ascii=False))
    check("題は「（全国）」に戻る", "（全国）" in title_of(scope), title_of(scope))
    session.close()


def scenario_municipality_chip(browser: Browser) -> None:
    print("[都道府県が 2 つのときの市区町村はチップで見せる・✕ で外せる]")
    session = Session(browser, WIDE)
    page = session.page
    session.open(fig_url(fig="ranking", figM="lp_near_price", figPref="東京都,神奈川県", figMuni="横浜市"))
    scope = canvas(page)
    scope.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    ranking = session.last("ranking")
    check("municipality=横浜市 で取りに行く", ranking.get("municipality") == "横浜市", json.dumps(ranking, ensure_ascii=False))
    check("選択の部品は出ず、チップ「横浜市」", municipality_select(scope).count() == 0 and chips(scope) == ["横浜市"], json.dumps(chips(scope), ensure_ascii=False))
    check("題は「（東京都・神奈川県・横浜市・上位）」", "（東京都・神奈川県・横浜市・上位）" in title_of(scope), title_of(scope))
    scope.get_by_role("button", name="横浜市の絞り込みを外す").click()
    page.wait_for_timeout(SETTLE_MS)
    check("✕ で市区町村が外れる", "municipality" not in session.last("ranking") and "figMuni" not in session.params(), json.dumps(session.params(), ensure_ascii=False))
    session.close()


def scenario_unknown_municipality(browser: Browser) -> None:
    print("[選択肢に無い市区町村（手で書き換えた URL）は「（駅なし）」として見せる]")
    session = Session(browser, WIDE)
    page = session.page
    session.open(fig_url(fig="ranking", figM="lp_near_price", figPref="神奈川県", figMuni="ほげ市"))
    scope = canvas(page)
    scope.wait_for(state="visible")
    wait_options(scope, "横浜市")
    page.wait_for_timeout(SETTLE_MS)
    select = municipality_select(scope)
    selected = select.locator("option:checked").inner_text() if select.count() > 0 else ""
    check("選択は「ほげ市（駅なし）」", select.input_value() == "ほげ市" and selected == "ほげ市（駅なし）", selected)
    page.screenshot(path=f"{OUT}/area-ranking-unknown.png")
    session.close()


def scenario_scatter_municipality(browser: Browser) -> None:
    print("[散布：市区町村を選ぶと /api/growth?municipality= ・題に出る]")
    session = Session(browser, WIDE)
    page = session.page
    session.open()
    page.get_by_role("button", name="散布図").click()
    scope = canvas(page)
    scope.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    choose_prefectures(scope, ["神奈川県"])
    wait_options(scope, "横浜市港北区")
    municipality_select(scope).select_option("横浜市港北区")
    page.wait_for_timeout(SETTLE_MS)
    growth = session.last("growth")
    check("municipality=横浜市港北区 で取りに行く", growth.get("municipality") == "横浜市港北区", json.dumps(growth, ensure_ascii=False))
    check("題に「神奈川県・横浜市港北区」", "（神奈川県・横浜市港北区）" in title_of(scope), title_of(scope))
    page.screenshot(path=f"{OUT}/area-scatter-municipality.png")
    session.close()


def scenario_recommend(browser: Browser) -> None:
    print("[おすすめ：同じ部品の市区町村で取りに行き、URL に残る]")
    session = Session(browser, WIDE)
    page = session.page
    session.open()
    page.get_by_role("button", name="おすすめ").click()
    dialog = page.get_by_role("dialog", name="おすすめ駅")
    dialog.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    choose_prefectures(dialog, ["神奈川県"])
    wait_options(dialog, "横浜市")
    municipality_select(dialog).select_option("横浜市")
    page.wait_for_timeout(3000)
    recommend = session.last("recommend")
    check("municipality=横浜市 で取りに行く", recommend.get("municipality") == "横浜市", json.dumps(recommend, ensure_ascii=False))
    check("URL に recMuni=横浜市", session.params().get("recMuni") == "横浜市", json.dumps(session.params(), ensure_ascii=False))
    url = page.url
    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(SETTLE_MS)
    dialog = page.get_by_role("dialog", name="おすすめ駅")
    wait_options(dialog, "横浜市")
    check("開き直しても市区町村が残る", municipality_select(dialog).input_value() == "横浜市", municipality_select(dialog).input_value())
    page.screenshot(path=f"{OUT}/area-recommend.png")
    session.close()


def scenario_narrow(browser: Browser) -> None:
    print("[狭いパソコン 1024px（モーダル）：市区町村を選ぶと題に出て、横にはみ出さない]")
    session = Session(browser, NARROW)
    page = session.page
    session.open()
    page.get_by_role("button", name="ランキング").click()
    dialog = page.get_by_role("dialog", name="ランキング")
    dialog.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    # 選べない市区町村のセレクタを足しても、絞り込みは 1 行に収まる（説明文だと「詳しい条件」が 2 行目に落ちた）
    tops = [box["y"] for box in [
        dialog.get_by_role("button", name="都道府県", exact=True).bounding_box(),
        municipality_select(dialog).bounding_box(),
        dialog.get_by_role("button", name="詳しい条件").bounding_box(),
    ] if box is not None]
    check("都道府県・市区町村・詳しい条件が 1 行に並ぶ", len(tops) == 3 and max(tops) - min(tops) < 6, json.dumps(tops))
    choose_prefectures(dialog, ["東京都"])
    wait_options(dialog, "千代田区")
    municipality_select(dialog).select_option("千代田区")
    page.wait_for_timeout(SETTLE_MS)
    check("municipality=千代田区 で取りに行く", session.last("ranking").get("municipality") == "千代田区", json.dumps(session.last("ranking"), ensure_ascii=False))
    check("題は「（東京都・千代田区・上位）」", "（東京都・千代田区・上位）" in title_of(dialog), title_of(dialog))
    check("セレクタが画面に収まる", inside(municipality_select(dialog).bounding_box(), NARROW["width"]), json.dumps(municipality_select(dialog).bounding_box()))
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    check("横にスクロールしない", scroll_width <= NARROW["width"], str(scroll_width))
    page.screenshot(path=f"{OUT}/area-narrow.png")
    session.close()


def scenario_phone(browser: Browser) -> None:
    print("[携帯 390px（モーダル）：起点・市区町村つきの図で、チップとセレクタが画面に収まる]")
    session = Session(browser, PHONE)
    page = session.page
    session.open(fig_url(fig="ranking", figM="lp_near_price", figPref="東京都", figMuni="千代田区", figNear=TAKEBASHI, figWithin="1500"))
    dialog = page.get_by_role("dialog", name="ランキング")
    dialog.wait_for(state="visible")
    wait_options(dialog, "千代田区")
    page.wait_for_timeout(SETTLE_MS)
    ranking = session.last("ranking")
    check("市区町村と起点の両方で取りに行く", ranking.get("municipality") == "千代田区" and ranking.get("withinM") == "1500", json.dumps(ranking, ensure_ascii=False))
    check("題は「（東京都・千代田区・竹橋から 1.5km・上位）」", "（東京都・千代田区・竹橋から 1.5km・上位）" in title_of(dialog), title_of(dialog))
    check("チップ「竹橋から 1.5km」（市区町村はセレクタで見せる）", chips(dialog) == ["竹橋から 1.5km"], json.dumps(chips(dialog), ensure_ascii=False))
    chip_group = dialog.get_by_role("group", name="場所で絞り込み中")
    check("チップが画面に収まる", inside(chip_group.bounding_box(), PHONE["width"]), json.dumps(chip_group.bounding_box()))
    check("セレクタが画面に収まる", inside(municipality_select(dialog).bounding_box(), PHONE["width"]), json.dumps(municipality_select(dialog).bounding_box()))
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    check("横にスクロールしない", scroll_width <= PHONE["width"], str(scroll_width))
    page.screenshot(path=f"{OUT}/area-phone.png")
    session.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    scenario_ranking_municipality(browser)
    scenario_ranking_near(browser)
    scenario_scatter_bbox(browser)
    scenario_municipality_chip(browser)
    scenario_unknown_municipality(browser)
    scenario_scatter_municipality(browser)
    scenario_recommend(browser)
    scenario_narrow(browser)
    scenario_phone(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
