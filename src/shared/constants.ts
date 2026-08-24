/**
 * アプリ全体で共有する不変の定数（意味づけの最下層）。
 *
 * 半径・都道府県・カテゴリ・配色トークンの「単一の真実」。
 * domain / UI / api / ai はすべてこの 1 ファイルを参照し、値の重複定義を作らない（DRY）。
 * ここでは型を明示し、`any` / `as` を使わない（.claude/CLAUDE.md §3）。
 */

// --- 半径（6 段） --------------------------------------------------------

/** 集約半径（メートル）。dataset.md の 500m–20km に対応。 */
export type RadiusM = 500 | 1000 | 2000 | 5000 | 10000 | 20000

/** 昇順に並べた集約半径。UI の半径セグメント・API 検証の母集合。 */
export const RADII_M: readonly RadiusM[] = [500, 1000, 2000, 5000, 10000, 20000]

/** 半径の表示ラベル（例 1000 → "1km"）。 */
export const RADIUS_LABELS: Readonly<Record<RadiusM, string>> = {
  500: '500m',
  1000: '1km',
  2000: '2km',
  5000: '5km',
  10000: '10km',
  20000: '20km',
}

/** number → 半径ラベル（6 段以外は m 表記にフォールバック・as を使わない安全参照）。 */
export function radiusLabel(radiusM: number): string {
  const known = RADII_M.find((radius) => radius === radiusM)
  return known === undefined ? `${radiusM}m` : RADIUS_LABELS[known]
}

// --- カテゴリ（指標の大分類） --------------------------------------------

/** 指標カテゴリ。catalog.json / GUI Chat Protocol と一致（plan_fable §3.1）。 */
export type Category =
  | 'passenger'
  | 'population'
  | 'income'
  | 'sales'
  | 'population_forecast'
  | 'land_price'
  | 'bus'
  | 'establishment'
  | 'employee'

/** 表示順を保持したカテゴリ一覧。 */
export const CATEGORIES: readonly Category[] = [
  'passenger',
  'population',
  'income',
  'sales',
  'population_forecast',
  'land_price',
  'bus',
  'establishment',
  'employee',
]

/** カテゴリの日本語ラベル。 */
export const CATEGORY_LABELS_JA: Readonly<Record<Category, string>> = {
  passenger: '乗降客数',
  population: '人口',
  income: '所得',
  sales: '売上',
  population_forecast: '将来推計人口',
  land_price: '地価',
  bus: 'バス',
  establishment: '事業所',
  employee: '従業者',
}

// --- 配色トークン（plan_fable §2.4） ------------------------------------
// Chart.js（canvas）が直接消費するため、Tailwind 既定パレット相当の sRGB hex で保持する。

/** アクセント（選択駅・半径サークル・主ボタン）= indigo-600。 */
export const ACCENT_COLOR = '#4f46e5'

/** 警告（信頼性フラグ lowbase/lown）= amber-500。 */
export const WARNING_COLOR = '#f59e0b'

/**
 * カテゴリ別のチャート配色。
 * 将来推計（population_forecast）は人口の淡色で、破線運用は各チャート側が担う。
 */
export const CATEGORY_COLORS: Readonly<Record<Category, string>> = {
  passenger: '#1e293b', // slate-800
  population: '#2563eb', // blue-600
  income: '#0d9488', // teal-600
  sales: '#ea580c', // orange-600（お金の暖色。地価 amber-600 とは色相・彩度で分かれる）
  population_forecast: '#93c5fd', // blue-300
  land_price: '#d97706', // amber-600
  bus: '#059669', // emerald-600
  establishment: '#7c3aed', // violet-600
  employee: '#db2777', // pink-600
}

/**
 * 散布図クラスタの配色（旧プロジェクト Station Area Database Map と同一の 4 色）。
 *
 * クラスタ番号は k-means の任意 index で意味を持たないため、色は「集団の区別」だけを担う
 * （凡例は出さない・docs/260728_scatter_plot_color.md）。決定的 k-means は k=4 のため 4 色で足り、
 * それを超える番号は clusterColor() が循環させる。非空タプル型で空配列を型として禁止する。
 */
export const CLUSTER_COLORS: readonly [string, ...string[]] = [
  '#ff6384', // ピンクレッド
  '#36a2eb', // ブルー
  '#ffce56', // イエロー
  '#4bc0c0', // ティール
]

/** クラスタ番号 → 配色（範囲外・負値・小数は剰余で循環し、必ず色を返す純関数）。 */
export function clusterColor(clusterIndex: number): string {
  const size = CLUSTER_COLORS.length
  const wrapped = ((Math.trunc(clusterIndex) % size) + size) % size
  return CLUSTER_COLORS[wrapped] ?? CLUSTER_COLORS[0]
}

// --- 併設パネルのレイアウト（260804） -----------------------------------

/**
 * 左のチャットと右の駅詳細ドロワーの幅（px）。**2 枚は同じ幅にする。**
 *
 * 380px 時代は駅詳細のタブ帯（当時 6 タブ＝404px）が**どの画面幅でも 24px はみ出し**、
 * 常に横スライドが要る状態だった。16px の余裕を足した 420px にしてスライドを無くした
 * （docs/260804_station_window_width.md §1・§4）。
 *
 * ⚠ 260813 に**所得タブを足して 7 タブ＝460px**、260817 に**売上タブで 8 タブ＝516px** になり、
 * 96px ぶんがはみ出す。ここをさらに広げると地図が狭くなるため広げない、と判断している
 * （docs/260805_research_add_dataset_economy.md §16.3）。7 タブまでは「最後のタブが 26px 見える」で
 * 続きに気づけたが、8 タブでは完全に隠れるので**帯の右端にフェード**を出す
 * （docs/260816_sales.md §7.4 案A）。この不変条件は `tests/panel-layout.test.ts` が守る。
 *
 * この 1 つの値から **flyTo の余白・キャンバスの左右端・FAB の退避位置**を算出する。
 * 以前はそれぞれに数値が直書きされており、片方だけ直すと
 * 「flyTo が選択駅をパネルの裏に置く」「キャンバスがドロワーと重なる」といったズレが起きた。
 */
export const PANEL_WIDTH_PX = 420

/** パネルと画面端・パネル同士のあいだの余白（px）。Tailwind の `*-3` と同値。 */
export const PANEL_GAP_PX = 12

/**
 * パネルの width に入れる CSS。画面が狭いときは縮める（その場合はタブがスライドするが、
 * 依頼どおり許容する・§4.1）。
 */
export const PANEL_WIDTH_CSS = `min(${PANEL_WIDTH_PX}px, calc(100% - ${PANEL_GAP_PX * 2}px))`

// --- 都道府県（47） -----------------------------------------------------

/** 都道府県（JIS X 0401 コード＋名称）。ランキングの都道府県フィルタ等で使用。 */
export type Prefecture = {
  /** JIS 都道府県コード（"01"–"47"・ゼロ埋め 2 桁）。 */
  readonly code: string
  /** 都道府県名（例 "東京都"）。 */
  readonly name: string
}

/** 47 都道府県（コード昇順）。 */
export const PREFECTURES: readonly Prefecture[] = [
  { code: '01', name: '北海道' },
  { code: '02', name: '青森県' },
  { code: '03', name: '岩手県' },
  { code: '04', name: '宮城県' },
  { code: '05', name: '秋田県' },
  { code: '06', name: '山形県' },
  { code: '07', name: '福島県' },
  { code: '08', name: '茨城県' },
  { code: '09', name: '栃木県' },
  { code: '10', name: '群馬県' },
  { code: '11', name: '埼玉県' },
  { code: '12', name: '千葉県' },
  { code: '13', name: '東京都' },
  { code: '14', name: '神奈川県' },
  { code: '15', name: '新潟県' },
  { code: '16', name: '富山県' },
  { code: '17', name: '石川県' },
  { code: '18', name: '福井県' },
  { code: '19', name: '山梨県' },
  { code: '20', name: '長野県' },
  { code: '21', name: '岐阜県' },
  { code: '22', name: '静岡県' },
  { code: '23', name: '愛知県' },
  { code: '24', name: '三重県' },
  { code: '25', name: '滋賀県' },
  { code: '26', name: '京都府' },
  { code: '27', name: '大阪府' },
  { code: '28', name: '兵庫県' },
  { code: '29', name: '奈良県' },
  { code: '30', name: '和歌山県' },
  { code: '31', name: '鳥取県' },
  { code: '32', name: '島根県' },
  { code: '33', name: '岡山県' },
  { code: '34', name: '広島県' },
  { code: '35', name: '山口県' },
  { code: '36', name: '徳島県' },
  { code: '37', name: '香川県' },
  { code: '38', name: '愛媛県' },
  { code: '39', name: '高知県' },
  { code: '40', name: '福岡県' },
  { code: '41', name: '佐賀県' },
  { code: '42', name: '長崎県' },
  { code: '43', name: '熊本県' },
  { code: '44', name: '大分県' },
  { code: '45', name: '宮崎県' },
  { code: '46', name: '鹿児島県' },
  { code: '47', name: '沖縄県' },
]

/**
 * 複数選択の表示ラベル（空＝`emptyLabel`／1–2件＝連結／3件以上＝先頭＋他N件）。
 * 都道府県・運営会社など、同じ文法のセレクタで共用する（DRY）。
 */
export function selectionLabel(items: readonly string[], emptyLabel: string): string {
  if (items.length === 0) return emptyLabel
  if (items.length <= 2) return items.join('・')
  return `${items[0]} 他${items.length - 1}件`
}

/** 選択都道府県の表示ラベル（空＝全国）。 */
export function prefectureLabel(prefectures: readonly string[]): string {
  return selectionLabel(prefectures, '全国')
}

/** 選択運営会社の表示ラベル（空＝全社・260730）。 */
export function operatorLabel(operators: readonly string[]): string {
  return selectionLabel(operators, '全社')
}

// --- 路線（事業者種別・260731） -----------------------------------------

/**
 * 事業者種別コード（国土数値情報 S12 の `S12_005`）。
 * 「新幹線駅のみ」は名前の部分一致ではなく**このコード 1** で厳密に表現できる
 * （docs/260730_scatter_plot_routes.md §1.2）。
 */
export const ROUTE_TYPES = [1, 2, 3, 4, 5] as const
export type RouteType = (typeof ROUTE_TYPES)[number]

/** 事業者種別の表示名（チップ・パネルタイトルで共用）。 */
export const ROUTE_TYPE_LABELS: Readonly<Record<RouteType, string>> = {
  1: '新幹線',
  2: 'JR在来線',
  3: '公営鉄道',
  4: '民営鉄道',
  5: '第三セクター',
}

/** コード → 表示名（未知のコードはそのまま数値を返す・安全側）。 */
export function routeTypeLabel(code: number): string {
  const known = ROUTE_TYPES.find((type) => type === code)
  return known === undefined ? `種別${code}` : ROUTE_TYPE_LABELS[known]
}

/** 選択路線の表示ラベル（空＝全路線・260731）。 */
export function routeLabel(routes: readonly string[]): string {
  return selectionLabel(routes, '全路線')
}

/**
 * 路線セレクタのボタン表示（路線と種別は 1 つのコントロールで扱う・空＝全路線）。
 * 種別を先に並べる：「新幹線」だけを押す使い方が最も多く、先頭に出したほうが読み取りやすい。
 */
export function routeFilterLabel(routes: readonly string[], routeTypes: readonly number[]): string {
  return routeLabel([...routeTypes.map(routeTypeLabel), ...routes])
}

/**
 * 路線一覧の 1 行の表示名。**同名の路線が複数社にあるときだけ**識別子を足す
 * （§9 決定 5：常に会社名を併記すると幅 200px で切れる）。
 *
 * 識別子は会社名ではなく**会社数**にする。実測では重複 28 本すべてで会社名の併記が
 * 行幅（約 14 字）に収まらず（「山陽線（九州旅客鉄道・西日本旅客鉄道）」＝18 字）、
 * 切れた表示は識別子として役に立たないため。会社数は「この名前を選ぶと N 社ぶんが対象」
 * （§9 決定 4）という、選択時にいちばん効く情報でもある。会社名の全文は
 * ホバー（title 属性）と、会社名での検索で辿れる。
 */
export function routeOptionLabel(route: string, operators: readonly string[]): string {
  return operators.length <= 1 ? route : `${route}（${operators.length}社）`
}

// --- ハザード（水害・docs/260824_flood.md §5.4） --------------------------
// 水害レイヤは「駅×半径の指標」ではなく**地図のレイヤ**という別の軸なので、
// `Category` とは混ぜず、ここに独立した語彙を置く（metric_catalog に水害を混ぜない）。

/** ハザードレイヤのグループ（表示の束ね方）。`hazard-catalog.json` の `groups` と一致する。 */
export type HazardGroup =
  'flood' | 'inland_flood' | 'storm_surge' | 'tsunami' | 'landslide' | 'terrain' | 'realtime'

/** 表示順を保持したハザードグループ一覧。 */
export const HAZARD_GROUPS: readonly HazardGroup[] = [
  'flood',
  'inland_flood',
  'storm_surge',
  'tsunami',
  'landslide',
  'terrain',
  'realtime',
]

/**
 * グループの日本語ラベル。
 * ⚠ `terrain` は「参考：地形」と明示する。地形は**ハザード（浸水想定）ではない**ので、
 * 同じ見え方にすると根拠の質が違うものを混ぜてしまう（docs/260824_flood.md §3.7）。
 */
export const HAZARD_GROUP_LABELS_JA: Readonly<Record<HazardGroup, string>> = {
  flood: '洪水',
  inland_flood: '内水（雨水出水）',
  storm_surge: '高潮',
  tsunami: '津波',
  landslide: '土砂災害',
  terrain: '参考：地形',
  realtime: '今の危険度（リアルタイム）',
}

/**
 * 危険度レベル（軽い順）。
 *
 * ⚠ 最も軽い段階を `safe`（安全）と呼ばない。**白＝「想定区域が指定されていない」であって
 * 「安全」ではない**——これがこの機能でいちばん大事な不変条件だから（docs/260824_flood.md §7.5-1）。
 * 型の名前からしてそう読めるようにしておく。
 */
export type HazardLevel = 'none' | 'caution' | 'warning' | 'danger' | 'critical'

/** 軽い順に並べたハザード危険度。比較（重い方を採る）はこの順に依る。 */
export const HAZARD_LEVELS: readonly HazardLevel[] = [
  'none',
  'caution',
  'warning',
  'danger',
  'critical',
]

/** 危険度の日本語ラベル。`none` は「安全」ではなく「想定区域外」。 */
export const HAZARD_LEVEL_LABELS_JA: Readonly<Record<HazardLevel, string>> = {
  none: '想定区域外',
  caution: '注意',
  warning: '警戒',
  danger: '危険',
  critical: '極めて危険',
}

/**
 * 危険度バッジの配色（**公式タイルの配色とは別物**）。
 * タイルの色は原典の凡例に従うしかないので、こちらは「地点カードのバッジ」用の重症度ランプ。
 * ⚠ 色だけで危険度を伝えない（色＋アイコン＋テキストの 3 重・同 §7.6）。
 */
export const HAZARD_LEVEL_COLORS: Readonly<Record<HazardLevel, string>> = {
  none: '#94a3b8', // slate-400
  caution: '#eab308', // yellow-500
  warning: '#f97316', // orange-500
  danger: '#dc2626', // red-600
  critical: '#7f1d1d', // red-900
}

/**
 * 危険度の記号。**色だけで危険度を伝えない**ための 3 要素（色・記号・テキスト）のうちの 1 つ
 * （1 型・2 型色覚への配慮・docs/260824_flood.md §7.6）。絵文字ではなく、どの環境でも出る記号を使う。
 */
export const HAZARD_LEVEL_ICONS: Readonly<Record<HazardLevel, string>> = {
  none: '—',
  caution: '△',
  warning: '⚠',
  danger: '❗',
  critical: '⛔',
}

/** レベルの重さ（大きいほど重い）。未知の値は最も軽い扱いにする（安全側に倒さない＝誇張しない）。 */
export function hazardLevelWeight(level: HazardLevel): number {
  const index = HAZARD_LEVELS.indexOf(level)
  return index < 0 ? 0 : index
}

/**
 * 避難行動の種別（`docs/260824_flood.md` §6.2 の判定が返す 3 択）。
 * ⚠ 「避難しなくてよい」とは言わない。`stay` は「その場に留まる」であって「安全」ではない。
 */
export type EvacuationAction = 'takeaway' | 'vertical' | 'stay'

/** 避難行動の日本語ラベル（断定しない文言で統一・同 §7.5-5）。 */
export const EVACUATION_LABELS_JA: Readonly<Record<EvacuationAction, string>> = {
  takeaway: '立退き避難が基本',
  vertical: '垂直避難も選択肢',
  stay: 'その場に留まる',
}

/**
 * ハザードレイヤの既定不透明度。
 * 背景地図の地名が読めなくなると避難に使えないため、UI では 0.3–0.9 で変えられるようにする
 * （docs/260824_flood.md §7.6）。
 */
export const HAZARD_OPACITY_DEFAULT = 0.6
export const HAZARD_OPACITY_MIN = 0.3
export const HAZARD_OPACITY_MAX = 0.9

/**
 * 「参考：地形」グループにかける不透明度の倍率。
 * 地形は**ハザードではない**（浸水想定ではない）ので、同じ濃さで塗るとハザードと見分けがつかない。
 * 一段薄くして「背景の参考情報」として読ませる（docs/260824_flood.md §3.7・§7.1）。
 */
export const HAZARD_TERRAIN_OPACITY_SCALE = 0.7

/** 不透明度を有効範囲（0.3–0.9）に丸める。URL 直打ちの異常値もここで吸収する。 */
export function clampHazardOpacity(value: number): number {
  if (!Number.isFinite(value)) return HAZARD_OPACITY_DEFAULT
  return Math.min(HAZARD_OPACITY_MAX, Math.max(HAZARD_OPACITY_MIN, value))
}
