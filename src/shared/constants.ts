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
  | 'population_forecast'
  | 'land_price'
  | 'bus'
  | 'establishment'
  | 'employee'

/** 表示順を保持したカテゴリ一覧。 */
export const CATEGORIES: readonly Category[] = [
  'passenger',
  'population',
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
