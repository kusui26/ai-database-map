/**
 * ドメイン：駅詳細 → 「年齢別の人口」の Panel（純関数・2026-11-25・人口の年齢 PR-3・計画書 261122 §6.4）。
 *
 * 人口タブの 2 枚目の図。2015・2020 年（国勢調査）と 2025〜2050 年（R6 推計）の 4 区分を人数の積み上げ縦棒にし、
 * 推計の年は淡く描く（`projectedFrom`）。上に要点のチップを 3 つ置く（値と結論を先に・§6.1）：
 * ①15〜64歳（2020年）の人数・割合 ②高齢化率 2020→2050 ③15〜64歳 2020→2050 の増減率。
 *
 * - 図の人数は年齢の表（`detail.ageStructure`）、**チップの数字は値の表の指標**（カタログの key）から取る——順位・散布・
 *   色分け・概要と同じ値・同じ書式・同じ ⚠ になる。2 つは同じ build の値で、2020 年の 15〜64 歳は 1 人の差もなく一致する
 *   （`pipeline/golden_station_age_profile_test.py`）
 * - 色は 1 つの色相（人口の青）の濃淡（年齢の区分は順序のある区分・dataviz の ordinal ramp）。15〜64 歳は人口の色
 * - 注意はその駅に固有のときだけ：年齢不詳が多い（`pop_ageunk_2020`）・母数が小さい（`pop_lowbase_2020`）。
 *   65 歳以上が少ない（`pop65_lowbase_2020`）は出さない——それが効く 65 歳以上の増減率を、この図は出さない
 */

import { AGE_BANDS, type AgeBand, type AgeRadius, type StationDetail } from '@/shared/api'
import {
  type PanelSize,
  type PanelStat,
  type ReliabilityFlag,
  type TrendChartPanel,
} from '@/shared/protocol'
import { CATEGORY_COLORS, radiusLabel } from '@/shared/constants'
import { formatNumber, formatWithUnit } from '@/shared/format'
import { seriesAt } from './series'

/** R6 推計（将来推計人口メッシュ・2024 年）の推計時点。将来の指標の `vintage`。 */
const R6_VINTAGE = 2024

/**
 * AI に渡す読み方（**画面には出さない**——どの駅でも同じ一般論なので・計画書 261122 §1.1・§7.4・261110 §2.2）。
 * 年齢別の人口は需要（通勤・通学・日中の利用）の材料で、乗降客数の予測ではない。需要やダイヤの話のときに AI がそう添える。
 */
export const AGE_STRUCTURE_READING_JA =
  '人口（年齢別を含む）は需要の材料で、乗降客数の予測ではない。需要やダイヤの話では、そう添える。'

/** 区分の名前（凡例・ツールチップ・AI の文）。 */
export const AGE_BAND_LABELS_JA: Readonly<Record<AgeBand, string>> = {
  '0_14': '0〜14歳',
  '15_64': '15〜64歳',
  '65_74': '65〜74歳',
  '75plus': '75歳以上',
}

/**
 * 区分の色（若い＝淡い → 高齢＝濃い）。白の上で `validate_palette.js --ordinal` を通した：明るさが単調・隣の差 ≥ 0.06・
 * 最も淡い 0〜14 歳も白に 2.54:1。推計の棒（不透明度 `PROJECTED_OPACITY`）でも隣の差 ≥ 0.06 が残る。
 */
export const AGE_BAND_COLORS: Readonly<Record<AgeBand, string>> = {
  '0_14': '#60a5fa', // blue-400
  '15_64': CATEGORY_COLORS.population, // blue-600（人口の色＝この図の主役）
  '65_74': '#1e40af', // blue-800
  '75plus': '#172554', // blue-950
}

/** 人数の和（4 区分の和＝総数）。 */
const sumOf = (counts: readonly number[]): number => counts.reduce((sum, count) => sum + count, 0)

/** 選んだ半径の年齢（年の昇順）。表に無い駅・半径は undefined。 */
function ageRadiusOf(detail: StationDetail, radiusM: number): AgeRadius | undefined {
  return detail.ageStructure?.radii.find((radius) => radius.radiusM === radiusM)
}

/**
 * 2020 年の総数が小さい（`pop_lowbase_2020_*`・50 人未満）。年齢の割合と将来増減率はこのフラグで順位から外すが、
 * 駅詳細の点の ⚠ は年齢不詳（notice）で解くので、年齢の点からは読めない。同じフラグを ⚠ に持つ総数の将来増減率
 * （分母が 2020 年の総数）の点で読む。
 */
function lowBase2020(detail: StationDetail, radiusM: number): boolean {
  const growth = seriesAt(detail, 'pop_gr_pred', radiusM, R6_VINTAGE)
  return growth?.points.some((point) => point.flagged) === true
}

/** ①15〜64歳（2020年）：人数・割合。 */
function workingAgeStat(detail: StationDetail, radiusM: number, lowBase: boolean): PanelStat[] {
  const level = seriesAt(detail, 'pop15_64', radiusM)
  const count = level?.points.at(-1)
  const share = seriesAt(detail, 'pop15_64_share', radiusM)?.points.at(-1)
  if (level === undefined || count === undefined || count.value === null) return []
  const parts = [formatWithUnit(count.value, level.format, level.unit)]
  if (share !== undefined && share.value !== null) parts.push(share.formatted)
  return [
    {
      label: `15〜64歳（${count.year ?? '?'}年）`,
      value: parts.join('・'),
      flagged: count.flagged || share?.flagged === true || lowBase,
    },
  ]
}

/** ②高齢化率 2020→2050（実績の割合 → R6 推計の割合）。 */
function agingRateStat(detail: StationDetail, radiusM: number, lowBase: boolean): PanelStat[] {
  const now = seriesAt(detail, 'pop65_share', radiusM)?.points.at(-1)
  const future = seriesAt(detail, 'pop65_share_pred', radiusM, R6_VINTAGE)?.points.at(-1)
  if (now === undefined || future === undefined || now.value === null || future.value === null) {
    return []
  }
  return [
    {
      label: `高齢化率 ${now.year ?? '?'}→${future.year ?? '?'}`,
      value: `${now.formatted}→${future.formatted}`,
      flagged: now.flagged || future.flagged || lowBase,
    },
  ]
}

/** ③15〜64歳 2020→2050 の増減率（R6 推計の最も遠い年）。 */
function workingFutureStat(detail: StationDetail, radiusM: number, lowBase: boolean): PanelStat[] {
  const growth = seriesAt(detail, 'pop15_64_gr_pred', radiusM, R6_VINTAGE)?.points.at(-1)
  if (growth === undefined || growth.value === null) return []
  return [
    {
      label: `15〜64歳 ${growth.yearBase ?? '?'}→${growth.year ?? '?'}`,
      value: growth.formatted,
      flagged: growth.flagged || lowBase,
    },
  ]
}

/** 年齢不詳の割合（国勢調査の最後の年・補う前の不詳 ÷ 総数）。 */
function unknownShare(radius: AgeRadius): { year: number; share: number } | null {
  const census = radius.years.filter((year) => !year.projected).at(-1)
  if (census === undefined || census.unknown === null) return null
  const total = sumOf(census.counts)
  return total === 0 ? null : { year: census.year, share: (census.unknown / total) * 100 }
}

/** 年齢不詳が多い（⚠ の印は `pop_ageunk_2020`＝15〜64 歳の点の notice）。割合は年齢の表から。 */
function unknownFlag(detail: StationDetail, radius: AgeRadius): ReliabilityFlag[] {
  const flagged = seriesAt(detail, 'pop15_64', radius.radiusM)?.points.at(-1)?.flagged === true
  const unknown = unknownShare(radius)
  if (!flagged || unknown === null) return []
  const share = formatNumber(unknown.share, 'percent1')
  return [{ label: `年齢不詳が多い地域です（${unknown.year}年 ${share}）`, level: 'warn' }]
}

/** 図の注意（その駅に固有のときだけ）。 */
function ageFlags(detail: StationDetail, radius: AgeRadius, lowBase: boolean): ReliabilityFlag[] {
  const small: ReliabilityFlag[] = lowBase
    ? [{ label: '母数が小さく割合・増減率は参考値', level: 'warn' }]
    : []
  return [...unknownFlag(detail, radius), ...small]
}

/** 要点のチップ 3 つ（値の表の指標から・無い値のチップは出さない）。 */
function ageStats(detail: StationDetail, radiusM: number, lowBase: boolean): PanelStat[] {
  return [
    ...workingAgeStat(detail, radiusM, lowBase),
    ...agingRateStat(detail, radiusM, lowBase),
    ...workingFutureStat(detail, radiusM, lowBase),
  ]
}

/** 区分ごとの系列（下から 0〜14 → 15〜64 → 65〜74 → 75 歳以上）。 */
function bandSeries(radius: AgeRadius): TrendChartPanel['series'] {
  return AGE_BANDS.map((band, index) => ({
    label: AGE_BAND_LABELS_JA[band],
    points: radius.years.map((year) => ({ x: year.year, y: year.counts[index] ?? null })),
    color: AGE_BAND_COLORS[band],
  }))
}

/** 年ごとの合計（4 区分の人数の和＝既存の総数の列と 1 人単位で同じ）。 */
function bandTotals(radius: AgeRadius): NonNullable<TrendChartPanel['totals']> {
  return radius.years.map((year) => ({ x: year.year, y: sumOf(year.counts) }))
}

/** 推計の始まり（最初の推計の年）。推計の年が無ければ指定しない（全部を濃く描く）。 */
function projectionOf(radius: AgeRadius): Pick<TrendChartPanel, 'projectedFrom'> {
  const projectedFrom = radius.years.find((year) => year.projected)?.year
  return projectedFrom === undefined ? {} : { projectedFrom }
}

/** どの駅・半径でも同じ、図の形（人数の積み上げ縦棒・人口の色の系統）。 */
const AGE_CHART_SHAPE: Pick<TrendChartPanel, 'type' | 'unit' | 'format' | 'category' | 'stacked'> =
  {
    type: 'trendChart',
    unit: '人',
    format: 'int',
    category: 'population',
    stacked: true,
  }

/**
 * 年齢別の人口 Panel（選択半径）。年齢の表に無い駅・半径は null（人口タブは推移の図だけになる）。
 * 合計は、2015・2020 年が国勢調査の総数、2025 年からが R6 推計の総数（人口の推移の図の実績・R6 推計と同じ値）。
 */
export function ageStructurePanel(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): TrendChartPanel | null {
  const radius = ageRadiusOf(detail, radiusM)
  if (radius === undefined || radius.years.length === 0) return null
  const lowBase = lowBase2020(detail, radiusM)
  return {
    ...AGE_CHART_SHAPE,
    title: `年齢別の人口（${radiusLabel(radiusM)}圏）`,
    totals: bandTotals(radius),
    ...projectionOf(radius),
    flags: ageFlags(detail, radius, lowBase),
    series: bandSeries(radius),
    stats: ageStats(detail, radiusM, lowBase),
    size,
  }
}
