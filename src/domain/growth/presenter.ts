/**
 * ドメイン：散布図（増減率×増減率など）の組立（純関数）。
 * values_for_columns の生行を grp で pivot → (x,y) 点 → 決定的 k-means → GrowthResponse。
 * excludeLowN 指定時は x/y の信頼性フラグ（lown）が立つ駅を除外する。
 */

import { requireEntry } from '@/shared/catalog'
import { type GrowthResponse } from '@/shared/api'
import { kmeans } from './kmeans'

/** values_for_columns RPC の1行（key ごとに縦持ち）。 */
export type ValueRow = {
  readonly grp: string
  readonly stationName: string
  readonly key: string
  readonly value: number
}

export type GrowthOptions = {
  readonly excludeLowN?: boolean
  readonly prefectures?: readonly string[]
}

export function buildGrowth(
  rows: readonly ValueRow[],
  xKey: string,
  yKey: string,
  options: GrowthOptions = {},
): GrowthResponse {
  const xEntry = requireEntry(xKey)
  const yEntry = requireEntry(yKey)
  const xFlag = xEntry.reliabilityFlagKey
  const yFlag = yEntry.reliabilityFlagKey

  // grp で pivot
  const byGrp = new Map<string, { name: string; values: Map<string, number> }>()
  for (const row of rows) {
    const bucket = byGrp.get(row.grp) ?? {
      name: row.stationName,
      values: new Map<string, number>(),
    }
    bucket.values.set(row.key, row.value)
    byGrp.set(row.grp, bucket)
  }

  const kept: { grp: string; name: string; x: number; y: number }[] = []
  let excludedLowN = 0
  for (const [grp, { name, values }] of byGrp) {
    const x = values.get(xKey)
    const y = values.get(yKey)
    if (x === undefined || y === undefined) continue
    if (options.excludeLowN === true) {
      const flagged =
        (xFlag !== null && values.get(xFlag) === 1) || (yFlag !== null && values.get(yFlag) === 1)
      if (flagged) {
        excludedLowN += 1
        continue
      }
    }
    kept.push({ grp, name, x, y })
  }

  const clusters = kmeans(kept.map((p) => ({ x: p.x, y: p.y })))
  const points = kept.map((p, i) => ({ ...p, cluster: clusters[i] ?? 0 }))

  return {
    x: { key: xEntry.key, labelJa: xEntry.labelJa, unit: xEntry.unit },
    y: { key: yEntry.key, labelJa: yEntry.labelJa, unit: yEntry.unit },
    prefectures: [...(options.prefectures ?? [])],
    clusterCount: new Set(clusters).size,
    excludedLowN,
    points,
  }
}
