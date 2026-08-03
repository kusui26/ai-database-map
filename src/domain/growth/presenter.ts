/**
 * ドメイン：散布図（増減率×増減率など）の組立（純関数）。
 * scatter_points の行（駅 1 行）→ 決定的 k-means → GrowthResponse。
 * excludeLowN 指定時は x/y の信頼性フラグ（lown）が立つ駅を除外する。
 *
 * 260804：pivot は SQL 側へ移した（DB 5,272ms→1,345ms・JSON 2,978KB→658KB）。
 * ここは「除外して数える」ことに専念する。
 */

import { requireEntry } from '@/shared/catalog'
import { type GrowthResponse } from '@/shared/api'
import { kmeans } from './kmeans'

/** scatter_points RPC の 1 行（駅ごとに x・y と、それぞれの信頼性フラグ）。 */
export type ScatterRow = {
  readonly grp: string
  readonly stationName: string
  readonly x: number
  readonly y: number
  /** x の信頼性フラグの値（無い指標・値が無い駅は null）。 */
  readonly xFlag: number | null
  readonly yFlag: number | null
}

export type GrowthOptions = {
  readonly excludeLowN?: boolean
  readonly prefectures?: readonly string[]
  /** 運営会社の絞り込み（絞り込み自体は DB 側・ここは応答へ載せて表示に使う・260730）。 */
  readonly operators?: readonly string[]
  /** 路線の絞り込み（同上・260731）。 */
  readonly routes?: readonly string[]
  /** 事業者種別の絞り込み（1:新幹線 …・同上・260731）。 */
  readonly routeTypes?: readonly number[]
}

export function buildGrowth(
  rows: readonly ScatterRow[],
  xKey: string,
  yKey: string,
  options: GrowthOptions = {},
): GrowthResponse {
  const xEntry = requireEntry(xKey)
  const yEntry = requireEntry(yKey)

  // x・y が揃った駅だけが届く（DB 側で間引き済み）。ここでは信頼性フラグの除外だけを行う。
  const kept: { grp: string; name: string; x: number; y: number }[] = []
  let excludedLowN = 0
  for (const row of rows) {
    if (options.excludeLowN === true && (row.xFlag === 1 || row.yFlag === 1)) {
      excludedLowN += 1
      continue
    }
    kept.push({ grp: row.grp, name: row.stationName, x: row.x, y: row.y })
  }

  const clusters = kmeans(kept.map((p) => ({ x: p.x, y: p.y })))
  const points = kept.map((p, i) => ({ ...p, cluster: clusters[i] ?? 0 }))

  return {
    x: { key: xEntry.key, labelJa: xEntry.labelJa, unit: xEntry.unit },
    y: { key: yEntry.key, labelJa: yEntry.labelJa, unit: yEntry.unit },
    prefectures: [...(options.prefectures ?? [])],
    operators: [...(options.operators ?? [])],
    routes: [...(options.routes ?? [])],
    routeTypes: [...(options.routeTypes ?? [])],
    clusterCount: new Set(clusters).size,
    excludedLowN,
    points,
  }
}
