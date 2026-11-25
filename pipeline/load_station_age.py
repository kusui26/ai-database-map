"""station_age_profiles の投入（2026-11-25・人口の年齢 PR-3）— グラフ用の年齢の CSV → Supabase（冪等・COPY）。

`build_station_age.py` が書いた `data/derived/station_age_profiles.csv`（駅 × 6 半径 × 8 年・445,104 行）を、1 駅 1 行の
配列にして `public.station_age_profiles` へ入れる（計画書 `docs/261122_PLAN_population_improvement.md` §3.5）。

- `counts`：[半径][年][区分] の 192（6 × 8 × 4）。区分は 0〜14・15〜64・65〜74・75 歳以上（`age_rules.BANDS`）
- `unknown`：[半径][実績の年] の 12（6 × 2）。補う前の年齢不詳（⚠ の割合の分子）

並びは migration `20261125090000_station_age_profiles.sql` の関数 `station_age_profile` と同じ。並びを知っているのは
その関数とここだけで、2 つが食い違えば `golden_station_age_profile_test.py` が落ちる（CSV の全行と照合する）。

grp → station_id は DB の `stations` から引く（駅の採番を再現しない・load_lines.py と同じ作法）。
冪等性：truncate → COPY → 投入後の確認を**単一トランザクション**で行い、確認が 1 つでも崩れたらロールバック（旧データを保持）。
`load_to_supabase.py` の全量投入からも `copy_station_age_profiles()` を呼ぶ（stations の truncate cascade で消える）。

    python3 pipeline/build_station_age.py && python3 pipeline/validate_station_age.py   # 先に作って確かめる
    python3 pipeline/load_station_age.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from age_rules import BANDS, CENSUS_YEARS, PROFILE_YEARS, STATION_AGE_PROFILES_CSV  # noqa: E402
from station_radii import RADII_M  # noqa: E402

#: CSV の区分の列（積む順＝配列の中の並び）。
BAND_COLUMNS: tuple[str, ...] = tuple(f"age{band}" for band in BANDS)
CSV_COLUMNS: tuple[str, ...] = ("grp", "radius_m", "year", *BAND_COLUMNS, "age_unknown")
#: 1 駅の配列の長さ。
COUNTS_PER_STATION = len(RADII_M) * len(PROFILE_YEARS) * len(BANDS)
UNKNOWN_PER_STATION = len(RADII_M) * len(CENSUS_YEARS)
#: 投入後に RPC の 48 行を CSV と照合する駅（政令市の中心・都心の新しい街・年齢不詳の多い駅）。
CHECK_GRPS: tuple[str, ...] = ("横浜#0", "武蔵小杉#0", "矢場町#0")


def read_profiles(path: Path = STATION_AGE_PROFILES_CSV) -> pd.DataFrame:
    """CSV を読み、形を確かめる（列・駅ごとの 48 行・整数・年齢不詳は実績の年だけ）。崩れていれば止める。"""
    if not path.exists():
        raise SystemExit(f"{path.name} がありません。先に pipeline/build_station_age.py を実行してください")
    frame = pd.read_csv(path, dtype={"grp": str})
    if tuple(frame.columns) != CSV_COLUMNS:
        raise SystemExit(f"{path.name} の列が想定と違う: {list(frame.columns)}")
    problems = _shape_problems(frame)
    if problems:
        raise SystemExit(f"{path.name} の形が崩れている: " + " / ".join(problems))
    return frame


def _shape_problems(frame: pd.DataFrame) -> list[str]:
    problems = []
    per_station = frame.groupby("grp").size()
    if (per_station != len(RADII_M) * len(PROFILE_YEARS)).any():
        problems.append(f"48 行でない駅 {int((per_station != 48).sum())}")
    if set(frame["radius_m"]) != set(RADII_M) or set(frame["year"]) != set(PROFILE_YEARS):
        problems.append(f"半径・年が違う: {sorted(set(frame['radius_m']))} / {sorted(set(frame['year']))}")
    if frame.duplicated(["grp", "radius_m", "year"]).any():
        problems.append("同じ（駅・半径・年）が 2 行ある")
    counts = frame[list(BAND_COLUMNS)]
    if counts.isna().any().any() or (counts < 0).any().any():
        problems.append("区分の人数に空・負がある")
    census = frame["year"].isin(CENSUS_YEARS)
    unknown = frame["age_unknown"]
    if unknown[census].isna().any() or (unknown[census] < 0).any() or unknown[~census].notna().any():
        problems.append("年齢不詳は実績の年だけに 0 以上の値（推計の年は空）")
    return problems


def station_arrays(frame: pd.DataFrame) -> dict[str, tuple[list[int], list[int]]]:
    """駅 → (counts 192, unknown 12)。並びは [半径][年][区分]・[半径][実績の年]（関数 station_age_profile と同じ）。"""
    ordered = frame.assign(
        r=frame["radius_m"].map({radius: index for index, radius in enumerate(RADII_M)}),
        y=frame["year"].map({year: index for index, year in enumerate(PROFILE_YEARS)}),
    ).sort_values(["grp", "r", "y"], kind="stable")
    grps = ordered["grp"].drop_duplicates().tolist()
    counts = ordered[list(BAND_COLUMNS)].to_numpy(dtype=np.int64).reshape(len(grps), COUNTS_PER_STATION)
    census = ordered[ordered["year"].isin(CENSUS_YEARS)]
    unknown = census["age_unknown"].to_numpy(dtype=np.int64).reshape(len(grps), UNKNOWN_PER_STATION)
    return {grp: (counts[i].tolist(), unknown[i].tolist()) for i, grp in enumerate(grps)}


def copy_station_age_profiles(cur: psycopg.Cursor, frame: pd.DataFrame | None = None) -> int:
    """CSV を station_age_profiles へ COPY する（呼び出し側のトランザクション内で実行）。駅の集合が DB と違えば止める。"""
    arrays = station_arrays(read_profiles() if frame is None else frame)
    cur.execute("select grp, id from public.stations")
    station_id = dict(cur.fetchall())
    unknown = sorted(set(arrays) - set(station_id))
    missing = sorted(set(station_id) - set(arrays))
    if unknown or missing:
        raise SystemExit(
            f"CSV の駅が stations と合わない（CSV だけ {len(unknown)}・DB だけ {len(missing)}・"
            f"build のあとに駅データを入れ替えた？）: {(unknown + missing)[:5]}"
        )
    cur.execute("truncate public.station_age_profiles")
    with cur.copy("copy public.station_age_profiles (station_id, counts, unknown) from stdin") as copy:
        for grp, (counts, unknowns) in arrays.items():
            copy.write_row([station_id[grp], counts, unknowns])
    return len(arrays)


def _csv_rows(frame: pd.DataFrame, grp: str) -> list[tuple[object, ...]]:
    rows = frame[frame["grp"] == grp].sort_values(["radius_m", "year"])
    return [
        (int(row.radius_m), int(row.year), *(int(getattr(row, column)) for column in BAND_COLUMNS),
         None if pd.isna(row.age_unknown) else int(row.age_unknown))
        for row in rows.itertuples(index=False)
    ]


def run_post_load_checks(cur: psycopg.Cursor, frame: pd.DataFrame) -> list[str]:
    """投入後の確認（DB の中で）。崩れたら呼び出し側がロールバックする。"""
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str) -> None:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}（{detail}）")
        if not ok:
            failures.append(name)

    cur.execute("select (select count(*) from public.station_age_profiles), (select count(*) from public.stations)")
    rows, stations = cur.fetchone()
    check("全駅に 1 行ずつ", rows == stations, f"{rows:,} 行 / 駅 {stations:,}")
    for grp in CHECK_GRPS:
        cur.execute(f"select {', '.join(CSV_COLUMNS[1:])} from public.station_age_profile(%s)", (grp,))
        actual = [tuple(row) for row in cur.fetchall()]
        check(f"{grp} の 48 行が CSV と同じ", actual == _csv_rows(frame, grp), f"{len(actual)} 行")
    cur.execute("select count(*) from public.station_age_profile(%s) where projected <> (year <> all(%s))",
                (CHECK_GRPS[0], list(CENSUS_YEARS)))
    (wrong,) = cur.fetchone()
    check("推計の年（projected）は国勢調査の年でない年", wrong == 0, f"違う行 {wrong}")
    cur.execute(
        "select count(*) from public.stations s cross join lateral public.station_age_profile(s.grp) a "
        "join public.metric_columns mc on mc.key = 'pop_2020_1km' "
        "join public.station_values v on v.station_id = s.id and v.column_id = mc.id "
        "where a.radius_m = 1000 and a.year = 2020 "
        "and a.age0_14 + a.age15_64 + a.age65_74 + a.age75plus <> v.value"
    )
    (differs,) = cur.fetchone()
    check("1km・2020 年の 4 区分の和 ＝ pop_2020_1km（全駅）", differs == 0, f"違う駅 {differs}")
    return failures


def main() -> int:
    from load_to_supabase import db_params

    frame = read_profiles()
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            cur.execute("set statement_timeout = 0")
            written = copy_station_age_profiles(cur, frame)
            print(f"投入：{written:,} 駅（{len(frame):,} 行の CSV から）")
            failures = run_post_load_checks(cur, frame)
            if failures:
                conn.rollback()
                print(f"投入後の確認が崩れたのでロールバックした：{failures}")
                return 1
            cur.execute("analyze public.station_age_profiles")
            cur.execute("select pg_size_pretty(pg_total_relation_size('public.station_age_profiles')), "
                        "pg_size_pretty(pg_database_size(current_database()))")
            table_size, db_size = cur.fetchone()
        conn.commit()
    print(f"コミットした。station_age_profiles {table_size}・DB {db_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
