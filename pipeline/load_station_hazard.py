"""駅別ハザードサマリ（事前計算）を Supabase へ投入する（PR-6・独立ローダ）。

`pipeline/build_station_hazard.ts` が出力した `data/derived/station_hazard.jsonl` を
`station_hazard` へ**全置換**（truncate → insert・単一トランザクション）で載せる。

⚠ `load_to_supabase.py`（統計指標のフルロード）には**組み込まない**——ハザードは
版（version / computed_at）を持つ独立データで、統計の年次更新のたびに重いタイルバッチを
要求しない（docs/260828_research_claude_auth.md §10 PR-6 方針）。

厳格さは市区町村ローダと同じ:
- jsonl のメタ行（version）を検証する
- stations に無い grp が jsonl にあれば失敗（ドリフト即検知）
- **全駅ぶん揃っていなければ失敗**（欠けた駅を黙って「データなし」にしない）

    python3 pipeline/load_station_hazard.py
"""

from __future__ import annotations

import json
from pathlib import Path

import psycopg

from load_to_supabase import db_params

ROOT = Path(__file__).resolve().parents[1]
JSONL = ROOT / "data" / "derived" / "station_hazard.jsonl"
EXPECTED_VERSION = 1  # shared/hazard-summary.ts の STATION_HAZARD_VERSION と一致させる


def read_jsonl() -> tuple[str, list[dict]]:
    """メタ行（computedAt）とサマリ行を読む。壊れた行は即失敗。"""
    if not JSONL.exists():
        raise SystemExit(f"{JSONL} がありません。先に pipeline/build_station_hazard.ts を実行してください")
    computed_at: str | None = None
    rows: dict[str, dict] = {}
    for line_no, line in enumerate(JSONL.read_text().splitlines(), start=1):
        if not line:
            continue
        row = json.loads(line)
        if row.get("type") == "meta":
            if row.get("version") != EXPECTED_VERSION:
                raise SystemExit(f"版が不一致: jsonl={row.get('version')} / 期待 {EXPECTED_VERSION}")
            computed_at = computed_at or row.get("computedAt")
            continue
        grp = row.get("grp")
        if not isinstance(grp, str) or not grp:
            raise SystemExit(f"{line_no} 行目に grp がありません")
        rows[grp] = row  # 再開で重複した grp は後勝ち（同じ計算の再実行なので同値のはず）
    if computed_at is None:
        raise SystemExit("メタ行（computedAt）がありません")
    return computed_at, list(rows.values())


def main() -> int:
    computed_at, rows = read_jsonl()
    print(f"station_hazard.jsonl: {len(rows):,} 駅（computed_at {computed_at}）")
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            cur.execute("select grp, id from public.stations")
            id_of = dict(cur.fetchall())
            unknown = [row["grp"] for row in rows if row["grp"] not in id_of]
            if unknown:
                raise SystemExit(f"stations に無い grp が jsonl にあります: {unknown[:5]}（計 {len(unknown)}）")
            missing = len(id_of) - len(rows)
            if missing != 0:
                raise SystemExit(
                    f"全駅ぶん揃っていません: stations {len(id_of):,} / jsonl {len(rows):,}"
                    "（build_station_hazard.ts を再実行して欠けを埋めてください）"
                )
            cur.execute("truncate table public.station_hazard")
            with cur.copy(
                "copy public.station_hazard (station_id, grp, version, computed_at, summary) from stdin"
            ) as copy:
                for row in rows:
                    copy.write_row(
                        (id_of[row["grp"]], row["grp"], EXPECTED_VERSION, computed_at, json.dumps(row, ensure_ascii=False))
                    )
            cur.execute(
                "select count(*), count(*) filter (where summary->>'level' <> 'none') from public.station_hazard"
            )
            total, non_none = cur.fetchone()
        conn.commit()
    print(f"OK station_hazard {total:,} 行（level≠none: {non_none:,}・version {EXPECTED_VERSION}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
