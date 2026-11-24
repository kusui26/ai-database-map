"""駅 × 半径の面積按分（2026-11-24・人口の年齢 PR-1）— ノートブック（４）の `_build_geom`・`aggregate_radii_multi` を移したもの。

駅の人口の列（`pop_<年>_<半径>`・`pop_pred_2024_<年>_<半径>`）は、ノートブック
（`script/create_dataset_for_AI_Database_Map.ipynb`）が作った。年齢別の人口も**同じ按分**で作らないと、年齢の和が
既存の総数と合わない。そこで計算の手順を、**足し算の順番まで**ノートブックと同じにして移した
（`station_radii_test.py` が、既存の列を全駅・全半径で 1 人単位まで再現することを確かめる）。ノートブックは触らない。

- 正積図法（Albers・`area_mesh.ALBERS_PROJ`）で、駅の代表点から半径 R の円（32 分割）を描く
- 候補のセルは、セルの重心の KD 木で探す（最大の半径＋H の範囲）
- 重心が R − H より内側のセルは全量、R ± H の帯のセルだけ「円との重なりの面積 ÷ セルの面積」を掛ける
- H は「重心から角までの距離の最大 × 1.02」。重心が R − H より内側なら、セルは円の中に入り切る
- 半径を広げて値が減ったら（浮動小数の誤差だけ）、前の半径の値にそろえてから四捨五入する
"""

from __future__ import annotations

import glob
import io
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from scipy.spatial import cKDTree

from area_mesh import BUFFER_QUAD_SEGS, CENSUS_MESH_DIRS, CENSUS_POP_CAT01, cell_bounds, to_albers

ROOT = Path(__file__).resolve().parents[1]
STATION_DATASET_CSV = ROOT / "data" / "derived" / "station_dataset.csv"
#: 半径（m）と、列名の接尾辞。並びは列の並び（小さい順）。
RADII_M: tuple[int, ...] = (500, 1000, 2000, 5000, 10000, 20000)
RADIUS_NAMES: dict[int, str] = {500: "500m", 1000: "1km", 2000: "2km", 5000: "5km", 10000: "10km", 20000: "20km"}
#: 判定の余白 H の掛け目（重心から角までの距離の最大に掛ける）。
MARGIN_FACTOR = 1.02
#: 進み具合を出す間隔（駅の数）。
PROGRESS_EVERY = 3000


@dataclass(frozen=True)
class MeshGeometry:
    """セルの矩形（正積図法）・重心・面積・重心の KD 木・判定の余白 H（m）。"""

    rings: np.ndarray
    cx: np.ndarray
    cy: np.ndarray
    area_m2: np.ndarray
    tree: cKDTree
    margin_m: float


@dataclass(frozen=True)
class Stations:
    """駅（grp）と、正積図法の代表点。"""

    grps: tuple[str, ...]
    x: np.ndarray
    y: np.ndarray


def mesh_geometry(codes: pd.Series) -> MeshGeometry:
    """メッシュコード（9 桁＝500m・10 桁＝250m）→ 矩形・重心・面積・KD 木・H（ノートブックの `_build_geom`）。"""
    west, south, east, north = cell_bounds(codes).T
    xw, ys = to_albers(west, south)
    xe, ys2 = to_albers(east, south)
    xe2, yn = to_albers(east, north)
    xw2, yn2 = to_albers(west, north)
    rings = np.stack([np.c_[xw, ys], np.c_[xe, ys2], np.c_[xe2, yn], np.c_[xw2, yn2], np.c_[xw, ys]], axis=1)
    cx = rings[:, :4, 0].mean(1)
    cy = rings[:, :4, 1].mean(1)
    xx, yy = rings[:, :, 0], rings[:, :, 1]
    area_m2 = 0.5 * np.abs(np.sum(xx[:, :-1] * yy[:, 1:] - xx[:, 1:] * yy[:, :-1], axis=1))  # 靴紐公式＝地表の面積
    half_diagonal = np.sqrt(((rings[:, :4, 0] - cx[:, None]) ** 2 + (rings[:, :4, 1] - cy[:, None]) ** 2).max(1))
    return MeshGeometry(rings, cx, cy, area_m2, cKDTree(np.c_[cx, cy]), float(half_diagonal.max()) * MARGIN_FACTOR)


def census_cells(year: int) -> pd.DataFrame:
    """国勢調査 250m の人口総数（code, pop）を、ノートブックの `load_mesh_pop` と**同じ並び**（ファイル名の順・行の順）で。

    `area_mesh.read_census_mesh` はコードで並べ替える。値は同じでも足し算の順番が変わるので、既存の列の再現には使わない。
    """
    frames = []
    for path in sorted(glob.glob(str(CENSUS_MESH_DIRS[year] / "mesh*.csv"))):
        lines = Path(path).read_text(encoding="utf-8").splitlines()
        start = next(i for i, line in enumerate(lines) if line == '"VALUE"')
        table = pd.read_csv(io.StringIO("\n".join(lines[start + 1 :])))
        rows = table[pd.to_numeric(table["cat01_code"], errors="coerce") == CENSUS_POP_CAT01]
        frames.append(pd.DataFrame({
            "code": rows["area_code"].astype(str),
            "pop": pd.to_numeric(rows["value"], errors="coerce").fillna(0.0),
        }))
    if not frames:
        raise SystemExit(f"{CENSUS_MESH_DIRS[year].relative_to(ROOT)} に mesh*.csv がありません")
    return pd.concat(frames, ignore_index=True)


def read_stations(path: Path = STATION_DATASET_CSV, only: tuple[str, ...] | None = None) -> Stations:
    """駅の代表点（CSV の行の順）。`only` を渡すと、その駅だけ（渡した順ではなく CSV の順）。"""
    if not path.exists():
        raise SystemExit(f"{path.relative_to(ROOT)} がありません（生成はノートブック）")
    table = pd.read_csv(path, usecols=["grp", "lon", "lat"])
    if only is not None:
        unknown = sorted(set(only) - set(table["grp"]))
        if unknown:
            raise SystemExit(f"station_dataset.csv に無い駅: {unknown[:5]}")
        table = table[table["grp"].isin(only)]
    x, y = to_albers(table["lon"].to_numpy(), table["lat"].to_numpy())
    return Stations(tuple(table["grp"]), np.asarray(x), np.asarray(y))


def _circle_weights(geometry: MeshGeometry, cells: np.ndarray, sx: float, sy: float, radius_m: int) -> np.ndarray:
    """帯のセルについて「円との重なりの面積 ÷ セルの面積」。"""
    circle = shapely.Point(sx, sy).buffer(radius_m, quad_segs=BUFFER_QUAD_SEGS)
    overlap = shapely.area(shapely.intersection(shapely.polygons(geometry.rings[cells]), circle))
    return overlap / geometry.area_m2[cells]


def _one_station(geometry: MeshGeometry, values: np.ndarray, sx: float, sy: float) -> np.ndarray:
    """1 駅の各半径の値（行＝半径・列＝値の種類）。`values` は（種類 × セル）。"""
    out = np.zeros((len(RADII_M), values.shape[0]))
    cand = np.asarray(geometry.tree.query_ball_point([sx, sy], RADII_M[-1] + geometry.margin_m), dtype=int)
    if cand.size == 0:
        return out
    dist = np.hypot(geometry.cx[cand] - sx, geometry.cy[cand] - sy)
    picked = values[:, cand]
    for row, radius_m in enumerate(RADII_M):
        inside = dist <= radius_m - geometry.margin_m
        band = (dist > radius_m - geometry.margin_m) & (dist <= radius_m + geometry.margin_m)
        out[row] = picked[:, inside].sum(axis=1)
        if band.any():
            weights = _circle_weights(geometry, cand[band], sx, sy, radius_m)
            out[row] += (picked[:, band] * weights).sum(axis=1)
    return out


def apportion(
    geometry: MeshGeometry, values: Mapping[str, np.ndarray], stations: Stations, label: str = ""
) -> dict[str, np.ndarray]:
    """セルの値（名前 → セルの並びの配列）を駅 × 半径へ按分する。戻り値は名前 → （駅 × 半径）の配列（四捨五入しない）。"""
    keys = list(values)
    matrix = np.vstack([np.asarray(values[key], dtype=np.float64) for key in keys])
    if matrix.shape[1] != len(geometry.area_m2):
        raise ValueError(f"値の長さ {matrix.shape[1]} がセルの数 {len(geometry.area_m2)} と違う")
    result = np.zeros((len(keys), len(stations.grps), len(RADII_M)))
    started = time.time()
    for j, (sx, sy) in enumerate(zip(stations.x, stations.y, strict=True)):
        result[:, j, :] = _one_station(geometry, matrix, float(sx), float(sy)).T
        if label and (j + 1) % PROGRESS_EVERY == 0:
            print(f"  [{label}] {j + 1:,}/{len(stations.grps):,} 駅（{time.time() - started:.0f} 秒）")
    return {key: result[i] for i, key in enumerate(keys)}


def monotone(values: np.ndarray) -> np.ndarray:
    """半径を広げて減った値（浮動小数の誤差だけ）を、前の半径の値にそろえる（ノートブックと同じ）。"""
    return np.maximum.accumulate(values, axis=1)


def column_names(prefix: str) -> list[str]:
    """`pop_2020` → `pop_2020_500m` … `pop_2020_20km`。"""
    return [f"{prefix}_{RADIUS_NAMES[radius_m]}" for radius_m in RADII_M]
