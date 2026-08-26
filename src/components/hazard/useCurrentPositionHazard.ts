'use client'

/**
 * 現在地の災害リスクを取る（`docs/260824_flood.md` §8.3）。
 *
 * ## オンラインは共通API、オフラインは**同じドメイン関数**をブラウザで走らせる
 *
 * 原則は「UI から直接ドメインを叩かない」（`.claude/CLAUDE.md` §2）だが、
 * **オフラインだけは例外にせざるを得ない**——通信できないのだから API は呼べない。
 * そこで、**再実装ではなく `pointHazard` そのもの**をブラウザで動かす。
 * こうすれば機内モードとオンラインで違うことを言うアプリにはならない。
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
import type { CurrentPosition } from '@/stores/geoStore'

/** 現在地の呼び名（応答の `placeJa` と `hazardCard` の見出しに出る）。 */
export const CURRENT_PLACE_JA = '現在地'
/** 問い合わせに使う座標の丸め（小数 4 桁 ≒ 11m）。 */
const COORD_DECIMALS = 4
const FETCH_TIMEOUT_MS = 12_000
/** 同じ場所への連続要求を畳む間隔。 */
const DEDUPE_MS = 30_000

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

/** オフラインの答え。**メッシュだけ**なので `online: false`＝確からしさは `unknown` になる。 */
async function offlineHazard(lon: number, lat: number): Promise<HazardPointResponse> {
  const mesh = await meshReadings(lon, lat)
  return pointHazard(
    {
      lon,
      lat,
      placeJa: CURRENT_PLACE_JA,
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

async function fetchPoint(lon: number, lat: number): Promise<HazardPointResponse> {
  const query = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    placeJa: CURRENT_PLACE_JA,
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
async function loadHazard([, lon, lat]: readonly [
  string,
  number,
  number,
]): Promise<HazardPointResponse> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return offlineHazard(lon, lat)
  try {
    return await fetchPoint(lon, lat)
  } catch (error) {
    console.error('共通API から地点のハザードを取れませんでした。メッシュだけで組み立てます', error)
    return offlineHazard(lon, lat)
  }
}

export type CurrentPositionHazard = {
  readonly point: HazardPointResponse | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** 現在地（null＝未測位）から災害リスクを取る。 */
export function useCurrentPositionHazard(position: CurrentPosition | null): CurrentPositionHazard {
  const key =
    position === null ? null : (['hazard/point', round(position.lon), round(position.lat)] as const)
  const { data, error, isLoading } = useSWR(key, loadHazard, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: DEDUPE_MS,
  })
  return { point: data, isLoading, error: error instanceof Error ? error : undefined }
}
