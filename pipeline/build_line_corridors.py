"""エリアの区域の値（B5a・2026-10-10）— 沿線の人口・推計・事業所・従業者を、メッシュの面積按分で作る。

設計は `docs/261001_fix_user_feedback_ui.md` §6.12.4 (b)・§12-22、データの説明は `docs/area_values.md`。

- **沿線**＝路線（運行系統・`data/derived/lines.csv` の 601 本）の駅から W（500m・1km・2km）の円を重ねた 1 つの面
- 按分は駅の半径の値と**同じ方法**：正積図法（Albers）で、セルと面の重なりの割合だけセルの値を数える（セルの中は一様と置く）。
  円は 32 分割（駅の値と同じ）。円が重ならない路線では、沿線の値が駅の円の値の和になる（validate_area_values.py が確かめる）
- 年：人口は 2015・2020 年（250m）、推計は R6 の 2020〜2070 年（250m）、事業所・従業者は 2012・2016・2021 年（500m）。
  2025 年のメッシュは未公表。2010 年以前は 500m で、250m の年と比べると段差が出るので作らない

    python3 pipeline/build_lines.py && python3 pipeline/build_line_corridors.py   # 路線を作り直したら、沿線も作り直す

出力は `data/derived/line_corridors.csv`（沿線ごとの駅の数・面積）と `line_corridor_values.csv`（沿線 × 指標）。
"""

from __future__ import annotations

import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_common import (  # noqa: E402
    DERIVED_DIR,
    LINE_CORRIDOR_VALUES_CSV,
    LINE_CORRIDORS_CSV,
    area_key,
    read_csv,
    write_csv,
)
from area_mesh import (  # noqa: E402
    BUFFER_QUAD_SEGS,
    R6_COLUMNS,
    cell_polygons,
    r6_cells,
    read_census_mesh,
    read_econ_mesh,
    to_albers,
)
from area_rules import ECON_YEARS, LINE_POP_YEARS, LINE_WIDTHS_M, PRED_YEARS, area_metrics  # noqa: E402

LINES_CSV = DERIVED_DIR / "lines.csv"
LINE_STATIONS_CSV = DERIVED_DIR / "line_stations.csv"
STATION_DATASET_CSV = DERIVED_DIR / "station_dataset.csv"
#: 幅の言い方（題に使う）。
WIDTH_LABELS_JA: dict[int, str] = {500: "500m", 1000: "1km", 2000: "2km"}
#: 幅に対して単調であることの許し（浮動小数の誤差だけ）。
MONOTONE_TOLERANCE = 1e-6


class Grid:
    """1 つの解像度のセルと値（行＝セル・列＝指標）。"""

    def __init__(self, codes: pd.Series, columns: dict[str, np.ndarray]) -> None:
        self.polygons = cell_polygons(codes)
        self.areas = shapely.area(self.polygons)
        self.tree = shapely.STRtree(self.polygons)
        self.metric_keys = list(columns)
        self.matrix = np.column_stack([columns[key] for key in self.metric_keys])

    def apportion(self, shape: shapely.Geometry) -> dict[str, float]:
        """面に重なるセルの値を、重なりの面積の割合で足す。"""
        index = self.tree.query(shape, predicate="intersects")
        if len(index) == 0:
            return {key: 0.0 for key in self.metric_keys}
        overlap = shapely.area(shapely.intersection(self.polygons[index], shape))
        weights = overlap / self.areas[index]
        sums = (self.matrix[index] * weights[:, None]).sum(axis=0)
        return {key: float(value) for key, value in zip(self.metric_keys, sums)}


def population_grid() -> Grid:
    """250m：国勢調査 2015・2020 と R6 の 2020〜2070（同じセルにそろえる）。"""
    cells = None
    for year in LINE_POP_YEARS:
        mesh = read_census_mesh(year).rename(columns={"pop": f"pop_{year}"})
        cells = mesh if cells is None else cells.merge(mesh, on="code", how="outer")
    r6 = r6_cells().rename(columns={column: f"pop_pred_2024_{column.removeprefix('PTN_')}" for column in R6_COLUMNS})
    cells = cells.merge(r6, on="code", how="outer").fillna(0.0)  # type: ignore[union-attr]
    keys = [f"pop_{y}" for y in LINE_POP_YEARS] + [f"pop_pred_2024_{y}" for y in PRED_YEARS]
    return Grid(cells["code"], {key: cells[key].to_numpy(dtype=float) for key in keys})


def economy_grid() -> Grid:
    """500m：経済センサス 2012・2016・2021 の民営の事業所・従業者（同じセルにそろえる）。"""
    cells = None
    for year in ECON_YEARS:
        mesh = read_econ_mesh(year).rename(columns={"estab": f"estab_n_{year}", "emp": f"emp_n_{year}"})
        cells = mesh if cells is None else cells.merge(mesh, on="code", how="outer")
    cells = cells.fillna(0.0)  # type: ignore[union-attr]
    keys = [f"estab_n_{y}" for y in ECON_YEARS] + [f"emp_n_{y}" for y in ECON_YEARS]
    return Grid(cells["code"], {key: cells[key].to_numpy(dtype=float) for key in keys})


def station_points() -> dict[str, tuple[float, float]]:
    """駅（grp）→ 正積図法の座標。"""
    stations = pd.read_csv(STATION_DATASET_CSV, usecols=["grp", "lon", "lat"])
    x, y = to_albers(stations["lon"].to_numpy(), stations["lat"].to_numpy())
    return dict(zip(stations["grp"], zip(x, y)))


def corridor_shape(points: list[tuple[float, float]], width_m: int) -> shapely.Geometry:
    circles = shapely.buffer(shapely.points(np.array(points)), width_m, quad_segs=BUFFER_QUAD_SEGS)
    return shapely.union_all(circles)


def check_monotone(values: dict[tuple[int, int, str], float], line_cds: list[int], keys: list[str]) -> list[str]:
    """幅を広げても値は減らない（沿線の面は幅に対して入れ子）。"""
    problems = []
    for line_cd in line_cds:
        for key in keys:
            series = [values[(line_cd, width, key)] for width in LINE_WIDTHS_M]
            for narrow, wide in zip(series, series[1:]):
                if wide < narrow - MONOTONE_TOLERANCE * max(1.0, narrow):
                    problems.append(f"路線 {line_cd} の {key} が幅を広げて減った: {series}")
                    break
    return problems


def main() -> int:
    started = time.time()
    lines = read_csv(LINES_CSV)
    members: dict[int, list[str]] = defaultdict(list)
    for row in read_csv(LINE_STATIONS_CSV):
        members[int(row["line_cd"])].append(row["grp"])
    points = station_points()
    unknown = sorted({grp for grps in members.values() for grp in grps} - set(points))
    if unknown:
        raise SystemExit(f"station_dataset.csv に無い駅（路線の駅と駅データがずれている）: {unknown[:5]}")

    grids = (population_grid(), economy_grid())
    print(f"セルの準備 {time.time() - started:.0f} 秒（250m {len(grids[0].areas):,}・500m {len(grids[1].areas):,}）")

    expected_keys = [m.key for m in area_metrics() if m.line is not None]
    grid_keys = [key for grid in grids for key in grid.metric_keys]
    if sorted(grid_keys) != sorted(expected_keys):
        raise SystemExit(f"沿線の指標がカタログと合わない: {sorted(set(grid_keys) ^ set(expected_keys))}")

    values: dict[tuple[int, int, str], float] = {}
    corridors: list[list[object]] = []
    line_cds = sorted(int(row["line_cd"]) for row in lines)
    names = {int(row["line_cd"]): row["name"] for row in lines}
    for count, line_cd in enumerate(line_cds, start=1):
        grps = members.get(line_cd, [])
        if not grps:
            raise SystemExit(f"路線 {line_cd} {names[line_cd]} に駅が無い")
        coords = [points[grp] for grp in grps]
        for width in LINE_WIDTHS_M:
            shape = corridor_shape(coords, width)
            for grid in grids:
                for key, value in grid.apportion(shape).items():
                    values[(line_cd, width, key)] = value
            corridors.append([
                area_key("line", line_cd=line_cd, width_m=width), line_cd, width, names[line_cd],
                f"{names[line_cd]}の沿線（駅から {WIDTH_LABELS_JA[width]}）", len(grps), f"{shape.area / 1e6:.3f}",
            ])
        if count % 100 == 0:
            print(f"  {count}/{len(line_cds)} 路線（{time.time() - started:.0f} 秒）")

    problems = check_monotone(values, line_cds, expected_keys)
    if problems:
        print("\n".join(["照合が崩れた（書き出していない）:", *problems[:20]]))
        return 1
    write_csv(LINE_CORRIDORS_CSV, ["key", "line_cd", "width_m", "name", "label", "station_count", "area_km2"], corridors)
    order = {key: i for i, key in enumerate(expected_keys)}
    write_csv(
        LINE_CORRIDOR_VALUES_CSV,
        ["area_key", "metric_key", "value"],
        [
            [area_key("line", line_cd=line_cd, width_m=width), key, f"{value:.4f}".rstrip("0").rstrip(".")]
            for (line_cd, width, key), value in sorted(values.items(), key=lambda item: (item[0][0], item[0][1], order[item[0][2]]))
        ],
    )
    print(f"OK {LINE_CORRIDORS_CSV.name}（{len(corridors):,} 沿線）・{LINE_CORRIDOR_VALUES_CSV.name}（{len(values):,} 値）"
          f"・{time.time() - started:.0f} 秒")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
