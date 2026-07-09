/**
 * ドメイン：メトリクス・カタログの問い合わせ（UI ピッカ・既定指標）。
 * カタログ（shared）を参照し、UI/AI が使う「指標の選び方」を組み立てる（純関数）。
 */

import { type CatalogEntry, entries, rankableForCategory } from '@/shared/catalog'
import { type Category, radiusLabel } from '@/shared/constants'

/** 指標の変種ラベル（半径・年・推計時点を簡潔に。指標ピッカの3段目・optgroup 内の option）。 */
export function variantLabel(entry: CatalogEntry): string {
  const parts: string[] = []
  if (entry.vintage !== null) parts.push(entry.vintage === 2024 ? 'R6推計' : 'H30推計')
  if (entry.yearBase !== null && entry.year !== null) parts.push(`${entry.yearBase}→${entry.year}`)
  else if (entry.year !== null) parts.push(`${entry.year}年`)
  if (entry.radiusM !== null) parts.push(radiusLabel(entry.radiusM))
  return parts.length > 0 ? parts.join('・') : entry.labelJa
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

/** 既定のランキング指標（人口増減率 2015→2020・1km圏）。plan_fable P6a。 */
export const DEFAULT_RANKING_KEY = 'pop_gr_2020_2015_1km'
/** 既定の散布 x/y（人口増減率 × 乗降客コロナ前後比）。plan_fable P6b。 */
export const DEFAULT_SCATTER_X = 'pop_gr_2020_2015_2km'
export const DEFAULT_SCATTER_Y = 'rate_covid'
