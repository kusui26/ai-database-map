"""エリアの区域の値（B5a・2026-10-10）— **手で編集するのはここだけ**。

設計は `docs/261001_fix_user_feedback_ui.md` §6.12、データの説明は `docs/area_values.md`。
fetch_area_stats.py・build_area_values.py・build_line_corridors.py・validate_area_values.py・load_area_values.py が読む。

区域の値は 2 つの作り方で持つ（§6.12.4・§12-20）。

- **行政区域**（全国・都道府県・市区町村・政令市・東京 23 区）：**公表値**。メッシュから作り直さない
  （全国の市区町村で按分すると、公表値と人口で最大 11%・従業者で最大 29% ずれた）
- **沿線**（路線の駅から W の円を重ねた範囲）：公表値が無いので、**メッシュの面積按分**（駅の半径の値と同じ方法）

将来推計人口は、国土数値情報の将来推計人口メッシュ（R6）を**市区町村コード（SHICODE）ごとに足す**。2020〜2050 年は
社人研の地域別推計（令和 5 年推計）と同じ値になる（validate_area_values.py が全市区町村で照合する）。
"""

from __future__ import annotations

from dataclasses import dataclass

# --- 年・幅 ---------------------------------------------------------------

#: 国勢調査の人口（行政区域・公表値）。1995〜2020 は今の境域に組み替えた値、2025 は令和 7 年国勢調査（2026-09-29 公表）。
POP_YEARS: tuple[int, ...] = (1995, 2000, 2005, 2010, 2015, 2020, 2025)
#: 沿線の人口（250m メッシュの年だけ）。2010 年以前は 500m で、250m の年と比べると段差が出る（docs/population_mesh.md §6.3）。
#: 2025 年のメッシュは未公表（2026-10-10 時点）。
LINE_POP_YEARS: tuple[int, ...] = (2015, 2020)
#: 将来推計人口（R6・2020 年は推計の基準年）。
PRED_YEARS: tuple[int, ...] = tuple(range(2020, 2071, 5))
#: 社人研の地域別推計がある年（それより後は国交省の延長）。
IPSS_LAST_YEAR = 2050
#: 経済センサス‐活動調査（民営）。
ECON_YEARS: tuple[int, ...] = (2012, 2016, 2021)
#: 沿線の幅（駅からの距離・m）。既定は 1km（§12-22）。
LINE_WIDTHS_M: tuple[int, ...] = (500, 1000, 2000)
#: 駅の半径の値の列名の接尾辞（沿線の検証で、同じ幅の駅の円の値と比べる）。
RADIUS_SUFFIX: dict[int, str] = {500: "500m", 1000: "1km", 2000: "2km"}

# --- e-Stat の表（取得は fetch_area_stats.py だけ。実行時のアプリは e-Stat を呼ばない） -----------


@dataclass(frozen=True)
class EstatTable:
    """取得する e-Stat の表 1 つ。`params` は getStatsData に足す絞り込み。"""

    name: str  # data/area_raw/estat/{name}.json
    stats_data_id: str
    params: tuple[tuple[str, str], ...]
    titleJa: str


ESTAT_TABLES: tuple[EstatTable, ...] = (
    EstatTable(
        "ssds_muni_pop", "0000020201", (("cdCat01", "A1101"),),
        "社会・人口統計体系 市区町村データ（廃置分合処理済）A 人口・世帯 — 総人口（国勢調査・今の境域に組み替え済み）",
    ),
    EstatTable(
        "ssds_pref_pop", "0000010101", (("cdCat01", "A1101"),),
        "社会・人口統計体系 都道府県データ A 人口・世帯 — 総人口（国勢調査）",
    ),
    EstatTable(
        "ssds_muni_econ", "0000020203", (("cdCat01", "C2108,C2208"),),
        "社会・人口統計体系 市区町村データ（廃置分合処理済）C 経済基盤 — 事業所数・従業者数（民営・経済センサス）",
    ),
    EstatTable(
        "census2025_pop", "0004065881", (("cdCat01", "0"),),
        "令和 7 年国勢調査 人口等基本集計 — 男女別人口（総数）",
    ),
    EstatTable(
        "census2025_change", "0004065882", (("cdTab", "2025_03,2025_47"),),
        "令和 7 年国勢調査 人口等基本集計 — 2020 年の人口（組替）・面積（参考）",
    ),
    EstatTable(
        "econ2012", "0003085523", (("cdCat01", "000"),),
        "平成 24 年経済センサス‐活動調査 — 経営組織別民営事業所数及び男女別従業者数（全国・都道府県・市区町村）",
    ),
    EstatTable(
        "econ2016", "0003218501", (("cdCat01", "000"),),
        "平成 28 年経済センサス‐活動調査 — 経営組織別民営事業所数，男女別従業者数（全国・都道府県・市区町村）",
    ),
    EstatTable(
        "econ2021", "0004005640", (("cdCat01", "1"),),
        "令和 3 年経済センサス‐活動調査 — 経営組織別全事業所数，男女別従業者数（うち民営）",
    ),
)

#: 社会・人口統計体系の経済センサスの「年」は**年度**の表記（2012 年 2 月の活動調査は 2011 年度）。
SSDS_ECON_TIME: dict[int, str] = {2012: "2011", 2016: "2016", 2021: "2021"}
#: 経済センサスの各年の表で、事業所数・従業者数を表す表章項目（tab）。
ECON_TABS: dict[int, tuple[str, str]] = {
    2012: ("004", "005"),
    2016: ("004", "005"),
    2021: ("102-2021", "113-2021"),
}
#: 社会・人口統計体系の項目：人口・事業所数（民営）・従業者数（民営）。
SSDS_POP_ITEM = "A1101"
SSDS_ESTAB_ITEM = "C2108"
SSDS_EMP_ITEM = "C2208"
#: 令和 7 年国勢調査の表章項目：2020 年の人口（組替）・面積（参考）。
CENSUS2025_POP2020_TAB = "2025_03"
CENSUS2025_AREA_TAB = "2025_47"

#: 社人研の地域別推計の結果表（R6 の市区町村ごとの合計を照合するためだけに使う。配信しない）。
IPSS_XLSX_URL = "https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/3kekka/suikei_kekka.xlsx"

# --- 単位の特例 -------------------------------------------------------------

#: 東京都特別区部（23 区をまとめた値）。基本単位ではない（23 区の和）。
SPECIAL_WARDS_CODE = "13100"
#: 境界未定地域（経済センサスにだけある・市区町村ではない）。都道府県・全国の公表値には含まれる。
BOUNDARY_UNDETERMINED_CODES: frozenset[str] = frozenset({"13199"})
#: 行政区域（N03）の所属未定地は「都道府県コード＋000」で入っている（市区町村ではない面）。エリアにしない。
N03_UNASSIGNED_SUFFIX = "000"
#: 北方領土の 6 村（N03 にはあるが、国勢調査・経済センサス・推計の対象外）。エリアにしない。
NORTHERN_TERRITORIES_CODES: frozenset[str] = frozenset({"01695", "01696", "01697", "01698", "01699", "01700"})
#: 浜松市（2024-01 に 7 区 → 3 区）。中央区・浜名区の値は 2020・2025 年の人口だけ（2025 年の国勢調査の組替）。
#: 天竜区は範囲が変わらずコードだけ変わったので、過去の値も推計もある。
HAMAMATSU_CODE = "22130"
#: 推計（R6）の再編前の区 → 今の区。天竜区（22137 → 22140）だけ写せる（build が 2020 年の人口の一致で確かめる）。
#: 中区・東区・西区・南区・北区・浜北区は中央区・浜名区へ分かれて入ったので、区の単位では写せない（市全体だけ）。
R6_CODE_ALIASES: dict[str, str] = {"22137": "22140"}
#: 2020 年の人口が社会・人口統計体系に無いとき、令和 7 年国勢調査の「2020 年の人口（組替）」で埋める区域。
POP2020_FROM_CENSUS2025: frozenset[str] = frozenset({"22138", "22139"})
#: 福島県の浜通り 13 市町村。社人研は個別の推計を出していない（R6 も 07999 にまとめている）。
HAMADORI_CODES: frozenset[str] = frozenset(
    {"07204", "07209", "07212", "07541", "07542", "07543", "07544", "07545", "07546", "07547", "07548", "07561", "07564"}
)
HAMADORI_R6_CODE = "07999"

# --- 値が無い理由（無い値は必ずここで理由を言う。言っていない欠けは build が落とす） -----------------


@dataclass(frozen=True)
class MissingRule:
    """どの区域の、どの指標が無いか（と、その理由）。上から順に当て、最初に当たった理由を使う。

    `codes` を書いた規則は「この区域にはこの値が無い」と言い切る（値があれば build が落とす＝規則が古い）。
    `codes` が None の規則は種類（`kinds`）で当て、`requires_parent_value` なら親（市全体）に値があることを確かめる。
    `in_parent_total` は、その値が**上の区域（市・県）の公表値には入っているか**。入っていれば内訳の和は上の値に
    ならないので照合しない。入っていなければ（調査されていない）残りの和で照合する。
    """

    codes: frozenset[str] | None
    kinds: frozenset[str] | None
    metric_prefixes: tuple[str, ...]  # 指標の key の頭（"pop_1995" … のように年まで書いてもよい）
    reasonJa: str
    requires_parent_value: bool = False
    in_parent_total: bool = True


MISSING_RULES: tuple[MissingRule, ...] = (
    MissingRule(
        frozenset({"22138", "22139"}), None,
        ("pop_1995", "pop_2000", "pop_2005", "pop_2010", "pop_2015"),
        "2024 年 1 月の区の再編（浜松市 7 区 → 3 区）で生まれた区。2015 年以前の値は無い"
        "（2020 年は 2025 年の国勢調査が新しい区に組み替えて出している）",
    ),
    MissingRule(
        frozenset({"22138", "22139"}), None,
        ("pop_pred_2024_",),
        "将来推計人口（R6）は再編前の浜松市の 7 区で作られている。浜松市全体の値はある",
    ),
    MissingRule(
        frozenset({"22138", "22139"}), None,
        ("estab_n_", "emp_n_"),
        "経済センサスは再編前の浜松市の 7 区で集計されている。浜松市全体の値はある",
    ),
    MissingRule(
        HAMADORI_CODES, None,
        ("pop_pred_2024_",),
        "社人研は福島県の浜通り 13 市町村の個別の推計を出していない（13 市町村をまとめた値だけ）",
        in_parent_total=False,  # 福島県の和には、まとめた値（07999）を足して照合する
    ),
    MissingRule(
        frozenset({"07542", "07543", "07545", "07546", "07547", "07548", "07564"}), None,
        ("estab_n_2012", "emp_n_2012"),
        "2012 年の経済センサスは、原発事故の避難指示区域のため調査されていない",
        in_parent_total=False,
    ),
    # 政令市の区は、その市が政令市になって区ができた年からしか値が無い（さいたま市・相模原市・新潟市・静岡市・
    # 堺市・岡山市・熊本市・浜松市の天竜区・札幌市の清田区など）。市全体の値はある（build が確かめる）。
    # 推計（pop_pred_…）はこの規則に入れない——推計はどの区にもある（無ければ別の理由で、build が落とす）。
    MissingRule(
        None, frozenset({"ward"}),
        (*(f"pop_{year}" for year in POP_YEARS), "estab_n_", "emp_n_"),
        "その年はまだ区が無かった（政令市になる前、または区ができる前）。市全体の値はある",
        requires_parent_value=True,
    ),
)

#: 市区町村の和が都道府県の公表値にならない組と、その差（＝都道府県の値 − 市区町村の和・1 人単位）。
#: 市区町村の値は今の境域に組み替えてあるが、都道府県の値はその年の県域のまま。差は旧村の人口と一致する
#: （社会・人口統計体系の組み替え前の表 0000020101 で確認・2026-10-10）。
PREFECTURE_SUM_EXCEPTIONS: dict[tuple[str, str], tuple[int, str]] = {
    # 長野県山口村（1995 年 2,127 人・2000 年 2,040 人）は 2005 年 2 月に岐阜県中津川市へ越県合併した。
    ("20", "pop_1995"): (2_127, "長野県山口村が 2005 年 2 月に岐阜県中津川市へ越県合併（今の境域では岐阜県に入る）"),
    ("20", "pop_2000"): (2_040, "長野県山口村が 2005 年 2 月に岐阜県中津川市へ越県合併（今の境域では岐阜県に入る）"),
    ("21", "pop_1995"): (-2_127, "長野県山口村が 2005 年 2 月に岐阜県中津川市へ越県合併（今の境域では岐阜県に入る）"),
    ("21", "pop_2000"): (-2_040, "長野県山口村が 2005 年 2 月に岐阜県中津川市へ越県合併（今の境域では岐阜県に入る）"),
    # 山梨県上九一色村（1995 年 1,779 人・2000 年 1,639 人・2005 年 1,521 人）は 2006 年 3 月に分かれて編入され、
    # 今の境域に組み替えた市区町村の値（甲府市・富士河口湖町）に入っていない。
    ("19", "pop_1995"): (1_779, "山梨県上九一色村が 2006 年 3 月に甲府市と富士河口湖町へ分かれて編入（組み替えた値に入っていない）"),
    ("19", "pop_2000"): (1_639, "山梨県上九一色村が 2006 年 3 月に甲府市と富士河口湖町へ分かれて編入（組み替えた値に入っていない）"),
    ("19", "pop_2005"): (1_521, "山梨県上九一色村が 2006 年 3 月に甲府市と富士河口湖町へ分かれて編入（組み替えた値に入っていない）"),
}

# --- 区域の指標（カタログ） ----------------------------------------------------

#: 出典とライセンス（駅の指標のカタログ `pipeline/catalog_rules.py` の SRC と同じ書き方）。
LICENSE_ESTAT = "CC BY 4.0（政府統計・出典明記で商用可）"
LICENSE_KSJ = "CC BY 4.0 相当（国土数値情報 利用約款）"


@dataclass(frozen=True)
class AreaSource:
    """1 つの指標を、ある種類の区域でどう作ったか。"""

    method: str  # official（公表値）／projection（推計の市区町村ごとの合計）／mesh（メッシュの面積按分）
    sourceJa: str
    license: str


def _pop_admin_source(year: int) -> AreaSource:
    if year == 2025:
        return AreaSource("official", "総務省 令和7年国勢調査 人口等基本集計（2026-09-29 公表・e-Stat）", LICENSE_ESTAT)
    return AreaSource(
        "official",
        "総務省 国勢調査（e-Stat 社会・人口統計体系 市区町村データ・今の市区町村の境域に組み替え済み）",
        LICENSE_ESTAT,
    )


POP_LINE_SOURCE = AreaSource(
    "mesh", "総務省 国勢調査 地域メッシュ統計（250m・e-Stat）を沿線の範囲で面積按分", LICENSE_ESTAT
)


def _pred_admin_source(year: int) -> AreaSource:
    if year <= IPSS_LAST_YEAR:
        return AreaSource(
            "projection",
            "国土数値情報 将来推計人口メッシュ（R6・国土交通省）を市区町村ごとに足したもの"
            "（国立社会保障・人口問題研究所『日本の地域別将来推計人口（令和5年推計）』と同じ値）",
            LICENSE_KSJ,
        )
    return AreaSource(
        "projection",
        "国土数値情報 将来推計人口メッシュ（R6・国土交通省が社人研の推計を 2070 年まで延長）を市区町村ごとに足したもの",
        LICENSE_KSJ,
    )


PRED_LINE_SOURCE = AreaSource(
    "mesh", "国土数値情報 将来推計人口メッシュ（R6・250m・国土交通省）を沿線の範囲で面積按分", LICENSE_KSJ
)
ECON_ADMIN_SOURCE = AreaSource(
    "official",
    "経済センサス‐活動調査（総務省・経済産業省／e-Stat 社会・人口統計体系 市区町村データ・今の境域に組み替え済み。"
    "都道府県・全国は各年の公表値）",
    LICENSE_ESTAT,
)
ECON_LINE_SOURCE = AreaSource(
    "mesh", "経済センサス‐活動調査 地域メッシュ統計（500m・e-Stat）を沿線の範囲で面積按分", LICENSE_ESTAT
)


@dataclass(frozen=True)
class AreaMetric:
    """区域の指標 1 つ（`src/shared/catalog/area-catalog.json` の 1 項目）。"""

    key: str
    baseMetric: str
    category: str  # 駅の指標のカタログと同じ語彙（population / population_forecast / establishment / employee）
    labelJa: str
    unit: str
    format: str
    year: int
    vintage: int | None
    admin: AreaSource
    line: AreaSource | None  # 沿線では作らない指標は None


def area_metrics() -> tuple[AreaMetric, ...]:
    """区域の指標の一覧（並び＝カタログと DB の id の並び）。"""
    pop = tuple(
        AreaMetric(
            f"pop_{y}", "pop", "population", f"人口（{y}年）", "人", "int", y, None,
            _pop_admin_source(y), POP_LINE_SOURCE if y in LINE_POP_YEARS else None,
        )
        for y in POP_YEARS
    )
    pred = tuple(
        AreaMetric(
            f"pop_pred_2024_{y}", "pop_pred", "population_forecast",
            f"将来推計人口（{y}年・R6推計{'の基準' if y == PRED_YEARS[0] else ''}）", "人", "int", y, 2024,
            _pred_admin_source(y), PRED_LINE_SOURCE,
        )
        for y in PRED_YEARS
    )
    estab = tuple(
        AreaMetric(
            f"estab_n_{y}", "estab_n", "establishment", f"事業所数（{y}年・民営）", "事業所", "int", y, None,
            ECON_ADMIN_SOURCE, ECON_LINE_SOURCE,
        )
        for y in ECON_YEARS
    )
    emp = tuple(
        AreaMetric(
            f"emp_n_{y}", "emp_n", "employee", f"従業者数（{y}年・民営）", "人", "int", y, None,
            ECON_ADMIN_SOURCE, ECON_LINE_SOURCE,
        )
        for y in ECON_YEARS
    )
    return pop + pred + estab + emp


# --- 照合の固定値（公表値・社人研。build と validate と DB の黄金テストが見る） -------------------

#: (エリアの鍵, 指標の key) → 期待値。推計（実数）は四捨五入して比べる。
ANCHORS: dict[tuple[str, str], int] = {
    ("jp", "pop_1995"): 125_570_246,
    ("jp", "pop_2000"): 126_925_843,
    ("jp", "pop_2005"): 127_767_994,
    ("jp", "pop_2010"): 128_057_352,
    ("jp", "pop_2015"): 127_094_745,
    ("jp", "pop_2020"): 126_146_099,
    ("jp", "pop_2025"): 122_972_528,
    ("jp", "pop_pred_2024_2050"): 104_686_386,
    ("jp", "estab_n_2012"): 5_453_635,
    ("jp", "estab_n_2016"): 5_340_783,
    ("jp", "estab_n_2021"): 5_156_063,
    ("jp", "emp_n_2012"): 55_837_252,
    ("jp", "emp_n_2016"): 56_872_826,
    ("jp", "emp_n_2021"): 57_949_915,
    ("pref:14", "pop_2025"): 9_193_922,
    ("muni:14100", "pop_2015"): 3_724_844,
    ("muni:14100", "pop_2020"): 3_777_491,
    ("muni:14100", "pop_2025"): 3_750_952,
    ("muni:14100", "pop_pred_2024_2025"): 3_786_702,
    ("muni:14100", "pop_pred_2024_2050"): 3_537_253,
    ("muni:14100", "estab_n_2021"): 116_479,
    ("muni:14100", "emp_n_2021"): 1_527_783,
    ("muni:14103", "pop_2025"): 108_145,
    ("muni:14130", "pop_2020"): 1_538_262,
    ("muni:14130", "pop_2025"): 1_559_571,
    ("muni:13100", "pop_2025"): 9_944_109,
    ("muni:22130", "pop_2025"): 765_254,
    ("muni:22138", "pop_2020"): 607_937,
}
