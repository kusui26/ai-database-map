"""エリアの区域の値（B5a・2026-10-10）— build の照合を使わない独立の検証。

build_area_values.py・build_line_corridors.py が書いた CSV を、別の経路で確かめる（全 PASS で exit 0）。

1. **推計＝社人研**：行政区域の将来推計人口（R6 を市区町村ごとに足したもの）が、社人研の地域別推計（令和 5 年推計・
   結果表 xlsx）と 2020〜2050 年のすべての市区町村・政令市・都道府県で 1 人単位で一致する
2. **固定値**：公表値（横浜市・川崎市・全国…）と一致する（`area_rules.ANCHORS`）
3. **沿線の不変条件**（駅の半径の値 `station_dataset.csv` と比べる）
   - 沿線 ≥ その路線のどの駅の円の値（同じ幅）・沿線 ≤ 駅の円の値の和（円は重なりうる）
   - **円が重ならない路線では、沿線＝駅の円の値の和**（同じ方法で作っていることの確かめ）
4. **形**：全路線 × 3 幅がそろう・駅の数が路線の駅の数と合う・区域の鍵が重ならない・区域の値の鍵がカタログにある
5. **人口の年齢**（2026-11-25）
   - 4 区分の和＝人口（実績）・＝将来推計人口（推計）：行政区域と沿線のすべて
   - 社人研の年齢別の推計（5 歳階級を 4 区分へ）と：2020 年（実績）は 1 人単位で一致・2025〜2050 年は各区分 10 人以内
   - 沿線：駅の年齢の表（`station_age_profiles.csv`）と比べて、最大の駅の円 ≤ 沿線 ≤ 駅の円の和・円が重ならない沿線は和と一致
6. `--mesh`（任意・約 5 分）：メッシュを市区町村へ按分した値と公表値のずれ（計画書 §6.12.4 a の表を再現する）

    python3 pipeline/validate_area_values.py
    python3 pipeline/validate_area_values.py --mesh
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_common import (  # noqa: E402
    AREA_CATALOG_JSON,
    AREA_UNITS_CSV,
    AREA_VALUES_CSV,
    DERIVED_DIR,
    IPSS_XLSX,
    LINE_CORRIDOR_VALUES_CSV,
    LINE_CORRIDORS_CSV,
    read_csv,
)
from age_rules import BANDS, STATION_AGE_PROFILES_CSV  # noqa: E402
from area_rules import (  # noqa: E402
    AGE_ACTUAL_YEARS,
    AGE_KEY_PREFIXES,
    AGE_PRED_YEARS,
    ANCHORS,
    IPSS_LAST_YEAR,
    LINE_WIDTHS_M,
    RADIUS_SUFFIX,
    age_key,
)

#: 駅の値は整数に四捨五入してあるので、駅 1 つにつき 0.5 まで許す（沿線との比べ方）。
#: 実測（2026-10-10）：円の重ならない 6,042 組で、差は駅 1 つあたり最大 0.48＝丸めの分だけ。
STATION_ROUNDING = 0.5
#: 駅の年齢の表は 4 区分の和が総数になるように整数へ割り振ってある（最大剰余）ので、区分ごとには駅 1 つにつき 1 人まで許す。
STATION_AGE_ROUNDING = 1.0
#: 推計の年齢（R6 の PTN × 構成の和）と社人研の年齢別の推計の差の許し（各区分・人。計画書 261122 §8.3：最大 9 人）。
IPSS_AGE_TOLERANCE = 10
#: 社人研の結果表の 5 歳階級の列（0〜4 歳が 7 列目＝index 6 … 95 歳以上が index 25）→ 4 区分。
IPSS_AGE_COLUMNS: dict[str, range] = {"0_14": range(6, 9), "15_64": range(9, 19), "65_74": range(19, 21), "75plus": range(21, 26)}
#: 4 区分の和と総数の比べ方：公表値は 1 人単位、推計と按分は浮動小数の誤差（相対）と、CSV の桁（小数 4 桁に丸めて書く
#: ＝1 つの値で ±0.00005、4 区分と総数の 5 つで 0.00025）の大きい方。総数 24 人の沿線では、丸めだけで 0.0001 ずれる。
EXACT_TOLERANCE = 0.5
FLOAT_TOLERANCE = 1e-6
CSV_ROUNDING_TOLERANCE = 5 * 0.5e-4


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        if not ok:
            self.failed.append(name)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def load_values(path: Path) -> dict[tuple[str, str], float]:
    return {(row["area_key"], row["metric_key"]): float(row["value"]) for row in read_csv(path)}


# --- 1. 推計＝社人研 -----------------------------------------------------------------------------


def read_ipss() -> pd.DataFrame:
    """社人研の結果表 → (area_key, year, total, 4 区分)。浜通り（9）はまとめた値なので除く。"""
    import openpyxl

    if not IPSS_XLSX.exists():
        raise SystemExit(f"{IPSS_XLSX} がありません（pipeline/fetch_area_stats.py が落とす）")
    sheet = openpyxl.load_workbook(IPSS_XLSX, read_only=True).worksheets[0]
    rows = []
    for row in sheet.iter_rows(min_row=6, values_only=True):
        code, kind, _pref, _muni, year, total = row[:6]
        if code is None or year is None or kind in (9, "9"):
            continue
        code5 = str(code).zfill(5)
        key = f"pref:{code5[:2]}" if kind == "a" else f"muni:{code5}"
        bands = [float(sum(row[i] for i in IPSS_AGE_COLUMNS[band])) for band in BANDS]
        rows.append((key, int(str(year).rstrip("年")), float(total), *bands))
    return pd.DataFrame(rows, columns=["area_key", "year", "total", *(f"b{band}" for band in BANDS)])


def check_ipss(checks: Checks, values: dict[tuple[str, str], float]) -> None:
    ipss = read_ipss()
    compared = mismatched = absent = 0
    examples = []
    for row in ipss.itertuples(index=False):
        ours = values.get((row.area_key, f"pop_pred_2024_{row.year}"))
        if ours is None:
            absent += 1
            continue
        compared += 1
        if round(ours) != round(row.total):
            mismatched += 1
            if len(examples) < 5:
                examples.append(f"{row.area_key} {row.year}: {ours:,.1f} / 社人研 {row.total:,.0f}")
    years = sorted(ipss["year"].unique())
    checks.add(
        mismatched == 0 and compared > 13_000 and years[-1] == IPSS_LAST_YEAR,
        "推計（R6 の市区町村ごとの合計）が社人研の地域別推計と 1 人単位で一致",
        f"{compared:,} 組（{years[0]}〜{years[-1]} 年）・不一致 {mismatched}・こちらに無い {absent}（浜松の旧区・浜通り）"
        + (f"・例 {examples}" if examples else ""),
    )
    check_ipss_age(checks, values, ipss)


def check_ipss_age(checks: Checks, values: dict[tuple[str, str], float], ipss: pd.DataFrame) -> None:
    """年齢の 4 区分と社人研：2020 年（実績＝不詳補完値）は 1 人単位、推計（R6 の PTN × 構成の和）は各区分 10 人以内。"""
    actual = ipss[ipss["year"].isin(AGE_ACTUAL_YEARS)]
    actual_compared, actual_wrong = 0, []
    for row in actual.itertuples(index=False):
        for band in BANDS:
            ours = values.get((row.area_key, age_key(band, row.year)))
            if ours is not None:
                actual_compared += 1
                if round(ours) != round(getattr(row, f"b{band}")):
                    actual_wrong.append(f"{row.area_key} {row.year} {band}")
    checks.add(actual_compared > 7_000 and not actual_wrong,
               "年齢の実績（不詳補完値の表）が社人研の推計の 2020 年（実績）と 1 人単位で一致",
               f"{actual_compared:,} 組・不一致 {len(actual_wrong)}" + (f"・例 {actual_wrong[:3]}" if actual_wrong else ""))
    gaps = [abs(ours - getattr(row, f"b{band}"))
            for row in ipss[ipss["year"].isin(AGE_PRED_YEARS)].itertuples(index=False) for band in BANDS
            if (ours := values.get((row.area_key, age_key(band, row.year)))) is not None]
    series = pd.Series(gaps, dtype=float)
    checks.add(len(series) > 40_000 and float(series.max()) <= IPSS_AGE_TOLERANCE,
               f"年齢の推計（R6 の PTN × 構成の和）が社人研の年齢別の推計と各区分 {IPSS_AGE_TOLERANCE} 人以内",
               f"{len(series):,} 組（{AGE_PRED_YEARS[0]}〜{AGE_PRED_YEARS[-1]} 年 × 4 区分）・最大 {series.max():.1f} 人・"
               f"4 人以内 {(series <= 4).mean():.1%}")


# --- 2. 固定値 ----------------------------------------------------------------------------------


def check_anchors(checks: Checks, values: dict[tuple[str, str], float]) -> None:
    wrong = [f"{k} {m}: {values.get((k, m))} ≠ {v:,}" for (k, m), v in ANCHORS.items()
             if values.get((k, m)) is None or round(values[(k, m)]) != v]
    checks.add(not wrong, f"固定値（公表値 {len(ANCHORS)} 個）と一致", "; ".join(wrong[:5]))


# --- 3. 沿線の不変条件 ------------------------------------------------------------------------


@dataclass(frozen=True)
class Corridor:
    """沿線 1 つ（区域の鍵・幅・路線の駅・駅の円が重ならないか）。"""

    key: str
    width: int
    grps: list[str]
    apart: bool


def read_corridors(checks: Checks) -> list[Corridor]:
    """沿線の一覧（形：全路線 × 3 幅・駅の数も確かめる）と、駅の円が重ならないか（正積図法で 2 × 幅 ＋ 1m より離れる）。"""
    corridors = read_csv(LINE_CORRIDORS_CSV)
    lines = read_csv(DERIVED_DIR / "lines.csv")
    members: dict[int, list[str]] = defaultdict(list)
    for row in read_csv(DERIVED_DIR / "line_stations.csv"):
        members[int(row["line_cd"])].append(row["grp"])
    have = {(int(c["line_cd"]), int(c["width_m"])) for c in corridors}
    want = {(int(row["line_cd"]), w) for row in lines for w in LINE_WIDTHS_M}
    counts_ok = all(int(c["station_count"]) == len(set(members[int(c["line_cd"])])) for c in corridors)
    checks.add(have == want and counts_ok, "沿線が全路線 × 3 幅そろい、駅の数が路線の駅の数と合う",
               f"{len(have):,}／{len(want):,}")

    from area_mesh import to_albers

    stations = pd.read_csv(DERIVED_DIR / "station_dataset.csv", usecols=["grp", "lon", "lat"]).set_index("grp")
    xy = dict(zip(stations.index, zip(*to_albers(stations["lon"].to_numpy(), stations["lat"].to_numpy()))))
    out = []
    for corridor in corridors:
        width = int(corridor["width_m"])
        grps = sorted(set(members[int(corridor["line_cd"])]))
        points = np.array([xy[g] for g in grps])
        gaps = np.sqrt(((points[:, None, :] - points[None, :, :]) ** 2).sum(axis=2))
        np.fill_diagonal(gaps, np.inf)
        out.append(Corridor(corridor["key"], width, grps, len(grps) == 1 or float(gaps.min()) > 2 * width + 1.0))
    return out


@dataclass
class Bounds:
    """沿線と駅の円の値の比べ（最大の駅の円 ≤ 沿線 ≤ 駅の円の和・重ならなければ和と一致）の数え。"""

    rounding: float
    below_max: int = 0
    above_sum: int = 0
    exact_checked: int = 0
    exact_wrong: int = 0
    worst_exact: float = 0.0

    def add(self, ours: float, per_station: np.ndarray, apart: bool) -> None:
        tolerance = self.rounding * len(per_station)
        self.below_max += int(ours < per_station.max() - self.rounding)
        self.above_sum += int(ours > per_station.sum() + tolerance)
        if apart:
            gap = abs(ours - per_station.sum())
            self.exact_checked += 1
            self.worst_exact = max(self.worst_exact, gap / len(per_station))
            self.exact_wrong += int(gap > tolerance)

    def report(self, checks: Checks, what: str, why_rounding: str) -> None:
        checks.add(self.below_max == 0, f"{what}：沿線 ≥ その路線のどの駅の円の値（同じ幅）", f"崩れ {self.below_max}")
        checks.add(self.above_sum == 0, f"{what}：沿線 ≤ 駅の円の値の和（重なりを二重に数えない）", f"崩れ {self.above_sum}")
        checks.add(self.exact_checked > 100 and self.exact_wrong == 0,
                   f"{what}：円が重ならない沿線は、駅の円の値の和と一致（駅の値と同じ方法）",
                   f"{self.exact_checked:,} 組・駅 1 つあたりの差は最大 {self.worst_exact:.2f}（{why_rounding}）・"
                   f"崩れ {self.exact_wrong}")


def check_corridors(checks: Checks, values: dict[tuple[str, str], float], corridors: list[Corridor]) -> None:
    """年齢以外の指標：駅の値（`station_dataset.csv` の同じ名前の列）と比べる。"""
    catalog = json.loads(AREA_CATALOG_JSON.read_text(encoding="utf-8"))
    line_metrics = [m["key"] for m in catalog["metrics"]
                    if m["sources"]["line"] is not None and m["baseMetric"] not in AGE_KEY_PREFIXES.values()]
    columns = {f"{m}_{RADIUS_SUFFIX[w]}" for m in line_metrics for w in LINE_WIDTHS_M}
    stations = pd.read_csv(DERIVED_DIR / "station_dataset.csv", usecols=["grp", *sorted(columns)]).set_index("grp")
    bounds = Bounds(STATION_ROUNDING)
    for corridor in corridors:
        for metric in line_metrics:
            per_station = stations.loc[corridor.grps, f"{metric}_{RADIUS_SUFFIX[corridor.width]}"].to_numpy(dtype=float)
            bounds.add(values[(corridor.key, metric)], per_station, corridor.apart)
    bounds.report(checks, "人口・推計・事業所・従業者", "駅の値は整数に丸め")


def check_age_corridors(checks: Checks, values: dict[tuple[str, str], float], corridors: list[Corridor]) -> None:
    """年齢：駅の年齢の表（`station_age_profiles.csv`・駅 × 半径 × 年の 4 区分）と比べる。"""
    profiles = pd.read_csv(STATION_AGE_PROFILES_CSV)
    by_radius_year = {key: frame.set_index("grp") for key, frame in profiles.groupby(["radius_m", "year"])}
    bounds = Bounds(STATION_AGE_ROUNDING)
    for corridor in corridors:
        for year in AGE_ACTUAL_YEARS + AGE_PRED_YEARS:
            frame = by_radius_year[(corridor.width, year)]
            for band in BANDS:
                per_station = frame.loc[corridor.grps, f"age{band}"].to_numpy(dtype=float)
                bounds.add(values[(corridor.key, age_key(band, year))], per_station, corridor.apart)
    bounds.report(checks, "年齢の 4 区分", "駅の年齢の表は和が総数になるよう整数へ割り振ってある")


# --- 4. 形 -------------------------------------------------------------------------------------


def check_shape(checks: Checks) -> None:
    units = read_csv(AREA_UNITS_CSV)
    corridors = read_csv(LINE_CORRIDORS_CSV)
    keys = [u["key"] for u in units] + [c["key"] for c in corridors]
    checks.add(len(keys) == len(set(keys)), "区域の鍵が重ならない", f"{len(keys):,} 区域")
    catalog = {m["key"] for m in json.loads(AREA_CATALOG_JSON.read_text(encoding="utf-8"))["metrics"]}
    stray = set()
    for path in (AREA_VALUES_CSV, LINE_CORRIDOR_VALUES_CSV):
        for row in read_csv(path):
            if row["metric_key"] not in catalog:
                stray.add(row["metric_key"])
    checks.add(not stray, "区域の値の鍵がすべてカタログにある", f"{sorted(stray)[:5]}")
    kinds = defaultdict(int)
    for unit in units:
        kinds[unit["kind"]] += 1
    checks.add(
        kinds["prefecture"] == 47 and kinds["city"] == 20 and kinds["special_wards"] == 1 and kinds["ward"] == 171,
        "都道府県 47・政令市 20・東京 23 区 1・政令市の区 171",
        json.dumps(dict(kinds), ensure_ascii=False),
    )
    parents = {u["key"] for u in units}
    orphans = [u["key"] for u in units if u["parent_key"] and u["parent_key"] not in parents]
    checks.add(not orphans, "親の区域がすべてある", f"{orphans[:5]}")


# --- 5. 人口の年齢 -------------------------------------------------------------------------------


def check_age_totals(checks: Checks, admin: dict[tuple[str, str], float], lines: dict[tuple[str, str], float]) -> None:
    """4 区分の和＝人口（実績）・＝将来推計人口（推計）。行政区域の実績は公表値どうし 1 人単位、ほかは浮動小数の誤差だけ。"""
    compared = 0
    wrong: list[str] = []
    for label, values in (("行政区域", admin), ("沿線", lines)):
        for area in sorted({key for key, _ in values}):
            for year in AGE_ACTUAL_YEARS + AGE_PRED_YEARS:
                bands = [values.get((area, age_key(band, year))) for band in BANDS]
                if all(value is None for value in bands):
                    continue
                total_key = f"pop_{year}" if year in AGE_ACTUAL_YEARS else f"pop_pred_2024_{year}"
                total = values.get((area, total_key))
                if total is None or any(value is None for value in bands):
                    wrong.append(f"{area} {year}：区分か総数が欠ける")
                    continue
                compared += 1
                exact = label == "行政区域" and year in AGE_ACTUAL_YEARS
                tolerance = EXACT_TOLERANCE if exact else max(FLOAT_TOLERANCE * total, CSV_ROUNDING_TOLERANCE)
                if abs(sum(value for value in bands if value is not None) - total) > tolerance:
                    wrong.append(f"{area} {year}")
    checks.add(compared > 25_000 and not wrong, "年齢の 4 区分の和＝人口（実績）・将来推計人口（推計）（行政区域・沿線）",
               f"{compared:,} 組・崩れ {len(wrong)}" + (f"・例 {wrong[:3]}" if wrong else ""))


# --- 6. メッシュの按分と公表値のずれ（任意） --------------------------------------------------------


def check_mesh(checks: Checks, values: dict[tuple[str, str], float]) -> None:
    """メッシュを市区町村（N03 2026）へ按分した値と、公表値のずれ（§6.12.4 a）。

    セルが市区町村の境界をまたぐときは、セルの陸地の部分（どれかの市区町村に入る部分）の面積の割合で割り振る。
    """
    import zipfile

    import pyogrio
    import shapely

    from area_mesh import ALBERS_PROJ, cell_polygons, read_census_mesh, read_econ_mesh
    from fetch_admin_boundaries import DEST as N03_ZIP

    with zipfile.ZipFile(N03_ZIP) as zf:
        shp = next(n for n in zf.namelist() if n.endswith(".shp") and "_prefecture" not in n)
    polygons = pyogrio.read_dataframe(f"zip://{N03_ZIP}!{shp}", columns=["N03_007"]).to_crs(ALBERS_PROJ)
    polygons = polygons[polygons["N03_007"].notna()].reset_index(drop=True)
    tree = shapely.STRtree(polygons.geometry.values)

    def apportion(codes: pd.Series, amounts: np.ndarray) -> pd.Series:
        cells = cell_polygons(codes)
        cell_index, poly_index = tree.query(cells, predicate="intersects")
        # 1 つの面にしか触れないセル（大半）は、陸地の部分がすべてその市区町村＝重なりを測るまでもない
        hits = np.bincount(cell_index, minlength=len(cells))
        shared = hits[cell_index] > 1
        overlap = np.ones(len(cell_index))
        overlap[shared] = shapely.area(
            shapely.intersection(cells[cell_index[shared]], polygons.geometry.values[poly_index[shared]])
        )
        frame = pd.DataFrame({"cell": cell_index, "muni": polygons["N03_007"].to_numpy()[poly_index], "overlap": overlap})
        frame["land"] = frame.groupby("cell")["overlap"].transform("sum")
        frame = frame[frame["land"] > 0]
        frame["share"] = amounts[frame["cell"].to_numpy()] * frame["overlap"] / frame["land"]
        return frame.groupby("muni")["share"].sum()

    def compare(label: str, apportioned: pd.Series, metric: str, median_limit: float) -> None:
        errors = []
        for code, got in apportioned.items():
            official = values.get((f"muni:{str(code).zfill(5)}", metric))
            if official and official > 0:
                errors.append(abs(got / official - 1))
        series = pd.Series(errors)
        detail = (f"{len(series):,} 市区町村・中央値 {series.median():.2%}・上位 1 割 {series.quantile(0.9):.2%}・"
                  f"最大 {series.max():.1%}・1% 以内 {(series < 0.01).mean():.1%}")
        checks.add(len(series) > 1_800 and series.median() < median_limit, f"メッシュの按分と公表値のずれ（{label}）", detail)

    census = read_census_mesh(2020)
    compare("人口 2020・250m", apportion(census["code"], census["pop"].to_numpy()), "pop_2020", 0.005)
    econ = read_econ_mesh(2021)
    compare("事業所 2021・500m", apportion(econ["code"], econ["estab"].to_numpy()), "estab_n_2021", 0.01)
    compare("従業者 2021・500m", apportion(econ["code"], econ["emp"].to_numpy()), "emp_n_2021", 0.015)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--mesh", action="store_true", help="メッシュの按分と公表値のずれも測る（約 5 分）")
    args = parser.parse_args()
    checks = Checks()
    admin = load_values(AREA_VALUES_CSV)
    lines = load_values(LINE_CORRIDOR_VALUES_CSV)
    check_shape(checks)
    check_anchors(checks, admin)
    check_ipss(checks, admin)
    corridors = read_corridors(checks)
    check_corridors(checks, lines, corridors)
    check_age_corridors(checks, lines, corridors)
    check_age_totals(checks, admin, lines)
    if args.mesh:
        check_mesh(checks, admin)
    print(f"\n{checks.total - len(checks.failed)}/{checks.total} PASS")
    return 0 if not checks.failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
