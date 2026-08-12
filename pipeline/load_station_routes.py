"""station_routes の投入（260731）— 路線 CSV → Supabase（冪等・COPY）。

`script/` のノートブックが出力する `data/derived/station_routes.csv`（grp, operator,
route, route_type）を `public.station_routes` へ入れる。grp → station_id は DB 側の
`stations` から解決するため、駅の採番を再現する必要はない。
（260812 以前は `pipeline/build_station_routes.py` が最近傍マッチングで生成していた。
現在は同じ内容をノートブックが直接出力し、旧スクリプトは `verify_station_routes.py` として
突き合わせ検証だけを行う・`docs/260811_income.md` §4.2）

冪等性: truncate → COPY を単一トランザクションで実行（失敗時はロールバック＝旧データ保持）。
`load_to_supabase.py` の全量投入からも `copy_station_routes()` を呼べるようにしてある
（stations の truncate cascade で消えるため、同じトランザクション内で入れ直す）。

    python3 pipeline/load_station_routes.py
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
ROUTES_CSV = ROOT / "data" / "derived" / "station_routes.csv"
ROUTE_COLUMNS = ["station_id", "operator", "route", "route_type"]


def copy_station_routes(cur: psycopg.Cursor, csv_path: Path = ROUTES_CSV) -> int:
    """路線 CSV を station_routes へ COPY する（呼び出し側のトランザクション内で実行）。"""
    cur.execute("select grp, id from public.stations")
    station_id = {grp: sid for grp, sid in cur.fetchall()}

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter="\t", lineterminator="\n")
    written = 0
    unknown: set[str] = set()
    with csv_path.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            sid = station_id.get(row["grp"])
            if sid is None:
                unknown.add(row["grp"])
                continue
            writer.writerow([sid, row["operator"], row["route"], int(row["route_type"])])
            written += 1
    if unknown:
        raise SystemExit(f"stations に無い grp があります（{len(unknown)} 件）: {sorted(unknown)[:5]}")

    buffer.seek(0)
    cur.execute("truncate public.station_routes")
    with cur.copy(f"copy public.station_routes ({','.join(ROUTE_COLUMNS)}) from stdin") as copy:
        copy.write(buffer.read())
    return written


def main() -> int:
    # 接続情報の組み立ては load_to_supabase に集約。単体実行のときだけ読み込む
    # （load_to_supabase 側は copy_station_routes を import するため、循環を避ける）。
    from load_to_supabase import db_params

    if not ROUTES_CSV.exists():
        raise SystemExit(f"{ROUTES_CSV} がありません。先に script/ のノートブックを実行してください")
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            written = copy_station_routes(cur)
            cur.execute("select count(*) from public.station_routes")
            total = cur.fetchone()[0]
            cur.execute("select count(distinct station_id) from public.station_routes")
            stations = cur.fetchone()[0]
            cur.execute("select count(distinct station_id) from public.station_routes where route_type = 1")
            shinkansen = cur.fetchone()[0]
        conn.commit()
    print(f"投入 {written} 行 / DB {total} 行 / 路線が付いた駅 {stations} / 新幹線の駅 {shinkansen}")
    return 0 if total == written else 1


if __name__ == "__main__":
    raise SystemExit(main())
