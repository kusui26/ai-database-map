/**
 * ドメイン：駅詳細の系列の引き方（純関数）。駅詳細のパネル（`panels.ts`）と年齢別の人口（`age-structure.ts`）が使う。
 */

import { type MetricSeries, type StationDetail } from '@/shared/api'

/** 系列点 → チャート座標（年欠損はスキップ・値欠損は null＝ギャップ）。 */
export function toXY(series: MetricSeries | undefined): { x: number; y: number | null }[] {
  return (series?.points ?? []).flatMap((point) =>
    point.year === null ? [] : [{ x: point.year, y: point.value }],
  )
}

/** 半径・ビンテージ指定で系列を1本引く。 */
export function seriesAt(
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
