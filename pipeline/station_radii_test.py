"""駅 × 半径の面積按分（`station_radii.py`）が、ノートブックの按分と同じであることを確かめる（2026-11-24）。

  1. 小さな作り例：円の中のセルは全量・外は 0・境のセルは重なりの割合（shapely で直に測った値と一致）・セルの面積・
     半径を広げて減った値をそろえる
  2. 再現：既存の列（ノートブックが作った `pop_2020_*`）を、全駅・全半径で 1 人単位まで再現する
     （`--all` で `pop_2015_*` と R6 の `pop_pred_2024_<年>_*` 全 11 年も。約 5 分）

    python3 pipeline/station_radii_test.py          # 作り例 ＋ 2020 年（約 2 分）
    python3 pipeline/station_radii_test.py --quick  # 作り例だけ
    python3 pipeline/station_radii_test.py --all    # 作り例 ＋ 2020・2015・R6
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
import station_radii as sr  # noqa: E402
from area_mesh import BUFFER_QUAD_SEGS, R6_COLUMNS, r6_cells  # noqa: E402

#: 作り例の格子：東京駅の近くの 1km メッシュ（533946 の 22）とその周り 3 × 3 の、250m セル 144 個。
GRID_HEAD = "533946"
#: 作り例の駅を置くセル（格子の真ん中あたり）。
CENTER_CELL = "5339462232"
#: 作り例の値の乱数の種（再現できるように固定）。
SEED = 7
#: 総当たりとの差の許し（20km の円の 32 角形は、内側と判定したセルの角を数 m 外に出しうる・値の割合で）。
BRUTE_FORCE_RTOL = 1e-4


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def grid_codes() -> pd.Series:
    """作り例の格子（3 × 3 の 1km メッシュ × 4 × 4 の 250m セル）。"""
    return pd.Series([f"{GRID_HEAD}{row}{col}{half}{quarter}"
                      for row in (1, 2, 3) for col in (1, 2, 3) for half in (1, 2, 3, 4) for quarter in (1, 2, 3, 4)])


def brute_force(geometry: sr.MeshGeometry, values: np.ndarray, sx: float, sy: float) -> np.ndarray:
    """近道（内側は全量）を使わず、全セルの重なりを shapely で測った按分（半径ごと）。"""
    polygons = shapely.polygons(geometry.rings)
    sums = []
    for radius_m in sr.RADII_M:
        circle = shapely.Point(sx, sy).buffer(radius_m, quad_segs=BUFFER_QUAD_SEGS)
        weights = shapely.area(shapely.intersection(polygons, circle)) / geometry.area_m2
        sums.append(float((values * weights).sum()))
    return np.array(sums)


def synthetic(checks: Checks) -> None:
    codes = grid_codes()
    geometry = sr.mesh_geometry(codes)
    checks.add(bool(np.allclose(geometry.area_m2, shapely.area(shapely.polygons(geometry.rings)), rtol=1e-9)),
               "セルの面積（靴紐公式）＝ shapely の面積", f"{geometry.area_m2.min():,.0f}〜{geometry.area_m2.max():,.0f} m²")
    values = np.random.default_rng(SEED).uniform(0, 1000, len(codes))
    at = int(codes[codes == CENTER_CELL].index[0])
    station = sr.Stations(("試し#0",), geometry.cx[at : at + 1].copy(), geometry.cy[at : at + 1].copy())
    got = sr.apportion(geometry, {"v": values}, station)["v"][0]
    want = brute_force(geometry, values, float(geometry.cx[at]), float(geometry.cy[at]))
    worst = float(np.max(np.abs(got - want) / want))
    checks.add(worst < BRUTE_FORCE_RTOL, "按分＝全セルの重なりを総当たりで測った値（6 半径）", f"最大の差 {worst:.2e}")
    partial = 0 < want[0] < values.sum() and abs(want[-1] - values.sum()) / values.sum() < BRUTE_FORCE_RTOL
    checks.add(partial, "500m は格子の一部・20km は格子の全部（作り例が境のセルを含んでいる）",
               f"{want[0]:,.0f} / {values.sum():,.0f}")
    checks.add(bool(np.all(np.diff(got) >= 0)), "半径を広げて減らない", f"{got.round(1).tolist()}")
    smoothed = sr.monotone(np.array([[1.0, 3.0, 2.9999999, 5.0]]))
    checks.add(smoothed.tolist() == [[1.0, 3.0, 3.0, 5.0]], "減った値は前の半径にそろえる（ノートブックと同じ）")
    checks.add(sr.column_names("pop_2020")[1] == "pop_2020_1km", "列名の接尾辞（500m・1km…）")


def compare(checks: Checks, label: str, floats: np.ndarray, columns: list[str], want: pd.DataFrame) -> None:
    got = np.rint(sr.monotone(floats)).astype(np.int64)
    expected = want[columns].to_numpy(dtype=np.int64)
    diff = got - expected
    checks.add(int((diff != 0).sum()) == 0, f"再現：{label}（{len(want):,} 駅 × {len(columns)} 半径）",
               f"ずれ {int((diff != 0).sum())} 件・最大 {int(np.abs(diff).max())} 人")


def reproduce_census(checks: Checks, year: int, stations: sr.Stations, want: pd.DataFrame) -> None:
    cells = sr.census_cells(year)
    geometry = sr.mesh_geometry(cells["code"])
    floats = sr.apportion(geometry, {"pop": cells["pop"].to_numpy()}, stations, label=str(year))["pop"]
    compare(checks, f"pop_{year}", floats, sr.column_names(f"pop_{year}"), want)


def reproduce_r6(checks: Checks, stations: sr.Stations, want: pd.DataFrame) -> None:
    cells = r6_cells()
    geometry = sr.mesh_geometry(cells["code"])
    values = {column: cells[column].fillna(0).to_numpy(dtype=np.float64) for column in R6_COLUMNS}
    floats = sr.apportion(geometry, values, stations, label="R6")
    for column in R6_COLUMNS:
        prefix = f"pop_pred_2024_{column.removeprefix('PTN_')}"
        compare(checks, prefix, floats[column], sr.column_names(prefix), want)


def main() -> int:
    checks = Checks()
    synthetic(checks)
    if "--quick" not in sys.argv:
        stations = sr.read_stations()
        want = pd.read_csv(sr.STATION_DATASET_CSV, low_memory=False)
        checks.add(tuple(want["grp"]) == stations.grps, "駅の並びが CSV と同じ")
        reproduce_census(checks, 2020, stations, want)
        if "--all" in sys.argv:
            reproduce_census(checks, 2015, stations, want)
            reproduce_r6(checks, stations, want)
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
