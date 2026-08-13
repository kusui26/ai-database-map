"""AI Database Map — メトリクス・カタログ生成ルール（純ロジック）。

CSV の列名（`docs/dataset.md` §2 の命名規約）を解析し、1 値列＝1 `CatalogEntry` に変換する。
`build_catalog.py`（生成）と、ラベル/出典の単一定義元として共有する。

設計の正: docs/dataset.md（列一覧）・docs/plan_fable.md §3.1（CatalogEntry 型）・
docs/population_mesh.md §8.10（信頼性フラグの紐付け規則）・各データ設計 docs（出典/ライセンス）。
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

# --- 半径 ---------------------------------------------------------------

RADIUS_M: dict[str, int] = {
    "500m": 500,
    "1km": 1000,
    "2km": 2000,
    "5km": 5000,
    "10km": 10000,
    "20km": 20000,
}
# 列サフィックスの半径トークン（非キャプチャ）
RT = r"(?:500m|1km|2km|5km|10km|20km)"

# --- カテゴリ ------------------------------------------------------------

CATEGORY_ORDER: list[str] = [
    "passenger",
    "population",
    "income",
    "population_forecast",
    "land_price",
    "bus",
    "establishment",
    "employee",
]
CATEGORY_LABELS: dict[str, str] = {
    "passenger": "乗降客数",
    "population": "人口",
    "income": "所得",
    "population_forecast": "将来推計人口",
    "land_price": "地価",
    "bus": "バス",
    "establishment": "事業所",
    "employee": "従業者",
}

# --- 出典・ライセンス（カテゴリ／グループ別・各データ設計 docs 準拠） ----
SRC: dict[str, tuple[str, str]] = {
    "passenger": (
        "国土数値情報「駅別乗降客数」(S12-25)",
        "CC BY 4.0 相当（国土数値情報 利用約款・出典明記で商用可）",
    ),
    "population": (
        "総務省 国勢調査 地域メッシュ統計（e-Stat）",
        "CC BY 4.0（政府統計・出典明記で商用可）",
    ),
    "income": (
        # 2015/2020年度は e-Stat 社会・人口統計体系、2025年度は総務省サイトの xlsx が出所
        # （SSDS は 2024 年度まで）。どちらも同じ原表＝『市町村税課税状況等の調』第11表。
        "総務省『市町村税課税状況等の調』（e-Stat 社会・人口統計体系／2025年度は総務省 xlsx）",
        "CC BY 4.0（政府統計・出典明記で商用可）",
    ),
    "population_forecast": (
        "国土数値情報 将来推計人口メッシュ（国土交通省 国土政策局・R6/H30推計）",
        "CC BY 4.0 相当（国土数値情報 利用約款）",
    ),
    "land_price": (
        "国土数値情報「地価公示」(L01・国土交通省 土地鑑定委員会)",
        "CC BY 4.0 相当（国土数値情報 利用約款・出典明記で商用可）",
    ),
    "bus": (
        "国土数値情報 バス停留所 P11 ＋ 高速バス停留所 P36",
        "CC BY 4.0（オープンデータ）",
    ),
    "bus_current": (
        "国土数値情報 バス停留所 P11（2022年度）＋ 高速バス停留所 P36（2023年度）",
        "CC BY 4.0（オープンデータ）",
    ),
    "bus_2010": (
        "国土数値情報 バス停留所 P11（2010年度版・増減率の分母）",
        "⚠ 非商用ライセンス（商用利用は要確認。docs/bus_point.md §8）",
    ),
    "establishment": (
        "経済センサス‑活動調査 地域メッシュ統計（総務省・経済産業省／e-Stat）",
        "CC BY 4.0 相当（e-Stat 利用規約・出典明記で商用可）",
    ),
    "employee": (
        "経済センサス‑活動調査 地域メッシュ統計（総務省・経済産業省／e-Stat）",
        "CC BY 4.0 相当（e-Stat 利用規約・出典明記で商用可）",
    ),
}

# --- 識別・駅属性（10列・指標ではない） ---------------------------------
# ※ flag_yoy / flag_covid は信頼性フラグ（他の lowbase/lown と同じ「flag 種別メトリクス」）
#   なので駅属性ではなく build_entry で値エントリ化する（除外/バッジは値経由で解決するため）。
IDENTITY_COLUMNS: list[dict[str, str]] = [
    {"key": "grp", "type": "string", "labelJa": "駅グループID", "role": "id"},
    {"key": "station_name", "type": "string", "labelJa": "駅名", "role": "name"},
    {"key": "label", "type": "string", "labelJa": "表示ラベル", "role": "label"},
    {"key": "search_label", "type": "string", "labelJa": "検索用ラベル", "role": "search"},
    {"key": "prefecture", "type": "string", "labelJa": "都道府県", "role": "region"},
    {"key": "lon", "type": "number", "labelJa": "経度（EPSG:6668）", "role": "geo"},
    {"key": "lat", "type": "number", "labelJa": "緯度（EPSG:6668）", "role": "geo"},
    {"key": "n_op", "type": "number", "labelJa": "延べ事業者数", "role": "attribute"},
    {"key": "operators", "type": "string", "labelJa": "運営会社名（pax規模降順・「・」連結）", "role": "attribute"},
    {"key": "level_complete", "type": "boolean", "labelJa": "乗降客時系列の完全性", "role": "flag"},
]

# 型・語彙（validate と共有する参照。値の妥当性検証に使う）
UNITS = {"人", "人/日", "円/㎡", "%", "箇所", "事業所", "m", "万円/人", "百万円", None}
FORMATS = {"int", "decimal1", "percent1", "ratio1", "yen", None}
KINDS = {"level", "growth", "flag", "error", "ratio"}


@dataclass(frozen=True)
class CatalogEntry:
    key: str  # CSV 列名＝全レイヤ共通の安定 ID
    baseMetric: str  # 系列を束ねる指標ファミリ（'pop' / 'lp_med' / 'bus_n' …）
    kind: str  # level | growth | flag | error | ratio
    category: str  # 7 カテゴリのいずれか
    labelJa: str  # 命名規約から自動生成した日本語ラベル
    unit: str | None
    format: str | None
    radiusM: int | None  # 500|1000|2000|5000|10000|20000（無ければ null）
    year: int | None  # 対象年（増減率は新年）
    yearBase: int | None  # 増減率の分母年
    vintage: int | None  # 将来推計の推計時点（2024=R6 / 2018=H30）
    reliabilityFlagKey: str | None  # **除外**に使うフラグ列の key（＝値が信用できない）
    noticeFlagKey: str | None  # **バッジ**に使うフラグ列の key（＝読むとき注意が要る）
    rankable: bool  # ランキング/散布の候補にするか
    higherIsBetter: bool | None  # 用途（鉄道/出店/住宅）で反転するため既定 null
    source: str
    license: str


def _make(
    key: str,
    base: str,
    kind: str,
    category: str,
    label: str,
    unit: str | None,
    fmt: str | None,
    *,
    radiusM: int | None = None,
    year: int | None = None,
    yearBase: int | None = None,
    vintage: int | None = None,
    flag: str | None = None,
    notice: str | None = None,
    rankable: bool = True,
    srckey: str | None = None,
) -> CatalogEntry:
    source, lic = SRC[srckey or category]
    return CatalogEntry(
        key=key,
        baseMetric=base,
        kind=kind,
        category=category,
        labelJa=label,
        unit=unit,
        format=fmt,
        radiusM=radiusM,
        year=year,
        yearBase=yearBase,
        vintage=vintage,
        reliabilityFlagKey=flag,
        # 既定では「除外に使うフラグ＝注意喚起にも使う」。両者が食い違うのは、
        # 複数の条件を 1 本に束ねたフラグ（flag_covid）を持つ指標だけ（260731）。
        noticeFlagKey=notice if notice is not None else flag,
        rankable=rankable,
        higherIsBetter=None,
        source=source,
        license=lic,
    )


def build_entry(col: str) -> CatalogEntry:
    """1 つの値列名から CatalogEntry を構築する（識別列は build 側で除外済み）。"""
    # --- 乗降客数（passenger） ---
    m = re.fullmatch(r"pax_(\d{4})", col)
    if m:
        y = int(m[1])
        return _make(col, "pax", "level", "passenger", f"乗降客数（{y}年）", "人/日", "int", year=y)
    if col == "rate_yoy":
        return _make(col, "pax_rate", "growth", "passenger", "乗降客数 前年増減率（2023→2024年）",
                     "%", "percent1", year=2024, yearBase=2023, flag="flag_yoy")
    if col == "rate_covid":
        # 除外は「低分母（|率|>100%）」だけに絞る。flag_covid は被覆<100%・pre<2019 も
        # 束ねており、そのままだと新宿・横浜・新横浜のような大駅が「低分母」の名目で
        # 消えてしまう（docs/260731_reliability_flag_semantics.md）。被覆・参照年は
        # 値そのものを損なわない（basket 内で like-for-like）ためバッジで注意を促す。
        return _make(col, "pax_rate", "growth", "passenger", "乗降客数 コロナ前後増減率",
                     "%", "percent1", flag="flag_covid_lown", notice="flag_covid")
    # 乗降の信頼性フラグ（他の lowbase/lown と同じ flag 種別メトリクス。rankable=False）。
    # rate_yoy/rate_covid の reliabilityFlagKey が指す先＝除外/バッジがこの値で機能する。
    if col == "flag_yoy":
        return _make(col, "pax_flag", "flag", "passenger",
                     "乗降客数 前年増減率 信頼性フラグ（|前年比|>30%）", None, None,
                     year=2024, yearBase=2023, rankable=False)
    if col == "flag_covid":
        return _make(col, "pax_flag", "flag", "passenger",
                     "乗降客数 コロナ前後増減率 注意フラグ（被覆<100%／pre<2019／|率|>100%）",
                     None, None, rankable=False)
    if col == "flag_covid_lown":
        return _make(col, "pax_flag", "flag", "passenger",
                     "乗降客数 コロナ前後増減率 低分母フラグ（|率|>100%＝小駅の分母ノイズ）",
                     None, None, rankable=False)

    # --- 人口 実績（population） ---
    m = re.fullmatch(rf"pop_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "pop", "level", "population", f"人口（{y}年・{r}圏）", "人", "int",
                     radiusM=RADIUS_M[r], year=y)
    m = re.fullmatch(r"pop_(\d{4})_500m_hidden_ratio", col)
    if m:
        y = int(m[1])
        return _make(col, "pop_hidden_ratio", "ratio", "population",
                     f"人口 秘匿・合算メッシュ割合（{y}年・500m圏）", "%", "ratio1",
                     radiusM=500, year=y, rankable=False)
    m = re.fullmatch(rf"pop_gr_(\d{{4}})_(\d{{4}})_({RT})", col)
    if m:
        new, old, r = int(m[1]), int(m[2]), m[3]
        return _make(col, "pop_gr", "growth", "population",
                     f"人口増減率（{old}→{new}年・{r}圏）", "%", "percent1",
                     radiusM=RADIUS_M[r], year=new, yearBase=old, flag=f"pop_lowbase_{old}_{r}")
    m = re.fullmatch(rf"pop_lowbase_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "pop_lowbase", "flag", "population",
                     f"人口 低基準フラグ（{y}年・{r}圏／基準人口<50人）", None, None,
                     radiusM=RADIUS_M[r], year=y, rankable=False)

    # --- 所得（income・docs/income.md §5-§6） ---
    # 年は**課税年度**（値は前年の所得）。ラベルに「年度」と書いて実績年と区別する。
    m = re.fullmatch(rf"inc_pc_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "inc_pc", "level", "income",
                     f"1人当たり課税対象所得（{y}年度・{r}圏）", "万円/人", "decimal1",
                     radiusM=RADIUS_M[r], year=y, flag=f"inc_lown_{y}_{r}")
    m = re.fullmatch(rf"inc_total_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        # 総額は**合計**なので、納税義務者が少なくても値は壊れない（人口・事業所数と同じ扱い）。
        # 低分母フラグ（除外）を付けるのは 1 人当たり（＝割り算）だけ。
        # 政令市フラグは**除外せずバッジだけ**にする（値は正しく、粒度が粗いだけ）。
        # 除外用が無く注意用だけを持つのは本エントリだけで、noticeFlagKey の本来の用途そのもの。
        return _make(col, "inc_total", "level", "income",
                     f"課税対象所得 総額（{y}年度・{r}圏）", "百万円", "int",
                     radiusM=RADIUS_M[r], year=y, notice=f"inc_city_only_{r}")
    m = re.fullmatch(rf"inc_gr_(\d{{4}})_(\d{{4}})_({RT})", col)
    if m:
        new, old, r = int(m[1]), int(m[2]), m[3]
        # 率の分母は**旧年**の 1 人当たりなので、参照するフラグも旧年
        # （人口の pop_gr → pop_lowbase_{旧} と同じ規則。docs/income.md §5 の実測）。
        return _make(col, "inc_gr", "growth", "income",
                     f"1人当たり課税対象所得 増減率（{old}→{new}年度・{r}圏）", "%", "percent1",
                     radiusM=RADIUS_M[r], year=new, yearBase=old, flag=f"inc_lown_{old}_{r}")
    m = re.fullmatch(rf"inc_lown_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "inc_lown", "flag", "income",
                     f"所得 低分母フラグ（{y}年度・{r}圏／納税義務者<1,000人）", None, None,
                     radiusM=RADIUS_M[r], year=y, rankable=False)
    m = re.fullmatch(rf"inc_city_only_({RT})", col)
    if m:
        r = m[1]
        # 政令市は所得が**市単位でしか公表されない**（行政区別が無い）。値が誤りなのではなく
        # 粒度が粗いだけなので除外はしない。UI は駅の注記として出す（docs/income.md §5）。
        return _make(col, "inc_city_only", "flag", "income",
                     f"所得 政令市フラグ（{r}圏／納税義務者の過半が政令市由来＝市全体の平均）",
                     None, None, radiusM=RADIUS_M[r], year=2025, rankable=False)

    # --- 将来推計人口（population_forecast） ---
    m = re.fullmatch(rf"pop_pred_2024_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "pop_pred", "level", "population_forecast",
                     f"将来推計人口（{y}年・R6推計・{r}圏）", "人", "int",
                     radiusM=RADIUS_M[r], year=y, vintage=2024)
    m = re.fullmatch(rf"pop_pred_2018_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "pop_pred", "level", "population_forecast",
                     f"将来推計人口（{y}年・H30推計・{r}圏）", "人", "int",
                     radiusM=RADIUS_M[r], year=y, vintage=2018)
    m = re.fullmatch(rf"pop_gr_pred_2024_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "pop_gr_pred", "growth", "population_forecast",
                     f"将来人口増減率（2020→{y}年・R6推計・{r}圏）", "%", "percent1",
                     radiusM=RADIUS_M[r], year=y, yearBase=2020, vintage=2024,
                     flag=f"pop_lowbase_2020_{r}")
    m = re.fullmatch(rf"pop_err_2020_pred_2018_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "pop_err", "error", "population_forecast",
                     f"人口予測誤差率（H30推計2020 vs 実績2020・{r}圏）", "%", "percent1",
                     radiusM=RADIUS_M[r], year=2020, vintage=2018, flag=f"pop_lowbase_2020_{r}")

    # --- 地価（land_price） ---
    if col == "lp_near_price":
        return _make(col, "lp_near", "level", "land_price", "最寄地価公示価格（2026年）",
                     "円/㎡", "yen", year=2026)
    if col == "lp_near_dist_m":
        return _make(col, "lp_near", "level", "land_price", "最寄地価公示地点までの距離",
                     "m", "int", rankable=False)
    if col == "lp_near_use":
        return _make(col, "lp_near", "level", "land_price", "最寄地価公示地点の用途区分",
                     None, None, rankable=False)
    m = re.fullmatch(rf"lp_med_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "lp_med", "level", "land_price", f"地価中央値（{y}年・{r}圏）",
                     "円/㎡", "yen", radiusM=RADIUS_M[r], year=y, flag=f"lp_lown_{r}")
    m = re.fullmatch(rf"lp_n_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "lp_n", "level", "land_price", f"地価公示地点数（{r}圏）",
                     "箇所", "int", radiusM=RADIUS_M[r], year=2026, rankable=False)
    m = re.fullmatch(rf"lp_lown_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "lp_lown", "flag", "land_price",
                     f"地価 低分母フラグ（{r}圏／地点数が少なく中央値が不安定）", None, None,
                     radiusM=RADIUS_M[r], year=2026, rankable=False)
    m = re.fullmatch(rf"lp_gr_2026_(\d{{4}})_({RT})", col)
    if m:
        old, r = int(m[1]), m[2]
        return _make(col, "lp_gr", "growth", "land_price", f"地価増減率（{old}→2026年・{r}圏）",
                     "%", "percent1", radiusM=RADIUS_M[r], year=2026, yearBase=old,
                     flag=f"lp_gr_lown_2026_{old}_{r}")
    m = re.fullmatch(rf"lp_gr_lown_2026_(\d{{4}})_({RT})", col)
    if m:
        old, r = int(m[1]), m[2]
        return _make(col, "lp_gr_lown", "flag", "land_price",
                     f"地価増減率 低分母フラグ（{old}→2026年・{r}圏）", None, None,
                     radiusM=RADIUS_M[r], year=2026, yearBase=old, rankable=False)

    # --- バス（bus） ---
    m = re.fullmatch(rf"bus_n_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "bus_n", "level", "bus", f"バス停留所数（現行・{r}圏）", "箇所", "int",
                     radiusM=RADIUS_M[r], srckey="bus_current")
    m = re.fullmatch(rf"bus_n_local_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "bus_n_local", "level", "bus", f"一般バス停留所数（現行・{r}圏）",
                     "箇所", "int", radiusM=RADIUS_M[r], srckey="bus_current")
    m = re.fullmatch(rf"bus_n_hw_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "bus_n_hw", "level", "bus", f"高速バス停留所数（現行・{r}圏）",
                     "箇所", "int", radiusM=RADIUS_M[r], srckey="bus_current")
    m = re.fullmatch(rf"bus_n2010_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "bus_n2010", "level", "bus", f"バス停留所数（2010年度・{r}圏）",
                     "箇所", "int", radiusM=RADIUS_M[r], year=2010, rankable=False, srckey="bus_2010")
    m = re.fullmatch(rf"bus_gr_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "bus_gr", "growth", "bus", f"バス停留所数増減率（2010→現行・{r}圏）",
                     "%", "percent1", radiusM=RADIUS_M[r], yearBase=2010,
                     flag=f"bus_gr_lown_{r}", srckey="bus_2010")
    m = re.fullmatch(rf"bus_gr_lown_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "bus_gr_lown", "flag", "bus",
                     f"バス増減率 低分母フラグ（{r}圏／2010年停留所数<5）", None, None,
                     radiusM=RADIUS_M[r], rankable=False, srckey="bus_2010")

    # --- 事業所 / 従業者（establishment / employee） ---
    m = re.fullmatch(rf"estab_n_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "estab_n", "level", "establishment", f"事業所数（{y}年・{r}圏）",
                     "事業所", "int", radiusM=RADIUS_M[r], year=y)
    m = re.fullmatch(rf"emp_n_(\d{{4}})_({RT})", col)
    if m:
        y, r = int(m[1]), m[2]
        return _make(col, "emp_n", "level", "employee", f"従業者数（{y}年・{r}圏）",
                     "人", "int", radiusM=RADIUS_M[r], year=y)
    m = re.fullmatch(rf"estab_gr_2021_(\d{{4}})_({RT})", col)
    if m:
        old, r = int(m[1]), m[2]
        return _make(col, "estab_gr", "growth", "establishment",
                     f"事業所数増減率（{old}→2021年・{r}圏）", "%", "percent1",
                     radiusM=RADIUS_M[r], year=2021, yearBase=old, flag=f"estab_gr_lown_{r}")
    m = re.fullmatch(rf"emp_gr_2021_(\d{{4}})_({RT})", col)
    if m:
        old, r = int(m[1]), m[2]
        return _make(col, "emp_gr", "growth", "employee",
                     f"従業者数増減率（{old}→2021年・{r}圏）", "%", "percent1",
                     radiusM=RADIUS_M[r], year=2021, yearBase=old, flag=f"estab_gr_lown_{r}")
    m = re.fullmatch(rf"estab_gr_lown_({RT})", col)
    if m:
        r = m[1]
        return _make(col, "estab_gr_lown", "flag", "establishment",
                     f"事業所・従業者 増減率 低分母フラグ（{r}圏／2012年事業所数<5）", None, None,
                     radiusM=RADIUS_M[r], rankable=False)

    raise ValueError(f"未分類の列: {col!r}")


def entry_to_dict(entry: CatalogEntry) -> dict[str, object]:
    return asdict(entry)
