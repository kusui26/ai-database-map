"""P2a — metric_columns シード生成（catalog.json → SQL）。

catalog.json のエントリ順（＝CSV列順）で column_id を 1..N に採番し、
`metric_columns(id, key, meta)` の INSERT を生成する。column_id はこの採番が正で、
P2b は key→id を DB の metric_columns から引く。

    python3 pipeline/build_seed.py supabase/migrations/<ts>_seed_metric_columns.sql
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "src" / "shared" / "catalog" / "catalog.json"


def sql_literal(text: str) -> str:
    """SQL 文字列リテラル（単一引用符をエスケープ）。"""
    return "'" + text.replace("'", "''") + "'"


def main(out_path: str) -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    entries = catalog["entries"]

    rows: list[str] = []
    for column_id, entry in enumerate(entries, start=1):
        meta = json.dumps(entry, ensure_ascii=False)
        rows.append(f"  ({column_id}, {sql_literal(entry['key'])}, {sql_literal(meta)}::jsonb)")

    lines = [
        "-- P2a — metric_columns シード（catalog.json のミラー・pipeline/build_seed.py が生成）",
        f"-- entries: {len(entries)}（column_id は catalog.json のエントリ順で 1..{len(entries)}）",
        "",
        "insert into public.metric_columns (id, key, meta) values",
        ",\n".join(rows) + ";",
        "",
    ]
    Path(out_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"✓ {out_path} — metric_columns {len(entries)} 行")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python3 pipeline/build_seed.py <out.sql>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
