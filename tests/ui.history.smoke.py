#!/usr/bin/env python3
"""ブラウザの「戻る／進む」で画面の状態が戻ることを、実ブラウザで確かめる（2026-10-02）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.history.smoke.py [出力ディレクトリ] [BASE]

## きっかけ（docs/261001_fix_user_feedback_ui.md §5）

フィードバック「開いた場合に、ユーザが戻りたいときに戻れるように、UIのイベントはurlのhistoryに積んでおいて、
ブラウザのバックでUIの状態がもどれるとよい」。2026-10-01 の本番では URL の書き換えがすべて replace で、
東京 → 新宿 → 戻る で about:blank（アプリの外）に出ていた。図とダイアログは URL に無かった。

## 約束（§5.3）

- 出る・消える・移る（駅を選ぶ・閉じる・図やおすすめを開く・閉じる）は push
- 中での調整（半径・タブ・図やおすすめの中の条件・ハザードのレイヤ）は replace
- **1 回の回答で積む履歴は 1 つ**。回答の途中で戻る／進むを押されたら、その回答はもう URL を書かない
- 戻る／進むでページを読み直さない（RSC の再取得もしない）
- 図の中身は、外から図が替わったときに 1 回だけ作る（開くたびに 2 回作らない・駅だけ戻しても作り直さない）
- 狭い画面・携帯で、初めて出す図や詳細を一瞬も広い画面の形（キャンバス・右ドロワー）で作らない

判定は URL・`history.length`・画面（ドロワー・キャンバス・モーダル）の 3 つで行う。作り直しと幅違いの形は、
DOM に足された要素で数える（すぐ外されても数える）。チャットは
ページの fetch を差し替え、本番と同じ UI メッセージストリームを返す（届く間隔も作れる）。
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
TOKYO_QUERY = "?grp=%E6%9D%B1%E4%BA%AC%230"
STAGE_DELAY_MS = 3_000
SETTLE_MS = 1_200
METRIC = "pop_gr_2020_2015_1km"

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# --- チャットの差し替え ----------------------------------------------------------

RANKING_PROMOTION = {
    "kind": "ranking",
    "metricKey": METRIC,
    "order": "desc",
    "prefectures": ["千葉県"],
    "operators": [],
    "routes": [],
    "routeTypes": [],
    "excludeLowN": True,
}
STATION_CARD = {
    "type": "stationCard",
    "grp": TOKYO,
    "stationName": "東京",
    "label": "東京",
    "prefecture": "東京都",
    "operators": "東日本旅客鉄道",
    "paxLatest": 1262604,
    "badges": [],
    "placement": "inline",
    "size": "compact",
}
TREND = {
    "type": "trendChart",
    "title": "人口の推移",
    "unit": "人",
    "format": "int",
    "flags": [],
    "series": [{"label": "実績", "points": [{"x": 2020, "y": 4248}]}],
    "placement": "inline",
    "size": "compact",
}
RANKING_TABLE = {
    "type": "rankingTable",
    "title": "人口増減率（2015→2020年・1km圏）（千葉県・上位）",
    "metricKey": METRIC,
    "unit": "%",
    "rows": [],
    "placement": "inline",
    "size": "compact",
}
SELECT_TOKYO = [
    {"type": "flyTo", "lon": 139.7671, "lat": 35.6812, "zoom": 12},
    {"type": "selectStation", "grp": TOKYO, "radiusM": 1000},
]


def sse(chunks: list[dict]) -> str:
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)


def figures(with_ranking: bool, text: str | None = None) -> list[dict]:
    """サーバと同じく、条件（data-promotions）を図（data-map）より先に送る。"""
    panels = [STATION_CARD, TREND] + ([RANKING_TABLE] if with_ranking else [])
    promotions = [{"kind": "detail", "grp": TOKYO, "category": "population"}, None]
    promotions += [RANKING_PROMOTION] if with_ranking else []
    actions = SELECT_TOKYO + ([{"type": "highlightStations", "grps": [TOKYO]}] if with_ranking else [])
    messages = [] if text is None else [{"role": "assistant", "text": text}]
    return [
        {"type": "data-promotions", "id": "promotions", "data": promotions},
        {"type": "data-map", "id": "map", "data": {"messages": messages, "mapActions": actions, "panels": panels}},
    ]


def answer(*, with_ranking: bool, delay_ms: int = 0) -> dict:
    """1 段目＝ツールが成功して図を送る。2 段目＝本文と送り直し（サーバと同じく図を 2 回送る）。"""
    text = "東京駅の周辺の人口は増えています。地図とグラフをご覧ください。"
    first = [{"type": "start", "messageId": "smoke"}, {"type": "start-step"}, *figures(with_ranking), {"type": "finish-step"}]
    second = [
        {"type": "start-step"},
        {"type": "text-start", "id": "t1"},
        {"type": "text-delta", "id": "t1", "delta": text},
        {"type": "text-end", "id": "t1"},
        *figures(with_ranking, text),
        {"type": "finish-step"},
        {"type": "finish"},
    ]
    return {"first": sse(first), "delayMs": delay_ms, "second": sse(second) + "data: [DONE]\n\n"}


def chat_script(plans: list[dict]) -> str:
    """呼ばれた順に plans を返す fetch（足りなければ最後を繰り返す）。/api/chat 以外は素通し。"""
    return f"""
    (() => {{
      const original = window.fetch.bind(window);
      const plans = {json.dumps(plans, ensure_ascii=False)};
      let calls = 0;
      window.fetch = async (input, init) => {{
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/api/chat')) return original(input, init);
        const plan = plans[Math.min(calls, plans.length - 1)];
        calls += 1;
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
    """1 つのタブ。再読み込み（文書の読み直し）と RSC の再取得を数える。"""

    def __init__(self, browser: Browser, viewport: dict, plans: list[dict] | None = None):
        self.context: BrowserContext = browser.new_context(
            viewport=viewport, is_mobile=viewport["width"] < 640, has_touch=viewport["width"] < 640
        )
        self.context.add_init_script("window.__loadId = window.__loadId || Math.random().toString(36).slice(2)")
        if plans is not None:
            self.context.add_init_script(chat_script(plans))
        self.page: Page = self.context.new_page()
        self.errors: list[str] = []
        self.rsc: list[str] = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("request", self._record)
        self.load_id: str | None = None

    def _record(self, request) -> None:
        if "_rsc=" in request.url or request.headers.get("rsc") is not None:
            self.rsc.append(request.url)

    def open(self, query: str = "", from_blank: bool = False) -> None:
        if from_blank:
            self.page.goto("about:blank")
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

    def not_reloaded(self) -> bool:
        return self.page.evaluate("() => window.__loadId") == self.load_id

    def finish(self, name: str) -> None:
        check("ページを読み直していない（戻る／進むはその場で状態を戻す）", self.not_reloaded())
        check("RSC の再取得が走っていない", not self.rsc, f"{len(self.rsc)} 件")
        check("画面のエラーなし", not self.errors, "; ".join(self.errors))
        self.page.screenshot(path=f"{OUT}/history-{name}.png")
        self.context.close()


def pick_station(page: Page, name: str) -> None:
    box = page.get_by_placeholder("駅名で検索…")
    box.click()
    box.fill(name)
    page.locator("[cmdk-item]").first.wait_for(state="visible")
    page.locator("[cmdk-item]").first.click()
    page.wait_for_function(f"() => new URL(location.href).searchParams.get('grp')?.startsWith({json.dumps(name)})")
    page.wait_for_timeout(600)


def detail_open(page: Page) -> bool:
    """駅詳細（デスクトップ＝右の aside・携帯＝シート）が開いているか。"""
    return page.evaluate(
        """() => [...document.querySelectorAll('button.border-b-2')].some((tab) => tab.getBoundingClientRect().width > 0
              && tab.closest('aside:not([aria-hidden="true"]), [data-vaul-drawer]') !== null)"""
    )


def detail_title(page: Page) -> str:
    """駅詳細の見出し（駅名）。"""
    return page.evaluate(
        """() => {
          const tab = [...document.querySelectorAll('button.border-b-2')].find((b) => b.getBoundingClientRect().width > 0);
          const panel = tab?.closest('aside, [data-vaul-drawer]');
          return panel?.querySelector('header h2, header h3, header [class*="text-2xl"], header [class*="text-xl"]')?.textContent?.trim() ?? '';
        }"""
    )


def canvas(page: Page):
    return page.locator('aside[aria-label="キャンバス"]')


def modal(page: Page, title: str):
    return page.get_by_role("dialog", name=title)


def send(page: Page, question: str) -> None:
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


def wait_answered(page: Page) -> None:
    page.get_by_text("東京駅の周辺の人口は増えています").first.wait_for(state="attached", timeout=15_000)
    page.locator('button[aria-label="送信"]').wait_for(state="attached", timeout=15_000)
    page.wait_for_timeout(SETTLE_MS)


def exclude_low_n(scope) -> bool:
    return scope.get_by_label("⚠除外").is_checked()


def ranking_scope_is(scope, label: str) -> bool:
    """表の見出しの範囲（`人口増減率（…）（千葉県・上位）` の「千葉県」）。"""
    return scope.get_by_text(f"（{label}・上位）").count() > 0


# --- 図の入れ物の作り直しと、最初のフレーム ------------------------------------------

DOM_PROBE = """
(() => {
  // 作り直し・幅違いの形は「足して、すぐ外す」ので、足された要素を（外されたあとも）数える。
  // 描かれたフレームでは数えない——1 フレームに満たずに消えると取り逃がす（対照実験で確認）。
  window.__selects = new Set();
  window.__inserted = 0;
  window.__watch = null;
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('select')) window.__selects.add(node);
      for (const el of node.querySelectorAll('select')) window.__selects.add(el);
      const watch = window.__watch;
      if (watch !== null && (node.matches(watch) || node.querySelector(watch) !== null)) window.__inserted += 1;
    }
  }).observe(document, { childList: true, subtree: true });
})();
"""


def selects_added(page: Page, action: Callable[[], None]) -> tuple[int, int]:
    """action のあいだに足された <select> の数と、そのうち残っている数（同じなら作り直していない）。"""
    page.evaluate("() => window.__selects.clear()")
    action()
    page.wait_for_timeout(2_000)
    added, kept = page.evaluate("() => [window.__selects.size, [...window.__selects].filter((el) => el.isConnected).length]")
    return added, kept


def insertions(page: Page, selector: str, action: Callable[[], None]) -> int:
    """action のあいだに、selector の要素が DOM に足された回数（すぐ外されても数える）。"""
    page.evaluate("(selector) => { window.__inserted = 0; window.__watch = selector; }", selector)
    action()
    page.wait_for_timeout(2_000)
    return page.evaluate("() => { window.__watch = null; return window.__inserted; }")


# --- 場面 --------------------------------------------------------------------


def scenario_stations(browser: Browser) -> None:
    print("[駅の移動：東京 → 新宿 → 戻る＝東京 → 戻る＝未選択 → 戻る＝アプリの外 → 進む]")
    session = Session(browser, WIDE)
    session.open(from_blank=True)
    start = session.length()
    pick_station(session.page, "東京")
    pick_station(session.page, "新宿")
    check("駅を 2 回選ぶと履歴が 2 つ増える", session.length() == start + 2, f"{start} → {session.length()}")
    session.back()
    check(
        "戻る＝東京（詳細の見出しも東京）",
        session.params().get("grp") == TOKYO and detail_open(session.page) and detail_title(session.page) == "東京",
        f"{session.params()}／見出し={detail_title(session.page)}",
    )
    session.back()
    check("もう一度戻る＝駅を選ぶ前（詳細は閉じる）", "grp" not in session.params() and not detail_open(session.page), str(session.params()))
    session.forward()
    check("進む＝東京に戻る", session.params().get("grp") == TOKYO and detail_open(session.page), str(session.params()))
    session.back()
    session.page.go_back(wait_until="commit")
    session.page.wait_for_timeout(800)
    check("さらに戻るとアプリの外（最初に開く前のページ）", session.page.url == "about:blank", session.page.url)
    session.page.go_forward(wait_until="commit")
    session.page.wait_for_load_state("networkidle")
    session.page.wait_for_timeout(800)
    session.load_id = session.page.evaluate("() => window.__loadId")  # 外から戻ったので読み直しは正しい
    session.finish("stations")


def scenario_close_detail(browser: Browser) -> None:
    print("[詳細を閉じる → 戻るで開き直せる]")
    session = Session(browser, WIDE)
    session.open()
    pick_station(session.page, "東京")
    session.page.locator('aside button[aria-label="閉じる"]').first.click()
    session.page.wait_for_function("() => !new URL(location.href).searchParams.get('grp')")
    session.page.wait_for_timeout(600)
    check("閉じると詳細が消える", not detail_open(session.page))
    session.back()
    check("戻る＝東京の詳細が開き直す", session.params().get("grp") == TOKYO and detail_open(session.page), str(session.params()))
    session.finish("close-detail")


def scenario_adjustments(browser: Browser) -> None:
    print("[中での調整（タブ・半径・ハザードのレイヤ）は履歴に積まない]")
    session = Session(browser, WIDE)
    session.open(TOKYO_QUERY)
    session.page.wait_for_timeout(1500)
    before = session.length()
    session.page.locator("button.border-b-2", has_text="所得").first.click()
    session.page.get_by_role("button", name="2km", exact=True).first.click()
    session.page.get_by_role("button", name="災害レイヤを開閉").click()
    session.page.locator("li > button[aria-pressed]").first.click()
    session.page.wait_for_timeout(800)
    params = session.params()
    check("タブ・半径・レイヤは URL に書く", params.get("tab") == "income" and params.get("r") == "2000" and "hz" in params, str(params))
    check("履歴の数は変わらない", session.length() == before, f"{before} → {session.length()}")
    session.finish("adjustments")


def scenario_fab_canvas(browser: Browser) -> None:
    print("[FAB の図（広い画面＝キャンバス）：条件を変えて駅を選ぶ → 戻る・戻る・進む]")
    session = Session(browser, WIDE)
    session.open()
    start = session.length()
    session.page.get_by_role("button", name="ランキング").click()
    canvas(session.page).wait_for(state="visible")
    session.page.wait_for_timeout(1500)
    check("FAB のランキングはキャンバスで開く", canvas(session.page).is_visible() and session.params().get("fig") == "ranking", str(session.params()))
    check("開いたら履歴が 1 つ増える", session.length() == start + 1, f"{start} → {session.length()}")
    canvas(session.page).get_by_label("⚠除外").uncheck()
    session.page.wait_for_timeout(1500)
    check("条件を変えると URL に書き戻す（積まない）", session.params().get("figLowN") == "false" and session.length() == start + 1, str(session.params()))
    canvas(session.page).locator("ol li > button, ul li > button").first.click()
    session.page.wait_for_function("() => new URL(location.href).searchParams.get('grp') !== null")
    session.page.wait_for_timeout(SETTLE_MS)
    check("表の駅を選ぶとキャンバスは開いたまま、詳細が開く", canvas(session.page).is_visible() and detail_open(session.page))
    session.back()
    check(
        "戻る＝駅の選択だけ取り消す（キャンバスと変えた条件はそのまま）",
        "grp" not in session.params() and canvas(session.page).is_visible() and not exclude_low_n(canvas(session.page)),
        str(session.params()),
    )
    session.back()
    check("もう一度戻る＝キャンバスが閉じる", not canvas(session.page).is_visible() and "fig" not in session.params(), str(session.params()))
    session.forward()
    canvas(session.page).wait_for(state="visible")
    session.page.wait_for_timeout(1000)
    check("進む＝キャンバスが開き直し、変えた条件（⚠を含める）も戻る", not exclude_low_n(canvas(session.page)), str(session.params()))
    session.finish("fab-canvas")


def scenario_fab_modal(browser: Browser) -> None:
    print("[FAB の図（狭い画面＝モーダル）：条件を変えて駅を選ぶ → 戻る＝モーダルが条件ごと戻る]")
    session = Session(browser, NARROW)
    session.open()
    session.page.get_by_role("button", name="ランキング").click()
    dialog = modal(session.page, "ランキング")
    dialog.wait_for(state="visible")
    session.page.wait_for_timeout(1500)
    check("狭い画面ではモーダルで開く", dialog.is_visible() and not canvas(session.page).is_visible())
    dialog.get_by_label("⚠除外").uncheck()
    session.page.wait_for_timeout(1200)
    before = session.length()
    dialog.locator("ol li > button, ul li > button").first.click()
    session.page.wait_for_function("() => new URL(location.href).searchParams.get('grp') !== null")
    session.page.wait_for_timeout(SETTLE_MS)
    check("駅を選ぶとモーダルは閉じ、詳細が開く（履歴は 1 つ）", not dialog.is_visible() and session.length() == before + 1, f"{before} → {session.length()}")
    session.back()
    dialog = modal(session.page, "ランキング")
    dialog.wait_for(state="visible")
    session.page.wait_for_timeout(1000)
    check("戻る＝モーダルが開き直し、変えた条件も戻る", dialog.is_visible() and not exclude_low_n(dialog) and "grp" not in session.params(), str(session.params()))
    session.back()
    check("もう一度戻る＝モーダルが閉じる", not modal(session.page, "ランキング").is_visible(), str(session.params()))
    session.finish("fab-modal")


def scenario_answer(browser: Browser) -> None:
    print("[AI の回答（駅＋焦点のタブ＋キャンバスの図）は履歴 1 つ・戻る 1 回で回答の前へ]")
    session = Session(browser, WIDE, [answer(with_ranking=True)])
    session.open()
    start = session.length()
    send(session.page, "東京駅の人口推移と、千葉県の人口が増えた駅は？")
    wait_answered(session.page)
    params = session.params()
    check(
        "回答で駅・焦点のタブ・図が開く",
        params.get("grp") == TOKYO and params.get("tab") == "population" and params.get("fig") == "ranking" and canvas(session.page).is_visible(),
        str(params),
    )
    check("積まれた履歴は 1 つ（図の送り直し・キャンバスの自動表示を含めて）", session.length() == start + 1, f"{start} → {session.length()}")
    session.back()
    params = session.params()
    check(
        "戻る 1 回で、駅もタブも図も回答の前に戻る",
        not any(key in params for key in ("grp", "tab", "fig")) and not canvas(session.page).is_visible() and not detail_open(session.page),
        str(params),
    )
    session.page.wait_for_timeout(1500)
    check("戻ったあと、キャンバスが勝手に開き直さない", not canvas(session.page).is_visible())
    session.forward()
    params = session.params()
    check("進む＝駅と図が戻る", params.get("grp") == TOKYO and params.get("fig") == "ranking" and canvas(session.page).is_visible(), str(params))
    session.finish("answer")


def scenario_back_mid_answer(browser: Browser) -> None:
    print("[回答の途中で戻る：送り直しが戻った先の履歴を上書きしない]")
    session = Session(browser, WIDE, [answer(with_ranking=False, delay_ms=STAGE_DELAY_MS)])
    session.open()
    send(session.page, "東京駅の人口推移を教えて")
    session.page.wait_for_function("() => new URL(location.href).searchParams.get('grp') !== null", timeout=15_000)
    session.page.wait_for_timeout(500)
    session.back()
    length = session.length()
    check("1 段目のあとに戻る＝駅を選ぶ前", "grp" not in session.params(), str(session.params()))
    wait_answered(session.page)
    check("続き（図の送り直し）が届いても、駅は出てこない", "grp" not in session.params() and not detail_open(session.page), str(session.params()))
    check("履歴も増えない", session.length() == length, f"{length} → {session.length()}")
    session.finish("back-mid-answer")


def scenario_chip(browser: Browser) -> None:
    print("[⤢ のチップ（狭い画面）：図を開く → 戻るで閉じる]")
    session = Session(browser, NARROW, [answer(with_ranking=True)])
    session.open()
    send(session.page, "千葉県で人口が増えた駅は？")
    wait_answered(session.page)
    check("狭い画面では自動で開かない（チップだけ）", not modal(session.page, "ランキング").is_visible())
    session.page.locator(f'button[title="{RANKING_TABLE["title"]}"]').click()
    dialog = modal(session.page, "ランキング")
    dialog.wait_for(state="visible")
    session.page.wait_for_timeout(800)
    check("チップで図が開く（AI の条件＝千葉県）", session.params().get("figPref") == "千葉県", str(session.params()))
    session.back()
    check("戻る＝図が閉じる", not modal(session.page, "ランキング").is_visible() and "fig" not in session.params(), str(session.params()))
    session.finish("chip")


def scenario_recommend(browser: Browser) -> None:
    print("[おすすめ：開く → 戻るで閉じる → 進むで開き直す]")
    session = Session(browser, WIDE)
    session.open()
    start = session.length()
    session.page.get_by_role("button", name="おすすめ").click()
    dialog = modal(session.page, "おすすめ駅")
    dialog.wait_for(state="visible")
    check("開いたら履歴が 1 つ増える", session.length() == start + 1 and session.params().get("rec") == "true", f"{start} → {session.length()}")
    session.back()
    check("戻る＝閉じる", not modal(session.page, "おすすめ駅").is_visible() and "rec" not in session.params(), str(session.params()))
    session.forward()
    modal(session.page, "おすすめ駅").wait_for(state="visible")
    check("進む＝開き直す", modal(session.page, "おすすめ駅").is_visible())
    session.finish("recommend")


def scenario_shared_link(browser: Browser) -> None:
    print("[共有リンク（?fig と条件つき）を開く＝図が開いた状態で始まる]")
    session = Session(browser, WIDE)
    session.open("?fig=scatter&figX=pop_gr_2020_2015_2km&figY=rate_covid&figLowN=false")
    opened = session.length()
    canvas(session.page).wait_for(state="visible")
    session.page.wait_for_timeout(1500)
    check("散布のキャンバスが開いている", canvas(session.page).is_visible() and canvas(session.page).get_by_text("散布図").first.is_visible())
    check("リンクの条件（⚠を含める）で開く", not exclude_low_n_scatter(canvas(session.page)))
    check(
        "開いただけでは履歴を増やさない（書き戻しは replace）",
        session.length() == opened and session.params().get("figX") == "pop_gr_2020_2015_2km",
        f"{opened} → {session.length()}",
    )
    session.finish("shared-link")


def exclude_low_n_scatter(scope) -> bool:
    return scope.get_by_label("信頼性の低い値（⚠）を除外").is_checked()


def scenario_phone(browser: Browser) -> None:
    print("[携帯：駅の詳細シート → 戻るで閉じる]")
    session = Session(browser, PHONE)
    session.open()
    pick_station(session.page, "東京")
    check("駅を選ぶと詳細シートが開く", detail_open(session.page))
    session.back()
    check("戻る＝シートが閉じる", not detail_open(session.page) and "grp" not in session.params(), str(session.params()))
    session.finish("phone")


def scenario_answer_over_figure(browser: Browser) -> None:
    print("[FAB の図を開いたまま AI に聞く → 回答の図に替わる → 戻る＝FAB の図（変えた条件のまま）]")
    session = Session(browser, WIDE, [answer(with_ranking=True)])
    session.open()
    page = session.page
    page.get_by_role("button", name="ランキング").click()
    canvas(page).wait_for(state="visible")
    page.wait_for_timeout(1500)
    canvas(page).get_by_label("⚠除外").uncheck()
    page.wait_for_timeout(1200)
    start = session.length()
    send(page, "千葉県で人口が増えた駅は？")
    wait_answered(page)
    params = session.params()
    check(
        "キャンバスが回答の図（千葉県・⚠を除外）に替わる",
        params.get("figPref") == "千葉県" and ranking_scope_is(canvas(page), "千葉県") and exclude_low_n(canvas(page)),
        str(params),
    )
    check("積まれた履歴は 1 つ", session.length() == start + 1, f"{start} → {session.length()}")
    session.back()
    params = session.params()
    check(
        "戻る＝FAB の図に戻る（全国・⚠を含める）",
        "figPref" not in params and params.get("figLowN") == "false" and ranking_scope_is(canvas(page), "全国") and not exclude_low_n(canvas(page)),
        str(params),
    )
    session.forward()
    check("進む＝回答の図に戻る", session.params().get("figPref") == "千葉県" and ranking_scope_is(canvas(page), "千葉県"), str(session.params()))
    session.finish("answer-over-figure")


def scenario_single_mount(browser: Browser) -> None:
    print("[図の中身は、外から図が替わったときに 1 回だけ作る（開くたびに 2 回作らない・駅を選んで戻っても作り直さない）]")
    for viewport in (WIDE, NARROW):
        width = viewport["width"]
        session = Session(browser, viewport)
        session.context.add_init_script(DOM_PROBE)
        session.open()
        page = session.page
        added, kept = selects_added(page, lambda: page.get_by_role("button", name="ランキング").click())
        check(f"{width}px：開くと中身を 1 回だけ作る", added > 0 and added == kept, f"足した select {added}・残った {kept}")
        if width >= WIDE["width"]:
            canvas(page).locator("ol li > button, ul li > button").first.click()
            page.wait_for_function("() => new URL(location.href).searchParams.get('grp') !== null")
            page.wait_for_timeout(SETTLE_MS)
            added, _ = selects_added(page, session.back)
            check(f"{width}px：表の駅を選んで戻っても、図は作り直さない（読み足した行を消さない）", added == 0, f"足した select {added}")
            page.locator('button[aria-label="キャンバスを閉じる"]').click()
        else:
            page.keyboard.press("Escape")
        page.wait_for_function("() => !new URL(location.href).searchParams.get('fig')")
        page.wait_for_timeout(600)
        added, kept = selects_added(page, session.back)
        check(f"{width}px：閉じてから戻る＝開き直しても 1 回だけ作る", added > 0 and added == kept, f"足した select {added}・残った {kept}")
        session.finish(f"single-mount-{width}")


def scenario_first_render(browser: Browser) -> None:
    print("[狭い画面・携帯：初めて出す図や詳細を、一瞬も広い画面の形（キャンバス・右ドロワー）で作らない]")
    for viewport in (NARROW, PHONE):
        width = viewport["width"]
        session = Session(browser, viewport)
        session.context.add_init_script(DOM_PROBE)
        session.open()
        page = session.page
        inserted = insertions(page, 'aside[aria-label="キャンバス"]', lambda: page.get_by_role("button", name="ランキング").click())
        check(
            f"{width}px：初めて図を開くとモーダルで開き、キャンバスは一度も作らない",
            inserted == 0 and modal(page, "ランキング").is_visible(),
            f"キャンバスを足した回数 {inserted}",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)
        if width < 640:
            # 携帯の <aside> はどれも広い画面の形（チャット・キャンバス・駅詳細・現在地）。詳細はシートで出す。
            inserted = insertions(page, "aside", lambda: pick_station(page, "東京"))
            check(f"{width}px：初めて駅を選ぶとシートで開き、右ドロワーは一度も作らない", inserted == 0 and detail_open(page), f"aside を足した回数 {inserted}")
        session.finish(f"first-render-{width}")


SCENARIOS: list[Callable[[Browser], None]] = [
    scenario_stations,
    scenario_close_detail,
    scenario_adjustments,
    scenario_fab_canvas,
    scenario_fab_modal,
    scenario_answer,
    scenario_back_mid_answer,
    scenario_chip,
    scenario_recommend,
    scenario_shared_link,
    scenario_phone,
    scenario_answer_over_figure,
    scenario_single_mount,
    scenario_first_render,
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
