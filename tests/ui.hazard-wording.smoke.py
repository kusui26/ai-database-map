#!/usr/bin/env python3
"""メッシュだけの答えに添う 1 文を、**実ブラウザで**確かめる（`docs/260916_ops_guard.md` §7）。

使い方:
    pnpm build && pnpm start -p 3300     # 別プロセスで（.env の SUPABASE_* が要る）
    pip install playwright && playwright install chromium
    python3 tests/ui.hazard-wording.smoke.py [BASE] [出力ディレクトリ]

## なぜユニットで足りないのか

言い方そのものは `tests/mesh-only-wording.test.ts` が固定している。ここで見るのは
**その文が実際に画面へ出るか**——フック・SWR・パネルを通った先である。実際、この検査を
書いたことで `HazardCard.tsx` に直書きされた「**通信できるようになったら**、もう一度
ご確認ください」が見つかった（ユニットでは触れていない行だった）。

## 2 つの場面を、別々の文脈で作る

| | 作り方 | 出るべき文 |
| --- | --- | --- |
| 届かなかった | `/api/hazard/point` を 500 に差し替える（利用者は繋がったまま） | 最新のデータを取得できなかったため |
| オフライン | 読み込み後に `set_offline(True)` | オフラインのため |

⚠ 「災害」という文字は地図のレイヤ切り替えにもある。タブ帯（`div.overflow-x-auto`）の中の
ボタンだけを掴む——`get_by_role("button", name="災害")` は前者を先に拾う（実測）。
"""

import sys
from urllib.parse import quote

from playwright.sync_api import Page, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3300"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
GRP = "亀有#0"
SETTLE_MS = 6000

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("  OK   " if ok else "  FAIL ") + label + (f"  [{detail}]" if detail else ""))
    if not ok:
        failures.append(label)


def hazard_tab(page: Page):
    """駅詳細の「災害」タブ（地図のレイヤ切り替えと同名なので、タブ帯の中から取る）。"""
    return page.locator('div.overflow-x-auto > button:has-text("災害")')


def open_station(page: Page) -> None:
    page.goto(f"{BASE}/?grp={quote(GRP)}", wait_until="domcontentloaded")
    hazard_tab(page).wait_for(timeout=30000)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()

    print("\n[A] 共通API が 500（利用者は繋がっている）")
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    page.route(
        "**/api/hazard/point*",
        lambda route: route.fulfill(
            status=500,
            content_type="application/json",
            body='{"error":{"code":"INTERNAL","message":"検査のために落としています"}}',
        ),
    )
    open_station(page)
    hazard_tab(page).click()
    page.wait_for_timeout(SETTLE_MS)
    body = page.inner_text("body")
    page.screenshot(path=f"{OUT}/wording-unreachable.png")
    check("こちらの不調として書く", "最新のデータを取得できなかったため" in body)
    check("「オフラインのため」とは言わない", "オフラインのため" not in body)
    check("利用者の回線のせいにしない", "通信できるように" not in body)
    check("「安全です」とは言わない", "安全です" not in body)
    context.close()

    print("\n[B] 端末がオフライン")
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    open_station(page)
    context.set_offline(True)
    hazard_tab(page).click()
    page.wait_for_timeout(SETTLE_MS)
    body = page.inner_text("body")
    page.screenshot(path=f"{OUT}/wording-offline.png")
    check("端末がそう言っているので、そう書く", "オフラインのため" in body)
    check("こちらの不調とは言わない", "最新のデータを取得できなかったため" not in body)
    context.close()

    browser.close()

print(f"\n==== {len(failures)} FAILED ====" if failures else "\n==== ALL PASS ====")
sys.exit(1 if failures else 0)
