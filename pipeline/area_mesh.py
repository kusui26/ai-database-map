"""メッシュの読み方（B5a）— 沿線の面積按分と、将来推計人口（R6）の市区町村ごとの合計に使う。

駅の半径の値を作ったノートブック（`script/create_dataset_for_AI_Database_Map.ipynb` の `_build_geom`・`load_mesh_pop`・
`_load_eco`）と**同じ規約**で読む。沿線の値が駅の値と同じ方法で作られていることは、validate_area_values.py が
円の重ならない路線で確かめる（沿線＝駅の円の値の和）。

- 国勢調査：250m（2015・2020）。人口総数（cat01＝0010）を、秘匿・合算の印に関わらずそのまま使う（全国計が公表値と一致）
- 経済センサス：500m（2012・2016・2021）・民営 A〜R（`docs/establishment_employee.md`）
- 将来推計人口（R6）：250m の真の値 `PTN_<年>`（`docs/population_mesh.md` §10.4）。県をまたぐセルは県ごとに分けて
  計上されているので、セルの値は足して 1 つにする（市区町村ごとの合計には分けたまま使う）
"""

from __future__ import annotations

import glob
import io
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

from area_common import RAW_DIR, ROOT
from area_rules import ANCHORS, PRED_YEARS

DATA_DIR = ROOT / "data"
#: CRS.md の正積図法（Albers・GRS80）。駅の値と同じ定義。
ALBERS_PROJ = "+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=35 +lon_0=135 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs"
#: バッファ円の分割（既定 8 は円の面積を 0.6% 小さく見積もる。32 で 99.96%・駅の値と同じ）。
BUFFER_QUAD_SEGS = 32

CENSUS_MESH_DIRS: dict[int, Path] = {
    2015: DATA_DIR / "国勢調査_人口及び世帯_2015_mesh250",
    2020: DATA_DIR / "国勢調査_人口及び世帯_2020_mesh250",
}
#: 人口総数（cat01）。15〜64 歳（0100）は別のファイル名（age1564_*.csv）なので混ざらない。
CENSUS_POP_CAT01 = 10
ECON_DIR = DATA_DIR / "経済センサス_活動調査_事業所数及び従業者数"
#: 2021 年の生テーブルの列：事業所数・従業者数（Ａ〜Ｒ全産業・Ｓ公務を除く＝民営）。
ECON_2021_COLUMNS = ("T001162002", "T001162023")
R6_ZIP = DATA_DIR / "250mメッシュ別将来推計人口データ（R6国政局推計）" / "250m_mesh_2024_SHP.zip"
R6_CACHE = RAW_DIR / "r6_ptn.parquet"
R6_COLUMNS = tuple(f"PTN_{y}" for y in PRED_YEARS)

_TO_ALBERS = Transformer.from_crs("EPSG:6668", ALBERS_PROJ, always_xy=True)


def to_albers(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return _TO_ALBERS.transform(lon, lat)


def _check_total(label: str, got: float, want: int) -> None:
    if round(got) != want:
        raise SystemExit(f"{label}の全国計 {got:,.0f} が公表値 {want:,} と合わない（読み方が崩れた）")


def read_census_mesh(year: int) -> pd.DataFrame:
    """国勢調査 250m メッシュの人口総数（code, pop）。全国計を公表値と照合する。"""
    frames = []
    for path in sorted(glob.glob(str(CENSUS_MESH_DIRS[year] / "mesh*.csv"))):
        lines = Path(path).read_text(encoding="utf-8").splitlines()
        start = next(i for i, line in enumerate(lines) if line == '"VALUE"')
        table = pd.read_csv(io.StringIO("\n".join(lines[start + 1 :])), dtype=str)
        rows = table[pd.to_numeric(table["cat01_code"], errors="coerce") == CENSUS_POP_CAT01]
        frames.append(pd.DataFrame({
            "code": rows["area_code"].astype(str),
            "pop": pd.to_numeric(rows["value"], errors="coerce").fillna(0.0),
        }))
    mesh = pd.concat(frames, ignore_index=True).groupby("code", as_index=False)["pop"].sum()
    _check_total(f"国勢調査 {year} 年の 250m メッシュ", float(mesh["pop"].sum()), ANCHORS[("jp", f"pop_{year}")])
    return mesh


def read_econ_mesh(year: int) -> pd.DataFrame:
    """経済センサス 500m メッシュの民営の事業所数・従業者数（code, estab, emp）。全国計を公表値と照合する。"""
    frames = []
    if year == 2021:
        for path in sorted(glob.glob(str(ECON_DIR / "2021" / "tblT001162H*.zip"))):
            with zipfile.ZipFile(path) as zf:
                text = zf.read(zf.namelist()[0]).decode("shift_jis")
            table = pd.read_csv(io.StringIO(text), dtype=str)
            table = table[table["KEY_CODE"].str.fullmatch(r"\d+", na=False)]  # 2 行目のラベル行を除く
            estab, emp = ECON_2021_COLUMNS
            frames.append(pd.DataFrame({
                "code": table["KEY_CODE"],
                "estab": pd.to_numeric(table[estab], errors="coerce").fillna(0.0),
                "emp": pd.to_numeric(table[emp], errors="coerce").fillna(0.0),
            }))
    else:
        for path in sorted(glob.glob(str(ECON_DIR / str(year) / f"eco{year}_*.csv"))):
            table = pd.read_csv(path, dtype={"KEY_CODE": str})
            frames.append(pd.DataFrame({
                "code": table["KEY_CODE"],
                "estab": pd.to_numeric(table["estab"], errors="coerce").fillna(0.0),
                "emp": pd.to_numeric(table["emp"], errors="coerce").fillna(0.0),
            }))
    mesh = pd.concat(frames, ignore_index=True).groupby("code", as_index=False)[["estab", "emp"]].sum()
    _check_total(f"経済センサス {year} 年の事業所", float(mesh["estab"].sum()), ANCHORS[("jp", f"estab_n_{year}")])
    _check_total(f"経済センサス {year} 年の従業者", float(mesh["emp"].sum()), ANCHORS[("jp", f"emp_n_{year}")])
    return mesh


def _read_r6_from_zip() -> pd.DataFrame:
    """R6 の入れ子 zip（外 zip → 県別 zip → shp）から、属性だけを読む（ジオメトリはコードから作る）。"""
    import pyogrio

    if not R6_ZIP.exists():
        raise SystemExit(f"{R6_ZIP.relative_to(ROOT)} がありません（将来推計人口メッシュ R6）")
    frames = []
    with zipfile.ZipFile(R6_ZIP) as outer, tempfile.TemporaryDirectory() as tmp:
        for name in sorted(n for n in outer.namelist() if n.endswith(".zip")):
            inner = Path(tmp) / Path(name).name
            inner.write_bytes(outer.read(name))
            with zipfile.ZipFile(inner) as zf:
                shp = [n for n in zf.namelist() if n.endswith(".shp")]
            if len(shp) != 1:
                raise SystemExit(f"{name} の中に shp が 1 つではない: {shp}")
            frame = pyogrio.read_dataframe(
                f"zip://{inner}!{shp[0]}", columns=["MESH_ID", "SHICODE", *R6_COLUMNS], read_geometry=False
            )
            frames.append(frame)
            inner.unlink()
    table = pd.concat(frames, ignore_index=True)
    table["MESH_ID"] = table["MESH_ID"].map(_code_text)
    table["SHICODE"] = table["SHICODE"].map(_code_text).str.zfill(5)
    return table


def _code_text(value: object) -> str:
    """属性のコード（数でも文字でも読める）→ 桁の文字列（`5339461132.0` のような小数の形にしない）。"""
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        if not float(value).is_integer():
            raise ValueError(f"コードが整数でない: {value}")
        return str(int(value))
    return str(value).strip()


def read_r6_ptn() -> pd.DataFrame:
    """R6 の行（MESH_ID, SHICODE, PTN_2020 … PTN_2070）。県をまたぐセルは県ごとの 2 行のまま返す。"""
    if R6_CACHE.exists():
        table = pd.read_parquet(R6_CACHE)
    else:
        table = _read_r6_from_zip()
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        table.to_parquet(R6_CACHE, index=False)
    _check_total("R6 の 2020 年（基準）", float(table["PTN_2020"].sum()), ANCHORS[("jp", "pop_2020")])
    _check_total("R6 の 2050 年", float(table["PTN_2050"].sum()), ANCHORS[("jp", "pop_pred_2024_2050")])
    return table


def r6_cells() -> pd.DataFrame:
    """R6 をセルごとに 1 行へ（県ごとに分けて計上されたセルを足す・面積按分用）。"""
    table = read_r6_ptn()
    return table.groupby("MESH_ID", as_index=False)[list(R6_COLUMNS)].sum().rename(columns={"MESH_ID": "code"})


def cell_bounds(codes: pd.Series) -> np.ndarray:
    """メッシュコード（9 桁＝500m・10 桁＝250m）→ 南西と北東の経度緯度 (west, south, east, north)。

    `docs/population_mesh.md` §8.2 のデコーダ（ノートブックの `_build_geom` と同じ）。1 列の中で桁数は揃っていること。
    """
    text = codes.astype(str)
    lengths = text.str.len().unique()
    if len(lengths) != 1 or lengths[0] not in (9, 10):
        raise ValueError(f"メッシュコードの桁数がそろっていない／9・10 桁でない: {lengths}")
    digit = [text.str[i].astype(int).to_numpy() for i in range(int(lengths[0]))]
    lat = digit[0] * 10 + digit[1]
    lon = digit[2] * 10 + digit[3]
    south = lat * 2 / 3 + digit[4] * (2 / 3) / 8 + digit[6] * (2 / 3) / 80 + ((digit[8] - 1) // 2) * (1 / 240)
    west = (lon + 100) + digit[5] / 8 + digit[7] / 80 + ((digit[8] - 1) % 2) * (1 / 160)
    dlat, dlon = 1 / 240, 1 / 160
    if lengths[0] == 10:
        south = south + ((digit[9] - 1) // 2) * (1 / 480)
        west = west + ((digit[9] - 1) % 2) * (1 / 320)
        dlat, dlon = 1 / 480, 1 / 320
    return np.column_stack([west, south, west + dlon, south + dlat])


def cell_polygons(codes: pd.Series) -> np.ndarray:
    """メッシュコード → 正積図法の矩形（4 隅を投影して結ぶ・ノートブックと同じ）。"""
    bounds = cell_bounds(codes)
    west, south, east, north = bounds.T
    xs, ys = [], []
    for lon, lat in ((west, south), (east, south), (east, north), (west, north)):
        x, y = to_albers(lon, lat)
        xs.append(x)
        ys.append(y)
    rings = np.stack([np.column_stack([xs[i], ys[i]]) for i in (0, 1, 2, 3, 0)], axis=1)
    return shapely.polygons(rings)
