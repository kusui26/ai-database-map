#!/usr/bin/env python3
"""おすすめ駅の画面をヘッドレスで実レンダして確かめる（W4・W5 の受け入れ・260912 §13.7）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（.env の SUPABASE_* が要る）
    pip install playwright && playwright install chromium
    python3 tests/ui.recommend.smoke.py [出力ディレクトリ] [BASE]

見るのは見た目の好みではなく、**順位と一緒に必ず出るもの**（§13.4 の規範 6 項目）と、
**空振りのときに次の一手が出るか**、**共有リンクで同じ条件が再現するか**。

⚠ 地図のハイライトは**スクリーンショットの画素**で見る。WebGL の描画バッファは提示後に
破棄されるので `gl.readPixels` では読めない（実測：常に 0 になる）。
"""

import random
import re
import sys
from urllib.parse import quote

import numpy as np
from PIL import Image
from playwright.sync_api import Page, sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

RESULTS = r"text=/候補 \d+ 駅 → 順位 \d+ 駅/"

# この検査は 1 回で 15 前後のリクエストを投げる。/api/recommend は IP あたり 30 件/分なので、
# 続けて走らせると 429 で落ちる——**画面の検査が、画面と関係ない理由で赤くなる**。
# 走るたびに別の IP を名乗って、レート制限そのものは `tests/api.smoke.sh` の担当にする。
HEADERS = {"x-real-ip": f"127.0.{random.randint(1, 254)}.{random.randint(1, 254)}"}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(("  OK   " if condition else "  FAIL ") + label + (f"  [{detail}]" if detail else ""))
    if not condition:
        failures.append(label)


def section(title: str) -> None:
    print(f"\n[{title}]")


def accent_pixels(path: str) -> int:
    """ハイライトの色（MapLibre の ACCENT_COLOR）に近い画素を数える。"""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(int)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    return int(np.count_nonzero((b > 140) & (b - r > 50) & (b - g > 30)))


def appears(page: Page, selector: str, timeout_ms: int = 15000) -> bool:
    """その要素が出てくるまで待つ（固定の sleep で待つと、遅い日に赤くなる）。"""
    try:
        page.wait_for_selector(selector, timeout=timeout_ms)
        return True
    except Exception:
        return False


def found(pattern: str, text: str) -> str:
    matched = re.search(pattern, text)
    return matched.group(0) if matched else ""


def share_url(**params: str) -> str:
    """共有リンクを組み立てる（`rec=true` で開いた状態から始まる）。"""
    query = "&".join(f"{key}={quote(value)}" for key, value in params.items())
    return f"{BASE}/?rec=true&{query}"


def open_shared(page: Page, **params: str) -> str:
    """共有リンクを踏んで、結果が出るまで待つ。戻り値は画面のテキスト。"""
    # `networkidle` は地図タイルの読み込みで待ち続けることがあるので使わない。
    page.goto(share_url(**params), wait_until="domcontentloaded")
    page.wait_for_selector("text=おすすめ駅", timeout=20000)
    page.wait_for_timeout(3000)
    return page.inner_text("body")


def check_norms(body: str, label: str) -> None:
    """§13.4 の規範——順位と一緒に必ず出るもの。"""
    check(f"{label}：候補集合", found(r"候補 \d+ 駅 → 順位 \d+ 駅", body) != "",
          found(r"候補 \d+ 駅 → 順位 \d+ 駅", body))
    check(f"{label}：正規化の方法", "パーセンタイル" in body or "min-max" in body)
    check(f"{label}：重みと向き", re.search(r"\d+%", body) is not None and "高いほど良い" in body)
    check(f"{label}：除外件数", found(r"除外 \d+ 駅", body) != "" or "除外" not in body)
    check(f"{label}：敏感度", ("頑健" in body) or ("僅差" in body))
    check(f"{label}：限界", "この結果の限界" in body and "候補が変われば順位も変わります" in body)
    check(f"{label}：出典", "国土数値情報" in body)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900}, extra_http_headers=HEADERS)

    # --- 1) FAB から組み立てる ------------------------------------------------
    section("操作して組み立てる")
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("button", name="おすすめ").click()
    page.wait_for_selector("text=おすすめ駅", timeout=10000)
    check("エリア未選択では順位を出さない",
          page.get_by_text("都道府県・市区町村・路線のいずれかを選んでください").is_visible())
    page.screenshot(path=f"{OUT}/01-open.png")

    page.get_by_label("都道府県").click()
    page.get_by_text("神奈川県", exact=True).click()
    # Escape はモーダルごと閉じてしまうので、見出しを押してポップオーバーだけ閉じる。
    page.get_by_text("おすすめ駅", exact=True).click()
    page.wait_for_timeout(300)
    select = page.get_by_label("市区町村")
    select.wait_for(state="visible", timeout=10000)
    # 選択肢は駅一覧を取ってから組み立てる。届く前に読むと「読み込み中…」だけが見える。
    page.wait_for_selector(
        'select[aria-label="市区町村"] option[value="横浜市"]', state="attached", timeout=20000
    )
    options = select.locator("option").all_text_contents()
    check("市区町村は実データから出る", any("横浜市（全区）" in o for o in options), f"{len(options)} 件")
    check("選ぶ前に候補の大きさが分かる", any(re.search(r"\d+ 駅", o) for o in options))
    select.select_option("横浜市")
    page.wait_for_selector(RESULTS, timeout=30000)
    page.wait_for_timeout(800)
    body = page.inner_text("body")
    page.screenshot(path=f"{OUT}/02-results.png")

    # --- 2) 規範 6 項目 -------------------------------------------------------
    section("順位と一緒に必ず出るもの")
    check_norms(body, "横浜市")
    check("エリアの名前が出る", "横浜市" in body)
    check("凡例は短い名前", "将来人口" in body)
    check("使った指標の限界が出る", "地価公示" in body)
    check("災害の扱いが出る", "候補から外しました" in body or "段階減点" in body)
    check("表が切れていることを言う", "順位が付いたのは" in body,
          found(r"上位 \d+ 駅を表示しています（順位が付いたのは \d+ 駅）", body))
    verdict_at = max(body.find("頑健"), body.find("僅差"))
    check("敏感度は表より前（順位全体にかかる断りなので）", 0 <= verdict_at < body.find("この結果の限界"))

    rows = page.locator("ol li button")
    check("表に行がある", rows.count() > 0, f"{rows.count()} 行")
    first = rows.first.inner_text().replace("\n", " ")
    check("行に順位・駅名・スコアが出る", re.search(r"\d\s*\S+.*0\.\d{3}", first) is not None, first[:60])
    check("内訳の帯がある", page.locator("ol li button div[aria-hidden='true'] div").count() > 0)

    # --- 3) ⚠ の見せ方 --------------------------------------------------------
    section("⚠ の見せ方")
    check("⚠ が何かを、印と同じ画面で言う", "値が信用できない指標がある駅です" in body,
          found(r"⚠ は[^\n]*（表示中 \d+ 駅）", body))
    marks = page.locator("ol li button span[aria-label*='信用できません']")
    check("⚠ はどの指標かまで言う", marks.count() > 0, f"{marks.count()} 件")
    if marks.count() > 0:
        check("⚠ の説明に指標名が入る", "の値が信用できません" in (marks.first.get_attribute("aria-label") or ""),
              marks.first.get_attribute("aria-label") or "")

    # --- 4) 重みは利用者のもの -------------------------------------------------
    section("重みを動かす")
    page.get_by_text("重みを調整", exact=False).click()
    sliders = page.locator("input[type=range]")
    check("重みスライダが 6 本", sliders.count() == 6, f"{sliders.count()} 本")
    before = rows.first.inner_text()
    sliders.nth(0).fill("1")
    check("重みを変えたことが画面に出る", appears(page, "text=重みを変更"))
    page.wait_for_timeout(1200)
    check("重みを変えると結果が変わる", before != page.locator("ol li button").first.inner_text())
    page.screenshot(path=f"{OUT}/03-weights.png")

    # --- 5) 共有リンク --------------------------------------------------------
    section("共有リンク")
    page.get_by_text("既定に戻す").click()
    page.wait_for_timeout(2000)
    url = page.url
    check("条件が URL に載る", "rec=true" in url and "recMuni=" in url, url.split("?")[-1][:90])
    check("既定は URL に載せない", "recNorm=" not in url and "recFlag=" not in url)
    top_before = page.locator("ol li button").first.inner_text().split("\n")[0]

    shared = browser.new_page(viewport={"width": 1280, "height": 900}, extra_http_headers=HEADERS)
    shared.goto(url, wait_until="networkidle")
    shared.wait_for_selector(RESULTS, timeout=30000)
    shared.wait_for_timeout(1200)
    check("リンクを踏むと開いた状態で始まる", shared.get_by_text("おすすめ駅", exact=True).is_visible())
    check("同じ条件・同じ順位になる",
          shared.locator("ol li button").first.inner_text().split("\n")[0] == top_before,
          f"{top_before}")
    shared.screenshot(path=f"{OUT}/04-shared.png")
    shared.close()

    # --- 6) 地図のハイライト ---------------------------------------------------
    section("地図のハイライト")
    page.get_by_role("button", name="閉じる").click()
    page.wait_for_timeout(3000)
    page.screenshot(path=f"{OUT}/05-map.png")
    check("地図に上位の印が出る", accent_pixels(f"{OUT}/05-map.png") > 200,
          f"{accent_pixels(f'{OUT}/05-map.png')} px")

    page.get_by_role("button", name="おすすめ").click()
    page.wait_for_selector(RESULTS, timeout=30000)
    check("開き直しても条件が残る", "横浜市" in page.inner_text("body"))
    page.locator("ol li button").first.click()
    page.wait_for_timeout(1500)
    check("駅を選ぶと URL に載る", "grp=" in page.url)
    check("モーダルが閉じる", not page.get_by_text("この結果の限界").is_visible())

    # --- 7) 空振りの言い方 -----------------------------------------------------
    section("空振りの言い方")
    empty = open_shared(page, recPref="神奈川県", recMuni="箱根町", recRoutes="東海道線")
    check("0 件：どこで空振りしたかを言う", "当てはまる駅がありませんでした" in empty)
    check("0 件：路線を外すよう言う", "路線・会社・種別の指定を外すと" in empty)
    page.screenshot(path=f"{OUT}/06-empty.png")

    excluded = open_shared(page, recPref="東京都", recMuni="世田谷区", recLevel="caution")
    check("全除外：候補はあったと言う", "すべて候補から外れました" in excluded,
          found(r"候補 \d+ 駅は、すべて候補から外れました。", excluded))
    check("全除外：1 段緩める先を名指しする", "「注意」から「警戒」に緩める" in excluded)
    check("全除外：段階減点という手も出す", "「段階減点」にすると" in excluded)
    check("全除外：除外の内訳は出したまま", found(r"除外 \d+ 駅（災害 \d+）", excluded) != "")
    # 0 駅で「頑健」は嘘になる（振っても変わらないのは並べる相手がいないから）。
    check("全除外：順位の頑健さを主張しない",
          "頑健" not in excluded and "比べる相手がいません" in excluded)
    page.screenshot(path=f"{OUT}/07-all-excluded.png")

    thin = open_shared(page, recPref="神奈川県", recMuni="二宮町", recHazard="off")
    check("少なすぎ：1 駅の「1 位」を順位と呼ばない", "順位が付いたのは 1 駅だけです" in thin)
    check("少なすぎ：相対評価だからだと言う", "相対評価" in thin)
    page.screenshot(path=f"{OUT}/08-thin.png")

    # --- 8) 3 エリアを通す（§13.7 W5 の受け入れ） -------------------------------
    section("3 エリア")
    for pref, muni in (("神奈川県", "横浜市"), ("東京都", "世田谷区"), ("北海道", "札幌市")):
        text = open_shared(page, recPref=pref, recMuni=muni)
        check_norms(text, muni)
        count = found(r"候補 \d+ 駅 → 順位 \d+ 駅", text)
        check(f"{muni}：順位が出る", page.locator("ol li button").count() > 0, count)
    page.screenshot(path=f"{OUT}/09-sapporo.png")

    # --- 9) モバイル -----------------------------------------------------------
    section("モバイル（390px）")
    mobile = browser.new_page(
        viewport={"width": 390, "height": 844}, device_scale_factor=2, extra_http_headers=HEADERS
    )
    mobile.goto(share_url(recPref="神奈川県", recMuni="横浜市"), wait_until="networkidle")
    mobile.wait_for_selector(RESULTS, timeout=30000)
    mobile.wait_for_timeout(1200)
    overflow = mobile.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    check("横スクロールが出ない", overflow == 0, f"{overflow} px")
    # 条件は畳まれ、結果がすぐ見える（つまみで画面が埋まらない）。
    check("結果が出たら条件は畳まれる", mobile.get_by_text("条件を変える").is_visible())
    first_row = mobile.locator("ol li button").first.bounding_box()
    check("1 位がスクロールなしで見える", first_row is not None and first_row["y"] < 844,
          f"y={first_row['y'] if first_row else 'なし'}")
    mobile.screenshot(path=f"{OUT}/10-mobile.png")

    mobile.get_by_text("条件を変える").click()
    mobile.wait_for_timeout(300)
    budget = mobile.get_by_role("button", name="予算重視")
    budget.scroll_into_view_if_needed()
    budget.click()
    mobile.wait_for_timeout(2500)
    check("端のペルソナにも手が届く", "安いほど良い" in mobile.inner_text("body"))
    # 省略記号は inner_text に出ないので、**実寸**で切れていないかを見る。
    clipped = mobile.evaluate("""() => {
      const span = document.querySelector('ol li button div span.min-w-0');
      return span === null ? -1 : span.scrollWidth - span.clientWidth;
    }""")
    check("駅名が切れない（実寸で確認）", clipped == 0, f"はみ出し {clipped}px")
    lines = [line for line in mobile.locator("ol li button").first.inner_text().split("\n") if line]
    check("市区町村は 2 行目に落ちている", re.search(r"[市区町村]$", lines[-1]) is not None,
          " / ".join(lines))
    mobile.screenshot(path=f"{OUT}/11-mobile-controls.png")
    mobile.close()

    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
