#!/usr/bin/env python3
"""導入ページ `/ai` が、狭い画面で**横に溢れない**ことを実ブラウザで確かめる。

使い方:
    pnpm build && pnpm start -p 3399     # 別プロセスで
    pip install playwright && playwright install chromium
    python3 tests/ui.ai-page.smoke.py [出力ディレクトリ] [BASE]

## なぜユニットで足りないのか

**溢れは寸法の話**で、ファイルの文字列を見ても分からない。実際、ツール一覧は
`shrink-0` が付いていたために、いちばん長い名前の札（380px）が縮みも折り返しもせず、
**430px の端末でも溢れていた**（320px で 112px・390px で 42px）。しかも症状は
「少しはみ出す」ではなく、**説明が画面の外に出て読めない**——320px では説明が
44px 幅の柱になり、1 行に 2〜3 文字しか入っていなかった。

`/ai` は「カタログに載らない以上ここが唯一の入口」（`docs/260915_week5…` §2）なので、
携帯で読めないのはそのまま到達性の問題になる。

## 何を見るか

| 検査 | 落ちる状況 |
| --- | --- |
| ページの横溢れが 0 | 折り返せない要素が入った（`shrink-0`・`whitespace-nowrap`・長い URL など） |
| ツール一覧が sm 未満で縦積み | `sm:` の切り替えを消した／`flex-col` を外した |
| ツール一覧が sm 以上で 1 行 | 広い画面の見た目を壊した |
| console エラー 0 | — |

**横スクロールしてよい枠は例外**（表・コマンド行）。それらは `overflow-x-auto` の中にあり、
ページ自体の `scrollWidth` は増えないので、この検査は素通りする。
"""

import re
import sys

from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3399"

# 320 は小さい端末、390 は iPhone、430 は Pro Max、640 は Tailwind の sm、768 以上は据え置き確認。
WIDTHS = (320, 360, 390, 430, 640, 768, 1280)
STACK_BELOW = 640  # これ未満は縦積み、以上は 1 行（`sm:flex-row`）

# 札と説明の位置関係を測る。縦積みなら説明の y が札より下にある。
ROW_GEOMETRY = """() => {
  const section = [...document.querySelectorAll('section')]
    .find(s => (s.querySelector('h2')?.textContent || '').includes('扱えるデータ'));
  if (!section) return null;
  return [...section.querySelectorAll('li')].map(li => {
    const code = li.querySelector('code').getBoundingClientRect();
    const span = li.querySelector('span').getBoundingClientRect();
    return { stacked: Math.round(span.y) > Math.round(code.y) + 2, codeRight: Math.round(code.right) };
  });
}"""

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark} {label}" + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(f"{label}{' — ' + detail if detail else ''}")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for width in WIDTHS:
        page = browser.new_page(viewport={"width": width, "height": 900}, device_scale_factor=2)
        errors: list[str] = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"{BASE}/ai", wait_until="networkidle")

        overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        check(f"[{width}px] 横に溢れていない", overflow == 0, f"はみ出し {overflow}px")

        rows = page.evaluate(ROW_GEOMETRY)
        check(f"[{width}px] ツール一覧が読める", rows is not None and len(rows) > 0)
        if rows:
            stacked = sum(1 for row in rows if row["stacked"])
            expected = len(rows) if width < STACK_BELOW else 0
            check(
                f"[{width}px] 札と説明の並び（縦積み {expected} 行）",
                stacked == expected,
                f"実際 {stacked} 行",
            )
            widest = max(row["codeRight"] for row in rows)
            check(f"[{width}px] いちばん長い札が画面内", widest <= width, f"右端 {widest}px")

        check(f"[{width}px] console エラーなし", not errors, "; ".join(errors[:2]))
        page.screenshot(path=f"{OUT}/ai-{width}.png", full_page=True)
        page.close()

    # 参考出力（落とさない）：JSX の改行は空白になるので、日本語の途中で折り返すと
    # 「地図の タイル」と出る。既知の箇所が残っているため情報として並べるだけにする。
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(f"{BASE}/ai", wait_until="networkidle")
    gaps = re.findall(r"[぀-ヿ㐀-鿿] [぀-ヿ㐀-鿿]", page.inner_text("body"))
    print(f"  info 日本語のあいだの空白: {len(gaps)} 件 {gaps[:4]}")
    page.close()
    browser.close()

print()
print(f"==== {'ALL PASS' if not failures else str(len(failures)) + ' FAILED'} ====")
for failure in failures:
    print(" - " + failure)
sys.exit(1 if failures else 0)
