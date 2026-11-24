"""人口の年齢（2026-11-24・人口の年齢 PR-1 データ）— **手で編集するのはここだけ**。

設計は `docs/261122_PLAN_population_improvement.md` §2〜§3、データの説明は `docs/population_mesh.md` §12。
fetch_age_mesh.py・fetch_area_stats.py（市区町村の年齢の表）・age_mesh.py・build_station_age.py・validate_station_age.py が読む。

- **実績**（2015・2020）：国勢調査 250m メッシュの年齢の項目。e-Stat の統計 GIS からファイルで取る（API には合算先の列が無い）。
  秘匿したセルの年齢は合算先のセルに足し上げてあるので、合算先と同じ年齢構成で本来のセルへ戻す。
  年齢不詳は、市区町村ごとの公式の不詳補完値に合うように割り振る（計画書の方式 B）
- **推計**（2025〜2050）：国土数値情報 将来推計人口メッシュ（R6）の年齢の列。真の総数 `PTN` × セルの年齢構成
  （秘匿したセル `*` は合算先 `@` の構成）。年齢の和は既存の `pop_pred_2024_*` と一致する
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

# --- 年・年齢の区分 -------------------------------------------------------------

#: 国勢調査の年（250m メッシュに年齢がある年。2010 年以前のメッシュに年齢は無い）。
CENSUS_YEARS: tuple[int, ...] = (2015, 2020)
#: R6 の年齢を使う年（2020 年は基準年で年齢が無い。2055 年以降は使わない＝計画書 §3.5）。
PRED_YEARS: tuple[int, ...] = (2025, 2030, 2035, 2040, 2045, 2050)
#: グラフ用の表（第 2 段）の年。
PROFILE_YEARS: tuple[int, ...] = CENSUS_YEARS + PRED_YEARS
#: 年齢の 4 区分（足すと総数）。並びは積む順・列の並び。
BANDS: tuple[str, ...] = ("0_14", "15_64", "65_74", "75plus")
BAND_LABELS_JA: dict[str, str] = {"0_14": "0〜14歳", "15_64": "15〜64歳", "65_74": "65〜74歳", "75plus": "75歳以上"}

# --- 国勢調査 250m メッシュ（e-Stat 統計 GIS のファイル） ----------------------------------------

#: 統計 GIS のダウンロード（appId 不要）。`downloadType=2` が統計データ（CSV の zip）。
GIS_DOWNLOAD_URL = "https://www.e-stat.go.jp/gis/statmap-search/data"
#: 秘匿処理（`HTKSYORI`）：0＝秘匿なし・1＝合算先（秘匿したセルの値を足し上げたセル）・2＝秘匿したセル（`HTKSAKI`＝合算先）。
SECRECY_NONE = "0"
SECRECY_TARGET = "1"
SECRECY_HIDDEN = "2"
#: セルの項目（読み込んだ表の列名）。total は年齢不詳を含む（秘匿しない項目）。年齢の項目は秘匿したセルで空。
CELL_ITEMS: tuple[str, ...] = ("total", "a0_14", "a15p", "a15_64", "a65p", "a75p")


@dataclass(frozen=True)
class MeshTable:
    """国勢調査 250m メッシュの統計 GIS の表 1 つ。`columns` と `labels` は項目 → 列・見出し（空白を除いた 2 行目）。"""

    year: int
    stats_id: str
    directory: Path
    columns: dict[str, str]
    labels: dict[str, str]


#: 2015 年と 2020 年は**項目の並びが違う**（2020 年は「18 歳以上」が入り、65 歳以上が 16 番目 → 19 番目）。
#: 取得と読み込みのたびに、2 行目の見出しで項目を確かめる。
MESH_TABLES: dict[int, MeshTable] = {
    2015: MeshTable(
        2015, "T000876", DATA_DIR / "国勢調査_人口及び世帯_2015_mesh250" / "gis",
        {"total": "T000876001", "a0_14": "T000876004", "a15p": "T000876007", "a15_64": "T000876010",
         "a65p": "T000876016", "a75p": "T000876019"},
        {"total": "人口総数", "a0_14": "０〜１４歳人口総数", "a15p": "１５歳以上人口総数", "a15_64": "１５〜６４歳人口総数",
         "a65p": "６５歳以上人口総数", "a75p": "７５歳以上人口総数"},
    ),
    2020: MeshTable(
        2020, "T001102", DATA_DIR / "国勢調査_人口及び世帯_2020_mesh250" / "gis",
        {"total": "T001102001", "a0_14": "T001102004", "a15p": "T001102007", "a15_64": "T001102010",
         "a65p": "T001102019", "a75p": "T001102022"},
        {"total": "人口（総数）", "a0_14": "０〜１４歳人口総数", "a15p": "１５歳以上人口総数", "a15_64": "１５〜６４歳人口総数",
         "a65p": "６５歳以上人口総数", "a75p": "７５歳以上人口総数"},
    ),
}
#: 全国は第 1 次地域区画 151 区画（`docs/population_mesh.md` §1）。
EXPECTED_REGIONS = 151


def gis_zip_name(table: MeshTable, region: str) -> str:
    """区画（`M5339`）→ 保存するファイル名（統計 GIS の名前のまま・`tblT001102Q5339.zip`。Q＝250m）。"""
    return f"tbl{table.stats_id}Q{region.removeprefix('M')}.zip"


# --- 市区町村の年齢の表（e-Stat API・fetch_area_stats.py が data/area_raw/estat/ に取る） -------------------


@dataclass(frozen=True)
class MuniAgeTable:
    """市区町村の年齢の表 1 つ。`codes` は区分 → 足す年齢のコード（5 歳階級）。`unknown` は年齢「不詳」のコード。"""

    name: str
    year: int
    imputed: bool
    stats_data_id: str
    params: tuple[tuple[str, str], ...]
    titleJa: str
    age_class: str
    total_code: str
    codes: dict[str, tuple[str, ...]]
    unknown: str | None


def _two_digit(first: int, last: int) -> tuple[str, ...]:
    return tuple(f"{code:02d}" for code in range(first, last + 1))


#: 2020 年の表（と 2015 年の不詳補完値）の 5 歳階級のコード：01＝0〜4 歳 … 13＝60〜64 歳・14〜15＝65〜74 歳・16〜21＝75 歳以上。
FIVE_YEAR_CODES: dict[str, tuple[str, ...]] = {
    "0_14": _two_digit(1, 3), "15_64": _two_digit(4, 13), "65_74": _two_digit(14, 15), "75plus": _two_digit(16, 21),
}
#: 2015 年の原数値の表（人口等基本集計）は別のコード：1180＝0〜4 歳 … 1460＝100 歳以上・1490＝年齢「不詳」。
FIVE_YEAR_CODES_2015_RAW: dict[str, tuple[str, ...]] = {
    "0_14": ("1180", "1190", "1200"),
    "15_64": tuple(str(code) for code in range(1210, 1301, 10)),
    "65_74": ("1310", "1320"),
    "75plus": ("1330", "1340", "1350", "1360", "1370", "1460"),
}

MUNI_AGE_TABLES: tuple[MuniAgeTable, ...] = (
    MuniAgeTable(
        "census_age_raw_2015", 2015, False, "0003149862",
        (("cdCat01", "00710"), ("cdCat03", "0000"), ("cdCat04", "0000"), ("cdCat05", "0000")),
        "平成 27 年国勢調査 人口等基本集計 — 年齢（5 歳階級），男女別人口（全域・総数・年齢「不詳」あり）",
        "cat02", "0000", FIVE_YEAR_CODES_2015_RAW, "1490",
    ),
    MuniAgeTable(
        "census_age_imputed_2015", 2015, True, "0004019348",
        (("cdCat02", "0"), ("cdCat03", "0")),
        "令和 2 年国勢調査 参考表：不詳補完結果（平成 27 年国勢調査に対応）— 年齢（5 歳階級），男女別人口（総数）",
        "cat01", "00", FIVE_YEAR_CODES, None,
    ),
    MuniAgeTable(
        "census_age_raw_2020", 2020, False, "0003445162",
        (("cdCat01", "0"), ("cdCat02", "0")),
        "令和 2 年国勢調査 人口等基本集計 — 年齢（5 歳階級），男女別人口（国籍総数・総数・年齢「不詳」あり）",
        "cat03", "00", FIVE_YEAR_CODES, "22",
    ),
    MuniAgeTable(
        "census_age_imputed_2020", 2020, True, "0004019309",
        (("cdCat02", "0"), ("cdCat03", "0")),
        "令和 2 年国勢調査 参考表：不詳補完結果 — 年齢（5 歳階級），男女別人口（国籍総数・総数）",
        "cat01", "00", FIVE_YEAR_CODES, None,
    ),
)


def muni_age_table(year: int, imputed: bool) -> MuniAgeTable:
    return next(t for t in MUNI_AGE_TABLES if t.year == year and t.imputed == imputed)


#: 国勢調査の年の市区町村コード → 今（N03 2026-01-01）のコード。市制施行でコードだけ変わった団体（範囲は同じ）。
MUNI_CODE_RENAMES: dict[int, dict[str, str]] = {
    2015: {"04423": "04216", "40305": "40231"},  # 富谷町 → 富谷市（2016）・那珂川町 → 那珂川市（2018）
    2020: {},
}
#: 今の区が国勢調査の年に無いとき、割り振り比を借りる区域（N03 のコード → 表のコード）。
#: 浜松市は 2024-01 に 7 区 → 3 区。天竜区は範囲が同じでコードだけ変わった。中央区・浜名区は市全体の比を使う。
RATIO_AREA_ALIASES: dict[str, str] = {"22140": "22137", "22138": "22130", "22139": "22130"}
#: 全国の行。都道府県の行は「都道府県コード＋000」。
NATIONAL_CODE = "00000"
PREFECTURE_SUFFIX = "000"

# --- R6（将来推計人口メッシュ）の列 ---------------------------------------------------

#: 年齢の 4 区分 → R6 の列の頭（`PTA_2050` など）。PTA＝0〜14・PTB＝15〜64・PTC＝65 歳以上・PTD＝75 歳以上。
R6_BAND_FIELDS: dict[str, str] = {"0_14": "PTA", "15_64": "PTB", "65_74": "PTC", "75plus": "PTD"}
#: 区分から引く列（65〜74 歳 ＝ PTC − PTD）。
R6_BAND_MINUS: dict[str, str] = {"65_74": "PTD"}
#: R6 から読む列の頭（年ごと）。PT00 は秘匿を当てた総数（合算先では足し上げた値）、PTN は真の総数。
R6_FIELDS: tuple[str, ...] = ("HITOKU", "GASSAN", "PTN_", "PT00_", "PTA_", "PTB_", "PTC_", "PTD_")
#: R6 の秘匿の印（`HITOKU<年>`）：`*`＝秘匿したセル（値は `GASSAN<年>` の合算先へ）・`@`＝合算先。
R6_HIDDEN = "*"
R6_TARGET = "@"

# --- しきい値・出力の列 -------------------------------------------------------------

#: 65 歳以上がこの人数より少ないと、65 歳以上の将来増減率を参考値にする（既存の pop_lowbase と同じ 50 人）。
LOWBASE_65_PEOPLE = 50
#: 2020 年の年齢不詳（補う前）の割合がこれ以上なら ⚠（`pop_ageunk_2020_*`）。除外はしない。
#: 全国の 1km 圏（人口 5,000 人以上の 5,054 駅）の上位 5.3%（95% 点は 10.2%・2026-11-24 実測）。1km で 295 駅に立つ。
AGE_UNKNOWN_NOTICE_SHARE = 0.10
#: 割合・増減率の小数の桁（既存の pop_gr と同じ 1 桁）。
RATE_DECIMALS = 1

#: 第 1 段の指標（列名の頭・半径の前まで）。並びは CSV の列の並び（計画書 §3.3 の表の順：必須 6・推奨 4）。
METRIC_PREFIXES: tuple[str, ...] = (
    "pop15_64_2020",
    "pop15_64_share_2020",
    "pop65_share_2020",
    "pop15_64_gr_2020_2015",
    "pop15_64_gr_pred_2024_2050",
    "pop65_gr_pred_2024_2050",
    "pop15_64_gr_pred_2024_2030",
    "pop15_64_gr_pred_2024_2040",
    "pop65_share_pred_2024_2050",
    "pop75_share_2020",
    "pop0_14_share_2020",
)
#: 信頼性のフラグ（1 のときだけ意味がある。0 は DB に入れない）。
FLAG_PREFIXES: tuple[str, ...] = ("pop65_lowbase_2020", "pop_ageunk_2020")

# --- 置き場所 -------------------------------------------------------------------

DERIVED_DIR = DATA_DIR / "derived"
AREA_RAW_DIR = DATA_DIR / "area_raw"
#: 駅ごとの第 1 段の列とフラグ（PR-2 が station_dataset.csv の右に駅で連結して読む）。
STATION_AGE_CSV = DERIVED_DIR / "station_age.csv"
#: 第 2 段（グラフ用）：駅 × 半径 × 年の 4 区分（と、実績の年の年齢不詳）。
STATION_AGE_PROFILES_CSV = DERIVED_DIR / "station_age_profiles.csv"
#: セルの値（補った年齢の 4 区分）。検証と、エリアの要約（PR-5）の沿線が使う。
CENSUS_AGE_CELLS = DERIVED_DIR / "age_cells_census.parquet"
R6_AGE_CELLS = DERIVED_DIR / "age_cells_r6.parquet"
#: 読み込みの控え（作り直せるもの）。
CENSUS_GIS_CACHE = AREA_RAW_DIR / "census_age_gis_{year}.parquet"
R6_AGE_CACHE = AREA_RAW_DIR / "r6_age.parquet"
CELL_N03_CACHE = AREA_RAW_DIR / "mesh250_n03.parquet"
