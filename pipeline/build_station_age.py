"""駅 × 半径の年齢（2026-11-24・人口の年齢 PR-1）— 第 1 段の列（66 列・フラグ 12 列）と第 2 段（グラフ用）を作る。

設計は `docs/261122_PLAN_population_improvement.md` §3、データの説明は `docs/population_mesh.md` §12。

1. セルの年齢（`age_cells.py`）：国勢調査 2015・2020 年（秘匿を戻し、年齢不詳を方式 B で割り振った 4 区分）と
   R6 2025〜2050 年（真の総数 × 年齢構成）
2. 按分（`station_radii.py`・ノートブックと同じ）：国勢調査は既存の人口と同じセルの並び（mesh250）、R6 は既存の推計と
   同じセル（`area_mesh.r6_cells`）で、駅 × 6 半径へ
3. 整数にする（`age_integers.py`）：区分の和が総数に一致し、どの区分も半径を広げて減らない
4. 照合：区分の和 ＝ 既存の総数の列（`pop_<年>_*`・`pop_pred_2024_<年>_*`）を全駅・全半径・全年で。崩れたら書かない
5. 指標（計画書 §3.3）：割合と増減率は整数の人数から作る（画面に出る人数と割合が合う）

出力（`data/derived/`・gitignore）：`station_age.csv`（駅 × 第 1 段の 66 列とフラグ 12 列）・`station_age_profiles.csv`
（駅 × 半径 × 年の 4 区分と、実績の年の年齢不詳）・`age_cells_census.parquet`・`age_cells_r6.parquet`（セルの値）。

    python3 pipeline/build_station_age.py                                   # 全駅（約 10 分）
    python3 pipeline/build_station_age.py --stations 東京#0,横浜#0 --out DIR  # 一部の駅だけ（試し・わざと壊す検査）
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import station_radii as sr  # noqa: E402
from age_cells import BAND_COLUMNS, census_age_cells, r6_age_cells  # noqa: E402
from age_integers import integer_bands  # noqa: E402
from age_rules import (  # noqa: E402
    AGE_UNKNOWN_NOTICE_SHARE,
    BANDS,
    CENSUS_AGE_CELLS,
    CENSUS_YEARS,
    DERIVED_DIR,
    FLAG_PREFIXES,
    LOWBASE_65_PEOPLE,
    METRIC_PREFIXES,
    PRED_YEARS,
    PROFILE_YEARS,
    R6_AGE_CELLS,
    RATE_DECIMALS,
    STATION_AGE_CSV,
    STATION_AGE_PROFILES_CSV,
)
from area_mesh import R6_COLUMNS, r6_cells  # noqa: E402

#: R6 のセルの総数を、既存の推計の総数（PTN）と比べるときの許し（足し算の順番の誤差だけ）。
R6_TOTAL_TOLERANCE = 1e-9
#: 年齢の 4 区分 → 第 2 段の列名。
PROFILE_COLUMNS: dict[str, str] = {band: f"age{band}" for band in BANDS}

Ages = dict[int, np.ndarray]  # 年 → （区分 × 駅 × 半径）の整数


# --- 按分 -------------------------------------------------------------------------


def census_floats(year: int, cells: pd.DataFrame, stations: sr.Stations) -> dict[str, np.ndarray]:
    """国勢調査のセルの年齢 → 駅 × 半径（実数）。セルの並びは既存の人口と同じ（mesh250・ノートブックの順）。"""
    order = sr.census_cells(year)
    aligned = order.merge(cells, on="code", how="left", validate="one_to_one")
    if aligned["total"].isna().any() or (aligned["total"] != aligned["pop"]).any():
        raise SystemExit(f"{year} 年：統計 GIS のセルの総数が、既存の人口のセル（mesh250）と合わない")
    values = {column: aligned[column].to_numpy() for column in (*BAND_COLUMNS, "unknown")}
    return sr.apportion(sr.mesh_geometry(order["code"]), values, stations, label=f"国勢調査 {year}")


def r6_floats(cells: pd.DataFrame, stations: sr.Stations) -> dict[str, np.ndarray]:
    """R6 のセルの年齢 → 駅 × 半径（実数）。セルは既存の推計と同じ（`r6_cells`）。総数が PTN と合わなければ落とす。"""
    order = r6_cells()
    aligned = order.merge(cells, on="code", how="left", validate="one_to_one")
    for column in R6_COLUMNS:
        year = int(column.removeprefix("PTN_"))
        if year in PRED_YEARS and (np.abs(aligned[f"total_{year}"] - aligned[column]) > R6_TOTAL_TOLERANCE).any():
            raise SystemExit(f"R6 {year} 年：セルの年齢の総数が、既存の推計の総数（PTN）と合わない")
    values = {f"{column}_{year}": aligned[f"{column}_{year}"].to_numpy() for year in PRED_YEARS for column in BAND_COLUMNS}
    return sr.apportion(sr.mesh_geometry(order["code"]), values, stations, label="R6")


def to_integers(floats: dict[str, np.ndarray], suffix: str) -> tuple[np.ndarray, int]:
    """1 年分の区分（実数）→（区分 × 駅 × 半径）の整数と、半径の直しで移した人数。"""
    return integer_bands(np.stack([floats[f"{column}{suffix}"] for column in BAND_COLUMNS]))


# --- 指標 -------------------------------------------------------------------------


def _band(ages: Ages, year: int, *names: str) -> np.ndarray:
    return sum(ages[year][BANDS.index(name)] for name in names)


def _total(ages: Ages, year: int) -> np.ndarray:
    return ages[year].sum(axis=0)


def share(part: np.ndarray, total: np.ndarray) -> np.ndarray:
    """割合（%・小数 1 桁）。総数が 0 なら NaN。"""
    ratio = np.divide(part, total, out=np.full(part.shape, np.nan), where=total > 0)
    return np.round(ratio * 100, RATE_DECIMALS)


def growth(new: np.ndarray, old: np.ndarray) -> np.ndarray:
    """増減率（%・小数 1 桁）。分母が 0 なら NaN（既存の pop_gr と同じ）。"""
    ratio = np.divide(new, old, out=np.full(new.shape, np.nan), where=old > 0)
    return np.round((ratio - 1) * 100, RATE_DECIMALS)


def metric_arrays(ages: Ages) -> dict[str, np.ndarray]:
    """第 1 段の 11 の指標（列名の頭 → 駅 × 半径）。将来の増減率の分母は国勢調査 2020 年の補った値（計画書 §2.4）。"""
    working, elderly = ("15_64",), ("65_74", "75plus")
    return {
        "pop15_64_2020": _band(ages, 2020, *working),
        "pop15_64_share_2020": share(_band(ages, 2020, *working), _total(ages, 2020)),
        "pop65_share_2020": share(_band(ages, 2020, *elderly), _total(ages, 2020)),
        "pop15_64_gr_2020_2015": growth(_band(ages, 2020, *working), _band(ages, 2015, *working)),
        "pop15_64_gr_pred_2024_2050": growth(_band(ages, 2050, *working), _band(ages, 2020, *working)),
        "pop65_gr_pred_2024_2050": growth(_band(ages, 2050, *elderly), _band(ages, 2020, *elderly)),
        "pop15_64_gr_pred_2024_2030": growth(_band(ages, 2030, *working), _band(ages, 2020, *working)),
        "pop15_64_gr_pred_2024_2040": growth(_band(ages, 2040, *working), _band(ages, 2020, *working)),
        "pop65_share_pred_2024_2050": share(_band(ages, 2050, *elderly), _total(ages, 2050)),
        "pop75_share_2020": share(_band(ages, 2020, "75plus"), _total(ages, 2020)),
        "pop0_14_share_2020": share(_band(ages, 2020, "0_14"), _total(ages, 2020)),
    }


def flag_arrays(ages: Ages, unknown_2020: np.ndarray) -> dict[str, np.ndarray]:
    """フラグ：65 歳以上が 50 人未満（65 歳以上の将来増減率を参考値に）・2020 年の年齢不詳が 10% 以上（⚠）。"""
    total = _total(ages, 2020)
    unknown_share = np.divide(unknown_2020, total, out=np.zeros(total.shape), where=total > 0)
    return {
        "pop65_lowbase_2020": (_band(ages, 2020, "65_74", "75plus") < LOWBASE_65_PEOPLE).astype(np.int8),
        "pop_ageunk_2020": (unknown_share >= AGE_UNKNOWN_NOTICE_SHARE).astype(np.int8),
    }


# --- 表 -------------------------------------------------------------------------


def station_table(stations: sr.Stations, arrays: dict[str, np.ndarray]) -> pd.DataFrame:
    """駅 × （第 1 段の 66 列・フラグ 12 列）。列の並びは age_rules の並び（指標ごとに 6 半径）。"""
    columns: dict[str, object] = {"grp": list(stations.grps)}
    for prefix in (*METRIC_PREFIXES, *FLAG_PREFIXES):
        for index, name in enumerate(sr.column_names(prefix)):
            columns[name] = arrays[prefix][:, index]
    return pd.DataFrame(columns)


def profile_table(stations: sr.Stations, ages: Ages, unknown: Ages) -> pd.DataFrame:
    """駅 × 半径 × 年 の 4 区分（と、実績の年の補う前の年齢不詳）。並びは駅（CSV の順）→ 半径 → 年。"""
    count, radii = len(stations.grps), len(sr.RADII_M)
    frames = []
    for year in PROFILE_YEARS:
        frame = pd.DataFrame({"order": np.repeat(np.arange(count), radii), "grp": np.repeat(stations.grps, radii),
                              "radius_m": np.tile(sr.RADII_M, count), "year": year})
        for band, values in zip(BANDS, ages[year], strict=True):
            frame[PROFILE_COLUMNS[band]] = values.reshape(-1)
        missing = np.full(count * radii, pd.NA, dtype=object)
        frame["age_unknown"] = pd.array(unknown[year].reshape(-1) if year in unknown else missing, dtype="Int64")
        frames.append(frame)
    table = pd.concat(frames, ignore_index=True).sort_values(["order", "radius_m", "year"], kind="stable")
    return table.drop(columns="order")


def check_totals(stations: sr.Stations, ages: Ages) -> list[str]:
    """区分の和 ＝ 既存の総数の列（全駅・全半径・全年）。"""
    prefixes = {year: f"pop_{year}" if year in CENSUS_YEARS else f"pop_pred_2024_{year}" for year in PROFILE_YEARS}
    columns = [name for prefix in prefixes.values() for name in sr.column_names(prefix)]
    existing = pd.read_csv(sr.STATION_DATASET_CSV, usecols=["grp", *columns]).set_index("grp").loc[list(stations.grps)]
    problems = []
    for year, prefix in prefixes.items():
        diff = _total(ages, year) - existing[sr.column_names(prefix)].to_numpy(dtype=np.int64)
        if (diff != 0).any():
            problems.append(f"{year} 年：区分の和が {prefix}_* と違う {int((diff != 0).sum()):,} 件（最大 {int(np.abs(diff).max())} 人）")
    return problems


# --- 組み立て -------------------------------------------------------------------


def station_ages(census: pd.DataFrame, r6: pd.DataFrame, stations: sr.Stations) -> tuple[Ages, Ages, int]:
    """セルの年齢 → 駅 × 半径の整数の区分（年 → 区分 × 駅 × 半径）・実績の年の年齢不詳・半径の直しで移した人数。"""
    ages, unknown, moved = {}, {}, 0
    for year in CENSUS_YEARS:
        floats = census_floats(year, census[census["year"] == year], stations)
        ages[year], count = to_integers(floats, "")
        unknown[year] = np.rint(sr.monotone(floats["unknown"])).astype(np.int64)
        moved += count
    floats = r6_floats(r6, stations)
    for year in PRED_YEARS:
        ages[year], count = to_integers(floats, f"_{year}")
        moved += count
    return ages, unknown, moved


def build(stations: sr.Stations, out_dir: Path) -> list[str]:
    """作って照合し、崩れていなければ書き出す。戻り値は崩れた点（空なら書き出した）。"""
    census = pd.concat([census_age_cells(year) for year in CENSUS_YEARS], ignore_index=True)
    r6 = r6_age_cells()
    ages, unknown, moved = station_ages(census, r6, stations)
    problems = check_totals(stations, ages)
    if problems:
        return problems
    out_dir.mkdir(parents=True, exist_ok=True)
    census.to_parquet(out_dir / CENSUS_AGE_CELLS.name, index=False)
    r6.to_parquet(out_dir / R6_AGE_CELLS.name, index=False)
    arrays = {**metric_arrays(ages), **flag_arrays(ages, unknown[2020])}
    station_table(stations, arrays).to_csv(out_dir / STATION_AGE_CSV.name, index=False)
    profile_table(stations, ages, unknown).to_csv(out_dir / STATION_AGE_PROFILES_CSV.name, index=False)
    print(f"  半径の直し：{moved:,} 人を移した（区分が半径を広げて 1 人減ったところ）")
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="駅 × 半径の年齢（第 1 段・第 2 段）を作る")
    parser.add_argument("--stations", help="この駅だけ（grp をカンマで区切る）")
    parser.add_argument("--out", type=Path, default=DERIVED_DIR, help="書き出す先（既定は data/derived）")
    args = parser.parse_args()
    started = time.time()
    only = tuple(args.stations.split(",")) if args.stations else None
    problems = build(sr.read_stations(only=only), args.out)
    if problems:
        print("\n".join(["照合が崩れた（書き出していない）:", *problems]))
        return 1
    print(f"OK {args.out}：{STATION_AGE_CSV.name}・{STATION_AGE_PROFILES_CSV.name}（{time.time() - started:.0f} 秒）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
