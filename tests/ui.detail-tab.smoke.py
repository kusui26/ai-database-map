#!/usr/bin/env python3
"""駅詳細のタブを覚えること、チャットが聞かれたタブで駅詳細を開くことを、実ブラウザで確かめる（2026-10-02）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.detail-tab.smoke.py [出力ディレクトリ] [BASE]

## きっかけ（docs/261001_fix_user_feedback_ui.md §2・§4）

1. 駅を替えるたびに乗降客数タブへ戻った（「同じ項目を見たいので、ブラウザに覚えておいてほしい」）
2. 「東京駅の人口推移を教えて」に、ドロワーが乗降客数タブで開いた（人口のグラフはチップを押すまで出ない）
3. 将来推計人口に焦点を当てた駅詳細を ⤢ で開くと、どのタブも選ばれず「データがありません」と出た

## やり方

タブは URL（`?tab`）→ この端末の記憶（localStorage）→ 概要（2026-10-09 B4 までは乗降客数）、の順で決まる。判定は、選ばれているタブ
（タブ帯の下線）と URL の両方で行う。チャットは `/api/chat` を差し替え、本番と同じ並び
（data-promotions → data-map、ツールが成功するたびに送り直し）を返す。回答の途中で利用者がタブを替える
場面だけは、届く間隔を空けたいので、ページの fetch を差し替えて 2 回に分けて流す。
"""

import json
import sys
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

STORAGE_KEY = "ai-database-map:detail-tab"
TOKYO = "東京#0"
STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
WIDE = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}
WAIT_MS = 15_000
STAGE_DELAY_MS = 3_000

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# --- チャットの差し替え（本番と同じ並び） ------------------------------------


def sse(chunks: list[dict]) -> str:
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)


def figures(category: str | None, text: str | None) -> list[dict]:
    """駅詳細の図（駅カード＋本文のグラフ）。条件（data-promotions）を図（data-map）より先に送る。"""
    card = {
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
    trend = {
        "type": "trendChart",
        "title": "人口の推移",
        "unit": "人",
        "format": "int",
        "flags": [],
        "series": [{"label": "実績", "points": [{"x": 2020, "y": 4248}]}],
        "placement": "inline",
        "size": "compact",
    }
    actions = [
        {"type": "flyTo", "lon": 139.7671, "lat": 35.6812, "zoom": 12},
        {"type": "selectStation", "grp": TOKYO, "radiusM": 1000},
    ]
    messages = [] if text is None else [{"role": "assistant", "text": text}]
    return [
        {"type": "data-promotions", "id": "promotions", "data": [{"kind": "detail", "grp": TOKYO, "category": category}, None]},
        {"type": "data-map", "id": "map", "data": {"messages": messages, "mapActions": actions, "panels": [card, trend]}},
    ]


def detail_answer_parts(category: str | None) -> tuple[str, str]:
    """1 段目＝ツールの成功（図を先に送る）、2 段目＝本文と送り直し。サーバと同じく 2 回送る。"""
    text = "東京駅の周辺のデータです。地図とグラフをご覧ください。"
    first = sse([{"type": "start", "messageId": "smoke"}, {"type": "start-step"}, *figures(category, None), {"type": "finish-step"}])
    second = sse(
        [
            {"type": "start-step"},
            {"type": "text-start", "id": "t1"},
            {"type": "text-delta", "id": "t1", "delta": text},
            {"type": "text-end", "id": "t1"},
            *figures(category, text),
            {"type": "finish-step"},
            {"type": "finish"},
        ]
    )
    return first, second + "data: [DONE]\n\n"


def stub_chat(page: Page, category: str | None) -> None:
    first, second = detail_answer_parts(category)
    page.route("**/api/chat", lambda route: route.fulfill(status=200, headers=STREAM_HEADERS, body=first + second))


def staged_chat_script(category: str) -> str:
    """回答を 2 回に分けて流す fetch（あいだに利用者がタブを替える時間を作る）。"""
    first, second = detail_answer_parts(category)
    return f"""
    (() => {{
      const original = window.fetch.bind(window);
      const parts = {json.dumps([first, second], ensure_ascii=False)};
      window.fetch = async (input, init) => {{
        const url = typeof input === 'string' ? input : input.url;
        if (!url.includes('/api/chat')) return original(input, init);
        const encoder = new TextEncoder();
        const body = new ReadableStream({{
          async start(controller) {{
            controller.enqueue(encoder.encode(parts[0]));
            await new Promise((resolve) => setTimeout(resolve, {STAGE_DELAY_MS}));
            controller.enqueue(encoder.encode(parts[1]));
            controller.close();
          }},
        }});
        return new Response(body, {{ status: 200, headers: {json.dumps(STREAM_HEADERS)} }});
      }};
    }})();
    """


# --- 画面の読み取り・操作 ----------------------------------------------------

ACTIVE_TAB_JS = """() => {
  const active = [...document.querySelectorAll('button.border-b-2')].find((b) => b.className.includes('border-indigo-600'));
  return active ? active.textContent.trim() : '(なし)';
}"""


def active_tab(page: Page) -> str:
    return page.evaluate(ACTIVE_TAB_JS)


def wait_for_tab(page: Page, label: str) -> bool:
    """選ばれているタブが label になるまで待つ（固定の待ち時間で判定しない）。"""
    try:
        page.wait_for_function(f"() => ({ACTIVE_TAB_JS})() === {json.dumps(label)}", timeout=WAIT_MS)
        return True
    except Exception:  # noqa: BLE001 — 待ちきれなかったことを判定に使う
        return False


def params(page: Page) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(urlparse(page.url).query).items()}


def click_tab(page: Page, label: str) -> None:
    page.locator("button.border-b-2", has_text=label).first.click()


def tab_visible_in_strip(page: Page, label: str) -> bool:
    """選んだタブが帯の見えている範囲に収まっているか（末尾の災害タブは既定で隠れている）。"""
    return page.evaluate(
        """(label) => {
          const tab = [...document.querySelectorAll('button.border-b-2')].find((b) => b.textContent.trim() === label);
          if (!tab) return false;
          const strip = tab.parentElement.getBoundingClientRect();
          const box = tab.getBoundingClientRect();
          return box.left >= strip.left - 1 && box.right <= strip.right + 1;
        }""",
        label,
    )


def search_and_select(page: Page, name: str) -> None:
    box = page.get_by_placeholder("駅名で検索…")
    box.click()
    box.fill(name)
    page.locator("[cmdk-item]").first.wait_for(state="visible", timeout=WAIT_MS)
    page.locator("[cmdk-item]").first.click()
    page.wait_for_function(f"() => new URL(location.href).searchParams.get('grp')?.startsWith({json.dumps(name)})", timeout=WAIT_MS)


def send_chat(page: Page, question: str) -> None:
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


def detail_text(page: Page) -> str:
    """駅詳細のパネル全体の文字（ヘッダ・タブ帯・本文）。"""
    return page.evaluate(
        """() => {
          const tab = document.querySelector('button.border-b-2');
          return (tab?.closest('aside') ?? tab?.closest('[data-vaul-drawer]'))?.innerText ?? '';
        }"""
    )


# --- 場面 --------------------------------------------------------------------


def open_page(browser: Browser, viewport: dict, remembered: str | None = None) -> tuple[BrowserContext, Page, list[str]]:
    context = browser.new_context(viewport=viewport, is_mobile=viewport["width"] < 640, has_touch=viewport["width"] < 640)
    if remembered is not None:
        context.add_init_script(f"localStorage.setItem({json.dumps(STORAGE_KEY)}, {json.dumps(remembered)})")
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page, errors


def goto(page: Page, query: str = "") -> None:
    page.goto(f"{BASE}/{query}", wait_until="networkidle")


def scenario_switch_station(browser: Browser) -> None:
    print("[駅を替えても・閉じて開き直しても・リロードしても、選んだタブのまま]")
    context, page, errors = open_page(browser, WIDE)
    goto(page, "?grp=%E6%9D%B1%E4%BA%AC%230")
    check("記憶が無ければ概要で開く（B4）", wait_for_tab(page, "概要"), f"タブ={active_tab(page)}")
    click_tab(page, "所得")
    check("所得を選ぶと URL に tab=income", wait_for_tab(page, "所得") and params(page).get("tab") == "income", page.url)
    search_and_select(page, "新宿")
    check("新宿に替えても所得のまま", wait_for_tab(page, "所得"), f"タブ={active_tab(page)}／{params(page)}")
    page.reload(wait_until="networkidle")
    check("リロードしても所得のまま", wait_for_tab(page, "所得"), f"タブ={active_tab(page)}")
    page.locator('button[aria-label="閉じる"]').first.click()
    page.wait_for_function("() => !new URL(location.href).searchParams.get('grp')", timeout=WAIT_MS)
    search_and_select(page, "渋谷")
    check("閉じて別の駅を開いても所得のまま", wait_for_tab(page, "所得"), f"タブ={active_tab(page)}")
    stored = page.evaluate(f"() => localStorage.getItem({json.dumps(STORAGE_KEY)})")
    check("この端末にも所得を覚えている", stored == "income", f"localStorage={stored}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/detail-tab-switch.png")
    context.close()


def scenario_remembered(browser: Browser) -> None:
    print("[URL にタブが無いときは、この端末で最後に見たタブ]")
    context, page, errors = open_page(browser, WIDE, remembered="land_price")
    goto(page, "?grp=%E6%9D%B1%E4%BA%AC%230")
    check("記憶した地価で開く", wait_for_tab(page, "地価"), f"タブ={active_tab(page)}")
    check("開いただけでは URL に書かない", "tab" not in params(page), page.url)
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_link(browser: Browser) -> None:
    print("[共有リンクの ?tab が記憶より優先・末尾の災害タブは帯を送って見せる]")
    context, page, errors = open_page(browser, WIDE, remembered="income")
    goto(page, "?grp=%E6%9D%B1%E4%BA%AC%230&tab=hazard")
    check("リンクの災害タブで開く（記憶の所得より優先）", wait_for_tab(page, "災害"), f"タブ={active_tab(page)}")
    page.wait_for_timeout(800)  # 帯を送るのはなめらかなスクロール
    check("災害タブが帯の見える範囲にある", tab_visible_in_strip(page, "災害"))
    stored = page.evaluate(f"() => localStorage.getItem({json.dumps(STORAGE_KEY)})")
    check("リンクを開いただけでは記憶を書き換えない", stored == "income", f"localStorage={stored}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/detail-tab-link-hazard.png")
    context.close()


def scenario_invalid(browser: Browser) -> None:
    print("[知らない ?tab は無いのと同じ（既定の概要）]")
    context, page, errors = open_page(browser, WIDE)
    goto(page, "?grp=%E6%9D%B1%E4%BA%AC%230&tab=population_forecast")
    check("将来推計人口（タブではない）は概要に倒す", wait_for_tab(page, "概要"), f"タブ={active_tab(page)}")
    goto(page, "?grp=%E6%9D%B1%E4%BA%AC%230&tab=xyz")
    check("でたらめな値も概要に倒す", wait_for_tab(page, "概要"), f"タブ={active_tab(page)}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_chat_focus(browser: Browser, viewport: dict, name: str) -> None:
    print(f"[チャット：「東京駅の人口推移」は人口タブで開く・{name}]")
    context, page, errors = open_page(browser, viewport)
    stub_chat(page, "population")
    goto(page)
    send_chat(page, "東京駅の人口推移を教えて")
    if viewport["width"] < 640:
        # 携帯：詳細のシートはチャットを覆うので、AI の選択では開かない（A4・§4.4(b)）。⤢ で聞いたタブのまま開く。
        page.wait_for_function("() => new URL(location.href).searchParams.get('sheet') === 'closed'", timeout=WAIT_MS)
        check("携帯ではシートを自動で開かない（回答を覆わない）", active_tab(page) == "(なし)", f"タブ={active_tab(page)}")
        page.get_by_role("button", name="東京 の人口 を拡大").click()
    check("駅詳細は人口タブで開く（携帯は会話の中の ⤢ から）", wait_for_tab(page, "人口"), f"タブ={active_tab(page)}")
    check("URL は駅と焦点のタブ", params(page).get("grp") == TOKYO and params(page).get("tab") == "population", str(params(page)))
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/detail-tab-chat-{name}.png")
    context.close()


def scenario_chat_no_focus(browser: Browser) -> None:
    print("[チャット：焦点の無い駅詳細（駅の概要）は、覚えたタブのまま開く]")
    context, page, errors = open_page(browser, WIDE, remembered="income")
    stub_chat(page, None)
    goto(page)
    send_chat(page, "東京駅について教えて")
    check("覚えた所得で開く", wait_for_tab(page, "所得"), f"タブ={active_tab(page)}")
    check("焦点が無いので URL にタブを書かない", "tab" not in params(page), str(params(page)))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_forecast(browser: Browser) -> None:
    print("[チャット：将来推計人口の焦点は人口タブ（チップの ⤢ でも）]")
    context, page, errors = open_page(browser, WIDE)
    stub_chat(page, "population_forecast")
    goto(page)
    send_chat(page, "東京駅の将来推計人口を見せて")
    check("自動で開いたドロワーは人口タブ", wait_for_tab(page, "人口"), f"タブ={active_tab(page)}")
    click_tab(page, "バス")
    wait_for_tab(page, "バス")
    # チップの文言は聞いたこと（将来推計人口）。開くのは人口タブ（A4 でチップに焦点を足した）。
    page.locator('button[title="東京 の将来推計人口"]').click()
    check("チップの ⤢ でも人口タブへ戻る", wait_for_tab(page, "人口"), f"タブ={active_tab(page)}")
    text = detail_text(page)
    check("「データがありません」を出さない", "データがありません" not in text, text[:80].replace("\n", " "))
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/detail-tab-forecast.png")
    context.close()


def scenario_streaming(browser: Browser) -> None:
    print("[チャット：回答の途中で替えたタブを、条件の送り直しで戻さない・次の質問では当て直す]")
    context, page, errors = open_page(browser, WIDE)
    context.add_init_script(staged_chat_script("population"))
    goto(page)
    send_chat(page, "東京駅の人口推移を教えて")
    check("1 段目で人口タブ", wait_for_tab(page, "人口"), f"タブ={active_tab(page)}")
    click_tab(page, "所得")
    wait_for_tab(page, "所得")
    page.wait_for_timeout(STAGE_DELAY_MS + 1500)  # 2 段目（同じ焦点の送り直し）が届き終わるまで
    check("送り直しが届いても所得のまま", active_tab(page) == "所得", f"タブ={active_tab(page)}")
    page.locator('button[aria-label="送信"]').wait_for(state="visible", timeout=WAIT_MS)
    send_chat(page, "東京駅の人口推移をもう一度")
    check("次の質問では焦点を当て直す（人口）", wait_for_tab(page, "人口"), f"タブ={active_tab(page)}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_hazard_badge(browser: Browser) -> None:
    print("[災害バッジから災害タブ → 駅を替えても災害タブ]")
    context, page, errors = open_page(browser, WIDE)
    goto(page, "?grp=%E4%BA%80%E6%9C%89%230")  # 亀有（浸水の想定がある駅）
    page.get_by_role("button", name="詳しく見る").first.click()
    check("バッジで災害タブ", wait_for_tab(page, "災害"), f"タブ={active_tab(page)}")
    search_and_select(page, "新宿")
    check("駅を替えても災害タブ", wait_for_tab(page, "災害"), f"タブ={active_tab(page)}")
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


SCENARIOS: list[Callable[[Browser], None]] = [
    scenario_switch_station,
    scenario_remembered,
    scenario_link,
    scenario_invalid,
    lambda browser: scenario_chat_focus(browser, WIDE, "wide"),
    lambda browser: scenario_chat_focus(browser, PHONE, "phone"),
    scenario_chat_no_focus,
    scenario_forecast,
    scenario_streaming,
    scenario_hazard_badge,
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for run in SCENARIOS:
        run(browser)
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
