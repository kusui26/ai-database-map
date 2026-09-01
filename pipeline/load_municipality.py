"""市区町村サイドカーを Supabase の stations へ結合する（260902・PR-4）。

`station_routes` と同じ流儀（別 CSV・冪等・`load_to_supabase.py` の全量投入からも呼ぶ）。
違いは **hard-fail**：市区町村は `list_stations`（MCP・§5.3）の前提なので、
CSV が無い・駅と合わない場合は**ロード自体を失敗**させる（ドリフトを即検知）。

    python3 pipeline/load_municipality.py   # 既存 DB へ単独適用（フルロード不要・軽い）

フルロード時は `load_to_supabase.py` が同じトランザクション内で `apply_municipality()` を呼ぶ。
将来、上流の `station_dataset.csv` に municipality 列が入ったらこの CSV は廃止できる
（`docs/260828_research_claude_auth.md` §9.2 決定 10・前方互換の設計）。
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
MUNI_CSV = ROOT / "data" / "derived" / "station_municipality.csv"


def apply_municipality(cur: psycopg.Cursor, csv_path: Path = MUNI_CSV) -> int:
    """一時テーブルへ COPY → stations を UPDATE。全駅に付いたことまで検証して件数を返す。"""
    if not csv_path.exists():
        raise SystemExit(
            f"{csv_path} がありません。fetch_admin_boundaries.py → build_municipality.py を先に実行してください"
        )
    cur.execute(
        "create temp table _muni "
        "(grp text primary key, municipality_code text not null, municipality text not null) "
        "on commit drop"
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        expected = {"grp", "municipality_code", "municipality"}
        if set(reader.fieldnames or []) != expected:
            raise SystemExit(f"{csv_path.name} の列が想定と違います: {reader.fieldnames}")
        for row in reader:
            writer.writerow([row["grp"], row["municipality_code"], row["municipality"]])
    buf.seek(0)
    with cur.copy("copy _muni (grp, municipality_code, municipality) from stdin with (format csv)") as cp:
        cp.write(buf.read())

    # CSV にだけある grp（駅マスタとずれた＝作り直しが要る）を先に落とす。
    cur.execute("select m.grp from _muni m left join public.stations s on s.grp = m.grp where s.id is null limit 5")
    orphans = [r[0] for r in cur.fetchall()]
    if orphans:
        raise SystemExit(f"CSV にだけ存在する grp: {orphans} — station_municipality.csv を作り直してください")

    cur.execute(
        "update public.stations s set municipality = m.municipality, municipality_code = m.municipality_code "
        "from _muni m where m.grp = s.grp"
    )
    updated = cur.rowcount

    # 付かなかった駅が 1 件でもあれば失敗（list_stations の前提が崩れる）。
    cur.execute("select grp from public.stations where municipality is null limit 5")
    missing = [r[0] for r in cur.fetchall()]
    if missing:
        raise SystemExit(
            f"municipality が付かない駅: {missing} — 駅マスタが変わっています。"
            "build_municipality.py を再実行してください"
        )
    return updated


def main() -> int:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from load_to_supabase import db_params

    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            updated = apply_municipality(cur)
            cur.execute(
                "select count(*) from public.stations where municipality like '横浜市%'"
            )
            yokohama = cur.fetchone()
            cur.execute("select count(distinct municipality_code) from public.stations")
            kinds = cur.fetchone()
        conn.commit()
    print(f"OK stations {updated:,} 行を更新（横浜市 {yokohama[0] if yokohama else '?'} 駅・"
          f"市区町村 {kinds[0] if kinds else '?'} 種）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
