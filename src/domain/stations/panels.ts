/**
 * ドメイン：StationDetail → GUI Chat Protocol の Panel（純関数）。
 *
 * クリック（P5 の詳細パネル）と会話（Step2 のチャット）は、この同一の Panel[] を消費する
 * （.claude/CLAUDE.md §2「API こそがプロダクト」）。UI にメトリクスの意味づけを埋めない。
 * 乗降（passenger）・人口（population）タブを実装する（地価・バス・事業所は P5c）。
 */

import { type MetricSeries, type StationDetail, type StationRow } from '@/shared/api'
import {
  type Panel,
  type PanelSize,
  type PanelStat,
  type ReliabilityFlag,
  type StationCardPanel,
  type TrendChartPanel,
} from '@/shared/protocol'
import { CATEGORY_COLORS, radiusLabel } from '@/shared/constants'
import { formatWithUnit } from '@/shared/format'
import { baseMetricLabel } from '@/domain/metrics'

/** 系列点 → チャート座標（年欠損はスキップ・値欠損は null＝ギャップ）。 */
function toXY(series: MetricSeries | undefined): { x: number; y: number | null }[] {
  return (series?.points ?? []).flatMap((point) =>
    point.year === null ? [] : [{ x: point.year, y: point.value }],
  )
}

/** 最新乗降客数の整形（int・人/日）。単位の意味づけはドメインが持つ（UI に埋めない）。 */
export function formatPaxLatest(value: number | null): string {
  return formatWithUnit(value, 'int', '人/日')
}

/** 駅の信頼性バッジ（時系列の完全性など・カード見出し級の注意）。 */
function stationBadges(station: StationRow): ReliabilityFlag[] {
  if (station.levelComplete === false) {
    return [{ label: '乗降 時系列に欠損あり', level: 'warn' }]
  }
  return []
}

/** 駅カード Panel（駅名・県・延べ事業者数・最新乗降客・信頼性バッジ）。 */
export function stationCardPanel(
  detail: StationDetail,
  size: PanelSize = 'full',
): StationCardPanel {
  const s = detail.station
  return {
    type: 'stationCard',
    grp: s.grp,
    stationName: s.stationName,
    label: s.label,
    prefecture: s.prefecture,
    operators: s.nOp === null ? null : `延べ${s.nOp}社`,
    paxLatest: s.paxLatest,
    badges: stationBadges(s),
    size,
  }
}

/** pax_rate 系列 → 要約スタッツ（前年比 → コロナ前後比の順・整形済み文字列＋フラグ）。 */
function paxRateStats(rate: MetricSeries | undefined): PanelStat[] {
  if (rate === undefined) return []
  const byKey = new Map(rate.points.map((point) => [point.key, point]))
  const LABELS: readonly { key: string; label: string }[] = [
    { key: 'rate_yoy', label: '前年比' },
    { key: 'rate_covid', label: 'コロナ前後比' },
  ]
  return LABELS.flatMap(({ key, label }) => {
    const point = byKey.get(key)
    return point === undefined ? [] : [{ label, value: point.formatted, flagged: point.flagged }]
  })
}

/** 乗降客数の推移 Panel（折れ線＋前年比/コロナ前後比の KPI）。 */
export function paxTrendPanel(detail: StationDetail, size: PanelSize = 'full'): TrendChartPanel {
  const pax = detail.series.find((series) => series.baseMetric === 'pax')
  const rate = detail.series.find((series) => series.baseMetric === 'pax_rate')
  return {
    type: 'trendChart',
    title: '乗降客数の推移',
    unit: pax?.unit ?? '人/日',
    format: pax?.format ?? 'int',
    category: 'passenger',
    flags: [],
    series: [
      { label: baseMetricLabel('pax'), points: toXY(pax), color: CATEGORY_COLORS.passenger },
    ],
    stats: paxRateStats(rate),
    size,
  }
}

/** 半径・ビンテージ指定で系列を1本引く。 */
function seriesAt(
  detail: StationDetail,
  baseMetric: string,
  radiusM: number,
  vintage: number | null = null,
): MetricSeries | undefined {
  return detail.series.find(
    (series) =>
      series.baseMetric === baseMetric && series.radiusM === radiusM && series.vintage === vintage,
  )
}

/** 人口タブの信頼性フラグ（lowbase 警告・H30 推計誤差・500m 秘匿割合）。 */
function populationFlags(detail: StationDetail, radiusM: number): ReliabilityFlag[] {
  const flags: ReliabilityFlag[] = []

  const growth = seriesAt(detail, 'pop_gr', radiusM)
  if (growth?.points.some((point) => point.flagged) === true) {
    flags.push({ label: '母数が小さく増減率は参考値', level: 'warn' })
  }

  const errPoint = seriesAt(detail, 'pop_err', radiusM, 2018)?.points[0]
  if (errPoint !== undefined && errPoint.value !== null) {
    flags.push({ label: `H30推計は2020年実績を ${errPoint.formatted} 乖離`, level: 'info' })
  }

  if (radiusM === 500) {
    const hidden = seriesAt(detail, 'pop_hidden_ratio', radiusM)?.points.at(-1)
    if (hidden !== undefined && hidden.value !== null) {
      flags.push({
        label: `500m圏は秘匿・合算メッシュ割合 ${hidden.formatted}（${hidden.year}年）`,
        level: 'info',
      })
    }
  }

  return flags
}

/** 人口の重ねチャート Panel（実績実線＋R6/H30 推計破線・凡例トグルは Chart.js が担う）。 */
function populationTrendPanel(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize,
): TrendChartPanel {
  const actual = seriesAt(detail, 'pop', radiusM)
  const predR6 = seriesAt(detail, 'pop_pred', radiusM, 2024)
  const predH30 = seriesAt(detail, 'pop_pred', radiusM, 2018)
  return {
    type: 'trendChart',
    title: `人口の推移（実績・将来推計・${radiusLabel(radiusM)}圏）`,
    unit: actual?.unit ?? '人',
    format: actual?.format ?? 'int',
    category: 'population',
    flags: populationFlags(detail, radiusM),
    series: [
      { label: '実績', points: toXY(actual), color: CATEGORY_COLORS.population },
      { label: 'R6推計', points: toXY(predR6), color: CATEGORY_COLORS.population, dashed: true },
      {
        label: 'H30推計',
        points: toXY(predH30),
        color: CATEGORY_COLORS.population_forecast,
        dashed: true,
      },
    ],
    size,
  }
}

/** 人口増減率のミニ表 Panel（選択半径の 9 ペア・lowbase は各行 ⚠）。 */
function populationGrowthTable(detail: StationDetail, radiusM: number, size: PanelSize): Panel {
  const growth = seriesAt(detail, 'pop_gr', radiusM)
  return {
    type: 'statTable',
    title: '人口増減率',
    rows: (growth?.points ?? []).map((point) => ({
      label: `${point.yearBase ?? '?'}→${point.year ?? '?'}`,
      value: point.formatted,
      flagged: point.flagged,
    })),
    note: null,
    size,
  }
}

/** 人口タブ 1 枚分の Panel[]（重ねチャート → 増減率ミニ表）。選択半径で再計算（再フェッチ不要）。 */
export function populationPanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  return [populationTrendPanel(detail, radiusM, size), populationGrowthTable(detail, radiusM, size)]
}

/** 乗降タブ 1 枚分の Panel[]（駅カード → 推移チャート）。UI/AI が同一配列を描画する。 */
export function passengerPanels(detail: StationDetail, size: PanelSize = 'full'): Panel[] {
  return [stationCardPanel(detail, size), paxTrendPanel(detail, size)]
}
