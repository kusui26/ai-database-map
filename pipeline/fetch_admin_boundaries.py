"""行政区域（N03）の原典を取得する（260902・PR-4 市区町村列）。

`docs/260828_research_claude_auth.md` §5.2 G1 ／ §9.2 決定 10。
駅の `prefecture` は上流整形が「N03 を代表点に空間結合」して作っている（`docs/dataset.md` §2.1）。
市区町村も**同じ方法論**で付けるため、全国一括の N03 を 1 ファイル落とす。

    python3 pipeline/fetch_admin_boundaries.py          # 未取得なら落とす（Range で再開可）
    python3 pipeline/fetch_admin_boundaries.py --list   # 落とさずに対象とサイズだけ出す

落とし先は `data/admin_raw/`（gitignore）。コミットされるのはコードだけ。
年度更新（毎年 1 月データ・公開は春）で市町村合併を取り込むときは `VINTAGE_*` を上げ、
`build_municipality.py` → `load_municipality.py` を再実行する（hazard の vintage と同じ運用）。
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST_DIR = ROOT / "data" / "admin_raw"

#: 使用する N03 の年版（2026-01-01 時点の行政区域）。
VINTAGE_YEAR = "2026"
VINTAGE_FILE = "N03-20260101_GML.zip"
URL = f"https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-{VINTAGE_YEAR}/{VINTAGE_FILE}"
DEST = DEST_DIR / VINTAGE_FILE

CHUNK = 1 << 20  # 1MB


def remote_size() -> int:
    req = urllib.request.Request(URL, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as res:
        return int(res.headers.get("Content-Length", "0"))


def fetch() -> None:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    total = remote_size()
    have = DEST.stat().st_size if DEST.exists() else 0
    if have == total and total > 0:
        print(f"OK 取得済み: {DEST.name} ({total:,} bytes)")
        return
    headers = {"Range": f"bytes={have}-"} if have > 0 else {}
    if have > 0:
        print(f".. 途中から再開: {have:,}/{total:,} bytes")
    req = urllib.request.Request(URL, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res, DEST.open("ab" if have else "wb") as out:
        done = have
        while True:
            chunk = res.read(CHUNK)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if done % (50 * CHUNK) < CHUNK:
                print(f"  {done:,}/{total:,} bytes")
    got = DEST.stat().st_size
    if total > 0 and got != total:
        raise SystemExit(f"サイズ不一致: got={got:,} expected={total:,}（再実行で再開できます）")
    print(f"OK {DEST.name} ({got:,} bytes)")


def main() -> int:
    if "--list" in sys.argv:
        print(f"{URL}\n  -> {DEST}\n  size: {remote_size():,} bytes")
        return 0
    fetch()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
