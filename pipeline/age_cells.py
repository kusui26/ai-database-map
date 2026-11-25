"""セルの年齢（2026-11-24・人口の年齢 PR-1）— 国勢調査 250m（2015・2020）と R6（2025〜2050）の、セルごとの年齢 4 区分。

規則は `age_rules.py`、年齢不詳の割り振り比とセルの市区町村は `age_muni.py`。

## 国勢調査：秘匿したセルを本来の位置へ戻し、年齢不詳を割り振る

国勢調査のメッシュは、小さなセル（秘匿したセル）の**年齢の値を合算先のセルに足し上げ**、総数（年齢不詳を含む）だけは
セルごとの値のまま出している（e-Stat の定義書）。セルごとに「不詳 ＝ 総数 − 0〜14 歳 − 15 歳以上」とすると、秘匿したセルは
全員が不詳、合算先は不詳が負になる（駅の 500m 圏で最大 24% ずれた）。そこで「合算先と、そこへ足し上げた秘匿したセル」を 1 つの組にして、

1. 組の総数 T ＝ 組のセルの総数の和。組の年齢 ＝ 合算先の年齢の値（組の中で年齢が分かっている人）
2. 組の年齢不詳 U ＝ T − （0〜14 歳 ＋ 15 歳以上）
3. U を、合算先のセルの市区町村の割り振り比で 4 区分へ（方式 B）
4. 組の 4 区分を、組のセルへ総数の割合で配る（秘匿したセルの人は、組と同じ年齢構成で本来のセルに置く）

セルの 4 区分の和はそのセルの総数（既存の `pop_<年>` の元）に一致する。秘匿の無いセルは自分だけの組。

## R6：真の総数 × セルの年齢構成

R6 の年齢の列（PTA〜PTD）と PT00 は秘匿を当てた値（`*` のセルは 0 で、合算先 `@` に足し上げてある）、PTN は真の総数。
セルの年齢 ＝ PTN × 年齢構成（`*` のセルは合算先の構成）。合算先は同じ県のファイルの中にある（全国で確かめた）。
構成は 4 区分の和で割る（PT00 とは最大 0.0001 人ずれるので、PT00 で割るとセルの和が PTN からずれる）。
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from age_muni import allocation_ratios, cell_n03, ratios_for
from age_rules import (
    BANDS,
    CENSUS_GIS_CACHE,
    EXPECTED_REGIONS,
    MESH_TABLES,
    PRED_YEARS,
    R6_AGE_CACHE,
    R6_BAND_FIELDS,
    R6_BAND_MINUS,
    R6_FIELDS,
    R6_HIDDEN,
    R6_TARGET,
    ROOT,
    SECRECY_HIDDEN,
    SECRECY_TARGET,
    MeshTable,
)
from area_mesh import read_r6_attributes

#: 統計 GIS のファイルの先頭の 4 列（セル・秘匿処理・合算先・合算した秘匿したセル）。
GIS_KEY_COLUMNS: tuple[str, ...] = ("KEY_CODE", "HTKSYORI", "HTKSAKI", "GASSAN")
#: 秘匿したセルの年齢の値の記号。
HIDDEN_VALUE = "*"
#: 区分の列名（`b0_14` など）。
BAND_COLUMNS: tuple[str, ...] = tuple(f"b{band}" for band in BANDS)
#: 合算した秘匿したセルの区切り（GASSAN）。
MERGED_SEPARATOR = ";"


# --- 国勢調査：統計 GIS のファイルを読む -------------------------------------------------


def normalize_label(text: str) -> str:
    """見出しの空白（全角・半角）を除き、波ダッシュの字形をそろえる（Shift_JIS の読み方で 〜 と ～ が入れ替わる）。"""
    return re.sub(r"\s", "", text).replace("～", "〜")


def _check_header(table: MeshTable, header: list[str], labels: list[str], source: str) -> None:
    """列（項目の番号）と 2 行目の見出しで項目を確かめる（2015 年と 2020 年は項目の並びが違う）。"""
    missing = [column for column in (*GIS_KEY_COLUMNS, *table.columns.values()) if column not in header]
    if missing:
        raise ValueError(f"{source}: 列が無い {missing}")
    for item, column in table.columns.items():
        got = normalize_label(labels[header.index(column)])
        if got != normalize_label(table.labels[item]):
            raise ValueError(f"{source}: {column} の見出しが「{got}」（{item} は「{table.labels[item]}」のはず）")


def _numbers(text: pd.Series, source: str, column: str) -> pd.Series:
    """値の列 → 数（秘匿の `*` は NaN）。ほかの記号が混ざっていたら落とす（黙って 0 にしない）。"""
    values = pd.to_numeric(text.where(text != HIDDEN_VALUE), errors="coerce")
    odd = text[values.isna() & (text != HIDDEN_VALUE)]
    if len(odd) > 0:
        raise ValueError(f"{source}: {column} に数でない値 {sorted(set(odd))[:5]}")
    return values


def read_gis_zip(table: MeshTable, payload: bytes, source: str) -> pd.DataFrame:
    """統計 GIS の zip（1 区画）→ セル × （code・secrecy・target・merged・total・年齢の項目）。秘匿したセルの年齢は NaN。"""
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith(".txt")]
        if len(names) != 1:
            raise ValueError(f"{source}: zip の中の表が 1 つではない {names}")
        lines = archive.read(names[0]).decode("cp932").splitlines()
    header, labels = lines[0].split(","), lines[1].split(",")
    _check_header(table, header, labels, source)
    frame = pd.read_csv(io.StringIO("\n".join([lines[0], *lines[2:]])), dtype=str, keep_default_na=False)
    cells = pd.DataFrame({
        "code": frame["KEY_CODE"], "secrecy": frame["HTKSYORI"], "target": frame["HTKSAKI"], "merged": frame["GASSAN"],
    })
    for item, column in table.columns.items():
        cells[item] = _numbers(frame[column], source, column)
    return cells


def gis_paths(table: MeshTable) -> list[Path]:
    """取得済みの統計 GIS の zip（区画の順）。"""
    return sorted(table.directory.glob(f"tbl{table.stats_id}Q*.zip"))


def read_census_gis(year: int, table: MeshTable | None = None, use_cache: bool = True) -> pd.DataFrame:
    """その年の全区画の統計 GIS のファイル → セルの表。控え（parquet）が zip より新しければ控えを読む。"""
    table = table or MESH_TABLES[year]
    paths = gis_paths(table)
    if len(paths) != EXPECTED_REGIONS:
        raise SystemExit(f"{table.directory.relative_to(ROOT)} の zip が {len(paths)} 区画"
                         f"（{EXPECTED_REGIONS} のはず）。先に pipeline/fetch_age_mesh.py を実行してください")
    cache = Path(str(CENSUS_GIS_CACHE).format(year=year))
    if use_cache and cache.exists() and cache.stat().st_mtime >= max(path.stat().st_mtime for path in paths):
        return pd.read_parquet(cache)
    cells = pd.concat([read_gis_zip(table, path.read_bytes(), path.name) for path in paths], ignore_index=True)
    if use_cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cells.to_parquet(cache, index=False)
    return cells


# --- 国勢調査：セルの決まり ---------------------------------------------------------------


def check_items(cells: pd.DataFrame, source: str) -> list[str]:
    """セルの項目の決まり：コードが重ならない・総数がある・秘匿していないセルは年齢がそろい、
    15 歳以上 ＝ 15〜64 歳 ＋ 65 歳以上・75 歳以上 ≤ 65 歳以上・0 以上。"""
    problems = []
    open_cells = cells[cells["secrecy"] != SECRECY_HIDDEN]
    rules = {
        "コードが重なる": cells["code"].duplicated(),
        "総数が無い": cells["total"].isna(),
        "秘匿していないのに年齢が無い": open_cells[["a0_14", "a15p", "a15_64", "a65p", "a75p"]].isna().any(axis=1),
        "15 歳以上 ≠ 15〜64 歳 ＋ 65 歳以上": open_cells["a15p"] != open_cells["a15_64"] + open_cells["a65p"],
        "75 歳以上 > 65 歳以上": open_cells["a75p"] > open_cells["a65p"],
        "負の値": (open_cells[["total", "a0_14", "a15p"]] < 0).any(axis=1),
    }
    for name, broken in rules.items():
        if broken.any():
            sample = cells.loc[broken[broken].index, "code"].head(3).tolist()
            problems.append(f"{source}: {name}（{int(broken.sum()):,} セル・例 {sample}）")
    return problems


def check_secrecy(cells: pd.DataFrame, source: str) -> list[str]:
    """秘匿したセルの合算先は「合算先」の印のセルで、合算先の GASSAN と秘匿したセルの HTKSAKI が同じ組を指す。"""
    marks = cells.set_index("code")["secrecy"]
    hidden = cells[cells["secrecy"] == SECRECY_HIDDEN]
    target_marks = hidden["target"].map(marks)
    problems = []
    if (target_marks != SECRECY_TARGET).any():
        bad = hidden.loc[target_marks != SECRECY_TARGET, "code"].head(3).tolist()
        problems.append(f"{source}: 合算先が無い／合算先の印でない秘匿したセル {int((target_marks != SECRECY_TARGET).sum())}（例 {bad}）")
    pointed = set(zip(hidden["target"], hidden["code"], strict=True))
    targets = cells[cells["secrecy"] == SECRECY_TARGET]
    listed = {(t, h) for t, merged in zip(targets["code"], targets["merged"], strict=True)
              for h in merged.split(MERGED_SEPARATOR) if h}
    if pointed != listed:
        problems.append(f"{source}: 合算先の GASSAN と秘匿したセルの HTKSAKI が食い違う {len(pointed ^ listed)} 組")
    return problems


# --- 国勢調査：補った年齢 ---------------------------------------------------------------


def _known_bands(heads: pd.DataFrame) -> pd.DataFrame:
    """組の頭（合算先か、秘匿の無いセル）の年齢 → 4 区分（年齢が分かっている人）。"""
    return pd.DataFrame({
        "0_14": heads["a0_14"], "15_64": heads["a15_64"], "65_74": heads["a65p"] - heads["a75p"], "75plus": heads["a75p"],
    }, index=heads.index)


def secrecy_groups(cells: pd.DataFrame) -> pd.Series:
    """セル → 組の鍵（秘匿したセルは合算先のコード、それ以外は自分のコード）。"""
    return cells["code"].where(cells["secrecy"] != SECRECY_HIDDEN, cells["target"])


def impute_census(cells: pd.DataFrame, ratios: pd.DataFrame, n03: pd.Series) -> pd.DataFrame:
    """セルの表 → セル × （n03・total・unknown・4 区分・ratio_area）。`n03` はセルのコード → 市区町村。

    組の不詳が負（年齢の分かっている人が組の総数より多い）なら、読み方が崩れているので落とす。
    """
    group = secrecy_groups(cells)
    heads = cells[cells["secrecy"] != SECRECY_HIDDEN].set_index("code")
    group_total = cells["total"].groupby(group.to_numpy()).sum().reindex(heads.index)
    known = _known_bands(heads)
    unknown = group_total - known.sum(axis=1)
    if (unknown < 0).any():
        sample = unknown[unknown < 0].head(3).to_dict()
        raise SystemExit(f"組の年齢不詳が負（年齢の分かっている人 > 総数）{int((unknown < 0).sum()):,} 組（例 {sample}）")
    rates, source = ratios_for(n03.reindex(heads.index), ratios)
    allocated = known + rates.to_numpy() * unknown.to_numpy()[:, None]
    totals = group.map(group_total).to_numpy()
    share = np.divide(cells["total"].to_numpy(), totals, out=np.zeros(len(cells)), where=totals > 0)
    out = pd.DataFrame({"code": cells["code"].to_numpy(), "n03": n03.reindex(cells["code"]).to_numpy(),
                        "total": cells["total"].to_numpy(), "unknown": unknown.reindex(group).to_numpy() * share})
    for band, column in zip(BANDS, BAND_COLUMNS, strict=True):
        out[column] = allocated[band].reindex(group).to_numpy() * share
    out["ratio_area"] = source.reindex(group).to_numpy()
    return out


def census_age_cells(year: int) -> pd.DataFrame:
    """その年の、補った年齢のセルの表（読み込み・決まりの確かめ・市区町村・割り振り）。"""
    cells = read_census_gis(year)
    problems = check_items(cells, f"{year} 年") + check_secrecy(cells, f"{year} 年")
    if problems:
        raise SystemExit("\n".join(["統計 GIS のセルの決まりが崩れた:", *problems]))
    n03 = cell_n03(cells["code"]).set_axis(cells["code"].to_numpy())
    if n03.isna().any():
        raise SystemExit(f"{year} 年：市区町村の付かないセル {int(n03.isna().sum()):,}")
    return impute_census(cells, allocation_ratios(year), n03).assign(year=year)


# --- R6：真の総数 × 年齢構成 ---------------------------------------------------------------


def read_r6_age() -> pd.DataFrame:
    """R6 の年齢の列（県 × セルの行。年ごとに HITOKU・GASSAN・PTN・PT00・PTA〜PTD）。控え（parquet）があれば読む。"""
    if R6_AGE_CACHE.exists():
        return pd.read_parquet(R6_AGE_CACHE)
    columns = ["MESH_ID", "SHICODE", *[f"{field}{year}" for year in PRED_YEARS for field in R6_FIELDS]]
    table = read_r6_attributes(columns)
    for year in PRED_YEARS:
        table[f"HITOKU{year}"] = table[f"HITOKU{year}"].fillna("").astype(str).str.strip()
        table[f"GASSAN{year}"] = table[f"GASSAN{year}"].fillna("").astype(str).str.strip()
    R6_AGE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    table.to_parquet(R6_AGE_CACHE, index=False)
    return table


def r6_parts(raw: pd.DataFrame, year: int) -> np.ndarray:
    """その年の 4 区分の値（秘匿を当てた値。行 × 区分）。"""
    columns = []
    for band in BANDS:
        value = raw[f"{R6_BAND_FIELDS[band]}_{year}"].to_numpy(dtype=np.float64)
        minus = R6_BAND_MINUS.get(band)
        columns.append(value - raw[f"{minus}_{year}"].to_numpy(dtype=np.float64) if minus else value)
    return np.column_stack(columns)


def r6_composition_source(raw: pd.DataFrame, year: int) -> pd.Series:
    """行ごとに、年齢構成を借りる行の鍵（`県:MESH_ID`。秘匿したセル `*` は合算先）。"""
    key = raw["pref"] + ":" + raw["MESH_ID"]
    hidden = raw[f"HITOKU{year}"] == R6_HIDDEN
    return key.where(~hidden, raw["pref"] + ":" + raw[f"GASSAN{year}"])


def _r6_year(raw: pd.DataFrame, year: int) -> pd.DataFrame:
    """1 年分：行 × （total＝PTN・4 区分＝PTN × 構成）。構成が無いのに PTN がある行があれば落とす。"""
    parts = r6_parts(raw, year)
    base = parts.sum(axis=1)
    key = raw["pref"] + ":" + raw["MESH_ID"]
    own = pd.DataFrame(np.divide(parts, base[:, None], out=np.zeros_like(parts), where=base[:, None] > 0), index=key)
    composition = own[base > 0].reindex(r6_composition_source(raw, year)).to_numpy()
    ptn = raw[f"PTN_{year}"].to_numpy(dtype=np.float64)
    lacking = (ptn > 0) & np.isnan(composition).any(axis=1)
    if lacking.any():
        raise SystemExit(f"R6 {year} 年：年齢構成の無い行 {int(lacking.sum()):,}（例 {key[lacking].head(3).tolist()}）")
    values = np.nan_to_num(composition) * ptn[:, None]
    columns = {f"total_{year}": ptn, **{f"{column}_{year}": values[:, i] for i, column in enumerate(BAND_COLUMNS)}}
    return pd.DataFrame(columns, index=raw.index)


def check_r6(raw: pd.DataFrame) -> list[str]:
    """R6 の秘匿の決まり：鍵（県:MESH_ID）が重ならない・`*` は PT00 が 0 で合算先は同じ県の `@`・印の無い行は PT00 ＝ PTN。"""
    key = raw["pref"] + ":" + raw["MESH_ID"]
    problems = ["R6：県:MESH_ID が重なる"] if key.duplicated().any() else []
    for year in PRED_YEARS:
        marks = pd.Series(raw[f"HITOKU{year}"].to_numpy(), index=key)
        hidden = raw[f"HITOKU{year}"] == R6_HIDDEN
        target_marks = r6_composition_source(raw, year)[hidden].map(marks)
        if (target_marks != R6_TARGET).any():
            problems.append(f"R6 {year} 年：合算先が同じ県の @ でない * の行 {int((target_marks != R6_TARGET).sum()):,}")
        if (raw.loc[hidden, f"PT00_{year}"] != 0).any():
            problems.append(f"R6 {year} 年：* なのに PT00 が 0 でない行")
        plain = raw[f"HITOKU{year}"] == ""
        if (np.abs(raw.loc[plain, f"PT00_{year}"] - raw.loc[plain, f"PTN_{year}"]) > 1e-3).any():
            problems.append(f"R6 {year} 年：印の無い行で PT00 ≠ PTN")
    return problems


def r6_age_rows() -> pd.DataFrame:
    """R6 の行（県 × セル）ごとの総数（PTN）と 4 区分（年ごと）に、セルのコードと市区町村コード（SHICODE）を添えて。

    エリアの区域の値（`build_area_values.py`）が、この行を SHICODE ごとに足して行政区域の推計の年齢にする（2026-11-25）。
    """
    raw = read_r6_age()
    problems = check_r6(raw)
    if problems:
        raise SystemExit("\n".join(["R6 の秘匿の決まりが崩れた:", *problems]))
    frames = [_r6_year(raw, year) for year in PRED_YEARS]
    return pd.concat([raw[["MESH_ID", "SHICODE"]].rename(columns={"MESH_ID": "code"}), *frames], axis=1)


def r6_age_cells() -> pd.DataFrame:
    """R6 → セル × 年 の総数（PTN）と 4 区分（県をまたぐセルは県ごとの行を足して 1 つに）。"""
    return r6_age_rows().drop(columns=["SHICODE"]).groupby("code", as_index=False).sum()
