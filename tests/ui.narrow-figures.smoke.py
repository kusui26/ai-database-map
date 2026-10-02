#!/usr/bin/env python3
"""狭い画面・携帯で、回答の図を会話の中に出し、携帯では駅詳細のシートが回答を覆わないことを
実ブラウザで確かめる（2026-10-02・A4）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.narrow-figures.smoke.py [出力ディレクトリ] [BASE]

## きっかけ（docs/261001_fix_user_feedback_ui.md §4）

フィードバック #3「図は開いてしまって欲しい」。2026-10-01 の本番では、幅 1024px でランキングの回答が
チップだけで開かず、携帯では駅詳細のシート（暗い幕つき）がチャットを覆って回答文が読めなかった。

## 約束（§4.4(b)）

| 画面幅 | 駅詳細 | ランキング・散布 |
| --- | --- | --- |
| 広い（1128px 以上） | チップ＋右の駅詳細 | チップ＋キャンバス |
| 狭い（640〜1127px） | チップ＋右の駅詳細 | 会話の中（⤢ でモーダル） |
| 携帯（640px 未満） | 会話の中（シートは自動で開かない・⤢ でシート） | 会話の中（⤢ でモーダル） |

- 会話の中の順位表は上位 10 行と「ほか N 駅」（全件は ⤢ のモーダル）
- 携帯でチャットを開いているときに AI が選んだ駅は、選ぶ（`?grp`）がシートは閉じたまま（`?sheet=closed`）。
  ⤢ でシートを開くのは 1 つの履歴で、戻る 1 回でシートだけが閉じる（駅の選択は残る）
- 利用者が駅を選ぶ（会話の駅名など）とシートは開く。チャットを閉じていれば、AI が選んでもシートは開く

チャットはページの fetch を差し替え、本番と同じ並び（data-promotions → data-map）の UI メッセージストリームを返す。
"""

import json
import sys
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
WIDE = {"width": 1280, "height": 900}
NARROW = {"width": 1024, "height": 800}
PHONE = {"width": 390, "height": 844}
TOKYO = "東京#0"
SETTLE_MS = 1_200
STAGE_DELAY_MS = 3_000

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# --- 回答の差し替え ----------------------------------------------------------

# 先頭の 5 駅は実在（行を押すと駅詳細が開く）。AI のランキングの既定と同じ 20 行。
RANKED_NAMES = [
    "柏たなか", "流山おおたかの森", "新浦安", "幕張豊砂", "海浜幕張", "舞浜", "南船橋", "新習志野", "津田沼", "船橋",
    "西船橋", "本八幡", "市川", "松戸", "柏", "我孫子", "千葉", "蘇我", "稲毛", "検見川浜",
]
RANKING_TABLE = {
    "type": "rankingTable",
    "title": "人口増減率（2015→2020年・1km圏）（千葉県・上位）",
    "metricKey": "pop_gr_2020_2015_1km",
    "unit": "%",
    "rows": [
        {"rank": i + 1, "grp": f"{name}#0", "name": name, "prefecture": "千葉県", "value": 60 - i * 2.5,
         "formatted": f"+{60 - i * 2.5:.1f}%", "flagged": False}
        for i, name in enumerate(RANKED_NAMES)
    ],
    "placement": "inline",
    "size": "compact",
}
RANKING_PROMOTION = {
    "kind": "ranking", "metricKey": "pop_gr_2020_2015_1km", "order": "desc", "prefectures": ["千葉県"],
    "operators": [], "routes": [], "routeTypes": [], "excludeLowN": True,
}
SCATTER = {
    "type": "scatter",
    "title": "人口増減率（2015→2020年・2km圏） × 乗降客数 コロナ前後増減率（千葉県）",
    "xLabel": "人口増減率（2015→2020年・2km圏）",
    "yLabel": "乗降客数 コロナ前後増減率",
    "xUnit": "%",
    "yUnit": "%",
    "points": [
        {"grp": f"{name}#0", "name": name, "x": 10 - i, "y": -20 + i * 1.5, "cluster": 0}
        for i, name in enumerate(RANKED_NAMES)
    ],
    "clusterCount": 1,
    "placement": "inline",
    "size": "compact",
}
SCATTER_PROMOTION = {
    "kind": "scatter", "xKey": "pop_gr_2020_2015_2km", "yKey": "rate_covid", "prefectures": ["千葉県"],
    "operators": [], "routes": [], "routeTypes": [], "excludeLowN": True,
}
STATION_CARD = {
    "type": "stationCard", "grp": TOKYO, "stationName": "東京", "label": "東京", "prefecture": "東京都",
    "operators": "東日本旅客鉄道", "paxLatest": 1262604, "badges": [], "placement": "inline", "size": "compact",
}
TREND = {
    "type": "trendChart", "title": "人口の推移（1km圏）", "unit": "人", "format": "int", "flags": [],
    "series": [{"label": "実績", "points": [{"x": 2010, "y": 3790}, {"x": 2015, "y": 4010}, {"x": 2020, "y": 4248}]}],
    "placement": "inline", "size": "compact",
}
DETAIL_PROMOTION = {"kind": "detail", "grp": TOKYO, "category": "population"}
ANSWER_TEXT = "東京駅の周辺の人口と、千葉県で人口が増えている駅をまとめました。"


def effects(kinds: tuple[str, ...]) -> tuple[list, list, list]:
    """回答に入れる図（パネル・⤢ の条件・地図の操作）。サーバと同じく、条件はパネルと同じ並び。"""
    panels: list = []
    promotions: list = []
    actions: list = []
    for kind in kinds:
        if kind == "detail":
            panels += [STATION_CARD, TREND]
            promotions += [DETAIL_PROMOTION, None]
            actions += [{"type": "flyTo", "lon": 139.7671, "lat": 35.6812, "zoom": 12}, {"type": "selectStation", "grp": TOKYO, "radiusM": 1000}]
        elif kind == "ranking":
            panels += [RANKING_TABLE]
            promotions += [RANKING_PROMOTION]
            actions += [{"type": "highlightStations", "grps": [row["grp"] for row in RANKING_TABLE["rows"]]}]
        else:
            panels += [SCATTER]
            promotions += [SCATTER_PROMOTION]
    return panels, promotions, actions


def sse(chunks: list[dict]) -> str:
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)


def answer(*kinds: str, delay_ms: int = 0) -> dict:
    """1 段目＝本文、delay_ms 待って 2 段目＝図（data-promotions → data-map）。"""
    panels, promotions, actions = effects(kinds)
    first = [
        {"type": "start", "messageId": "smoke"}, {"type": "start-step"},
        {"type": "text-start", "id": "t1"}, {"type": "text-delta", "id": "t1", "delta": ANSWER_TEXT}, {"type": "text-end", "id": "t1"},
    ]
    second = [
        {"type": "data-promotions", "id": "promotions", "data": promotions},
        {"type": "data-map", "id": "map", "data": {"messages": [{"role": "assistant", "text": ANSWER_TEXT}], "mapActions": actions, "panels": panels}},
        {"type": "finish-step"}, {"type": "finish"},
    ]
    return {"first": sse(first), "delayMs": delay_ms, "second": sse(second) + "data: [DONE]\n\n"}


def chat_script(plan: dict) -> str:
    """/api/chat だけを差し替える fetch（ほかの API は本物）。"""
    return f"""
    (() => {{
      const original = window.fetch.bind(window);
      const plan = {json.dumps(plan, ensure_ascii=False)};
      window.fetch = async (input, init) => {{
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/api/chat')) return original(input, init);
        const encoder = new TextEncoder();
        const body = new ReadableStream({{
          async start(controller) {{
            controller.enqueue(encoder.encode(plan.first));
            if (plan.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
            controller.enqueue(encoder.encode(plan.second));
            controller.close();
          }},
        }});
        return new Response(body, {{ status: 200, headers: {json.dumps(STREAM_HEADERS)} }});
      }};
    }})();
    """


# --- 画面の読み取り・操作 ----------------------------------------------------


class Session:
    """1 つのタブ。再読み込み（文書の読み直し）と画面のエラーを数える。"""

    def __init__(self, browser: Browser, viewport: dict, plan: dict | None = None):
        mobile = viewport["width"] < 640
        self.context: BrowserContext = browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile)
        self.context.add_init_script("window.__loadId = window.__loadId || Math.random().toString(36).slice(2)")
        if plan is not None:
            self.context.add_init_script(chat_script(plan))
        self.page: Page = self.context.new_page()
        self.errors: list[str] = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.load_id: str | None = None

    def open(self, query: str = "") -> None:
        self.page.goto(f"{BASE}/{query}", wait_until="networkidle")
        self.load_id = self.page.evaluate("() => window.__loadId")

    def params(self) -> dict[str, str]:
        return {key: values[0] for key, values in parse_qs(urlparse(self.page.url).query).items()}

    def length(self) -> int:
        return self.page.evaluate("() => history.length")

    def back(self) -> None:
        self.page.go_back(wait_until="commit")
        self.page.wait_for_timeout(SETTLE_MS)

    def forward(self) -> None:
        self.page.go_forward(wait_until="commit")
        self.page.wait_for_timeout(SETTLE_MS)

    def finish(self, name: str) -> None:
        reloaded = self.page.evaluate("() => window.__loadId") != self.load_id
        check("ページを読み直していない", not reloaded)
        check("画面のエラーなし", not self.errors, "; ".join(self.errors))
        self.page.screenshot(path=f"{OUT}/narrow-figures-{name}.png")
        self.context.close()


def send(page: Page, question: str) -> None:
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


def wait_answered(page: Page) -> None:
    page.wait_for_function("() => document.querySelector('[data-chat-question]') !== null")
    page.locator('button[aria-label="送信"]').wait_for(state="attached", timeout=15_000)
    page.wait_for_timeout(SETTLE_MS)


def chat(page: Page):
    """チャットの枠（広い画面は左の aside、携帯は下のシート）。"""
    return page.locator('aside[aria-label="AI チャット"], [data-vaul-drawer]').filter(
        has=page.locator('textarea[aria-label="チャット入力"]')
    )


def expand_button(page: Page, label: str):
    """会話の中の図の ⤢「拡大」。"""
    return chat(page).get_by_role("button", name=f"{label} を拡大")


def chip(page: Page, label: str):
    """図への参照チップ（広い画面・狭い画面の駅詳細）。"""
    return chat(page).locator(f'button[title="{label}"]')


def detail_open(page: Page) -> bool:
    """駅詳細（デスクトップ＝右の aside・携帯＝シート）が開いているか。"""
    return page.evaluate(
        """() => [...document.querySelectorAll('button.border-b-2')].some((tab) => tab.getBoundingClientRect().width > 0
              && tab.closest('aside:not([aria-hidden="true"]), [data-vaul-drawer]') !== null)"""
    )


def active_tab(page: Page) -> str:
    return page.evaluate(
        """() => {
          const active = [...document.querySelectorAll('button.border-b-2')].find((b) => b.className.includes('border-indigo-600'));
          return active ? active.textContent.trim() : '(なし)';
        }"""
    )


def wait_detail(page: Page, opened: bool) -> bool:
    try:
        page.wait_for_function(
            f"""() => [...document.querySelectorAll('button.border-b-2')].some((tab) => tab.getBoundingClientRect().width > 0
                  && tab.closest('aside:not([aria-hidden="true"]), [data-vaul-drawer]') !== null) === {json.dumps(opened)}""",
            timeout=10_000,
        )
        return True
    except Exception:  # noqa: BLE001 — 待ちきれなかったことを判定に使う
        return False


def canvas_visible(page: Page) -> bool:
    return page.locator('aside[aria-label="キャンバス"]').is_visible()


def modal(page: Page, title: str):
    return page.get_by_role("dialog", name=title)


def inline_ranks(page: Page) -> list[str]:
    """会話の中の順位表に出ている順位。"""
    return chat(page).locator("ol li > button > span:first-child").all_inner_texts()


def visible_in_thread(page: Page, text: str) -> bool:
    """本文が、チャットのスレッドの見えている範囲に入っているか（覆われていないかは別に見る）。"""
    return page.evaluate(
        """(text) => {
          const node = [...document.querySelectorAll('[data-chat-question] ~ div p, [data-chat-question] ~ div div')]
            .find((el) => el.textContent.includes(text) && el.children.length < 6);
          const box = node?.closest('.overflow-y-auto');
          if (!node || !box) return false;
          const a = node.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          return a.top >= b.top - 1 && a.top < b.bottom;
        }""",
        text,
    )


# --- 場面 --------------------------------------------------------------------


def scenario_narrow_ranking(browser: Browser) -> None:
    print("[狭い画面 1024px：ランキングは会話の中（上位 10 行）・⤢ でモーダル・行を押すと駅詳細]")
    session = Session(browser, NARROW, answer("ranking"))
    session.open()
    start = session.length()
    send(session.page, "千葉県で人口が増えている駅は？")
    wait_answered(session.page)
    page = session.page
    check("会話の中に順位表が出る（上位 10 行）", inline_ranks(page) == [str(rank) for rank in range(1, 11)], str(inline_ranks(page)))
    check("残りの数を添える（ほか 10 駅）", chat(page).get_by_text("ほか 10 駅").is_visible())
    check("チップではなく ⤢「拡大」", expand_button(page, RANKING_TABLE["title"]).count() == 1 and chip(page, RANKING_TABLE["title"]).count() == 0)
    check("モーダルもキャンバスも勝手には開かない", not modal(page, "ランキング").is_visible() and not canvas_visible(page))
    check("回答は URL を書かない（履歴も増えない）", "fig" not in session.params() and session.length() == start, f"{start} → {session.length()}")
    chat(page).locator("ol li > button").first.click()
    check("会話の中の行を押すと、その駅の詳細が開く", wait_detail(page, True) and session.params().get("grp") == "柏たなか#0", str(session.params()))
    expand_button(page, RANKING_TABLE["title"]).click()
    modal(page, "ランキング").wait_for(state="visible")
    page.wait_for_timeout(800)
    check("⤢ で、AI の条件（千葉県）のモーダルが開く", session.params().get("figPref") == "千葉県", str(session.params()))
    session.back()
    check("戻る＝モーダルだけ閉じる（選んだ駅は残る）", not modal(page, "ランキング").is_visible() and session.params().get("grp") == "柏たなか#0", str(session.params()))
    session.finish("narrow-ranking")


def scenario_narrow_scatter(browser: Browser) -> None:
    print("[狭い画面 1024px：散布も会話の中・⤢ で同じ条件のモーダル]")
    session = Session(browser, NARROW, answer("scatter"))
    session.open()
    send(session.page, "千葉県で人口増減とコロナの影響の関係は？")
    wait_answered(session.page)
    page = session.page
    check("会話の中に散布図が描かれる", chat(page).locator("canvas").count() >= 1)
    expand_button(page, SCATTER["title"]).click()
    modal(page, "散布図").wait_for(state="visible")
    page.wait_for_timeout(800)
    params = session.params()
    check("⤢ で、AI の条件の散布が開く", params.get("fig") == "scatter" and params.get("figY") == "rate_covid" and params.get("figPref") == "千葉県", str(params))
    session.finish("narrow-scatter")


def scenario_narrow_detail(browser: Browser) -> None:
    print("[狭い画面 1024px：駅詳細はチップ（文言に焦点）＋右の駅詳細が聞いたタブで開く]")
    session = Session(browser, NARROW, answer("detail"))
    session.open()
    send(session.page, "東京駅の人口推移を教えて")
    wait_answered(session.page)
    page = session.page
    check("駅詳細はチップ「東京 の人口」（押す前に開く先が分かる）", chip(page, "東京 の人口").count() == 1, str(chat(page).locator("button[title]").evaluate_all("(els) => els.map((el) => el.title)")))
    check("会話の中には出さない（右に出ている）", expand_button(page, "東京 の人口").count() == 0)
    check("右の駅詳細が人口タブで開く", wait_detail(page, True) and active_tab(page) == "人口", f"タブ={active_tab(page)}")
    session.finish("narrow-detail")


def scenario_phone_detail(browser: Browser) -> None:
    print("[携帯 390px：駅詳細は会話の中・シートは被せない → ⤢ でシート → 戻る＝シートだけ閉じる → 進む]")
    session = Session(browser, PHONE, answer("detail"))
    session.open()
    start = session.length()
    send(session.page, "東京駅の人口推移を教えて")
    wait_answered(session.page)
    page = session.page
    params = session.params()
    check("駅は選ぶが、シートは閉じたまま（URL に sheet=closed）", params.get("grp") == TOKYO and params.get("sheet") == "closed" and params.get("tab") == "population", str(params))
    check("詳細のシートが回答を覆っていない", not detail_open(page))
    check("回答の本文がスレッドに見えている", visible_in_thread(page, "東京駅の周辺の人口"))
    check("駅カードと焦点のグラフが会話の中にある", chat(page).get_by_text("最新乗降客数").is_visible() and chat(page).get_by_text("人口の推移（1km圏）").count() == 1)
    check("回答で積んだ履歴は 1 つ", session.length() == start + 1, f"{start} → {session.length()}")
    expand_button(page, "東京 の人口").click()
    check("⤢ でシートが開く（聞いた人口タブ）", wait_detail(page, True) and active_tab(page) == "人口", f"タブ={active_tab(page)}")
    check("⤢ は 1 つの履歴（sheet の印が消える）", session.length() == start + 2 and "sheet" not in session.params(), f"{session.length()}・{session.params()}")
    session.back()
    params = session.params()
    check("戻る＝シートだけ閉じる（駅の選択と回答の状態は残る）", wait_detail(page, False) and params.get("grp") == TOKYO and params.get("sheet") == "closed", str(params))
    session.forward()
    check("進む＝シートが開き直す", wait_detail(page, True), str(session.params()))
    session.finish("phone-detail")


def scenario_phone_ranking(browser: Browser) -> None:
    print("[携帯 390px：ランキングも会話の中・⤢ でモーダル・戻るで閉じる]")
    session = Session(browser, PHONE, answer("ranking"))
    session.open()
    send(session.page, "千葉県で人口が増えている駅は？")
    wait_answered(session.page)
    page = session.page
    check("会話の中に上位 10 行", inline_ranks(page) == [str(rank) for rank in range(1, 11)], str(inline_ranks(page)))
    expand_button(page, RANKING_TABLE["title"]).click()
    modal(page, "ランキング").wait_for(state="visible")
    page.wait_for_timeout(800)
    check("⤢ でモーダル（AI の条件）", session.params().get("figPref") == "千葉県", str(session.params()))
    session.back()
    check("戻る＝モーダルが閉じる", not modal(page, "ランキング").is_visible() and "fig" not in session.params(), str(session.params()))
    session.finish("phone-ranking")


def scenario_phone_name_tap(browser: Browser) -> None:
    print("[携帯 390px：会話の駅名を押す＝利用者が選んだので、シートが開く]")
    session = Session(browser, PHONE, answer("detail"))
    session.open()
    send(session.page, "東京駅の人口推移を教えて")
    wait_answered(session.page)
    page = session.page
    check("回答の直後はシートを開かない（前提）", not detail_open(page))
    chat(page).get_by_role("button", name="東京", exact=True).first.click()
    check("駅名を押すとシートが開く", wait_detail(page, True) and "sheet" not in session.params(), str(session.params()))
    session.finish("phone-name-tap")


def scenario_phone_chat_closed(browser: Browser) -> None:
    print("[携帯 390px：回答の途中でチャットを閉じた＝覆うものが無いので、AI が選んだ駅のシートは開く]")
    session = Session(browser, PHONE, answer("detail", delay_ms=STAGE_DELAY_MS))
    session.open()
    send(session.page, "東京駅の人口推移を教えて")
    page = session.page
    page.get_by_text(ANSWER_TEXT).first.wait_for(state="visible", timeout=15_000)
    page.get_by_role("button", name="チャットを閉じる").click()
    page.wait_for_function("() => new URL(location.href).searchParams.get('grp') !== null", timeout=15_000)
    check("シートが開く（sheet の印を付けない）", wait_detail(page, True) and "sheet" not in session.params(), str(session.params()))
    session.finish("phone-chat-closed")


def scenario_shared_link(browser: Browser) -> None:
    print("[共有リンク ?grp=東京&sheet=closed：携帯はシートを閉じたまま、デスクトップは印を見ない]")
    query = "?grp=%E6%9D%B1%E4%BA%AC%230&sheet=closed"
    phone = Session(browser, PHONE)
    phone.open(query)
    phone.page.wait_for_timeout(1500)
    check("携帯：駅は選ばれ、シートは閉じている", phone.params().get("grp") == TOKYO and not detail_open(phone.page), str(phone.params()))
    phone.finish("shared-phone")
    desk = Session(browser, NARROW)
    desk.open(query)
    check("デスクトップ：右の駅詳細は開く（sheet の印は携帯だけ）", wait_detail(desk.page, True))
    desk.finish("shared-desktop")


def scenario_boundaries(browser: Browser) -> None:
    print("[幅の境界 639/640/1127/1128px：駅詳細とランキングの出し方]")
    # 幅 → (駅詳細は会話の中か, ランキングは会話の中か, キャンバスが開くか)
    expected = {639: (True, True, False), 640: (False, True, False), 1127: (False, True, False), 1128: (False, False, True)}
    for width, (detail_inline, ranking_inline, canvas) in expected.items():
        session = Session(browser, {"width": width, "height": 860}, answer("detail", "ranking"))
        session.open()
        send(session.page, "東京駅と千葉県のランキング")
        wait_answered(session.page)
        page = session.page
        got_detail = expand_button(page, "東京 の人口").count() == 1
        got_ranking = expand_button(page, RANKING_TABLE["title"]).count() == 1
        got_chips = chip(page, "東京 の人口").count() + chip(page, RANKING_TABLE["title"]).count()
        detail_chip_expected = 0 if detail_inline else 1
        ranking_chip_expected = 0 if ranking_inline else 1
        check(
            f"{width}px：駅詳細={'会話の中' if detail_inline else 'チップ'}・ランキング={'会話の中' if ranking_inline else 'チップ'}・キャンバス={'あり' if canvas else 'なし'}",
            got_detail == detail_inline and got_ranking == ranking_inline and got_chips == detail_chip_expected + ranking_chip_expected and canvas_visible(page) == canvas,
            f"会話の中: 詳細={got_detail}・ランキング={got_ranking}／チップ {got_chips} 個／キャンバス={canvas_visible(page)}",
        )
        session.finish(f"boundary-{width}")


def scenario_wide_unchanged(browser: Browser) -> None:
    print("[広い画面 1280px：いままでどおり（チップ＋キャンバス＋右の駅詳細）。会話の中には出さない]")
    session = Session(browser, WIDE, answer("detail", "ranking"))
    session.open()
    send(session.page, "東京駅と千葉県のランキング")
    wait_answered(session.page)
    page = session.page
    check("チップ 2 つ（駅詳細は焦点つきの文言）", chip(page, "東京 の人口").count() == 1 and chip(page, RANKING_TABLE["title"]).count() == 1)
    check("会話の中の図（拡大）は無い", chat(page).get_by_role("button", name="拡大").count() == 0)
    check("キャンバスが開き、右の駅詳細は人口タブ", canvas_visible(page) and wait_detail(page, True) and active_tab(page) == "人口", f"タブ={active_tab(page)}")
    session.finish("wide")


def scenario_phone_overflow(browser: Browser) -> None:
    print("[携帯 390px：会話の中の図で、横にはみ出さない]")
    session = Session(browser, PHONE, answer("detail", "ranking", "scatter"))
    session.open()
    send(session.page, "まとめて見せて")
    wait_answered(session.page)
    overflow = session.page.evaluate(
        """() => {
          const thread = document.querySelector('[data-chat-question]')?.closest('.overflow-y-auto');
          return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            thread: thread ? thread.scrollWidth - thread.clientWidth : -1,
          };
        }"""
    )
    check("ページも会話も横にはみ出さない", overflow["page"] <= 0 and 0 <= overflow["thread"] <= 0, str(overflow))
    session.finish("phone-overflow")


SCENARIOS: list[Callable[[Browser], None]] = [
    scenario_narrow_ranking,
    scenario_narrow_scatter,
    scenario_narrow_detail,
    scenario_phone_detail,
    scenario_phone_ranking,
    scenario_phone_name_tap,
    scenario_phone_chat_closed,
    scenario_shared_link,
    scenario_boundaries,
    scenario_wide_unchanged,
    scenario_phone_overflow,
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for run in SCENARIOS:
        try:
            run(browser)
        except Exception as error:  # noqa: BLE001 — 途中で止まった（修正前の画面など）＝その場面は失敗
            check(f"場面が最後まで進む（{run.__name__}）", False, f"{type(error).__name__}: {str(error).splitlines()[0]}")
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
