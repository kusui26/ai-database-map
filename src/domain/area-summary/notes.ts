/**
 * ドメイン：エリア要約の注記・見ていないこと・出典（純関数・2026-10-10 B5b）。
 *
 * 注記は応答に必ず載せる（画面にも AI にも出す）：区域の値と駅の分布の違い、年のずれ、推計は確定した未来ではないこと。
 * 「見ていないこと」は B4 のプロフィールと同じく並べて出す（§9.2 原則 5）。
 */

import { type AreaSummary } from '@/shared/area-summary'
import { radiusLabel } from '@/shared/constants'
import { sourcesForKeys } from '@/domain/sources'

/** 区域の値と駅の値の違い（どの要約にも付ける）。 */
export const AREA_TOTALS_NOTE_JA =
  '区域の値は、市区町村・都道府県は公表値（国勢調査・経済センサス）、沿線はメッシュを面積で按分した値。駅の値を足したものではない（駅の円は重なる）。'

/** 推計の読み方。 */
export const PROJECTION_NOTE_JA =
  '将来推計人口は 2020 年が起点の推計（2050 年までは国立社会保障・人口問題研究所の地域別推計と同じ値、その先は国土交通省の延長）で、確定した未来ではない。'

/** 年のずれ（市区町村だけ 2025 年がある）。 */
export const YEAR_GAP_NOTE_JA =
  '人口の実績は、市区町村・都道府県は 2025 年の国勢調査まで、沿線と駅の周りは 2020 年まで（2025 年のメッシュは未公表）。'

/** このデータが見ていないこと。 */
export const AREA_NOT_INCLUDED_JA: readonly string[] = [
  '増えた・減った理由（再開発・転入・住宅の供給など）',
  '地価・所得・売上のエリア全体の値（駅があれば、駅の周りの分布で見られる）',
  '年齢構成・世帯の形',
  '通勤・通学の流れ（どこから来てどこへ行くか）',
  '町丁目より細かい場所の違い',
]

/** 駅の分布の読み方（集計した半径つき）。 */
export function stationsNote(radiusM: number): string {
  return `駅の周りの値（中央値・四分位・上位と下位）は、エリアの駅ごとの ${radiusLabel(radiusM)} の円の値で、エリア全体の値ではない。⚠ の値（母数が小さいなど）は除いて数えた。`
}

/** 要約全体の注記（ある種類のエリアのときだけ付くものもある）。 */
export function notesFor(summaries: readonly AreaSummary[], radiusM: number): string[] {
  const hasTotals = summaries.some((summary) => summary.totals.length > 0)
  const hasFuture = summaries.some((summary) =>
    summary.totals.some((total) => total.id === 'populationFuture'),
  )
  const hasStations = summaries.some((summary) => summary.stations.stats.length > 0)
  return [
    hasTotals ? AREA_TOTALS_NOTE_JA : null,
    hasFuture ? PROJECTION_NOTE_JA : null,
    hasTotals ? YEAR_GAP_NOTE_JA : null,
    hasStations ? stationsNote(radiusM) : null,
  ].filter((note): note is string => note !== null)
}

/** 出典（区域の値の出典と、駅の指標の出典を (出典, 利用条件) で束ねる・初出順）。 */
export function sourcesFor(
  summaries: readonly AreaSummary[],
  areaSources: readonly { readonly source: string; readonly license: string }[],
): { source: string; license: string }[] {
  const stationKeys = summaries.flatMap((summary) => summary.stations.stats.map((stat) => stat.key))
  const all = [...areaSources, ...sourcesForKeys(stationKeys)]
  const unique = new Map(all.map((item) => [`${item.source}\u0000${item.license}`, { ...item }]))
  return [...unique.values()]
}
