'use client'

/**
 * 避難先を取る（`docs/260824_flood.md` §8.5）。
 *
 * 共通API `/api/hazard/evacuation` をそのまま叩く。**AI ツール `findEvacuationSites` と
 * 同じ答え**が返るので、バナーから開いた一覧とチャットの答えが食い違わない
 * （`.claude/CLAUDE.md` §2）。
 *
 * **押されるまで問い合わせない。** 警戒中に全員ぶん先読みすると、
 * 国土地理院のタイルを無駄に叩くだけで、しかも見られないまま終わることが多い。
 */

import useSWR from 'swr'
import { hazardEvacuationResponseSchema, type HazardEvacuationResponse } from '@/shared/api'
import type { EvacuationDisasterKey } from '@/shared/evacuation'

/** 問い合わせに使う座標の丸め（小数 3 桁 ≒ 110m）。現在地の揺れを畳む。 */
const COORD_DECIMALS = 3
const FETCH_TIMEOUT_MS = 12_000

export type EvacuationTarget = {
  readonly lon: number
  readonly lat: number
  readonly placeJa: string
  readonly disaster: EvacuationDisasterKey
}

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

async function fetchSites([, lon, lat, placeJa, disaster]: readonly [
  string,
  number,
  number,
  string,
  string,
]): Promise<HazardEvacuationResponse> {
  const query = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    placeJa,
    for: disaster,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`/api/hazard/evacuation?${query.toString()}`, {
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`避難場所を取得できません（${response.status}）`)
    return hazardEvacuationResponseSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export type EvacuationState = {
  readonly evacuation: HazardEvacuationResponse | undefined
  readonly isLoading: boolean
  readonly error: Error | undefined
}

/** 避難先（`null`＝まだ探さない）。 */
export function useEvacuationSites(target: EvacuationTarget | null): EvacuationState {
  const key =
    target === null
      ? null
      : ([
          'hazard/evacuation',
          round(target.lon),
          round(target.lat),
          target.placeJa,
          target.disaster,
        ] as const)
  const { data, error, isLoading } = useSWR(key, fetchSites, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
  return { evacuation: data, isLoading, error: error instanceof Error ? error : undefined }
}
