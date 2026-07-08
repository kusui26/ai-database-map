/**
 * ドメイン：StationDetail → GUI Chat Protocol の Panel（純関数）。
 *
 * クリック（P5 の詳細パネル）と会話（Step2 のチャット）は、この同一の Panel[] を消費する
 * （.claude/CLAUDE.md §2「API こそがプロダクト」）。UI にメトリクスの意味づけを埋めない。
 * ここでは乗降（passenger）タブを実装する（人口・地価… は P5b/P5c）。
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
import { CATEGORY_COLORS } from '@/shared/constants'
import { formatWithUnit } from '@/shared/format'
import { baseMetricLabel } from '@/domain/metrics'

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
  const points = (pax?.points ?? []).flatMap((point) =>
    point.year === null ? [] : [{ x: point.year, y: point.value }],
  )
  return {
    type: 'trendChart',
    title: '乗降客数の推移',
    unit: pax?.unit ?? '人/日',
    format: pax?.format ?? 'int',
    category: 'passenger',
    flags: [],
    series: [{ label: baseMetricLabel('pax'), points, color: CATEGORY_COLORS.passenger }],
    stats: paxRateStats(rate),
    size,
  }
}

/** 乗降タブ 1 枚分の Panel[]（駅カード → 推移チャート）。UI/AI が同一配列を描画する。 */
export function passengerPanels(detail: StationDetail, size: PanelSize = 'full'): Panel[] {
  return [stationCardPanel(detail, size), paxTrendPanel(detail, size)]
}
