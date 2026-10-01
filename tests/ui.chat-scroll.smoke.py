#!/usr/bin/env python3
"""チャットの回答が、終わったときに見えていることを実ブラウザで確かめる（2026-10-02）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.chat-scroll.smoke.py [出力ディレクトリ] [BASE]

## きっかけ（docs/261001_fix_user_feedback_ui.md §3）

フィードバック「回答が最後までスクロールされてないケースがあるので、きちんと回答が終わったらそれがみえる
ようにするとよい」。2026-10-01 の本番で、回答を 3 往復すると末尾までの残りが 303 → 1,161 → 2,020px と
増え、駅を選んだ状態では回答の前後でスレッドの見える高さが 488 → 602 → 464px と伸び縮みした。

## 判定

「回答が見えている」＝スレッドが**追従先**にいること。追従先は末尾。ただし質問＋回答が枠より高いときは
質問の頭（の 12px 上）。画面の中で実装（`followScroll.ts`）と同じ式を計算し、scrollTop と突き合わせる。
チャットはページの fetch を差し替え、本番と同じ UI メッセージストリームを返す（届く間隔も作れる）。
"""

import json
import sys
import time
from collections.abc import Callable

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

STREAM_HEADERS = {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache",
}
WIDE = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}
MARGIN_PX = 12
TOLERANCE_PX = 2
SETTLE_TIMEOUT_S = 6.0
STAGE_DELAY_MS = 3_000

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


# --- 回答の差し替え ------------------------------------------------------------


def sse(chunks: list[dict]) -> str:
    return "".join(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks)


def lines_of(index: int, start: int, stop: int) -> str:
    return "\n".join(
        f"{index} 問目の回答の {line} 行目です。駅の周辺のデータについて、少し説明します。" for line in range(start, stop + 1)
    )


RANKING_FIGURE = [
    {
        "type": "data-promotions",
        "id": "promotions",
        "data": [
            {
                "kind": "ranking",
                "metricKey": "pop_gr_2020_2015_1km",
                "order": "desc",
                "prefectures": ["千葉県"],
                "operators": [],
                "routes": [],
                "routeTypes": [],
                "excludeLowN": False,
            }
        ],
    },
    {
        "type": "data-map",
        "id": "map",
        "data": {
            "messages": [],
            "mapActions": [],
            "panels": [
                {
                    "type": "rankingTable",
                    "title": "人口増減率（2015→2020年・1km圏）（千葉県・上位）",
                    "metricKey": "pop_gr_2020_2015_1km",
                    "unit": "%",
                    "rows": [],
                    "placement": "inline",
                    "size": "compact",
                }
            ],
        },
    },
]


def answer(
    index: int,
    lines: int,
    *,
    chip: bool = False,
    split_at: int | None = None,
    delay_ms: int = 0,
) -> dict:
    """1 段目 → delay_ms 待つ → 2 段目。split_at を渡すと本文を途中で区切る（届く途中を作る）。"""
    head = [{"type": "start", "messageId": f"m{index}"}, {"type": "start-step"}, {"type": "text-start", "id": "t1"}]
    tail = [{"type": "text-end", "id": "t1"}, *(RANKING_FIGURE if chip else []), {"type": "finish-step"}, {"type": "finish"}]
    if split_at is None:
        first = head
        second = [{"type": "text-delta", "id": "t1", "delta": lines_of(index, 1, lines)}, *tail]
    else:
        first = [*head, {"type": "text-delta", "id": "t1", "delta": lines_of(index, 1, split_at)}]
        second = [{"type": "text-delta", "id": "t1", "delta": "\n" + lines_of(index, split_at + 1, lines)}, *tail]
    return {"kind": "stream", "first": sse(first), "delayMs": delay_ms, "second": sse(second) + "data: [DONE]\n\n"}


def http_error(status: int, code: str, message: str) -> dict:
    """サーバの失敗の封筒（`{ error: { code, message } }`）をそのまま返す回。"""
    body = json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False)
    return {"kind": "http", "status": status, "body": body}


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
        if (plan.kind === 'http') {{
          return new Response(plan.body, {{ status: plan.status, headers: {{ 'content-type': 'application/json' }} }});
        }}
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


# --- スレッドの読み取り --------------------------------------------------------

BOX_JS = """() => {
  const form = document.querySelector('textarea[aria-label="チャット入力"]')?.closest('form');
  return form?.parentElement?.parentElement?.querySelector('div.overflow-y-auto') ?? null;
}"""

MEASURE_JS = f"""() => {{
  const box = ({BOX_JS})();
  if (!box) return null;
  const questions = box.querySelectorAll('[data-chat-question]');
  const question = questions[questions.length - 1];
  const bottom = Math.max(0, box.scrollHeight - 1 - box.clientHeight);
  const questionTop = question
    ? question.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    : null;
  const target = questionTop === null ? bottom : Math.max(0, Math.min(bottom, questionTop - {MARGIN_PX}));
  return {{
    scrollTop: Math.round(box.scrollTop),
    target: Math.round(target),
    remaining: Math.round(box.scrollHeight - box.clientHeight - box.scrollTop),
    clientHeight: box.clientHeight,
    questionOffset: question ? Math.round(question.getBoundingClientRect().top - box.getBoundingClientRect().top) : null,
    fits: questionTop === null || questionTop - {MARGIN_PX} >= bottom,
  }};
}}"""


def measure(page: Page) -> dict:
    return page.evaluate(MEASURE_JS)


def at_target(state: dict | None) -> bool:
    return state is not None and abs(state["scrollTop"] - state["target"]) <= TOLERANCE_PX


def settle(page: Page) -> dict:
    """なめらかな送りが止まるまで待つ（同じ値が 2 回続いたら止まったとみなす）。"""
    deadline = time.monotonic() + SETTLE_TIMEOUT_S
    previous = measure(page)
    while time.monotonic() < deadline:
        page.wait_for_timeout(150)
        current = measure(page)
        if current == previous and at_target(current):
            return current
        previous = current
    return previous


def jump_button(page: Page):
    return page.get_by_role("button", name="最新の回答へ")


def send(page: Page, question: str) -> None:
    textarea = page.locator('textarea[aria-label="チャット入力"]')
    if not textarea.is_visible():
        page.get_by_role("button", name="AI チャットを開閉（⌘K）").click()
    textarea.wait_for(state="visible")
    textarea.fill(question)
    page.locator('button[aria-label="送信"]').click()


def wait_answered(page: Page, index: int, last_line: int) -> None:
    page.get_by_text(f"{index} 問目の回答の {last_line} 行目です").first.wait_for(state="attached", timeout=15_000)
    page.locator('button[aria-label="送信"]').wait_for(state="attached", timeout=15_000)


def open_page(browser: Browser, viewport: dict, plans: list[dict], **options) -> tuple[BrowserContext, Page, list[str]]:
    context = browser.new_context(viewport=viewport, is_mobile=viewport["width"] < 640, has_touch=viewport["width"] < 640, **options)
    context.add_init_script(chat_script(plans))
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page, errors


def describe(state: dict | None) -> str:
    if state is None:
        return "スレッドが見つからない"
    return f"scrollTop={state['scrollTop']} 追従先={state['target']} 末尾まで残り={state['remaining']}px 枠={state['clientHeight']}px"


# --- 場面 --------------------------------------------------------------------


def scenario_rounds(browser: Browser, viewport: dict, name: str, rounds: int) -> None:
    print(f"[{rounds} 往復：毎回、回答が終わったら末尾まで見えている・{name}]")
    plans = [answer(index, 3, chip=True) for index in range(1, rounds + 1)]
    context, page, errors = open_page(browser, viewport, plans)
    page.goto(BASE, wait_until="networkidle")
    for index in range(1, rounds + 1):
        send(page, f"{index} 問目の質問です")
        wait_answered(page, index, 3)
        page.get_by_title("人口増減率（2015→2020年・1km圏）（千葉県・上位）").nth(index - 1).wait_for(state="attached")
        state = settle(page)
        check(f"{index} 問目：質問＋回答は枠に収まる（前提）", bool(state and state["fits"]), describe(state))
        check(f"{index} 問目：末尾まで見えている（図のチップを含む）", bool(state and state["remaining"] <= 1), describe(state))
    check("「最新の回答へ」は出ない", not jump_button(page).is_visible())
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/chat-scroll-rounds-{name}.png")
    context.close()


def scenario_frame_height(browser: Browser) -> None:
    print("[駅を選んだ状態：回答の前後でスレッドの枠の高さが変わらない（サジェストは押せないだけ）]")
    context, page, errors = open_page(browser, WIDE, [answer(1, 3), answer(2, 3, delay_ms=STAGE_DELAY_MS)])
    page.goto(f"{BASE}/?grp=%E6%9D%B1%E4%BA%AC%230", wait_until="networkidle")
    send(page, "1 問目の質問です")
    wait_answered(page, 1, 3)
    settle(page)
    send(page, "2 問目の質問です")
    page.wait_for_timeout(800)
    waiting = measure(page)
    chip = page.get_by_role("button", name="この駅の人口推移は？")
    chip_disabled = chip.count() > 0 and chip.first.is_disabled()  # 消えている（修正前）なら待たずに落とす
    wait_answered(page, 2, 3)
    done = settle(page)
    check("回答待ちのあいだ、サジェストは押せない（消えない）", chip_disabled)
    check(
        "回答待ちと回答後で、枠の高さが同じ",
        bool(waiting and done and waiting["clientHeight"] == done["clientHeight"]),
        f"待ち {waiting and waiting['clientHeight']}px → 後 {done and done['clientHeight']}px",
    )
    check("回答後、末尾まで見えている", bool(done and done["remaining"] <= 1), describe(done))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_frame_grows(browser: Browser) -> None:
    print("[回答の途中で駅詳細を閉じて枠が広がっても（サジェストが減る）、追従が外れない]")
    # 中身が伸びていない間に枠だけが広がると、ブラウザが詰めたスクロールを「利用者が上へ戻した」と
    # 取り違えて追従が外れうる。1 段目と 2 段目のあいだ（中身が止まっている間）に駅詳細を閉じる。
    plans = [answer(1, 8), answer(2, 8), answer(3, 14, split_at=2, delay_ms=STAGE_DELAY_MS)]
    context, page, errors = open_page(browser, WIDE, plans)
    page.goto(f"{BASE}/?grp=%E6%9D%B1%E4%BA%AC%230", wait_until="networkidle")
    for index in (1, 2):
        send(page, f"{index} 問目の質問です")
        wait_answered(page, index, 8)
        settle(page)
    send(page, "3 問目の質問です")
    page.get_by_text("3 問目の回答の 2 行目です").first.wait_for(state="attached", timeout=15_000)
    before = settle(page)
    check("駅詳細を閉じる前は末尾にいる（前提）", bool(before and before["remaining"] <= 1), describe(before))
    page.locator('button[aria-label="閉じる"]').first.click()
    page.wait_for_function("() => !new URL(location.href).searchParams.get('grp')", timeout=15_000)
    page.wait_for_timeout(800)
    grown = measure(page)
    check(
        "駅詳細を閉じて枠が広がった（前提）",
        bool(before and grown and grown["clientHeight"] > before["clientHeight"]),
        f"{before and before['clientHeight']}px → {grown and grown['clientHeight']}px",
    )
    check("枠が広がっても「最新の回答へ」は出ない（追従したまま）", not jump_button(page).is_visible(), describe(grown))
    wait_answered(page, 3, 14)
    state = settle(page)
    check("続きが届いたら追従先へ送られている", at_target(state), describe(state))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


def scenario_tall(browser: Browser) -> None:
    print("[枠より高い回答：末尾ではなく質問の頭で止まり、回答の頭が見えている]")
    context, page, errors = open_page(browser, WIDE, [answer(1, 2), answer(2, 40)])
    page.goto(BASE, wait_until="networkidle")
    send(page, "1 問目の質問です")
    wait_answered(page, 1, 2)
    settle(page)
    send(page, "2 問目の長い質問です")
    wait_answered(page, 2, 40)
    state = settle(page)
    check("質問＋回答は枠に収まらない（前提）", bool(state and not state["fits"]), describe(state))
    check("追従先（質問の頭）にいる", at_target(state), describe(state))
    offset = None if state is None else state["questionOffset"]
    check("質問の頭が枠の上端の近く（余白 12px）にある", offset is not None and 0 <= offset <= MARGIN_PX * 2, f"枠の上端から {offset}px")
    check("末尾へは送っていない（回答の続きが下にある）", bool(state and state["remaining"] > 100), describe(state))
    check("「最新の回答へ」は出ない（いま最新の回答を見ている）", not jump_button(page).is_visible())
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/chat-scroll-tall.png")
    context.close()


def scenario_escape(browser: Browser) -> None:
    print("[回答の途中で上へスクロールしたら追わない・「最新の回答へ」で戻る・送信したら必ず最新へ]")
    plans = [answer(1, 8), answer(2, 30, split_at=12, delay_ms=STAGE_DELAY_MS), answer(3, 2)]
    context, page, errors = open_page(browser, WIDE, plans)
    page.goto(BASE, wait_until="networkidle")
    send(page, "1 問目の質問です")
    wait_answered(page, 1, 8)
    settle(page)
    send(page, "2 問目の質問です")
    page.get_by_text("2 問目の回答の 12 行目です").first.wait_for(state="attached", timeout=15_000)
    settle(page)
    box = page.evaluate_handle(BOX_JS)
    box.as_element().hover()
    page.mouse.wheel(0, -600)
    page.wait_for_timeout(600)
    before = measure(page)
    check("上へスクロールすると「最新の回答へ」が出る", jump_button(page).is_visible(), describe(before))
    page.get_by_text("2 問目の回答の 30 行目です").first.wait_for(state="attached", timeout=15_000)
    page.wait_for_timeout(1200)
    after = measure(page)
    check(
        "続きが届いても、読んでいる所を奪わない",
        bool(before and after and abs(before["scrollTop"] - after["scrollTop"]) <= TOLERANCE_PX),
        f"{before and before['scrollTop']} → {after and after['scrollTop']}",
    )
    if jump_button(page).is_visible():  # 無い（修正前の画面）ときは押せない＝下の判定で落とす
        jump_button(page).click()
    state = settle(page)
    check("「最新の回答へ」で追従先へ戻る", at_target(state), describe(state))
    check("戻ったらボタンは消える", not jump_button(page).is_visible())
    box.as_element().hover()
    page.mouse.wheel(0, -800)
    page.wait_for_timeout(600)
    send(page, "3 問目の質問です")
    wait_answered(page, 3, 2)
    state = settle(page)
    check("上を読んでいても、送信したら最新の質問と回答が見える", at_target(state) and bool(state and state["remaining"] <= 1), describe(state))
    check("画面のエラーなし", not errors, "; ".join(errors))
    page.screenshot(path=f"{OUT}/chat-scroll-escape.png")
    context.close()


SAMPLER_JS = f"""() => {{
  window.__samples = [];
  const measure = {MEASURE_JS};
  const loop = () => {{ const state = measure(); if (state) window.__samples.push([state.scrollTop, state.target]); requestAnimationFrame(loop); }};
  requestAnimationFrame(loop);
}}"""


def in_between_frames(samples: list[list[int]]) -> int:
    """位置が動いたフレームのうち、追従先に着いていない（途中の）フレームの数。"""
    moved = [current for previous, current in zip(samples, samples[1:]) if current[0] != previous[0]]
    return sum(1 for scroll_top, target in moved if abs(scroll_top - target) > TOLERANCE_PX)


def scenario_motion(browser: Browser, reduced: bool) -> int:
    label = "動きを減らす設定" if reduced else "通常の設定"
    print(f"[{label}：送りの途中のフレームを数える]")
    plans = [answer(1, 10), answer(2, 10), answer(3, 10)]
    context, page, errors = open_page(browser, WIDE, plans, reduced_motion="reduce" if reduced else "no-preference")
    page.goto(BASE, wait_until="networkidle")
    for index in (1, 2):
        send(page, f"{index} 問目の質問です")
        wait_answered(page, index, 10)
        settle(page)
    page.evaluate(SAMPLER_JS)
    send(page, "3 問目の質問です")
    wait_answered(page, 3, 10)
    state = settle(page)
    samples = page.evaluate("() => window.__samples")
    count = in_between_frames(samples)
    check(f"{label}：最後は追従先にいる", at_target(state), describe(state))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()
    print(f"  途中のフレーム {count} 枚（全 {len(samples)} フレーム）")
    return count


def scenario_reduced_motion(browser: Browser) -> None:
    animated = scenario_motion(browser, reduced=False)
    reduced = scenario_motion(browser, reduced=True)
    check("通常の設定ではなめらかに送る（途中のフレームがある＝この数え方で見分けられる）", animated > 0, f"{animated} 枚")
    check("動きを減らす設定では一度に送る（途中のフレームが無い）", reduced == 0, f"{reduced} 枚")


def scenario_error(browser: Browser) -> None:
    print("[失敗の知らせも、出たときに見えている]")
    plans = [
        answer(1, 6),
        answer(2, 6),
        http_error(429, "RATE_LIMITED", "リクエストが多すぎます。37秒後に再試行してください。"),
    ]
    context, page, errors = open_page(browser, WIDE, plans)
    page.goto(BASE, wait_until="networkidle")
    for index in (1, 2):
        send(page, f"{index} 問目の質問です")
        wait_answered(page, index, 6)
        settle(page)
    send(page, "3 問目の質問です")
    alert = page.locator('[role="alert"]').filter(has_text="リクエストが多すぎます")
    alert.wait_for(state="attached", timeout=15_000)
    state = settle(page)
    visible = page.evaluate(
        f"""() => {{
          const box = ({BOX_JS})();
          const alert = [...document.querySelectorAll('[role="alert"]')].find((element) => element.textContent.includes('リクエストが多すぎます'));
          if (!box || !alert) return false;
          return alert.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1;
        }}"""
    )
    check("失敗の知らせが枠の中に見えている", visible, describe(state))
    check("画面のエラーなし", not errors, "; ".join(errors))
    context.close()


SCENARIOS: list[Callable[[Browser], None]] = [
    lambda browser: scenario_rounds(browser, WIDE, "wide", 3),
    lambda browser: scenario_rounds(browser, PHONE, "phone", 2),
    scenario_frame_height,
    scenario_frame_grows,
    scenario_tall,
    scenario_escape,
    scenario_reduced_motion,
    scenario_error,
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
