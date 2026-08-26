'use client'

/**
 * 地点の災害リスクを取る（`docs/260824_flood.md` §8.3・§7.2）。
 * 現在地カードと駅バッジが**同じフックを通る**——両方で言うことが変わらないように。
 *
 * ## オンラインは共通API、オフラインは**同じドメイン関数**をブラウザで走らせる
 *
 * 原則は「UI から直接ドメインを叩かない」（`.claude/CLAUDE.md` §2）だが、
 * **オフラインだけは例外にせざるを得ない**——通信できないのだから API は呼べない。
 * そこで、**再実装ではなく `pointHazard` そのもの**をブラウザで動かす。
 * 違うのは入力（浸水ナビと公式タイルが無い）だけで、その差は `certainty: 'unknown'` に出る。
 *
 * ## 位置は丸めてから問い合わせる
 *
 * `watchPosition` は静止していても数メートル揺れ続ける。座標をそのまま鍵にすると
 * 揺れるたびに取得が走るので、**小数 4 桁（約 11m）に丸める**。
 * GPS の誤差（5〜50m）より細かいので、答えは変わらない。
 */

import useSWR from 'swr'
import { hazardPointResponseSchema, type HazardPointResponse } from '@/shared/api'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { pointHazard } from '@/domain/hazard/point'
import { meshReadings } from '@/lib/hazard/readings'

/** 問い合わせに使う座標の丸め（小数 4 桁 ≒ 11m）。 */
const COORD_DECIMALS = 4
const FETCH_TIMEOUT_MS = 12_000
/** 同じ場所への連続要求を畳む間隔。 */
const DEDUPE_MS = 30_000

/** 調べたい地点（`null`＝まだ調べない）。 */
export type HazardTarget = {
  readonly lon: number
  readonly lat: number
  readonly placeJa: string
}

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

/** オフラインの答え。**メッシュだけ**なので `online: false`＝確からしさは `unknown` になる。 */
async function offlineHazard(target: HazardTarget): Promise<HazardPointResponse> {
  const mesh = await meshReadings(target.lon, target.lat)
  return pointHazard(
    {
      lon: target.lon,
      lat: target.lat,
      placeJa: target.placeJa,
      mesh: mesh.mesh,
      tile: [],
      rivers: [],
      elevationM: mesh.elevationM,
      online: false,
      notesJa: [
        ...(mesh.noteJa === null ? [] : [mesh.noteJa]),
        'オフラインのため、端末に保存した 250m メッシュだけで判断しています。',
      ],
    },
    hazardLayersWithPointAnswer(),
  )
}

async function fetchPoint(target: HazardTarget): Promise<HazardPointResponse> {
  const query = new URLSearchParams({
    lon: String(target.lon),
    lat: String(target.lat),
    placeJa: target.placeJa,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`/api/hazard/point?${query.toString()}`, {
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`地点のハザードを取得できません（${response.status}）`)
    return hazardPointResponseSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * オンラインなら共通API、落ちたらオフライン経路。**沈黙させない**のが目的で、
 * 通信が途中で切れても「メッシュだけの答え」に静かに切り替わる（§6.3）。
 */
async function loadHazard([, lon, lat, placeJa]: readonly [
  string,
  number,
  number,
  string,
]): Promise<HazardPointResponse> {
  const target = { lon, lat, placeJa }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return offlineHazard(target)
  try {
    return await fetchPoint(target)
  } catch (error) {
    console.error('共通API から地点のハザードを取れませんでした。メッシュだけで組み立てます', error)
    return offlineHazard(target)
  }
}

export type HazardPointState = {
  readonly point: HazardPointResponse | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** 地点（`null`＝未指定）から災害リスクを取る。 */
export function useHazardPoint(target: HazardTarget | null): HazardPointState {
  const key =
    target === null
      ? null
      : (['hazard/point', round(target.lon), round(target.lat), target.placeJa] as const)
  const { data, error, isLoading } = useSWR(key, loadHazard, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: DEDUPE_MS,
  })
  return { point: data, isLoading, error: error instanceof Error ? error : undefined }
}
