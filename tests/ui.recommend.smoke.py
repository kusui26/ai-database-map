#!/usr/bin/env python3
"""おすすめ駅の画面をヘッドレスで実レンダして確かめる（W4 の受け入れ・260912 §13.7）。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで（.env の SUPABASE_* が要る）
    pip install playwright && playwright install chromium
    python3 tests/ui.recommend.smoke.py [出力ディレクトリ] [BASE]

見るのは見た目の好みではなく、**順位と一緒に必ず出るもの**——候補集合・正規化の方法・重み・
除外件数・敏感度・限界・出典（§13.4 の規範 6 項目）。どれか 1 つでも画面から消えたら落ちる。

⚠ 地図のハイライトは**スクリーンショットの画素**で見る。WebGL の描画バッファは提示後に
破棄されるので `gl.readPixels` では読めない（実測：常に 0 になる）。
"""

import re
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(("  OK   " if condition else "  FAIL ") + label + (f"  [{detail}]" if detail else ""))
    if not condition:
        failures.append(label)


def accent_pixels(path: str) -> int:
    """ハイライトの色（MapLibre の ACCENT_COLOR）に近い画素を数える。"""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(int)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    return int(np.count_nonzero((b > 140) & (b - r > 50) & (b - g > 30)))


def found(pattern: str, text: str) -> str:
    matched = re.search(pattern, text)
    return matched.group(0) if matched else ""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(BASE, wait_until="networkidle")

    # 1) FAB から開く
    page.get_by_role("button", name="おすすめ").click()
    page.wait_for_selector("text=おすすめ駅", timeout=10000)
    check(
        "エリア未選択では順位を出さない",
        page.get_by_text("都道府県・市区町村・路線のいずれかを選んでください").is_visible(),
    )
    page.screenshot(path=f"{OUT}/01-open.png")

    # 2) エリアを選ぶ（都道府県 → 市区町村）
    page.get_by_label("都道府県").click()
    page.get_by_text("神奈川県", exact=True).click()
    # Escape はモーダルごと閉じてしまうので、見出しを押してポップオーバーだけ閉じる。
    page.get_by_text("おすすめ駅", exact=True).click()
    page.wait_for_timeout(300)
    select = page.get_by_label("市区町村")
    select.wait_for(state="visible", timeout=10000)
    options = select.locator("option").all_text_contents()
    check("市区町村は実データから出る", any("横浜市（全区）" in o for o in options), f"{len(options)} 件")
    check("選ぶ前に候補の大きさが分かる", any(re.search(r"\d+ 駅", o) for o in options))
    select.select_option("横浜市")

    # 3) 結果に「順位と一緒に必ず出るもの」が揃っている
    page.wait_for_selector(r"text=/候補 \d+ 駅 → 順位 \d+ 駅/", timeout=30000)
    page.wait_for_timeout(800)
    body = page.inner_text("body")
    page.screenshot(path=f"{OUT}/02-results.png")

    check("候補集合が出る", found(r"候補 \d+ 駅 → 順位 \d+ 駅", body) != "",
          found(r"候補 \d+ 駅 → 順位 \d+ 駅", body))
    check("エリアの名前が出る", "横浜市" in body)
    check("正規化の方法が出る", "パーセンタイル" in body)
    check("重みが % で出る", re.search(r"\d+%", body) is not None)
    check("指標の向きが出る", "高いほど良い" in body or "低いほど良い" in body)
    check("凡例は短い名前", "将来人口" in body)
    check("除外件数が出る", found(r"除外 \d+ 駅", body) != "", found(r"除外 \d+ 駅（[^）]*）", body))
    check("敏感度が出る", ("頑健" in body) or ("僅差" in body), found(r"(頑健|僅差)[^\n]*", body))
    check("限界が出る", "この結果の限界" in body and "候補が変われば順位も変わります" in body)
    check("使った指標の限界が出る", "地価公示" in body)
    check("出典が出る", "出典" in body and "国土数値情報" in body)
    check("災害の扱いが出る", "候補から外しました" in body or "段階減点" in body)
    check("表が切れていることを言う", "順位が付いたのは" in body,
          found(r"上位 \d+ 駅を表示しています（順位が付いたのは \d+ 駅）", body))

    verdict_at = max(body.find("頑健"), body.find("僅差"))
    limits_at = body.find("この結果の限界")
    check("敏感度は表より前（順位全体にかかる断りなので）", 0 <= verdict_at < limits_at)

    rows = page.locator("ol li button")
    check("表に行がある", rows.count() > 0, f"{rows.count()} 行")
    first = rows.first.inner_text().replace("\n", " ")
    check("行に順位・駅名・スコアが出る", re.search(r"\d\s*\S+.*0\.\d{3}", first) is not None, first[:60])
    bars = page.locator("ol li button div[aria-hidden='true'] div")
    check("内訳の帯がある", bars.count() > 0, f"{bars.count()} セグメント")

    # 4) 重みは利用者のもの（動かすと順位が変わる）
    page.get_by_text("重みを調整", exact=False).click()
    sliders = page.locator("input[type=range]")
    check("重みスライダが 6 本", sliders.count() == 6, f"{sliders.count()} 本")
    before = rows.first.inner_text()
    sliders.nth(0).fill("1")
    page.wait_for_timeout(2500)
    check("重みを変えたことが画面に出る", "重みを変更" in page.inner_text("body"))
    check("重みを変えると結果が変わる", before != page.locator("ol li button").first.inner_text())
    page.screenshot(path=f"{OUT}/03-weights.png")

    # 5) 閉じると、地図に上位が印されている
    page.get_by_text("既定に戻す").click()
    page.wait_for_timeout(2000)
    page.get_by_role("button", name="閉じる").click()
    page.wait_for_timeout(3000)
    page.screenshot(path=f"{OUT}/04-map.png")
    check("地図に上位の印が出る", accent_pixels(f"{OUT}/04-map.png") > 200,
          f"{accent_pixels(f'{OUT}/04-map.png')} px")

    # 6) 開き直しても条件が残る（組み直しにならない）
    page.get_by_role("button", name="おすすめ").click()
    page.wait_for_selector(r"text=/候補 \d+ 駅 → 順位 \d+ 駅/", timeout=30000)
    page.wait_for_timeout(600)
    check("開き直しても条件が残る", "横浜市" in page.inner_text("body"))

    # 7) 行を選ぶと閉じて、その駅が URL に載る
    page.locator("ol li button").first.click()
    page.wait_for_timeout(1500)
    check("駅を選ぶと URL に載る", "grp=" in page.url)
    check("モーダルが閉じる", not page.get_by_text("この結果の限界").is_visible())
    page.screenshot(path=f"{OUT}/05-selected.png")
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
