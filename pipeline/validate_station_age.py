"""駅 × 半径の年齢を、作り方とは別の道で確かめる（2026-11-24・人口の年齢 PR-1）。

build_station_age.py の書き出し（station_age.csv・station_age_profiles.csv・セルの parquet）を読み、元の表と照合する：

  (a) 形：列（第 1 段の 66 列・フラグ 12 列）・駅・第 2 段の行（駅 × 6 半径 × 8 年）・年齢不詳は実績の年だけ
  (b) 和：第 2 段の 4 区分の和 ＝ 既存の総数の列（`pop_<年>_*`・`pop_pred_2024_<年>_*`）。全駅・全半径・全年
  (c) 区分：0 以上・半径を広げて減らない
  (d) 第 1 段 ＝ 第 2 段から作り直した値（指標 11・フラグ 2）
  (e) 割合：0〜100・3 区分の割合の和 ＝ 100（小数 1 桁の丸めの分だけ）
  (f) セル：4 区分の和 ＝ セルの総数。全国の総数 ＝ 公表値。全国の 4 区分 ≈ 不詳補完値の全国（国勢調査）・
      ＝ R6 の年齢の列の全国の和（R6）
  (g) 市区町村：セルを市区町村ごとに足した年齢の割合 ≈ 公式の不詳補完値の割合（人口 5 万人以上の市区町村）
  (h) 既知の駅：作った時点の値（計画書 §2.5 の駅など。値が動いたら理由を確かめる）

    python3 pipeline/validate_station_age.py            # data/derived を確かめる（全 PASS で exit 0）
    python3 pipeline/validate_station_age.py --dir DIR  # ほかの書き出し先（わざと壊す検査で使う）
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from age_cells import BAND_COLUMNS, r6_parts, read_r6_age  # noqa: E402
from age_muni import band_table  # noqa: E402
from age_rules import (  # noqa: E402
    AGE_UNKNOWN_NOTICE_SHARE,
    BANDS,
    CENSUS_AGE_CELLS,
    CENSUS_YEARS,
    DERIVED_DIR,
    FLAG_PREFIXES,
    LOWBASE_65_PEOPLE,
    METRIC_PREFIXES,
    MUNI_CODE_RENAMES,
    NATIONAL_CODE,
    PRED_YEARS,
    PROFILE_YEARS,
    R6_AGE_CELLS,
    STATION_AGE_CSV,
    STATION_AGE_PROFILES_CSV,
    muni_age_table,
)
from area_rules import ANCHORS  # noqa: E402
from station_radii import RADII_M, RADIUS_NAMES, STATION_DATASET_CSV, column_names  # noqa: E402

PROFILE_BANDS: tuple[str, ...] = tuple(f"age{band}" for band in BANDS)
#: 駅の数（全駅を作ったとき）。
STATION_COUNT = 9273
#: セルの 4 区分の和と総数の差の許し（浮動小数の誤差だけ）。
CELL_SUM_TOLERANCE = 1e-6
#: 全国の 4 区分と不詳補完値の全国の差の許し（割合）。セルを中心で市区町村へ寄せる分だけずれる。
CENSUS_NATIONAL_TOLERANCE = 0.0005
#: R6 の全国の 4 区分と、R6 の年齢の列の全国の和の差の許し（人）。
R6_NATIONAL_TOLERANCE_PEOPLE = 1.0
#: 市区町村の照合の対象（公式の総数がこの人数以上）と、年齢の割合の差の許し（ポイント）。
MUNI_MIN_POPULATION = 50_000
MUNI_SHARE_TOLERANCE_PT = 1.0
#: 3 区分の割合の和と 100 の差の許し（小数 1 桁に丸めた 3 つの和）。
SHARE_SUM_TOLERANCE = 0.15
#: 既知の駅（1km・2026-11-24 に作った値）。(grp, 列) → 値。計画書 §2.5 の駅・年齢不詳の多い駅・秘匿で崩れていた駅。
#: 方式 A の概算（計画書 §2.5）との差は割合で 0.7 ポイント以内。値が動いたら、元のデータか作り方が変わった理由を確かめる。
KNOWN_STATIONS: dict[tuple[str, str], float] = {
    ("武蔵小杉#0", "pop15_64_2020_1km"): 55863,
    ("武蔵小杉#0", "pop15_64_share_2020_1km"): 74.1,
    ("武蔵小杉#0", "pop65_share_2020_1km"): 12.7,
    ("武蔵小杉#0", "pop65_share_pred_2024_2050_1km"): 25.2,
    ("たまプラーザ#0", "pop15_64_gr_pred_2024_2050_1km"): -19.1,
    ("たまプラーザ#0", "pop65_gr_pred_2024_2050_1km"): 116.5,
    ("矢場町#0", "pop15_64_gr_2020_2015_1km"): 16.7,
    ("矢場町#0", "pop_ageunk_2020_1km"): 1,
    ("大安#0", "pop15_64_share_2020_1km"): 68.8,
    ("東京#0", "pop15_64_2020_1km"): 3239,
}


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        if not ok:
            self.failed.append(name)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def existing_totals(grps: list[str]) -> pd.DataFrame:
    """station_dataset.csv の総数の列（実績・推計）。"""
    prefixes = [f"pop_{year}" if year in CENSUS_YEARS else f"pop_pred_2024_{year}" for year in PROFILE_YEARS]
    columns = [name for prefix in prefixes for name in column_names(prefix)]
    return pd.read_csv(STATION_DATASET_CSV, usecols=["grp", *columns]).set_index("grp").loc[grps]


def total_column(year: int, radius_m: int) -> str:
    prefix = f"pop_{year}" if year in CENSUS_YEARS else f"pop_pred_2024_{year}"
    return f"{prefix}_{RADIUS_NAMES[radius_m]}"


# --- (a)〜(e) 駅 -------------------------------------------------------------------


def check_shape(checks: Checks, ages: pd.DataFrame, profiles: pd.DataFrame) -> None:
    want = ["grp", *[name for prefix in (*METRIC_PREFIXES, *FLAG_PREFIXES) for name in column_names(prefix)]]
    checks.add(list(ages.columns) == want, "(a) 列：第 1 段 66 列＋フラグ 12 列（並びも）",
               f"{len(ages.columns) - 1} 列（指標 {len(METRIC_PREFIXES) * len(RADII_M)}・フラグ {len(FLAG_PREFIXES) * len(RADII_M)}）")
    known = set(pd.read_csv(STATION_DATASET_CSV, usecols=["grp"])["grp"])
    full = len(ages) == STATION_COUNT
    checks.add(ages["grp"].is_unique and set(ages["grp"]) <= known, "(a) 駅：重ならない・station_dataset.csv の駅",
               f"{len(ages):,} 駅{'（全駅）' if full else '（一部の駅）'}")
    keys = profiles[["grp", "radius_m", "year"]]
    shape_ok = (len(profiles) == len(ages) * len(RADII_M) * len(PROFILE_YEARS) and not keys.duplicated().any()
                and set(profiles["year"]) == set(PROFILE_YEARS) and set(profiles["radius_m"]) == set(RADII_M))
    checks.add(shape_ok, "(a) 第 2 段：駅 × 6 半径 × 8 年（重ならない）", f"{len(profiles):,} 行")
    census = profiles["year"].isin(CENSUS_YEARS)
    unknown_ok = profiles.loc[census, "age_unknown"].notna().all() and profiles.loc[~census, "age_unknown"].isna().all()
    checks.add(bool(unknown_ok), "(a) 年齢不詳（補う前）は実績の年（2015・2020）だけ")


def check_sums(checks: Checks, profiles: pd.DataFrame, totals: pd.DataFrame) -> None:
    summed = profiles[list(PROFILE_BANDS)].sum(axis=1)
    mismatches, worst = 0, 0
    for (year, radius_m), rows in profiles.groupby(["year", "radius_m"]):
        diff = summed[rows.index].to_numpy() - totals.loc[rows["grp"], total_column(year, radius_m)].to_numpy()
        mismatches += int((diff != 0).sum())
        worst = max(worst, int(np.abs(diff).max()))
    checks.add(mismatches == 0, "(b) 4 区分の和 ＝ 既存の総数（全駅・全半径・全年）", f"ずれ {mismatches} 件・最大 {worst} 人")


def check_bands(checks: Checks, profiles: pd.DataFrame) -> None:
    values = profiles[[*PROFILE_BANDS, "age_unknown"]]
    checks.add(bool((values.fillna(0) >= 0).all().all()), "(c) 区分・年齢不詳は 0 以上")
    ordered = profiles.sort_values(["grp", "year", "radius_m"])
    steps = ordered.groupby(["grp", "year"])[list(PROFILE_BANDS)].diff().dropna()
    checks.add(bool((steps >= 0).all().all()), "(c) どの区分も半径を広げて減らない", f"減った {int((steps < 0).sum().sum())} 件")


def _wide(profiles: pd.DataFrame, year: int, column: str) -> pd.DataFrame:
    """第 2 段 → 駅 × 半径（その年のその列）。"""
    rows = profiles[profiles["year"] == year]
    return rows.pivot(index="grp", columns="radius_m", values=column)[list(RADII_M)]


def _share(part: pd.DataFrame, total: pd.DataFrame) -> pd.DataFrame:
    return (part / total.where(total > 0) * 100).round(1)


def _growth(new: pd.DataFrame, old: pd.DataFrame) -> pd.DataFrame:
    return ((new / old.where(old > 0) - 1) * 100).round(1)


def recomputed(profiles: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """第 2 段の整数から、第 1 段の指標とフラグを作り直す（build とは別の書き方で）。"""
    band = {year: {b: _wide(profiles, year, f"age{b}").astype(float) for b in BANDS} for year in PROFILE_YEARS}
    total = {year: sum(band[year].values()) for year in PROFILE_YEARS}
    old = {year: band[year]["65_74"] + band[year]["75plus"] for year in PROFILE_YEARS}
    unknown = _wide(profiles, 2020, "age_unknown").astype(float)
    return {
        "pop15_64_2020": band[2020]["15_64"],
        "pop15_64_share_2020": _share(band[2020]["15_64"], total[2020]),
        "pop65_share_2020": _share(old[2020], total[2020]),
        "pop15_64_gr_2020_2015": _growth(band[2020]["15_64"], band[2015]["15_64"]),
        "pop15_64_gr_pred_2024_2050": _growth(band[2050]["15_64"], band[2020]["15_64"]),
        "pop65_gr_pred_2024_2050": _growth(old[2050], old[2020]),
        "pop15_64_gr_pred_2024_2030": _growth(band[2030]["15_64"], band[2020]["15_64"]),
        "pop15_64_gr_pred_2024_2040": _growth(band[2040]["15_64"], band[2020]["15_64"]),
        "pop65_share_pred_2024_2050": _share(old[2050], total[2050]),
        "pop75_share_2020": _share(band[2020]["75plus"], total[2020]),
        "pop0_14_share_2020": _share(band[2020]["0_14"], total[2020]),
        "pop65_lowbase_2020": (old[2020] < LOWBASE_65_PEOPLE).astype(float),
        "pop_ageunk_2020": ((unknown / total[2020].where(total[2020] > 0)).fillna(0) >= AGE_UNKNOWN_NOTICE_SHARE).astype(float),
    }


def check_recomputed(checks: Checks, ages: pd.DataFrame, profiles: pd.DataFrame) -> None:
    indexed = ages.set_index("grp")
    broken = []
    for prefix, frame in recomputed(profiles).items():
        want = frame.loc[indexed.index].to_numpy(dtype=float)
        got = indexed[column_names(prefix)].to_numpy(dtype=float)
        if not np.array_equal(want, got, equal_nan=True):
            broken.append(prefix)
    checks.add(not broken, "(d) 第 1 段 ＝ 第 2 段から作り直した値（指標 11・フラグ 2）", f"{broken}")


def check_rates(checks: Checks, ages: pd.DataFrame) -> None:
    shares = [name for prefix in METRIC_PREFIXES if "_share_" in prefix for name in column_names(prefix)]
    values = ages[shares]
    checks.add(bool(((values >= 0) & (values <= 100) | values.isna()).all().all()), "(e) 割合は 0〜100")
    worst = 0.0
    for radius in RADII_M:
        parts = [f"{prefix}_{RADIUS_NAMES[radius]}" for prefix in ("pop0_14_share_2020", "pop15_64_share_2020", "pop65_share_2020")]
        summed = ages[parts].sum(axis=1, min_count=3).dropna()
        worst = max(worst, float((summed - 100).abs().max()))
    checks.add(worst <= SHARE_SUM_TOLERANCE, "(e) 0〜14・15〜64・65 歳以上の割合の和 ＝ 100（丸めの分だけ）", f"最大のずれ {worst:.2f}")


# --- (f)〜(g) セル・市区町村 ---------------------------------------------------------------


def check_census_cells(checks: Checks, census: pd.DataFrame) -> None:
    gap = (census[list(BAND_COLUMNS)].sum(axis=1) - census["total"]).abs()
    negative = int((census[[*BAND_COLUMNS, "unknown"]] < -CELL_SUM_TOLERANCE).sum().sum())
    checks.add(float(gap.max()) <= CELL_SUM_TOLERANCE and negative == 0, "(f) 国勢調査のセル：4 区分の和 ＝ 総数・0 以上",
               f"最大の差 {float(gap.max()):.1e}・負 {negative}")
    for year in CENSUS_YEARS:
        cells = census[census["year"] == year]
        official = band_table(muni_age_table(year, imputed=True)).loc[NATIONAL_CODE]
        total_ok = round(float(cells["total"].sum())) == ANCHORS[("jp", f"pop_{year}")]
        diffs = {band: float(cells[f"b{band}"].sum() / official[band] - 1) for band in BANDS}
        worst = max(abs(value) for value in diffs.values())
        checks.add(total_ok and worst <= CENSUS_NATIONAL_TOLERANCE, f"(f) {year} 年の全国：総数 ＝ 公表値・4 区分 ≈ 不詳補完値",
                   "  ".join(f"{band} {value:+.4%}" for band, value in diffs.items()))


def check_r6_cells(checks: Checks, r6: pd.DataFrame) -> None:
    raw = read_r6_age()
    worst_cell, worst_national = 0.0, 0.0
    for year in PRED_YEARS:
        bands = r6[[f"{column}_{year}" for column in BAND_COLUMNS]]
        worst_cell = max(worst_cell, float((bands.sum(axis=1) - r6[f"total_{year}"]).abs().max()))
        worst_national = max(worst_national, float(np.abs(bands.sum().to_numpy() - r6_parts(raw, year).sum(axis=0)).max()))
    checks.add(worst_cell <= CELL_SUM_TOLERANCE, "(f) R6 のセル：4 区分の和 ＝ PTN（真の総数）", f"最大の差 {worst_cell:.1e}")
    checks.add(worst_national <= R6_NATIONAL_TOLERANCE_PEOPLE, "(f) R6 の全国の 4 区分 ＝ R6 の年齢の列の全国の和（6 年）",
               f"最大の差 {worst_national:.3f} 人")
    total_2050 = round(float(r6["total_2050"].sum()))
    checks.add(total_2050 == ANCHORS[("jp", "pop_pred_2024_2050")], "(f) R6 の 2050 年の全国 ＝ 公表値", f"{total_2050:,}")


def municipal_gaps(census: pd.DataFrame, year: int) -> pd.DataFrame:
    """市区町村（公式の総数 5 万人以上）× 区分：セルを足した割合 − 公式の不詳補完値の割合（ポイント）。"""
    official = band_table(muni_age_table(year, imputed=True)).rename(index=MUNI_CODE_RENAMES[year])
    cells = census[census["year"] == year].groupby("n03")[["total", *BAND_COLUMNS]].sum()
    common = official.index.intersection(cells.index)
    big = [code for code in common if official.loc[code, "total"] >= MUNI_MIN_POPULATION]
    mine = cells.loc[big, list(BAND_COLUMNS)].div(cells.loc[big, "total"], axis=0) * 100
    theirs = official.loc[big, list(BANDS)].div(official.loc[big, "total"], axis=0) * 100
    return pd.DataFrame(mine.to_numpy() - theirs.to_numpy(), index=big, columns=list(BANDS))


def check_municipal(checks: Checks, census: pd.DataFrame) -> None:
    for year in CENSUS_YEARS:
        gaps = municipal_gaps(census, year).abs()
        worst_code = gaps.max(axis=1).idxmax()
        checks.add(float(gaps.max().max()) <= MUNI_SHARE_TOLERANCE_PT,
                   f"(g) {year} 年の市区町村（{len(gaps):,} 区域・5 万人以上）：年齢の割合 ≈ 不詳補完値",
                   f"最大 {float(gaps.max().max()):.2f} pt（{worst_code}）・95% 点 {float(gaps.max(axis=1).quantile(0.95)):.2f} pt")


def check_known(checks: Checks, ages: pd.DataFrame) -> None:
    indexed = ages.set_index("grp")
    present = {key: value for key, value in KNOWN_STATIONS.items() if key[0] in indexed.index}
    off = {key: (value, indexed.loc[key[0], key[1]]) for key, value in present.items() if indexed.loc[key[0], key[1]] != value}
    checks.add(not off, f"(h) 既知の駅（{len(present)} 値）", f"{off}" if off else "")


def run(directory: Path) -> Checks:
    """書き出し先の 4 つのファイルを確かめる（station_age_fault_test.py からも呼ぶ）。"""
    ages = pd.read_csv(directory / STATION_AGE_CSV.name)
    profiles = pd.read_csv(directory / STATION_AGE_PROFILES_CSV.name, dtype={"age_unknown": "Int64"})
    census = pd.read_parquet(directory / CENSUS_AGE_CELLS.name)
    r6 = pd.read_parquet(directory / R6_AGE_CELLS.name)
    checks = Checks()
    check_shape(checks, ages, profiles)
    check_sums(checks, profiles, existing_totals(list(ages["grp"])))
    check_bands(checks, profiles)
    check_recomputed(checks, ages, profiles)
    check_rates(checks, ages)
    check_census_cells(checks, census)
    check_r6_cells(checks, r6)
    check_municipal(checks, census)
    check_known(checks, ages)
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="駅 × 半径の年齢を確かめる")
    parser.add_argument("--dir", type=Path, default=DERIVED_DIR, help="build_station_age.py の書き出し先")
    checks = run(parser.parse_args().dir)
    print(f"\n{checks.total - len(checks.failed)} / {checks.total} PASS")
    return 0 if not checks.failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
