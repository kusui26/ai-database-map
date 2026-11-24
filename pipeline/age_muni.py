"""年齢不詳の割り振り比と、セルの市区町村（2026-11-24・人口の年齢 PR-1）。

## 割り振り比（計画書 §2.3 の方式 B）

総務省は、国勢調査の年齢「不詳」を補った値（不詳補完値）を市区町村ごとに出している。そこで市区町村 m の区分 g ごとに

    割り振り比(m, g) ＝ （補完値(m, g) − 原数値(m, g)）÷ Σ_g（補完値 − 原数値）

を作る（Σ_g の分母は原数値の年齢「不詳」の人数に等しい）。メッシュの年齢不詳をこの比で区分へ割り振ると、市区町村ごとに
足した値がほぼ公式の補完値になる。年齢の割合で按分する方式 A は、不詳の多い都心で 15〜64 歳を少なく見る（不詳は若い単身者に偏る）。

- 表は 4 つ（2015・2020 年 × 原数値・不詳補完値・`age_rules.MUNI_AGE_TABLES`）。取得は fetch_area_stats.py
- 政令市の区は区の比（区ごとに不詳の偏りが違う）。コードが変わった団体は今のコードへ読み替える
- 不詳が 0 の区域や、表に無い今の区（浜松市の中央区・浜名区）は、借りる区域 → 都道府県 → 全国の順に比を借りる

## セルの市区町村

セルの中心を行政区域（N03 2026-01-01）に空間結合する（所得の按分・駅の市区町村と同じ作法）。ポリゴンに乗らない中心
（海の埋立・境のすれすれ）は最近傍の市区町村へ寄せる。結果は `data/area_raw/mesh250_n03.parquet` に覚える。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from age_rules import (
    BANDS,
    CELL_N03_CACHE,
    MUNI_CODE_RENAMES,
    NATIONAL_CODE,
    PREFECTURE_SUFFIX,
    RATIO_AREA_ALIASES,
    MuniAgeTable,
    muni_age_table,
)
from area_common import EstatData, read_estat
from area_mesh import cell_bounds
from area_rules import ANCHORS, N03_UNASSIGNED_SUFFIX

#: 割り振り比の区分の列（`r0_14` など）。
RATIO_COLUMNS: tuple[str, ...] = tuple(f"r{band}" for band in BANDS)


def _rows(data: EstatData, table: MuniAgeTable) -> list[dict[str, str]]:
    """表の値のうち、取得の条件（`params`）に合う行だけ（取り直しで条件の違う行が混ざっても数えない）。"""
    where = {f"@{key.removeprefix('cd').lower()}": value for key, value in table.params}
    return [row for row in data.values if all(row.get(key) == value for key, value in where.items())]


def band_table(table: MuniAgeTable) -> pd.DataFrame:
    """市区町村の年齢の表 → 区域 × （total・4 区分・unknown）。区分の和（＋不詳）が総数に合わなければ落とす。"""
    data = read_estat(table.name)
    area_key = f"@{data.area_class_id()}"
    age_key = f"@{table.age_class}"
    frame = pd.DataFrame([(row[area_key], row[age_key], row.get("$")) for row in _rows(data, table)],
                         columns=["area", "age", "value"])
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce").fillna(0.0)  # 「-」（該当なし）は 0
    wide = frame.pivot_table(index="area", columns="age", values="value", aggfunc="sum").fillna(0.0)
    out = pd.DataFrame(index=wide.index)
    out["total"] = wide[table.total_code]
    for band, codes in table.codes.items():
        out[band] = wide[list(codes)].sum(axis=1)
    out["unknown"] = wide[table.unknown] if table.unknown else 0.0
    gap = (out[list(BANDS)].sum(axis=1) + out["unknown"] - out["total"]).abs()
    if (gap > 0).any():
        raise SystemExit(f"{table.name}: 区分の和が総数に合わない区域 {list(gap[gap > 0].index[:5])}")
    national = float(out.loc[NATIONAL_CODE, "total"])
    if round(national) != ANCHORS[("jp", f"pop_{table.year}")]:
        raise SystemExit(f"{table.name}: 全国の総数 {national:,.0f} が公表値と合わない")
    return out


def allocation_ratios(year: int) -> pd.DataFrame:
    """区域（今のコード）→ 年齢不詳の割り振り比（`r0_14` … `r75plus`・和は 1）。不詳が 0 の区域は入れない。"""
    raw = band_table(muni_age_table(year, imputed=False))
    imputed = band_table(muni_age_table(year, imputed=True))
    areas = imputed.index.intersection(raw.index)
    if (raw.loc[areas, "total"] != imputed.loc[areas, "total"]).any():
        raise SystemExit(f"{year} 年：原数値と不詳補完値で総数が違う区域がある（総数は補わないはず）")
    added = (imputed.loc[areas, list(BANDS)] - raw.loc[areas, list(BANDS)]).clip(lower=0.0)
    unknown = raw.loc[areas, "unknown"]
    usable = (unknown > 0) & (added.sum(axis=1) > 0)
    ratios = added[usable].div(added[usable].sum(axis=1), axis=0)
    ratios.columns = list(RATIO_COLUMNS)
    ratios.index = [MUNI_CODE_RENAMES[year].get(code, code) for code in ratios.index]
    return ratios


def ratio_area(n03_code: str, available: set[str]) -> str:
    """今の区域のコード → 割り振り比を使う区域（自分 → 借りる区域 → 都道府県 → 全国の順で、表にあるもの）。"""
    for code in (n03_code, RATIO_AREA_ALIASES.get(n03_code, ""), f"{n03_code[:2]}{PREFECTURE_SUFFIX}"):
        if code in available:
            return code
    return NATIONAL_CODE


def ratios_for(n03_codes: pd.Series, ratios: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """セル（の市区町村）ごとの割り振り比と、比を借りた区域（自分のコードと違えば借りた）。"""
    available = set(ratios.index)
    source = n03_codes.map(lambda code: ratio_area(code, available))
    return ratios.reindex(source.to_numpy()).set_index(n03_codes.index), source


# --- セルの市区町村 ---------------------------------------------------------------


def _cell_centers(codes: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    west, south, east, north = cell_bounds(codes).T
    return (west + east) / 2, (south + north) / 2


def _n03_vintage() -> str:
    """N03 の年版（ファイル名）。控えの割り当てがどの年版のものかを覚えておく。"""
    from fetch_admin_boundaries import DEST

    return DEST.name


def _n03_polygons():  # noqa: ANN202 — geopandas は読み込みが重いので、ここでだけ使う
    from build_municipality import read_n03

    n03 = read_n03()
    code = n03["N03_007"].astype("string")
    keep = code.notna() & ~code.str.endswith(N03_UNASSIGNED_SUFFIX)  # 所属未定地は市区町村ではない
    return n03.loc[keep, ["N03_007", "geometry"]].assign(N03_007=code[keep].str.zfill(5))


def _assign(codes: pd.Series) -> pd.DataFrame:
    """セルの中心 → N03 のコード（中に乗るポリゴン。無ければ最近傍）。"""
    import geopandas as gpd

    lon, lat = _cell_centers(codes)
    points = gpd.GeoDataFrame({"code": codes.to_numpy()}, geometry=gpd.points_from_xy(lon, lat), crs="EPSG:6668")
    polygons = _n03_polygons()
    hit = gpd.sjoin(points, polygons, how="left", predicate="within")
    hit = hit.sort_values(["code", "N03_007"]).drop_duplicates("code", keep="first").set_index("code")
    miss = hit.index[hit["N03_007"].isna()]
    nearest = gpd.sjoin_nearest(points.set_index("code").loc[miss].to_crs(3857), polygons.to_crs(3857), how="left")
    hit.loc[miss, "N03_007"] = nearest[~nearest.index.duplicated(keep="first")]["N03_007"].reindex(miss)
    print(f"  セルの市区町村：{len(codes):,} セル（ポリゴンに乗らず最近傍 {len(miss):,}）")
    return pd.DataFrame({"code": hit.index, "n03": hit["N03_007"].to_numpy(), "nearest": hit.index.isin(miss),
                         "vintage": _n03_vintage()})


def _remembered() -> pd.DataFrame:
    """控えの割り当て（N03 の年版が今と違えば捨てる）。"""
    empty = pd.DataFrame(columns=["code", "n03", "nearest", "vintage"])
    if not CELL_N03_CACHE.exists():
        return empty
    known = pd.read_parquet(CELL_N03_CACHE)
    return known if "vintage" in known.columns and (known["vintage"] == _n03_vintage()).all() else empty


def cell_n03(codes: pd.Series) -> pd.Series:
    """セル → 市区町村（N03・政令市は区）。覚えているセルは読み、無いセルだけ結合する。"""
    known = _remembered()
    missing = pd.Series(sorted(set(codes) - set(known["code"])), dtype=str)
    if len(missing) > 0:
        known = pd.concat([known, _assign(missing)], ignore_index=True)
        CELL_N03_CACHE.parent.mkdir(parents=True, exist_ok=True)
        known.to_parquet(CELL_N03_CACHE, index=False)
    mapping = known.set_index("code")["n03"]
    return codes.map(mapping)
