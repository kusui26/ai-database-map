/**
 * ドメイン：ランキング整形（純関数）。
 * rank_by_column RPC の生行を、カタログの format/label で整形した RankingResponse にする。
 */

import { requireEntry } from '@/shared/catalog'
import { type Order, type RankingResponse } from '@/shared/api'
import { formatNumber } from '@/shared/format'

/** rank_by_column RPC の1行（生）。 */
export type RankRawRow = {
  readonly grp: string
  readonly stationName: string
  readonly prefecture: string
  readonly value: number
  readonly flagValue: number | null
  readonly rank: number
}

export function buildRanking(
  metricKey: string,
  prefectures: readonly string[],
  order: Order,
  rows: readonly RankRawRow[],
  total: number,
  offset: number,
): RankingResponse {
  const entry = requireEntry(metricKey)
  const signed = entry.kind === 'growth' || entry.kind === 'error'
  return {
    metric: { key: entry.key, labelJa: entry.labelJa, unit: entry.unit },
    prefectures: [...prefectures],
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
