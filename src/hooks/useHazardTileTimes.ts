'use client'

/**
 * 表示中のキキクルに、いまの配信時刻を差し込んだ URL を返す（`docs/260824_flood.md` §7.4）。
 *
 * キキクルを 1 枚も出していないときは**何も取りに行かない**（SWR のキーが null）。
 * 出している間だけ 5 分ごとに取り直す——面は 10 分ごとに更新されるので、
 * これで「1 世代前の面をずっと見ている」ことは起きない。
 */

import { useMemo } from 'react'
import useSWR from 'swr'
import {
  needsTileTime,
  resolveHazardTile,
  tileTimeLabelJa,
  tileTimesUrlOf,
  type HazardTileTime,
} from '@/domain/hazard/tile-time'
import { hazardTileTimes } from '@/lib/hazard/tile-times'

/** 取り直す間隔。面の更新（10 分）より短くし、遅れても半周期で追いつくようにする。 */
const REFRESH_MS = 5 * 60 * 1000

export type HazardTileTimeState = {
  /** レイヤ key → 時刻を差し込んだタイル URL（解決できたものだけ）。 */
  readonly urls: ReadonlyMap<string, string>
  /** 面の時刻（「8月27日 10:10 現在」）。まだ解決していなければ null。 */
  readonly labelJa: string | null
}

const EMPTY: HazardTileTimeState = { urls: new Map(), labelJa: null }

/** 表示中レイヤのうち、時刻を差し込むもの（＝キキクル）の取得先。1 つに畳む。 */
function timesUrlFor(layerKeys: readonly string[]): string | null {
  return layerKeys.map(tileTimesUrlOf).find((url) => url !== null) ?? null
}

/** 差し込み済みの URL と、代表の面の時刻（同時に出るキキクルは同じ時刻になる）。 */
function resolveAll(
  layerKeys: readonly string[],
  times: readonly HazardTileTime[],
): HazardTileTimeState {
  const resolved = layerKeys.filter(needsTileTime).flatMap((key) => {
    const tile = resolveHazardTile(key, times)
    return tile === null ? [] : [{ key, tile }]
  })
  const first = resolved[0]
  return {
    urls: new Map(resolved.map(({ key, tile }) => [key, tile.url])),
    labelJa: first === undefined ? null : tileTimeLabelJa(first.tile.basetime),
  }
}

/** 表示中レイヤ（カタログ順）→ 差し込み済みの URL と、その面の時刻。 */
export function useHazardTileTimes(layerKeys: readonly string[]): HazardTileTimeState {
  const timesUrl = timesUrlFor(layerKeys)
  const { data } = useSWR(timesUrl, hazardTileTimes, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
  // layerKeys は毎レンダ新しい配列になりうるので、内容（文字列）を依存にする。
  const joined = layerKeys.join(',')
  return useMemo(
    () => (data === undefined ? EMPTY : resolveAll(joined.split(',').filter(Boolean), data)),
    [data, joined],
  )
}
