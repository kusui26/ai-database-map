#!/usr/bin/env python3
"""画面の路線（運行系統）の選択肢・会社の表示名・詳しい条件を、実ブラウザで確かめる（2026-10-08 L4）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（本物の DB を使う）
    pip install playwright && playwright install chromium
    python3 tests/ui.line-picker.smoke.py [出力ディレクトリ] [BASE]

## 見ること

1. ランキング（広い画面＝キャンバス）：路線のセレクタは事業者の通称でまとまり（JR東日本が先頭）、路線色の見本がある。
   全国では上限で切ったことを言う
2. 「山手」で検索 → JR山手線と神戸市営地下鉄山手線。JR山手線を選ぶと `/api/ranking?lines=11302`・題「（全国・JR山手線・上位）」・
   30 件・URL の figLines=11302・ボタンは「JR山手線」
3. 路線を選ぶと、都道府県は東京都だけ・会社は JR東日本だけが選べる
4. 大阪府を選ぶと、路線の候補は大阪の路線だけ（上限のお知らせは出ない）。検索すると東京の路線は薄く出て選べない
5. 会社は表示名（「東京メトロ」「東京都交通局」）。都営を選ぶと題は「（全国・東京都交通局・上位）」
6. 詳しい条件：開くと法令上の路線（指定なし）。新幹線を押すと routeTypes=1。閉じても「詳しい条件（1）」
7. 以前の URL（figRoutes=山手線）で開くと、詳しい条件が開いていて「山手線」が見え、routes=山手線 で取りに行く
8. 散布：路線を選ぶと `/api/growth?lines=`
9. おすすめ：路線だけで候補になる（`/api/recommend?lines=`・URL の recLines）。開き直しても残る
10. 狭いパソコン 1024px（モーダル）：同じセレクタで選べて、題に路線が出る（3 つの幅：1280 キャンバス・1024・390 モーダル）
11. 携帯 390px（モーダル）：絞り込みの 4 つのポップオーバーが画面からはみ出さない
"""

import json
import sys
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Browser, Locator, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

WIDE = {"width": 1280, "height": 900}
NARROW = {"width": 1024, "height": 800}
PHONE = {"width": 390, "height": 844}
YAMANOTE = 11302
SETTLE_MS = 1800

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


def query_of(url: str) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}


class Session:
    """1 つの画面と、そこで出た API の呼び出し。"""

    def __init__(self, browser: Browser, viewport: dict[str, int]) -> None:
        self.context = browser.new_context(viewport=viewport)
        self.page = self.context.new_page()
        self.calls: list[str] = []
        self.page.on("request", lambda request: self.calls.append(request.url) if "/api/" in request.url else None)

    def open(self, path: str = "") -> None:
        self.page.goto(f"{BASE}/{path}", wait_until="networkidle")
        self.page.wait_for_timeout(1200)

    def last(self, api: str) -> dict[str, str]:
        hits = [url for url in self.calls if f"/api/{api}?" in url]
        return query_of(hits[-1]) if hits else {}

    def params(self) -> dict[str, str]:
        return query_of(self.page.url)

    def close(self) -> None:
        self.context.close()


def canvas(page: Page) -> Locator:
    return page.locator('aside[aria-label="キャンバス"]')


def popover_of(scope: Locator, button_label: str) -> Locator:
    """セレクタのボタンのすぐ後ろの、開いたポップオーバー。"""
    return scope.get_by_role("button", name=button_label, exact=True).locator("xpath=following-sibling::div[1]")


def open_picker(scope: Locator, button_label: str) -> Locator:
    button = scope.get_by_role("button", name=button_label, exact=True)
    if button.get_attribute("aria-expanded") != "true":
        button.click()
    popover = popover_of(scope, button_label)
    popover.wait_for(state="visible")
    return popover


def close_picker(scope: Locator, button_label: str) -> None:
    button = scope.get_by_role("button", name=button_label, exact=True)
    if button.get_attribute("aria-expanded") == "true":
        button.click()


def button_text(scope: Locator, label: str) -> str:
    return scope.get_by_role("button", name=label, exact=True).inner_text().strip()


def ranking_title(scope: Locator) -> str:
    heading = scope.locator("h3").first
    return heading.inner_text().strip() if heading.count() > 0 else ""


def enabled_names(popover: Locator) -> list[str]:
    return [label.inner_text().strip() for label in popover.locator("label:has(input:not([disabled]))").all()]


def scenario_ranking(browser: Browser) -> None:
    print("[ランキング（広い画面＝キャンバス）：路線のセレクタ・連動・会社の表示名・詳しい条件]")
    session = Session(browser, WIDE)
    page = session.page
    session.open()
    page.get_by_role("button", name="ランキング").click()
    scope = canvas(page)
    scope.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)

    check("並びは 都道府県・運営会社・路線・詳しい条件", all(
        scope.get_by_role("button", name=name, exact=True).count() == 1 for name in ["都道府県", "運営会社", "路線"]
    ) and scope.get_by_role("button", name="詳しい条件").count() == 1)
    check("法令上の路線は、詳しい条件を開くまで出ない", scope.get_by_role("button", name="法令上の路線", exact=True).count() == 0)
    check("路線のボタンは「全路線」", button_text(scope, "路線") == "全路線", button_text(scope, "路線"))

    popover = open_picker(scope, "路線")
    page.wait_for_timeout(800)
    groups = popover.get_by_role("group")
    first_group = groups.first.get_attribute("aria-label") if groups.count() > 0 else None
    check("事業者の通称でまとまり、JR東日本が先頭", first_group == "JR東日本", str(first_group))
    swatches = popover.locator('label span[style*="background-color"]')
    check("路線色の見本がある", swatches.count() > 10, f"{swatches.count()} 個")
    check("全国では上限で切ったことを言う", popover.get_by_text("路線名・会社名で検索するか、都道府県を選ぶと絞れます").count() == 1)
    page.screenshot(path=f"{OUT}/line-picker-wide-all.png")

    popover.get_by_label("路線を検索").fill("山手")
    page.wait_for_timeout(400)
    names = [label.inner_text().strip() for label in popover.locator("label").all()]
    check("「山手」→ JR山手線・神戸市営地下鉄山手線", any(n.startswith("JR山手線") for n in names) and any(n.startswith("神戸市営地下鉄山手線") for n in names), json.dumps(names, ensure_ascii=False))
    before = len(session.calls)
    popover.locator("label", has_text="JR山手線").locator("input").check()
    page.wait_for_timeout(SETTLE_MS)
    ranking = session.last("ranking")
    check("JR山手線を選ぶと lines=11302 で取りに行く", ranking.get("lines") == str(YAMANOTE), json.dumps(ranking, ensure_ascii=False))
    check("取り直した（呼び出しが増えた）", len(session.calls) > before)
    close_picker(scope, "路線")
    page.wait_for_timeout(300)
    check("ボタンは「JR山手線」", button_text(scope, "路線") == "JR山手線", button_text(scope, "路線"))
    check("題は「（全国・JR山手線・上位）」", "（全国・JR山手線・上位）" in ranking_title(scope), ranking_title(scope))
    check("30 件", scope.get_by_text("/ 30 件").count() == 1)
    check("URL に figLines=11302", session.params().get("figLines") == str(YAMANOTE), json.dumps(session.params(), ensure_ascii=False))
    page.screenshot(path=f"{OUT}/line-picker-wide-yamanote.png")

    prefs = open_picker(scope, "都道府県")
    enabled = enabled_names(prefs)
    check("路線を選ぶと、都道府県は東京都だけ選べる", enabled == ["東京都"], json.dumps(enabled, ensure_ascii=False))
    check("都道府県の説明は「選択中の路線が走る 1 県」", prefs.get_by_text("選択中の路線が走る 1 県のみ選べます").count() == 1)
    close_picker(scope, "都道府県")
    ops = open_picker(scope, "運営会社")
    page.wait_for_timeout(500)
    enabled = [name.split("\n")[0] for name in enabled_names(ops)]
    check("会社は JR東日本だけ選べる（表示名）", [n.rstrip("0123456789").strip() for n in enabled] == ["JR東日本"], json.dumps(enabled, ensure_ascii=False))
    close_picker(scope, "運営会社")

    lines = open_picker(scope, "路線")
    check("開き直すと検索語は消えている", lines.get_by_label("路線を検索").input_value() == "")
    lines.get_by_role("button", name="全路線（すべて解除）").click()
    page.wait_for_timeout(SETTLE_MS)
    # 路線なしの表は最初に取ってあるので、取り直さずに出る（通信ではなく URL と題で見る）。
    check("すべて解除で URL から figLines が消える", "figLines" not in session.params(), json.dumps(session.params(), ensure_ascii=False))
    check("題から路線が消える（全国）", "（全国・上位）" in ranking_title(scope), ranking_title(scope))
    close_picker(scope, "路線")

    prefs = open_picker(scope, "都道府県")
    prefs.locator("label", has_text="大阪府").locator("input").check()
    close_picker(scope, "都道府県")
    page.wait_for_timeout(SETTLE_MS)
    lines = open_picker(scope, "路線")
    page.wait_for_timeout(300)
    group_names = [g.get_attribute("aria-label") for g in lines.get_by_role("group").all()]
    check("大阪府なら、上限のお知らせは出ない（56 本）", lines.get_by_text("路線名・会社名で検索するか").count() == 0)
    check("大阪府なら JR東日本・東京メトロは出ない", "JR東日本" not in group_names and "東京メトロ" not in group_names, json.dumps(group_names, ensure_ascii=False))
    check("路線の説明は「選択中の都道府県に合う 56 本」", lines.get_by_text("選択中の都道府県に合う 56 本のみ選べます").count() == 1)
    lines.get_by_label("路線を検索").fill("山手")
    page.wait_for_timeout(400)
    jr = lines.locator("label", has_text="JR山手線").locator("input")
    check("検索すると東京の路線も薄く出て、選べない", jr.count() == 1 and jr.is_disabled())
    page.screenshot(path=f"{OUT}/line-picker-wide-osaka.png")
    lines.get_by_label("路線を検索").fill("")
    close_picker(scope, "路線")
    prefs = open_picker(scope, "都道府県")
    prefs.get_by_role("button", name="全国（すべて解除）").click()
    close_picker(scope, "都道府県")
    page.wait_for_timeout(SETTLE_MS)

    ops = open_picker(scope, "運営会社")
    page.wait_for_timeout(500)
    texts = [label.inner_text() for label in ops.locator("label").all()[:12]]
    check("会社は表示名（JR東日本・東京メトロ・東京都交通局）", all(any(t.startswith(n) for t in texts) for n in ["JR東日本", "東京メトロ", "東京都交通局"]), json.dumps(texts, ensure_ascii=False))
    metro_title = ops.locator("label", has_text="東京メトロ").first.get_attribute("title")
    check("ホバーで S12 の会社名も読める（東京メトロ（東京地下鉄））", metro_title == "東京メトロ（東京地下鉄）", str(metro_title))
    ops.get_by_label("運営会社を検索").fill("都営")
    page.wait_for_timeout(300)
    ops.get_by_label("運営会社を検索").fill("東京都交通局")
    page.wait_for_timeout(300)
    ops.locator("label", has_text="東京都交通局").locator("input").check()
    close_picker(scope, "運営会社")
    page.wait_for_timeout(SETTLE_MS)
    check("題は「（全国・東京都交通局・上位）」（都道府県の東京都と紛れない）", "（全国・東京都交通局・上位）" in ranking_title(scope), ranking_title(scope))
    check("条件は S12 の会社名（operators=東京都）", session.last("ranking").get("operators") == "東京都", json.dumps(session.last("ranking"), ensure_ascii=False))
    check("ボタンは表示名「東京都交通局」", button_text(scope, "運営会社") == "東京都交通局", button_text(scope, "運営会社"))
    ops = open_picker(scope, "運営会社")
    ops.get_by_role("button", name="全社（すべて解除）").click()
    close_picker(scope, "運営会社")
    page.wait_for_timeout(SETTLE_MS)

    scope.get_by_role("button", name="詳しい条件").click()
    page.wait_for_timeout(300)
    check("詳しい条件を開くと、法令上の路線（指定なし）", button_text(scope, "法令上の路線") == "指定なし", button_text(scope, "法令上の路線"))
    legal = open_picker(scope, "法令上の路線")
    check("法令上の路線の説明がある", legal.get_by_text("国土数値情報の路線名（法令上の路線）").count() == 1)
    legal.get_by_role("button", name="新幹線", exact=True).click()
    close_picker(scope, "法令上の路線")
    page.wait_for_timeout(SETTLE_MS)
    check("新幹線で routeTypes=1", session.last("ranking").get("routeTypes") == "1", json.dumps(session.last("ranking"), ensure_ascii=False))
    scope.get_by_role("button", name="詳しい条件（1）").click()
    page.wait_for_timeout(300)
    check("閉じても「詳しい条件（1）」で効いていると分かる", scope.get_by_role("button", name="詳しい条件（1）").count() == 1 and scope.get_by_role("button", name="法令上の路線", exact=True).count() == 0)
    page.screenshot(path=f"{OUT}/line-picker-wide-detail.png")
    session.close()


def scenario_old_url(browser: Browser) -> None:
    print("[以前の URL（法令上の路線）：詳しい条件が開いて見える]")
    session = Session(browser, WIDE)
    session.open("?fig=ranking&figM=pop_2020_1km&figRoutes=山手線")
    scope = canvas(session.page)
    scope.wait_for(state="visible")
    session.page.wait_for_timeout(SETTLE_MS)
    check("routes=山手線 で取りに行く", session.last("ranking").get("routes") == "山手線", json.dumps(session.last("ranking"), ensure_ascii=False))
    check("詳しい条件が開いている", scope.get_by_role("button", name="法令上の路線", exact=True).count() == 1)
    check("法令上の路線に「山手線」", button_text(scope, "法令上の路線") == "山手線", button_text(scope, "法令上の路線"))
    check("ボタンは「詳しい条件（1）」", scope.get_by_role("button", name="詳しい条件（1）").count() == 1)
    session.close()


def scenario_scatter(browser: Browser) -> None:
    print("[散布：路線を選ぶと /api/growth?lines=]")
    session = Session(browser, WIDE)
    session.open()
    session.page.get_by_role("button", name="散布図").click()
    scope = canvas(session.page)
    scope.wait_for(state="visible")
    session.page.wait_for_timeout(SETTLE_MS)
    lines = open_picker(scope, "路線")
    lines.get_by_label("路線を検索").fill("副都心")
    session.page.wait_for_timeout(300)
    lines.locator("label", has_text="東京メトロ副都心線").locator("input").check()
    close_picker(scope, "路線")
    session.page.wait_for_timeout(SETTLE_MS)
    growth = session.last("growth")
    check("lines=28010 で取りに行く", growth.get("lines") == "28010", json.dumps(growth, ensure_ascii=False))
    title = scope.locator("h3").first.inner_text() if scope.locator("h3").count() > 0 else ""
    check("題に「東京メトロ副都心線」", "東京メトロ副都心線" in title, title)
    session.page.screenshot(path=f"{OUT}/line-picker-scatter.png")
    session.close()


def scenario_recommend(browser: Browser) -> None:
    print("[おすすめ：路線だけで候補になり、URL に残る]")
    session = Session(browser, WIDE)
    session.open()
    session.page.get_by_role("button", name="おすすめ").click()
    dialog = session.page.get_by_role("dialog", name="おすすめ駅")
    dialog.wait_for(state="visible")
    session.page.wait_for_timeout(SETTLE_MS)
    lines = open_picker(dialog, "路線")
    lines.get_by_label("路線を検索").fill("山手")
    session.page.wait_for_timeout(300)
    lines.locator("label", has_text="JR山手線").locator("input").check()
    close_picker(dialog, "路線")
    session.page.wait_for_timeout(2500)
    recommend = session.last("recommend")
    check("lines=11302 だけで取りに行く", recommend.get("lines") == str(YAMANOTE) and "prefecture" not in recommend, json.dumps(recommend, ensure_ascii=False))
    check("URL に recLines=11302", session.params().get("recLines") == str(YAMANOTE), json.dumps(session.params(), ensure_ascii=False))
    check("対象は「全国（JR山手線）」", dialog.get_by_text("全国（JR山手線）").count() >= 1)
    session.page.screenshot(path=f"{OUT}/line-picker-recommend.png")
    url = session.page.url
    session.page.goto(url, wait_until="networkidle")
    session.page.wait_for_timeout(SETTLE_MS)
    dialog = session.page.get_by_role("dialog", name="おすすめ駅")
    check("開き直しても路線が残る（ボタンは JR山手線）", dialog.is_visible() and button_text(dialog, "路線") == "JR山手線", button_text(dialog, "路線") if dialog.is_visible() else "閉じている")
    session.close()


def scenario_narrow(browser: Browser) -> None:
    print("[狭いパソコン 1024px（モーダル）：路線を選ぶと題に出る]")
    session = Session(browser, NARROW)
    page = session.page
    session.open()
    page.get_by_role("button", name="ランキング").click()
    dialog = page.get_by_role("dialog", name="ランキング")
    dialog.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    lines = open_picker(dialog, "路線")
    lines.get_by_label("路線を検索").fill("丸ノ内")
    page.wait_for_timeout(300)
    lines.locator("label", has_text="東京メトロ丸ノ内線").locator("input").check()
    close_picker(dialog, "路線")
    page.wait_for_timeout(SETTLE_MS)
    check("lines=28002 で取りに行く", session.last("ranking").get("lines") == "28002", json.dumps(session.last("ranking"), ensure_ascii=False))
    check("題は「（全国・東京メトロ丸ノ内線・上位）」", "（全国・東京メトロ丸ノ内線・上位）" in ranking_title(dialog), ranking_title(dialog))
    row = dialog.get_by_role("button", name="路線", exact=True).bounding_box()
    toggle = dialog.get_by_role("button", name="詳しい条件").bounding_box()
    same_row = row is not None and toggle is not None and abs(row["y"] - toggle["y"]) < 4
    check("絞り込みは 1 行に並ぶ（詳しい条件も同じ行）", same_row, json.dumps([row, toggle]))
    lines = open_picker(dialog, "路線")
    page.wait_for_timeout(300)
    check("ポップオーバーが画面に収まる", inside(lines.bounding_box(), NARROW["width"]), json.dumps(lines.bounding_box()))
    page.screenshot(path=f"{OUT}/line-picker-narrow.png")
    session.close()


def inside(box: dict[str, float] | None, width: int) -> bool:
    return box is not None and box["x"] >= 0 and box["x"] + box["width"] <= width


def scenario_phone(browser: Browser) -> None:
    print("[携帯 390px（モーダル）：ポップオーバーが画面からはみ出さない]")
    session = Session(browser, PHONE)
    page = session.page
    session.open()
    page.get_by_role("button", name="ランキング").click()
    dialog = page.get_by_role("dialog", name="ランキング")
    dialog.wait_for(state="visible")
    page.wait_for_timeout(SETTLE_MS)
    dialog.get_by_role("button", name="詳しい条件").click()
    page.wait_for_timeout(300)
    for label in ["都道府県", "運営会社", "路線", "法令上の路線"]:
        popover = open_picker(dialog, label)
        page.wait_for_timeout(300)
        box = popover.bounding_box()
        check(f"「{label}」のポップオーバーが画面に収まる", inside(box, PHONE["width"]), json.dumps(box))
        if label == "路線":
            page.screenshot(path=f"{OUT}/line-picker-phone.png")
        close_picker(dialog, label)
        page.wait_for_timeout(200)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    check("横にスクロールしない", scroll_width <= PHONE["width"], str(scroll_width))
    session.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    scenario_ranking(browser)
    scenario_old_url(browser)
    scenario_scatter(browser)
    scenario_recommend(browser)
    scenario_narrow(browser)
    scenario_phone(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
