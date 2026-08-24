"""水害ハザード・レイヤカタログ生成ルール（純ロジック・単一の真実）。

`docs/260824_flood.md` §5.4 の設計に従い、ハザードレイヤの**意味**（ラベル・階級・色・
何 m か・どうすべきか・網羅性の注記・出典）を 1 箇所に集約する。
`build_hazard_catalog.py`（生成）だけがこれを読み、`src/shared/hazard/hazard-catalog.json`
を書き出す。凡例 UI と Gemini は**この 1 つの定義**を読む（フロントに凡例を直書きしない）。

## 配色の根拠（colorSource）

- `official` … 国土交通省『洪水浸水想定区域図作成マニュアル（第 4 版）』表-7.2／表-7.4 の
  RGB 値。**さらに配信タイルの画素を実測して一致を確認済み**（2026-08-25・294 タイル）。
- `measured` … 公式の凡例仕様を確認できず、**配信タイルの実測**で得た色。階級との対応づけに
  推定を含む（土砂災害の 3 レイヤ）。凡例 UI はここに控えめな注記を出す。
- `None`     … 色を確定していない（実測標本に出現しなかった階級）。

## 参照

- 浸水深・浸水継続時間の階級と RGB: https://nlftp.mlit.go.jp/ksj/gml/datalist/A31_manual.pdf
- タイル配信一覧: https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html
- 土砂災害の区域コード: https://nlftp.mlit.go.jp/ksj/gml/codelist/CodeOfZone_A33.html
- 地理院タイル一覧: https://maps.gsi.go.jp/development/ichiran.html
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

# --- グループ・危険度レベル（src/shared/constants.ts と同順・同名） -------

GROUP_ORDER: list[str] = [
    "flood",
    "inland_flood",
    "storm_surge",
    "tsunami",
    "landslide",
    "terrain",
    "realtime",
]

# 危険度レベル。⚠ 最も軽い階級を "safe" と呼ばない：白（＝想定区域外）を「安全」と
# 読ませないことが、この機能でいちばん大事な不変条件だから（docs/260824_flood.md §7.5）。
LEVEL_ORDER: list[str] = ["none", "caution", "warning", "danger", "critical"]

# --- 出典・ライセンス ----------------------------------------------------

DISAPORTAL_LICENSE = "商用・非商用を問わず利用可（ハザードマップポータルサイト オープンデータ配信）"
DISAPORTAL_ATTRIBUTION = "出典：ハザードマップポータルサイト（国土交通省）"
GSI_TILE_LICENSE = (
    "国土地理院コンテンツ利用規約"
    "（ウェブサイト等でリアルタイムに読み込む場合は出典明示のみで申請不要）"
)
GSI_TILE_ATTRIBUTION = "出典：地理院タイル（国土地理院）"

DISAPORTAL_TILE = "https://disaportaldata.gsi.go.jp/raster/{name}/{{z}}/{{x}}/{{y}}.png"
GSI_TILE = "https://cyberjapandata.gsi.go.jp/xyz/{name}/{{z}}/{{x}}/{{y}}.png"

# 全応答に添える免責。UI も AI もこの 1 文を使う（docs/260824_flood.md §7.5-5）。
DISCLAIMER_JA = (
    "この地図は災害リスクの目安を示すものです。"
    "実際の避難は、お住まいの市町村が発表する避難情報に従ってください。"
)

# 浸水深レイヤに共通の注意（原典より広く浸水することがある）。
DEPTH_COVERAGE_NOTE = (
    "白い場所は「浸水想定が指定されていない」という意味で、"
    "「浸水しない」という意味ではありません。実際の浸水域が想定区域より広がることがあります。"
)

# --- 浸水深の階級（詳細版 8 階級・A31_manual 表-7.2） --------------------
# ⚠ 国土数値情報の「浸水深ランクコード」は 6 階級だが、**配信タイルは詳細版 8 階級の配色**で
#   描かれている（実測：8 色すべてが出現）。凡例は画面と一致していなければ意味がないので、
#   カタログは 8 階級を正とし、対応する原典コードを sourceCode に残す。

# (order, 下限m, 上限m, 原典コード, 危険度, 色, 意味)
_DEPTH_CLASSES: list[tuple[int, float, float | None, int, str, str, str]] = [
    (1, 0.0, 0.3, 1, "caution", "#FFFFB3", "一般的な住宅で床下程度の浸水"),
    (2, 0.3, 0.5, 1, "caution", "#F7F5A9", "一般的な住宅で床下程度の浸水"),
    (3, 0.5, 1.0, 2, "warning", "#F8E1A6", "床上が浸水する高さ"),
    (4, 1.0, 3.0, 2, "warning", "#FFD8C0", "1 階が水没する高さ"),
    (5, 3.0, 5.0, 3, "danger", "#FFB7B7", "2 階部分が浸水する高さ"),
    (6, 5.0, 10.0, 4, "danger", "#FF9191", "2 階部分が水没する高さ"),
    (7, 10.0, 20.0, 5, "critical", "#F285C9", "3 階建てでも水没しうる高さ"),
    (8, 20.0, None, 6, "critical", "#DC7ADC", "建物が完全に水没する高さ"),
]

# 危険度 → 行動の目安（docs/260824_flood.md §6.2 の判定ルールと同じ閾値。断定しない文言）。
_DEPTH_ACTION: dict[str, str] = {
    "caution": "浸水想定区域内です。避難の要否は市町村の情報で確認してください。",
    "warning": "床上まで浸水する想定です。上階への垂直避難、または早めの立退き避難が基本です。",
    "danger": "2 階まで浸水する想定です。立退き避難が基本です。",
    "critical": "建物の上階でも安全とは言えない高さです。立退き避難が基本です。",
}

# --- 浸水継続時間の階級（7 階級・A31_manual 表-7.4） ---------------------
# (order, 下限h, 上限h, 原典コード, 危険度, 色, 意味)
_DURATION_CLASSES: list[tuple[int, float, float | None, int, str, str, str]] = [
    (1, 0, 12, 1, "caution", "#A0D2FF", "半日未満で水が引く想定"),
    (2, 12, 24, 2, "caution", "#0041FF", "1 日近く浸水が続く想定"),
    (3, 24, 72, 3, "warning", "#FAF500", "1〜3 日浸水が続く想定"),
    (4, 72, 168, 4, "danger", "#FF9900", "3 日〜1 週間浸水が続く想定"),
    (5, 168, 336, 5, "danger", "#FF2800", "1〜2 週間浸水が続く想定"),
    (6, 336, 672, 6, "critical", "#B40068", "2〜4 週間浸水が続く想定"),
    (7, 672, None, 7, "critical", "#600060", "4 週間以上浸水が続く想定"),
]

_DURATION_ACTION_LONG = (
    "浸水が長く続くため、水が引くまで孤立するおそれがあります。"
    "浸水域外への立退き避難が基本です。"
)
_DURATION_ACTION_SHORT = "在宅避難を選ぶ場合は、水・食料・トイレ・電源の備えを確認してください。"


# --- 型 ------------------------------------------------------------------


@dataclass(frozen=True)
class HazardRank:
    order: int  # 凡例の並び（1 が最も軽い）
    labelJa: str
    meaningJa: str
    actionJa: str | None
    level: str  # LEVEL_ORDER のいずれか
    color: str | None  # '#RRGGBB'（未確定は None）
    colorSource: str | None  # 'official' | 'measured' | None
    min: float | None  # 階級の下限（単位は layer.rankUnit）
    max: float | None  # 階級の上限（開区間は None）
    sourceCode: int | None  # 国土数値情報のコード値


@dataclass(frozen=True)
class HazardTile:
    url: str  # XYZ テンプレート（{z}/{x}/{y}）
    minZoom: int
    maxZoom: int
    format: str  # 'png' | 'geojson' | 'pbf'


@dataclass(frozen=True)
class HazardMesh:
    available: bool  # 配布アーティファクトが存在するか（Phase 1b で true になる）
    pathTemplate: str  # 'hazard/{layer}/{primary}.bin'


@dataclass(frozen=True)
class HazardLayer:
    key: str
    group: str
    labelJa: str
    summaryJa: str  # 1〜2 文。AI がそのまま説明に使える
    # 重ね方。'base'＝面をベタ塗りするので**同じグループで同時に 1 つだけ**（重ねると濁って読めない）。
    # 'overlay'＝細い区域や点在する区域なので、base の上に何枚でも重ねてよい。
    # これは見た目の都合ではなく「そのレイヤが面か点在か」という意味なので、カタログが持つ。
    display: str  # 'base' | 'overlay'
    rankUnit: str | None  # 'm' | 'hour'（階級が量でないレイヤは None）
    ranks: list[HazardRank]
    tile: HazardTile | None
    mesh: HazardMesh | None
    legendUrl: str | None
    vintage: int | None
    updateCadence: str  # 'static' | 'annual' | '10min'
    source: str
    license: str
    attribution: str
    coverageNoteJa: str | None
    fallbackLayersJa: list[str] = field(default_factory=list)


# --- 階級の組み立て ------------------------------------------------------


def _depth_label(low: float, high: float | None) -> str:
    return f"{low:g}m 以上" if high is None else f"{low:g}〜{high:g}m 未満"


def depth_ranks() -> list[HazardRank]:
    """浸水深 8 階級（洪水・内水・高潮・津波で共通）。"""
    return [
        HazardRank(
            order=order,
            labelJa=_depth_label(low, high),
            meaningJa=meaning,
            actionJa=_DEPTH_ACTION[level],
            level=level,
            color=color,
            colorSource="official",
            min=low,
            max=high,
            sourceCode=code,
        )
        for order, low, high, code, level, color, meaning in _DEPTH_CLASSES
    ]


def _duration_label(low: float, high: float | None) -> str:
    return f"{low:g}時間以上" if high is None else f"{low:g}〜{high:g}時間"


def duration_ranks() -> list[HazardRank]:
    """浸水継続時間 7 階級。"""
    return [
        HazardRank(
            order=order,
            labelJa=_duration_label(low, high),
            meaningJa=meaning,
            actionJa=_DURATION_ACTION_LONG if level in ("danger", "critical") else _DURATION_ACTION_SHORT,
            level=level,
            color=color,
            colorSource="official",
            min=low,
            max=high,
            sourceCode=code,
        )
        for order, low, high, code, level, color, meaning in _DURATION_CLASSES
    ]


def _single_rank(
    label: str, meaning: str, action: str, level: str, color: str | None, source_code: int | None
) -> list[HazardRank]:
    return [
        HazardRank(
            order=1,
            labelJa=label,
            meaningJa=meaning,
            actionJa=action,
            level=level,
            color=color,
            colorSource="measured" if color else None,
            min=None,
            max=None,
            sourceCode=source_code,
        )
    ]


def landslide_ranks(warning_color: str, special_color: str | None) -> list[HazardRank]:
    """土砂災害の 2 区分（A33 区域コード 1=警戒区域・2=特別警戒区域）。

    ⚠ 色は配信タイルの実測。公式の凡例仕様を確認できていないため colorSource='measured'。
    対応づけは「特別警戒区域は警戒区域の内側の部分集合＝面積が小さい」ことから決めた。
    """
    return [
        HazardRank(
            order=1,
            labelJa="土砂災害警戒区域（イエローゾーン）",
            meaningJa="土砂災害のおそれがあるとして指定された区域",
            actionJa="土砂災害警戒情報が出たら、区域の外へ立退き避難するのが基本です。",
            level="danger",
            color=warning_color,
            colorSource="measured",
            min=None,
            max=None,
            sourceCode=1,
        ),
        HazardRank(
            order=2,
            labelJa="土砂災害特別警戒区域（レッドゾーン）",
            meaningJa="建築物が破壊され、住民の生命・身体に著しい危害が生じるおそれがある区域",
            actionJa="建物の中に留まるのは危険です。立退き避難が基本です。",
            level="critical",
            color=special_color,
            colorSource="measured" if special_color else None,
            min=None,
            max=None,
            sourceCode=2,
        ),
    ]


# --- レイヤ定義 ----------------------------------------------------------

_A31A_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html"
_A51_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A51-2025.html"
_A49_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A49-2024.html"
_A40_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A40-2024.html"
_A33_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33-2025.html"
_GSI_TILE_LIST_URL = "https://maps.gsi.go.jp/development/ichiran.html"

# Phase 1b でメッシュ化する対象（決定 4：洪水・内水のみ）。他は表示のみ。
_MESH_PLANNED = HazardMesh(available=False, pathTemplate="hazard/{layer}/{primary}.bin")


def _flood_layers() -> list[HazardLayer]:
    common = {
        "group": "flood",
        "display": "base",
        "rankUnit": "m",
        "vintage": 2025,
        "updateCadence": "annual",
        "source": "国土交通省 各地方整備局等・都道府県（重ねるハザードマップ／国土数値情報 A31a）",
        "license": DISAPORTAL_LICENSE,
        "attribution": DISAPORTAL_ATTRIBUTION,
        "legendUrl": _A31A_URL,
    }
    return [
        HazardLayer(
            key="flood_l2",
            labelJa="洪水浸水想定区域（想定最大規模）",
            summaryJa=(
                "想定し得る最大規模の降雨で河川が氾濫した場合に、浸水が想定される区域と深さです。"
                "1000 年に一度あるかどうかの規模で、全国の人口のおよそ 4 割がこの区域に住んでいます。"
            ),
            ranks=depth_ranks(),
            tile=HazardTile(DISAPORTAL_TILE.format(name="01_flood_l2_shinsuishin_data"), 2, 17, "png"),
            mesh=_MESH_PLANNED,
            coverageNoteJa=DEPTH_COVERAGE_NOTE,
            fallbackLayersJa=[],
            **common,
        ),
        HazardLayer(
            key="flood_l1",
            labelJa="洪水浸水想定区域（計画規模）",
            summaryJa=(
                "河川の整備計画が前提とする規模の降雨で氾濫した場合に、浸水が想定される区域と深さです。"
                "想定最大規模より狭く、より起こりやすい規模を示します。"
            ),
            ranks=depth_ranks(),
            tile=HazardTile(
                DISAPORTAL_TILE.format(name="01_flood_l1_shinsuishin_newlegend_data"), 2, 17, "png"
            ),
            mesh=_MESH_PLANNED,
            coverageNoteJa=DEPTH_COVERAGE_NOTE,
            fallbackLayersJa=[],
            **common,
        ),
        HazardLayer(
            key="flood_duration",
            labelJa="浸水継続時間（想定最大規模）",
            summaryJa=(
                "想定最大規模の洪水で浸水したあと、水が引くまでにかかる時間の想定です。"
                "長いほど在宅避難では孤立しやすく、立退き避難の判断材料になります。"
            ),
            ranks=duration_ranks(),
            tile=HazardTile(DISAPORTAL_TILE.format(name="01_flood_l2_keizoku_data"), 2, 17, "png"),
            mesh=_MESH_PLANNED,
            coverageNoteJa="継続時間が公表されていない河川があります。白い場所は「浸水しない」という意味ではありません。",
            fallbackLayersJa=[],
            **{**common, "rankUnit": "hour"},
        ),
        HazardLayer(
            key="flood_kaoku_hanran",
            labelJa="家屋倒壊等氾濫想定区域（氾濫流）",
            summaryJa=(
                "氾濫した水の流れの力で、木造家屋が倒壊するおそれがある区域です。"
                "建物の上階に留まる垂直避難では命を守れないため、立退き避難が必要になります。"
            ),
            ranks=_single_rank(
                "氾濫流により家屋が倒壊するおそれ",
                "水の流れの力で木造家屋が倒壊しうる区域",
                "建物の上階に留まるのは危険です。区域の外への立退き避難が基本です。",
                "critical",
                "#FF0000",
                1,
            ),
            tile=HazardTile(
                DISAPORTAL_TILE.format(name="01_flood_l2_kaokutoukai_hanran_data"), 4, 17, "png"
            ),
            mesh=_MESH_PLANNED,
            coverageNoteJa="公表されていない河川があります。白い場所は「倒壊しない」という意味ではありません。",
            fallbackLayersJa=[],
            **{**common, "rankUnit": None, "display": "overlay"},
        ),
        HazardLayer(
            key="flood_kaoku_kagan",
            labelJa="家屋倒壊等氾濫想定区域（河岸侵食）",
            summaryJa=(
                "河岸が削られることで、家屋が倒壊・流失するおそれがある区域です。"
                "氾濫流と同じく、建物の上階では命を守れません。"
            ),
            ranks=_single_rank(
                "河岸侵食により家屋が倒壊・流失するおそれ",
                "河岸が削られて家屋が倒壊・流失しうる区域",
                "建物の上階に留まるのは危険です。区域の外への立退き避難が基本です。",
                "critical",
                "#FF0000",
                2,
            ),
            tile=HazardTile(
                DISAPORTAL_TILE.format(name="01_flood_l2_kaokutoukai_kagan_data"), 4, 17, "png"
            ),
            mesh=_MESH_PLANNED,
            coverageNoteJa="公表されていない河川があります。白い場所は「倒壊しない」という意味ではありません。",
            fallbackLayersJa=[],
            **{**common, "rankUnit": None, "display": "overlay"},
        ),
    ]


def _other_hazard_layers() -> list[HazardLayer]:
    return [
        HazardLayer(
            key="naisui",
            display="base",
            group="inland_flood",
            labelJa="雨水出水（内水）浸水想定区域",
            summaryJa=(
                "川が溢れる前に、降った雨が下水道や排水路の能力を超えて街に溜まる浸水の想定です。"
                "近年のゲリラ豪雨で都市部の被害の中心になっており、過去 10 年の水害被害額の"
                "およそ 4 割が内水によるものです（東京都ではおよそ 7 割）。"
            ),
            rankUnit="m",
            ranks=depth_ranks(),
            tile=HazardTile(DISAPORTAL_TILE.format(name="02_naisui_data"), 2, 17, "png"),
            mesh=_MESH_PLANNED,
            legendUrl=_A51_URL,
            vintage=2025,
            updateCadence="annual",
            source="市町村（流域下水道・一部事務組合を含む／重ねるハザードマップ・国土数値情報 A51）",
            license=DISAPORTAL_LICENSE,
            attribution=DISAPORTAL_ATTRIBUTION,
            coverageNoteJa=(
                "⚠ この地図は 47 都道府県のうち 22 でしか整備されていません"
                "（大阪府・京都府などは全域が対象外です）。指定するのは市町村で、"
                "下水道の管路モデルが必要なため整備が進んでいません。"
                "**白いことは「内水が起きない」という意味ではありません。**"
                "国土数値情報も「実際の浸水区域はこれより広い場合があります」と注記しています。"
            ),
            fallbackLayersJa=["治水地形分類図", "色別標高図", "傾斜量図", "土地条件図"],
        ),
        HazardLayer(
            key="hightide_l2",
            display="base",
            group="storm_surge",
            labelJa="高潮浸水想定区域",
            summaryJa=(
                "想定し得る最大規模の台風による高潮で、浸水が想定される区域と深さです。"
                "面積は狭いものの人口の多い沿岸都市に集中しており、曝露人口が大きいのが特徴です。"
            ),
            rankUnit="m",
            ranks=depth_ranks(),
            tile=HazardTile(
                DISAPORTAL_TILE.format(name="03_hightide_l2_shinsuishin_data"), 2, 17, "png"
            ),
            mesh=None,
            legendUrl=_A49_URL,
            vintage=2024,
            updateCadence="annual",
            source="都道府県（重ねるハザードマップ／国土数値情報 A49）",
            license=DISAPORTAL_LICENSE,
            attribution=DISAPORTAL_ATTRIBUTION,
            coverageNoteJa="公表していない都道府県があります。白い場所は「浸水しない」という意味ではありません。",
            fallbackLayersJa=["色別標高図"],
        ),
        HazardLayer(
            key="tsunami_shinsui",
            display="base",
            group="tsunami",
            labelJa="津波浸水想定",
            summaryJa=(
                "最大クラスの津波が悪条件下で発生した場合に、浸水が想定される区域と深さです。"
                "津波は浸水深にかかわらず、揺れを感じたらすぐ高台へ避難するのが基本です。"
            ),
            rankUnit="m",
            ranks=depth_ranks(),
            tile=HazardTile(DISAPORTAL_TILE.format(name="04_tsunami_newlegend_data"), 2, 17, "png"),
            mesh=None,
            legendUrl=_A40_URL,
            vintage=2024,
            updateCadence="annual",
            source="都道府県（重ねるハザードマップ／国土数値情報 A40）",
            license=DISAPORTAL_LICENSE,
            attribution=DISAPORTAL_ATTRIBUTION,
            coverageNoteJa="公表していない都道府県があります。白い場所は「浸水しない」という意味ではありません。",
            fallbackLayersJa=["色別標高図"],
        ),
    ]


def _landslide_layers() -> list[HazardLayer]:
    common = {
        "group": "landslide",
        "display": "overlay",
        "rankUnit": None,
        "tile": None,
        "mesh": None,
        "legendUrl": _A33_URL,
        "vintage": 2025,
        "updateCadence": "annual",
        "source": "国土数値情報（土砂災害警戒区域 A33・令和 7 年度）を国土地理院が加工",
        "license": DISAPORTAL_LICENSE,
        "attribution": DISAPORTAL_ATTRIBUTION,
        "coverageNoteJa": (
            "都道府県が調査を終えた区域のみが表示されます。"
            "特別警戒区域（レッドゾーン）の調査が済んでいない区域もあります。"
        ),
        "fallbackLayersJa": ["傾斜量図"],
    }
    specs = [
        ("dosekiryu", "土砂災害警戒区域（土石流）", "05_dosekiryukeikaikuiki", "#E6C832", "#A50021",
         "山や谷から土砂と水が一気に流れ下る「土石流」のおそれがある区域です。"),
        ("kyukeisha", "土砂災害警戒区域（急傾斜地の崩壊）", "05_kyukeishakeikaikuiki", "#FAE600", "#FA2800",
         "急な斜面が崩れ落ちる「がけ崩れ」のおそれがある区域です。"),
        ("jisuberi", "土砂災害警戒区域（地すべり）", "05_jisuberikeikaikuiki", "#FF9900", None,
         "斜面の広い範囲がゆっくり滑り出す「地すべり」のおそれがある区域です。"),
    ]
    return [
        HazardLayer(
            key=key,
            labelJa=label,
            summaryJa=summary,
            ranks=landslide_ranks(warning_color, special_color),
            **{
                **common,
                "tile": HazardTile(DISAPORTAL_TILE.format(name=tile_name), 2, 17, "png"),
            },
        )
        for key, label, tile_name, warning_color, special_color, summary in specs
    ]


def _terrain_layers() -> list[HazardLayer]:
    """内水の空白を埋める地形レイヤ（docs/260824_flood.md §3.7）。

    ⚠ これらは**ハザードではない**（浸水想定ではない）。凡例は分類が多く自前で持たないため
    `ranks` は空にし、公式凡例へのリンクを持つ。立退き／垂直避難の判定には使わない。
    """
    common = {
        "group": "terrain",
        "display": "base",
        "rankUnit": None,
        "mesh": None,
        "vintage": None,
        "updateCadence": "static",
        "license": GSI_TILE_LICENSE,
        "attribution": GSI_TILE_ATTRIBUTION,
        "coverageNoteJa": "これは浸水想定ではなく地形の分類・標高です。危険の有無を示すものではありません。",
        "fallbackLayersJa": [],
    }
    specs = [
        (
            "chisui_chikei",
            "治水地形分類図",
            "lcmfc2",
            "国土地理院「治水地形分類図」",
            "旧河道・後背湿地・氾濫平野といった、水が集まってきた歴史がそのまま読める地形分類図です。"
            "内水の浸水想定が整備されていない地域で、水が集まりやすい場所を知る手がかりになります。",
        ),
        (
            "lcm25k",
            "土地条件図",
            "lcm25k_2012",
            "国土地理院「数値地図 25000（土地条件）」",
            "台地・低地・盛土・切土といった地形分類を示します。造成地や埋立地の位置が分かります。",
        ),
        (
            "relief",
            "色別標高図",
            "relief",
            "国土地理院「色別標高図」",
            "標高を色で塗り分けた地図です。周囲より低い土地が面で見えます。",
        ),
        (
            "slopemap",
            "傾斜量図",
            "slopemap",
            "国土地理院「傾斜量図」",
            "斜面の急さを濃淡で示します。平坦で水が抜けにくい場所と、崩れやすい急斜面が分かります。",
        ),
    ]
    return [
        HazardLayer(
            key=key,
            labelJa=label,
            summaryJa=summary,
            ranks=[],
            tile=HazardTile(GSI_TILE.format(name=tile_name), 2, 17, "png"),
            legendUrl=_GSI_TILE_LIST_URL,
            source=source,
            **common,
        )
        for key, label, tile_name, source, summary in specs
    ]


def build_layers() -> list[HazardLayer]:
    """カタログに載せる全レイヤ（表示順）。"""
    return [
        *_flood_layers(),
        *_other_hazard_layers(),
        *_landslide_layers(),
        *_terrain_layers(),
    ]


def layer_to_dict(layer: HazardLayer) -> dict[str, object]:
    """JSON へ落とす（dataclass をそのまま辞書化）。"""
    return asdict(layer)
