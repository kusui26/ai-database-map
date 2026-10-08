/**
 * ドメイン：ランキング整形（純関数）。
 * rank_by_column RPC の生行を、カタログの format/label で整形した RankingResponse にする。
 */

import { requireEntry } from '@/shared/catalog'
import { type LineRef, type Order, type RankingResponse } from '@/shared/api'
import { formatNumber } from '@/shared/format'
import { displayOperators } from '@/domain/scope'

/** rank_by_column RPC の1行（生）。 */
export type RankRawRow = {
  readonly grp: string
  readonly stationName: string
  readonly prefecture: string
  readonly value: number
  readonly flagValue: number | null
  readonly rank: number
}

/** 絞り込み条件（省略時は絞らない）。散布の GrowthOptions と対になる（260801）。 */
export type RankingOptions = {
  readonly operators?: readonly string[]
  /** 会社の表示名（`operators` と同じ順・261008 L4）。無ければ会社名のまま。 */
  readonly operatorLabels?: readonly string[]
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
  /** 路線（運行系統・名前つき・261008 L2）。絞り込みは DB 側、ここは応答へ載せて題に使う。 */
  readonly lines?: readonly LineRef[]
}

export function buildRanking(
  metricKey: string,
  prefectures: readonly string[],
  order: Order,
  rows: readonly RankRawRow[],
  total: number,
  offset: number,
  options: RankingOptions = {},
): RankingResponse {
  const entry = requireEntry(metricKey)
  const signed = entry.kind === 'growth' || entry.kind === 'error'
  return {
    metric: { key: entry.key, labelJa: entry.labelJa, unit: entry.unit },
    prefectures: [...prefectures],
    operators: [...(options.operators ?? [])],
    operatorLabels: displayOperators(options.operators ?? [], options.operatorLabels),
    routes: [...(options.routes ?? [])],
    routeTypes: [...(options.routeTypes ?? [])],
    lines: [...(options.lines ?? [])],
    order,
    offset,
    total,
    rows: rows.map((row) => ({
      rank: row.rank,
      grp: row.grp,
      name: row.stationName,
      prefecture: row.prefecture,
      value: row.value,
      formatted: formatNumber(row.value, entry.format, { signed }),
      flagged: row.flagValue === 1,
    })),
  }
}
