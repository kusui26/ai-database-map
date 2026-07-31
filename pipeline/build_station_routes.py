"""路線データの生成（260731）— S12 の路線名・事業者種別を既存の駅グループへ貼る。

国土数値情報「駅別乗降客数」S12-25 は `S12_003` に路線名、`S12_005` に事業者種別コード
（1:JR新幹線 / 2:JR在来線 / 3:公営鉄道 / 4:民営鉄道 / 5:第三セクター）を持つ。ノートブックは
この 2 列を読んでいるが出力していないため、派生 CSV にも DB にも路線が存在しない。

**ノートブックは再実行しない**（他列への偶発差分を避ける・docs/260727_data_check.md §4.2 と同じ判断）。
代わりに、S12 の各レコードを **既存の駅グループ（駅名 + 半径1km クラスタ）へ最近傍で対応づける**。
grp は「同名グループ同士が 1km 以上離れる」性質を持つため（docs/passenger_aggregation.md §3.1）、
同名グループのうち最も近いものを選べば一意に決まる。実測では 10,534 件すべてが一致し、
距離は中央値 55m・最大 706m だった（docs/260730_scatter_plot_routes.md §2）。

    python3 pipeline/build_station_routes.py
    → data/derived/station_routes.csv（grp, operator, route, route_type）＋ 自己検証レポート
"""

from __future__ import annotations

import csv
import json
import math
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
S12_ZIP = ROOT / "data" / "駅別乗降客数データ" / "S12-25_GML.zip"
STATIONS_CSV = ROOT / "data" / "derived" / "station_dataset.csv"
OUT_CSV = ROOT / "data" / "derived" / "station_routes.csv"

STATION_NAME = "S12_001"
OPERATOR = "S12_002"
ROUTE = "S12_003"
ROUTE_TYPE = "S12_005"

#: 対応づけを許容する最大距離（m）。grp のクラスタ半径 1km を上限にする。
MAX_MATCH_M = 1000.0
#: 妥当性チェック（既知の事実）。ズレたら生成を失敗させる。
EXPECTED_SHINKANSEN_STATIONS = 103
EXPECTED_TOKAIDO_SHINKANSEN = 17


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """2 点間の距離（m）。CRS.md に従い距離計算は測地線ベースで行う。"""
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def representative_point(geometry: dict[str, object]) -> tuple[float, float]:
    """LineString / MultiLineString の代表点（頂点列の中央）。"""
    coords = geometry["coordinates"]
    if geometry["type"] == "MultiLineString":
        coords = [point for part in coords for point in part]
    lon, lat = coords[len(coords) // 2]
    return float(lon), float(lat)


def load_station_groups() -> dict[str, list[tuple[str, float, float]]]:
    """駅名 → [(grp, lon, lat)]（既存の駅グループ）。"""
    groups: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    with STATIONS_CSV.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            groups[row["station_name"]].append((row["grp"], float(row["lon"]), float(row["lat"])))
    return groups


def load_s12_features() -> list[dict[str, object]]:
    """S12 の geojson（UTF-8 版）を zip から直接読む（展開しない）。"""
    with zipfile.ZipFile(S12_ZIP) as archive:
        names = [n for n in archive.namelist() if n.endswith(".geojson") and "UTF-8" in n]
        if not names:
            raise SystemExit(f"S12 の geojson が見つかりません: {S12_ZIP}")
        return json.loads(archive.read(names[0]).decode("utf-8"))["features"]


def main() -> int:
    groups = load_station_groups()
    features = load_s12_features()
    station_count = sum(len(v) for v in groups.values())
    print(f"駅グループ {station_count} / S12 レコード {len(features)}")

    rows: set[tuple[str, str, str, int]] = set()
    distances: list[float] = []
    missing: list[str] = []
    for feature in features:
        props = feature["properties"]
        candidates = groups.get(props[STATION_NAME], [])
        if not candidates:
            missing.append(f"{props[STATION_NAME]}({props[OPERATOR]})")
            continue
        lon, lat = representative_point(feature["geometry"])
        grp, distance = min(
            ((g, haversine_m(lon, lat, glon, glat)) for g, glon, glat in candidates),
            key=lambda pair: pair[1],
        )
        distances.append(distance)
        rows.add((grp, props[OPERATOR], props[ROUTE], int(props[ROUTE_TYPE])))

    # --- 自己検証（1 つでも崩れたら失敗させる） ---
    distances.sort()
    matched = len(distances)
    covered = {grp for grp, *_ in rows}
    by_type: dict[int, set[str]] = defaultdict(set)
    for grp, _operator, _route, route_type in rows:
        by_type[route_type].add(grp)
    tokaido = {grp for grp, operator, route, _t in rows if route == "東海道新幹線"}

    print(f"一致 {matched}/{len(features)}（{matched / len(features) * 100:.1f}%）／未一致 {len(missing)}")
    print(
        f"距離: 中央値 {distances[len(distances) // 2]:.0f}m / "
        f"95%tile {distances[int(len(distances) * 0.95)]:.0f}m / 最大 {distances[-1]:.0f}m"
    )
    print(f"路線が付いた駅グループ {len(covered)}/{station_count}／出力行 {len(rows)}")
    print("種別別の駅グループ数: " + " ".join(f"{k}={len(v)}" for k, v in sorted(by_type.items())))
    print(f"新幹線 {len(by_type[1])} 駅（うち東海道新幹線 {len(tokaido)} 駅）")

    failures: list[str] = []
    if missing:
        failures.append(f"駅名が既存グループに無い: {missing[:5]}")
    if distances[-1] > MAX_MATCH_M:
        failures.append(f"対応づけ距離が {MAX_MATCH_M:.0f}m を超えた: {distances[-1]:.0f}m")
    if len(covered) != station_count:
        failures.append(f"路線が付かない駅グループがある: {station_count - len(covered)} 件")
    if len(by_type[1]) != EXPECTED_SHINKANSEN_STATIONS:
        failures.append(f"新幹線の駅数が想定と異なる: {len(by_type[1])}")
    if len(tokaido) != EXPECTED_TOKAIDO_SHINKANSEN:
        failures.append(f"東海道新幹線の駅数が想定と異なる: {len(tokaido)}")
    if failures:
        for failure in failures:
            print(f"NG: {failure}")
        return 1

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["grp", "operator", "route", "route_type"])
        writer.writerows(sorted(rows))
    print(f"OK: {OUT_CSV.relative_to(ROOT)} に {len(rows)} 行を書き出しました")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
