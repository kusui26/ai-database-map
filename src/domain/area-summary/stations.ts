/**
 * ドメイン：**駅の分布**——エリアの駅ごとの円の値の中央値・四分位・上位と下位（純関数・2026-10-10 B5b）。
 *
 * `docs/261001_fix_user_feedback_ui.md` §6.12.5。**区域の値と混ぜない**：横浜市の 137 駅の 1km の人口増減（2015→2020）の
 * 中央値は +2.5% だが、市の合計は +1.4%（2020→2025 は -0.7%）。駅は人の増える街なかに多く、円は重なる。
 * だから分布は「駅の周りでは」と言い分ける材料で、エリア全体の値ではない。
 *
 * 指標はファミリで書き、半径はプロフィール（B4）と同じ規則で決める（無い半径は近い半径に替えて言う）。
 * ⚠（母数が小さいなど）の値は分布から除き、数だけ出す（ランキングの「⚠ を除外」と同じ）。
 */

import { type StationStatRow } from '@/db/queries'
import { type AreaStationStat, type AreaStationValue } from '@/shared/area-summary'
import { type CatalogEntry } from '@/shared/catalog'
import { radiusLabel, type RadiusM } from '@/shared/constants'
import { formatNumber, formatWithUnit, MISSING } from '@/shared/format'
import { periodOf } from '@/domain/metrics'
import { resolveFamilyAtRadius } from '@/domain/metrics/family'

/** 分布を出す指標（ファミリ・短い名前・増減の期間）。 */
type StationStatSpec = {
  readonly family: string
  readonly labelJa: string
  readonly spanYears?: number
}

/**
 * 既定の顔ぶれ：人口・人口の増減（5 年）・将来の人口の増減（2050 年＝区域の値の推計と同じ年）・地価・従業者。
 * 色分けの指標がこの外なら、それも足す。
 */
export const STATION_STAT_SPECS: readonly StationStatSpec[] = [
  { family: 'pop', labelJa: '人口' },
  { family: 'pop_gr', labelJa: '人口の増減', spanYears: 5 },
  { family: 'pop_gr_pred', labelJa: '将来の人口の増減（推計）', spanYears: 30 },
  { family: 'lp_med', labelJa: '地価（中央値）' },
  { family: 'emp_n', labelJa: '従業者' },
]

/** 分布を出す指標 1 つ（決まったエントリと、半径を替えたか）。 */
export type ResolvedStationStat = {
  readonly entry: CatalogEntry
  readonly labelJa: string
  readonly substituted: boolean
}

/** 選んだ半径で分布の指標を決める（色分けの指標がほかにあれば最後に足す）。 */
export function resolveStationStats(
  radiusM: RadiusM,
  extra: CatalogEntry | null,
): readonly ResolvedStationStat[] {
  const resolved = STATION_STAT_SPECS.flatMap((spec) => {
    const found = resolveFamilyAtRadius(spec.family, radiusM, spec.spanYears)
    return found === null
      ? []
      : [{ entry: found.entry, labelJa: spec.labelJa, substituted: found.substituted }]
  })
  if (extra === null || resolved.some((stat) => stat.entry.key === extra.key)) return resolved
  return [...resolved, { entry: extra, labelJa: extra.labelJa, substituted: false }]
}

function signedOf(entry: CatalogEntry): boolean {
  return entry.kind === 'growth' || entry.kind === 'error'
}

function valueText(value: number | null, entry: CatalogEntry): string {
  return formatWithUnit(value, entry.format, entry.unit, { signed: signedOf(entry) })
}

/** 四分位の書き方（「+0.2%〜+4.9%」「25,164〜44,957 人」・同じ値なら 1 つ）。 */
function rangeText(q1: number | null, q3: number | null, entry: CatalogEntry): string {
  if (q1 === null || q3 === null) return MISSING
  if (q1 === q3) return valueText(q1, entry)
  if (entry.format === 'percent1') return `${valueText(q1, entry)}〜${valueText(q3, entry)}`
  const options = { signed: signedOf(entry) }
  const unit = entry.unit === null ? '' : ` ${entry.unit}`
  return `${formatNumber(q1, entry.format, options)}〜${formatNumber(q3, entry.format, options)}${unit}`
}

function stationValues(rows: StationStatRow['top'], entry: CatalogEntry): AreaStationValue[] {
  return rows.map((row) => ({
    grp: row.grp,
    labelJa: row.label,
    value: row.value,
    valueJa: valueText(row.value, entry),
  }))
}

/** 下位から上位の駅を外す（駅が 6 未満だと上位と下位が重なる——同じ駅を両方に出さない）。 */
function bottomOnly(row: StationStatRow): StationStatRow['bottom'] {
  const top = new Set(row.top.map((each) => each.grp))
  return row.bottom.filter((each) => !top.has(each.grp))
}

function substitutionNote(stat: ResolvedStationStat, requested: RadiusM): string | null {
  if (!stat.substituted || stat.entry.radiusM === null) return null
  return `${radiusLabel(requested)}圏は算出対象外のため、${radiusLabel(stat.entry.radiusM)}圏の値です。`
}

/** 分布の数と言い方（DB の行が無ければ、値のある駅 0）。 */
function distributionOf(
  row: StationStatRow | undefined,
  entry: CatalogEntry,
): Pick<
  AreaStationStat,
  'n' | 'flaggedN' | 'median' | 'q1' | 'q3' | 'medianJa' | 'rangeJa' | 'top' | 'bottom'
> {
  const median = row?.median ?? null
  const q1 = row?.q1 ?? null
  const q3 = row?.q3 ?? null
  return {
    n: row?.n ?? 0,
    flaggedN: row?.flaggedN ?? 0,
    median,
    q1,
    q3,
    medianJa: valueText(median, entry),
    rangeJa: rangeText(q1, q3, entry),
    top: stationValues(row?.top ?? [], entry),
    bottom: stationValues(row === undefined ? [] : bottomOnly(row), entry),
  }
}

/** 1 指標の分布。値の無い駅は、エリアの駅の数から値のある駅と ⚠ の駅を引いた数。 */
export function stationStatOf(
  stat: ResolvedStationStat,
  row: StationStatRow | undefined,
  stationCount: number,
  requested: RadiusM,
): AreaStationStat {
  const { entry } = stat
  const distribution = distributionOf(row, entry)
  return {
    key: entry.key,
    labelJa: stat.labelJa,
    periodJa: periodOf(entry),
    radiusM: entry.radiusM,
    unit: entry.unit,
    format: entry.format,
    ...distribution,
    missingN: Math.max(stationCount - distribution.n - distribution.flaggedN, 0),
    noteJa: substitutionNote(stat, requested),
  }
}
