#!/usr/bin/env python3
"""build_dataset の URL から CSV と meta.json を保存する（標準ライブラリのみ）。

`docs/260828_research_claude_auth.md` §5.4-8「使った CSV と手順を残して再現可能に」の道具。
URL は約 24 時間で失効する——失効したら build_dataset を呼び直して新しい URL を取る。

    python3 scripts/fetch_dataset.py "<build_dataset が返した url>" [--out DIR]

保存先（既定 ./dataset_out/）:
    dataset.csv       … 駅×指標の CSV（値の欠損は空欄・フラグ列は 0/1）
    dataset.meta.json … 列の意味・単位・年次・出典・注意
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TIMEOUT_S = 60


def meta_url_of(csv_url: str) -> str:
    """CSV の URL に kind=meta を足して meta.json の URL を作る。"""
    parts = urllib.parse.urlsplit(csv_url)
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    query = [(k, v) for (k, v) in query if k != "kind"] + [("kind", "meta")]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


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
    parser = argparse.ArgumentParser(description="build_dataset の CSV と meta を保存する")
    parser.add_argument("url", help="build_dataset が返した url（そのまま引用符で囲んで渡す）")
    parser.add_argument("--out", default="dataset_out", help="保存先ディレクトリ（既定 dataset_out）")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_bytes = fetch(args.url)
    meta_bytes = fetch(meta_url_of(args.url))
    (out_dir / "dataset.csv").write_bytes(csv_bytes)
    (out_dir / "dataset.meta.json").write_bytes(meta_bytes)

    meta = json.loads(meta_bytes)
    columns = meta.get("columns", [])
    print(f"OK {out_dir}/dataset.csv ({len(csv_bytes):,} bytes)")
    print(f"   駅: {meta.get('stationCount')} / 列: {len(columns)} / shape: {meta.get('shape')}")
    for note in meta.get("notes", []):
        print(f"   note: {note}")
    print(f"   期限: {meta.get('expiresAt')}（失効後は build_dataset を呼び直す）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
