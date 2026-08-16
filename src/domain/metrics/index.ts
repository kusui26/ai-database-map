/**
 * ドメイン：メトリクス・カタログの問い合わせ（UI ピッカ・既定指標）。
 * カタログ（shared）を参照し、UI/AI が使う「指標の選び方」を組み立てる（純関数）。
 */

import { type CatalogEntry, entries, getEntry, rankableForCategory } from '@/shared/catalog'
import { type Category } from '@/shared/constants'

/** 指標の変種ラベル（年・期間・推計時点。**半径は含めない**＝半径は別セレクタ・P6c）。 */
export function variantLabel(entry: CatalogEntry): string {
  const parts: string[] = []
  if (entry.vintage !== null) parts.push(entry.vintage === 2024 ? 'R6推計' : 'H30推計')
  if (entry.yearBase !== null && entry.year !== null) parts.push(`${entry.yearBase}→${entry.year}`)
  else if (entry.year !== null) parts.push(`${entry.year}年`)
  return parts.length > 0 ? parts.join('・') : entry.labelJa
}

/** 変種トークン（半径非依存の一意アイデンティティ＝同一なら半径違いのみ）。 */
function variantToken(entry: CatalogEntry): string {
  return `${entry.baseMetric}|${entry.year ?? ''}|${entry.yearBase ?? ''}|${entry.vintage ?? ''}`
}

/** metricKey → 変種トークン（未知は undefined）。 */
export function variantTokenOf(key: string): string | undefined {
  const entry = getEntry(key)
  return entry === undefined ? undefined : variantToken(entry)
}

/** 半径依存カテゴリ（radiusM を持つ指標がある＝集計半径で値が変わる）。カタログから導出。 */
const RADIUS_DEPENDENT_CATEGORIES: ReadonlySet<Category> = new Set(
  entries.filter((entry) => entry.radiusM !== null).map((entry) => entry.category),
)

/** カテゴリが集計半径に依存するか（UI の半径セレクタ表示・チャート再計算の判断）。 */
export function isRadiusDependentCategory(category: Category): boolean {
  return RADIUS_DEPENDENT_CATEGORIES.has(category)
}

/** baseMetric → 系列の基底ラベル（年・半径を除いた指標名）。 */
const BASE_LABELS: Readonly<Record<string, string>> = {
  pax: '乗降客数',
  pax_rate: '乗降客 増減率',
  pop: '人口',
  pop_gr: '人口増減率',
  pop_hidden_ratio: '秘匿・合算メッシュ割合',
  pop_pred: '将来推計人口',
  pop_gr_pred: '将来人口増減率',
  pop_err: '人口予測誤差率',
  inc_pc: '1人当たり課税対象所得',
  inc_total: '課税対象所得 総額',
  inc_gr: '1人当たり課税対象所得 増減率',
  inc_lown: '所得 低分母フラグ',
  inc_city_only: '所得 政令市フラグ',
  sales_dest: '目的地としての売上',
  sales_retail: '小売の売上',
  sales_food: '飲食・宿泊の売上',
  sales_leisure: '生活関連・娯楽の売上',
  sales_dest_gr: '目的地としての売上 増減率',
  sales_lown: '売上 低分母フラグ',
  sales_asym: '売上 娯楽の集計定義 非対称フラグ',
  sales_gr_unrel: '売上 増減率 信頼性フラグ',
  emp_trade_n: '卸売・小売の従業者数',
  emp_food_n: '宿泊・飲食の従業者数',
  emp_life_n: '生活関連・娯楽の従業者数',
  emp_trade_gr: '卸売・小売の従業者数増減率',
  emp_food_gr: '宿泊・飲食の従業者数増減率',
  emp_life_gr: '生活関連・娯楽の従業者数増減率',
  emp_dest_gr: '売上対象3業種の従業者数増減率',
  lp_near: '最寄地価公示',
  lp_med: '地価中央値',
  lp_n: '地価公示地点数',
  lp_gr: '地価増減率',
  bus_n: 'バス停留所数',
  bus_n_local: '一般バス停留所数',
  bus_n_hw: '高速バス停留所数',
  bus_n2010: 'バス停留所数（2010年度）',
  bus_gr: 'バス停留所数増減率',
  estab_n: '事業所数',
  emp_n: '従業者数',
  estab_gr: '事業所数増減率',
  emp_gr: '従業者数増減率',
  estab_gr_lown: '事業所・従業者 低分母フラグ',
}

/** baseMetric の基底ラベル（未定義はキーそのもの）。 */
export function baseMetricLabel(baseMetric: string): string {
  return BASE_LABELS[baseMetric] ?? baseMetric
}

/** ランキング/散布ピッカの1グループ（同一 baseMetric の変種＝半径/年）。 */
export type MetricGroup = {
  readonly baseMetric: string
  readonly labelJa: string
  readonly entries: readonly CatalogEntry[]
}

/** カテゴリ内の rankable を baseMetric でまとめる（ピッカの2段目・3段目）。 */
export function rankableGroups(category: Category): readonly MetricGroup[] {
  const groups = new Map<string, CatalogEntry[]>()
  for (const entry of rankableForCategory(category)) {
    const list = groups.get(entry.baseMetric) ?? []
    list.push(entry)
    groups.set(entry.baseMetric, list)
  }
  return [...groups.entries()].map(([baseMetric, entries]) => ({
    baseMetric,
    labelJa: baseMetricLabel(baseMetric),
    entries,
  }))
}

/** 指標の変種（半径非依存）。同一 (baseMetric, year, yearBase, vintage) の entries を半径で束ねる。 */
export type MetricVariant = {
  readonly baseMetric: string
  readonly token: string // <option> の value
  readonly labelJa: string // 半径を除いた変種ラベル
  readonly byRadius: ReadonlyMap<number | null, string> // radiusM → entry key
}
export type VariantGroup = {
  readonly baseMetric: string
  readonly labelJa: string
  readonly variants: readonly MetricVariant[]
}

/**
 * カテゴリ内の rankable を「baseMetric → 変種（半径で束ねる）」にまとめる（指標ピッカ用・P6c）。
 * 各変種は byRadius で半径→key を持ち、UI は半径セグメントで選ばせる。
 */
export function rankableVariantGroups(category: Category): readonly VariantGroup[] {
  const byBase = new Map<string, Map<string, { label: string; byRadius: Map<number | null, string> }>>()
  for (const entry of rankableForCategory(category)) {
    const variants = byBase.get(entry.baseMetric) ?? new Map()
    const token = variantToken(entry)
    const variant = variants.get(token) ?? {
      label: variantLabel(entry),
      byRadius: new Map<number | null, string>(),
    }
    variant.byRadius.set(entry.radiusM, entry.key)
    variants.set(token, variant)
    byBase.set(entry.baseMetric, variants)
  }
  return [...byBase.entries()].map(([baseMetric, variants]) => ({
    baseMetric,
    labelJa: baseMetricLabel(baseMetric),
    variants: [...variants.entries()].map(([token, v]) => ({
      baseMetric,
      token,
      labelJa: v.label,
      byRadius: v.byRadius,
    })),
  }))
}

/** 変種の利用可能半径（昇順・null＝半径非依存は除外）。 */
export function radiiOf(variant: MetricVariant): readonly number[] {
  return [...variant.byRadius.keys()]
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b)
}

/** 既定のランキング指標（人口増減率 2015→2020・1km圏）。plan_fable P6a。 */
export const DEFAULT_RANKING_KEY = 'pop_gr_2020_2015_1km'
/** 既定の散布 x/y（人口増減率 × 乗降客コロナ前後比）。plan_fable P6b。 */
export const DEFAULT_SCATTER_X = 'pop_gr_2020_2015_2km'
export const DEFAULT_SCATTER_Y = 'rate_covid'
