"""lines / line_stations の投入（L1・2026-10-08）— 路線 CSV → Supabase（冪等・COPY）。

build_lines.py が書いた `data/derived/lines.csv`・`line_stations.csv` を `public.lines`・`public.line_stations` へ入れる。
grp → station_id は DB の `stations` から解決する（駅の採番を再現しない・load_station_routes.py と同じ作法）。

冪等性：truncate → COPY → 投入後の確認を**単一トランザクション**で行い、確認が 1 つでも崩れたらロールバック
（旧データを保持）。成功したときだけ、そのときのアプリの駅を `data/derived/lines_loaded_grps.txt` に書く
（次の build で「前回の投入から増えた駅」を見つけるため）。

`load_to_supabase.py` の全量投入からも `copy_lines()` を呼ぶ（line_stations は stations の truncate cascade で消える）。

    python3 pipeline/build_lines.py && python3 pipeline/validate_lines.py   # 先に作って確かめる
    python3 pipeline/load_lines.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import line_common as common  # noqa: E402

LINE_DB_COLUMNS = [
    "line_cd", "name", "formal_name", "company_cd", "company_name", "company_short", "operator",
    "color", "color_name", "line_type", "is_loop", "station_count", "source",
]


def _text_or_none(value: str) -> str | None:
    return value if value != "" else None


def line_record(row: dict[str, str]) -> list[object]:
    return [
        int(row["line_cd"]), row["name"], row["formal_name"], int(row["company_cd"]), row["company_name"],
        row["company_short"], _text_or_none(row["operator"]), _text_or_none(row["color"]),
        _text_or_none(row["color_name"]), int(row["line_type"]), row["is_loop"] == "True",
        int(row["station_count"]), row["source"],
    ]


def copy_lines(cur: psycopg.Cursor) -> tuple[int, int]:
    """路線 CSV を lines / line_stations へ COPY する（呼び出し側のトランザクション内で実行）。"""
    lines = common.read_csv(common.LINES_CSV)
    members = common.read_csv(common.LINE_STATIONS_CSV)
    cur.execute("select grp, id from public.stations")
    station_id = dict(cur.fetchall())
    unknown = sorted({m["grp"] for m in members} - set(station_id))
    if unknown:
        raise SystemExit(f"stations に無い grp があります（{len(unknown)} 件・build のあとに駅データを入れ替えた？）: {unknown[:5]}")

    cur.execute("truncate public.line_stations, public.lines")
    with cur.copy(f"copy public.lines ({','.join(LINE_DB_COLUMNS)}) from stdin") as copy:
        for row in lines:
            copy.write_row(line_record(row))
    with cur.copy("copy public.line_stations (line_cd, station_id, seq) from stdin") as copy:
        for m in members:
            copy.write_row([int(m["line_cd"]), station_id[m["grp"]], int(m["seq"])])
    return len(lines), len(members)


#: 投入後の確認（SQL・期待値）。崩れたらロールバックする。build / validate とは別に、DB の中で確かめる。
POST_LOAD_CHECKS: tuple[tuple[str, str, object], ...] = (
    (
        "路線の駅数が line_stations の行数と合う",
        "select count(*) from public.lines l where l.station_count <> "
        "(select count(*) from public.line_stations ls where ls.line_cd = l.line_cd)",
        0,
    ),
    (
        "JR山手線は 30 駅で、東京・上野・秋葉原・品川を含む",
        "select count(*), count(*) filter (where s.station_name in ('東京', '上野', '秋葉原', '品川')) "
        "from public.line_stations ls join public.lines l using (line_cd) "
        "join public.stations s on s.id = ls.station_id where l.name = 'JR山手線'",
        (30, 4),
    ),
    (
        "東京メトロ副都心線は 16 駅で、地下鉄成増・地下鉄赤塚を含む",
        "select count(*), count(*) filter (where s.station_name in ('地下鉄成増', '地下鉄赤塚')) "
        "from public.line_stations ls join public.lines l using (line_cd) "
        "join public.stations s on s.id = ls.station_id where l.name = '東京メトロ副都心線'",
        (16, 2),
    ),
    (
        "大阪メトロ中央線は夢洲を含む（2024-04 版に無い駅の追加）",
        "select count(*) from public.line_stations ls join public.lines l using (line_cd) "
        "join public.stations s on s.id = ls.station_id where l.name = '大阪メトロ中央線' and s.station_name = '夢洲'",
        1,
    ),
)


def run_post_load_checks(cur: psycopg.Cursor) -> list[str]:
    failures = []
    for name, sql, expected in POST_LOAD_CHECKS:
        cur.execute(sql)
        row = cur.fetchone()
        actual = row[0] if not isinstance(expected, tuple) else tuple(row)
        status = "PASS" if actual == expected else "FAIL"
        print(f"  {status}  {name}（{actual}）")
        if actual != expected:
            failures.append(name)
    return failures


def main() -> int:
    from load_to_supabase import db_params

    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            lines, members = copy_lines(cur)
            print(f"投入：路線 {lines}・路線の駅 {members}")
            failures = run_post_load_checks(cur)
            if failures:
                conn.rollback()
                print(f"投入後の確認が崩れたのでロールバックした：{failures}")
                return 1
            cur.execute("analyze public.lines")
            cur.execute("analyze public.line_stations")
        conn.commit()
    grps = sorted(station.grp for station in common.load_app_stations())
    common.LOADED_GRPS_TXT.write_text("\n".join(grps) + "\n", encoding="utf-8")
    print(f"コミットした。投入時のアプリの駅 {len(grps)} を {common.LOADED_GRPS_TXT.name} に記録")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
