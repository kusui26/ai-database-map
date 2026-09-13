#!/usr/bin/env python3
"""render_map の URL から地図レポート（HTML 1 ページ）を保存する（標準ライブラリのみ）。

`docs/260912_gui_chat_protocol.md` §4.3(b) の道具。保存した HTML は、Canvas を持つホストなら
`presentHtml`（ファイルのパスを渡す形）で開けるし、ブラウザで直接開いてもよい。
URL は約 24 時間で失効する——失効したら render_map を呼び直して新しい URL を取る。

    python3 scripts/fetch_map.py "<render_map が返した url>" [--out PATH]

既定の保存先は ./map_out/map.html。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

TIMEOUT_S = 60


def fetch(url: str) -> bytes:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
            return response.read()
    except urllib.error.HTTPError as error:  # エラー封筒（{"error":{code,message}}）を読んで伝える
        body = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(body)["error"]["message"]
        except (json.JSONDecodeError, KeyError, TypeError):
            message = body[:200]
        raise SystemExit(f"取得に失敗（HTTP {error.code}）: {message}")
    except urllib.error.URLError as error:
        raise SystemExit(f"取得に失敗: {error.reason}")


def main() -> int:
    parser = argparse.ArgumentParser(description="render_map の地図レポートを保存する")
    parser.add_argument("url", help="render_map が返した url（そのまま引用符で囲んで渡す）")
    parser.add_argument("--out", default="map_out/map.html", help="保存先（既定 map_out/map.html）")
    args = parser.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    html = fetch(args.url)
    out.write_bytes(html)

    print(f"保存しました: {out}（{len(html):,} バイト）")
    print("HTML を表示できるツール（presentHtml など）にこのパスを渡すか、ブラウザで開いてください。")
    print("凡例・出典・注意はページ本文にあります。分析の文章にもそのまま書いてください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
