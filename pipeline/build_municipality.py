"""駅の代表点 × N03（行政区域）→ 市区町村サイドカー CSV（260902・PR-4）。

`docs/260828_research_claude_auth.md` §5.2 G1 ／ §9.2 決定 10。
出力は `data/derived/station_municipality.csv`（grp, municipality_code, municipality）。
`station_dataset.csv`（上流整形）には触れない——**サイドカー**として持ち、
`load_to_supabase.py` が stations 投入と同じトランザクションで結合する
（`station_routes` と同じ流儀。将来上流に列が入ったらこの CSV を廃止できる）。

## 方法

- 駅の `prefecture` と同じ方法論：**代表点を N03 に空間結合**（`docs/dataset.md` §2.1）
- 名前は「政令指定都市は市名＋区名（例 横浜市西区）、それ以外は市区町村名（例 大磯町）」。
  郡名は含めない（気象庁の区域解決 `build_jma_areas.py` と同じ語彙感覚）
- コードは N03_007（JIS 5 桁）。**「横浜市で」の絞りは名前の前方一致**（横浜市%）で束ねる
- ポリゴンに乗らない点（海上の埋立・境界すれすれ）は**同じ都道府県内の最近傍**へ落とす
  （都道府県を跨ぐ最近傍は採らない＝上流の prefecture と矛盾させない）

## 検証（このスクリプト自身が落とす）

- 全駅 100% 付与（漏れ 0）
- N03 の都道府県と既存 `prefecture` の**全数一致**（上流と同じ N03 系の結合なので一致すべき）

    python3 pipeline/build_municipality.py
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATASET_CSV = ROOT / "data" / "derived" / "station_dataset.csv"
OUT_CSV = ROOT / "data" / "derived" / "station_municipality.csv"

from fetch_admin_boundaries import DEST as N03_ZIP  # noqa: E402  （vintage の単一定義元）

#: 最近傍フォールバックの上限（メートル）。これを超えて漂う点はデータ異常として落とす。
NEAREST_MAX_M = 5_000


def read_stations() -> gpd.GeoDataFrame:
    df = pd.read_csv(DATASET_CSV, usecols=["grp", "prefecture", "lon", "lat"])
    if df["grp"].duplicated().any():
        raise SystemExit("station_dataset.csv の grp が重複しています")
    return gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df["lon"], df["lat"]), crs="EPSG:6668"
    )


def read_n03() -> gpd.GeoDataFrame:
    if not N03_ZIP.exists():
        raise SystemExit(f"{N03_ZIP} がありません。先に fetch_admin_boundaries.py を実行してください")
    with zipfile.ZipFile(N03_ZIP) as zf:
        # 2026 年版は市区町村と都道府県の 2 枚が同梱される。使うのは市区町村側。
        shp = [
            name
            for name in zf.namelist()
            if name.endswith(".shp") and "_prefecture" not in name
        ]
    if len(shp) != 1:
        raise SystemExit(f"zip 内の市区町村 .shp を特定できない: {shp}")
    gdf = gpd.read_file(f"zip://{N03_ZIP}!{shp[0]}")
    # 2024 年以降のスキーマ：N03_004＝市区町村名（政令市は「横浜市」）、
    # **N03_005＝政令市の区名（新設）**。無い年版でも動くよう任意扱いにする。
    needed = {"N03_001", "N03_003", "N03_004", "N03_007"}
    missing = needed - set(gdf.columns)
    if missing:
        raise SystemExit(f"N03 の想定列が無い: {sorted(missing)} / 実列: {list(gdf.columns)}")
    if "N03_005" not in gdf.columns:
        gdf["N03_005"] = None
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:6668")
    return gdf.to_crs("EPSG:6668")


def municipality_name(row: pd.Series) -> str:
    """政令指定都市は「市名＋区名」（例 横浜市西区）、それ以外は市区町村名（郡名は含めない）。

    2024 年以降の N03 は区名が **N03_005**（N03_004 は「横浜市」）。
    それ以前は N03_003＝政令市名・N03_004＝区名。両方に対応する。
    """
    def text(key: str) -> str:
        value = row[key]
        return "" if pd.isna(value) else str(value)

    city_old = text("N03_003")
    town = text("N03_004")
    ward = text("N03_005")
    if ward != "":
        return f"{town}{ward}"
    if city_old.endswith("市"):
        return f"{city_old}{town}"
    return town


def join_within(stations: gpd.GeoDataFrame, n03: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    joined = gpd.sjoin(
        stations,
        n03[["N03_001", "N03_003", "N03_004", "N03_005", "N03_007", "geometry"]],
        how="left",
        predicate="intersects",
    )
    # 境界線上の点は複数ポリゴンに触れうる。grp ごとに 1 行へ（コード昇順の先頭＝決定的）。
    joined = joined.sort_values(["grp", "N03_007"]).drop_duplicates("grp", keep="first")
    return joined.set_index("grp")


def fill_nearest(
    stations: gpd.GeoDataFrame, n03: gpd.GeoDataFrame, joined: gpd.GeoDataFrame
) -> tuple[gpd.GeoDataFrame, int]:
    """ポリゴンに乗らなかった点を、**同じ都道府県の**最近傍ポリゴンへ落とす。"""
    missing_grps = joined.index[joined["N03_007"].isna()]
    if len(missing_grps) == 0:
        return joined, 0
    misses = stations.set_index("grp").loc[missing_grps].reset_index()
    filled_frames = []
    for pref, group in misses.groupby("prefecture"):
        candidates = n03[n03["N03_001"] == pref]
        if candidates.empty:
            raise SystemExit(f"N03 に都道府県が見つからない: {pref}")
        # 距離はメートル系で測る（地理座標のままだと度数の距離になり警告どおり不正確）。
        near = gpd.sjoin_nearest(
            group.to_crs("EPSG:3857"),
            candidates[["N03_001", "N03_003", "N03_004", "N03_005", "N03_007", "geometry"]].to_crs(
                "EPSG:3857"
            ),
            how="left",
            max_distance=NEAREST_MAX_M,
            distance_col="dist_m",
        ).drop_duplicates("grp", keep="first")
        filled_frames.append(near)
    filled = pd.concat(filled_frames).set_index("grp")
    still = filled.index[filled["N03_007"].isna()]
    if len(still) > 0:
        raise SystemExit(f"最近傍でも市区町村を特定できない駅: {list(still)[:5]}（計 {len(still)}）")
    for grp in filled.index:
        for col in ("N03_001", "N03_003", "N03_004", "N03_005", "N03_007"):
            joined.loc[grp, col] = filled.loc[grp, col]
    print(f"  最近傍フォールバック: {len(filled)} 駅（max {float(filled['dist_m'].max()):.0f} m）")
    return joined, len(filled)


def main() -> int:
    stations = read_stations()
    print(f"stations: {len(stations):,} 点")
    n03 = read_n03()
    print(f"N03: {len(n03):,} ポリゴン（{N03_ZIP.name}）")

    joined = join_within(stations, n03)
    joined, nearest_count = fill_nearest(stations, n03, joined)

    # --- 検証（落とすべきものはここで落とす） ---
    missing = int(joined["N03_007"].isna().sum())
    if missing > 0:
        raise SystemExit(f"市区町村を付与できない駅が {missing} 件あります")
    mismatched = joined[joined["N03_001"] != joined["prefecture"]]
    if len(mismatched) > 0:
        sample = mismatched[["prefecture", "N03_001"]].head(5).to_dict("index")
        raise SystemExit(f"都道府県の不一致 {len(mismatched)} 件（上流と N03 の食い違い）: {sample}")

    # index（grp）と列名の衝突を避けるため、先に素の DataFrame へ戻す。
    flat = joined.reset_index()
    out = pd.DataFrame(
        {
            "grp": flat["grp"],
            "municipality_code": flat["N03_007"].astype(str).str.zfill(5),
            "municipality": flat.apply(municipality_name, axis=1),
        }
    ).sort_values("grp")
    if (out["municipality"] == "").any():
        raise SystemExit("市区町村名が空の行があります")
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_CSV, index=False)

    yokohama = int(out["municipality"].str.startswith("横浜市").sum())
    print(f"OK {OUT_CSV.name}: {len(out):,} 行（最近傍 {nearest_count}・横浜市 {yokohama} 駅・"
          f"市区町村 {out['municipality_code'].nunique():,} 種）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
