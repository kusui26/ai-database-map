'use client'

/**
 * 脱出方向を取る（`docs/260824_flood.md` §8.6）。
 *
 * 共通API `/api/hazard/escape` をそのまま叩く。**AI ツール `findEscapeDirection` と
 * 同じ答え**が返るので、バナーから見た向きとチャットの答えが食い違わない。
 *
 * **避難先を開いたときに一緒に取る。** 「どこへ行くか」と「どちらへ動けば区域を出られるか」は
 * 同じ場面で要る問いなので、押す回数を増やさない。
 */

import useSWR from 'swr'
import { hazardEscapeResponseSchema, type HazardEscapeResponse } from '@/shared/api'
import type { EvacuationDisasterKey } from '@/shared/evacuation'

/** 問い合わせに使う座標の丸め（小数 3 桁 ≒ 110m）。現在地の揺れを畳む。 */
const COORD_DECIMALS = 3
const FETCH_TIMEOUT_MS = 12_000

export type EscapeTarget = {
  readonly lon: number
  readonly lat: number
  readonly placeJa: string
  readonly disaster: EvacuationDisasterKey
}

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

async function fetchEscape([, lon, lat, placeJa, disaster]: readonly [
  string,
  number,
  number,
  string,
  string,
]): Promise<HazardEscapeResponse> {
  const query = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    placeJa,
    for: disaster,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`/api/hazard/escape?${query.toString()}`, {
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`脱出方向を取得できません（${response.status}）`)
    return hazardEscapeResponseSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export type EscapeState = {
  readonly escape: HazardEscapeResponse | undefined
  readonly isLoading: boolean
}

/** 脱出方向（`null`＝まだ調べない）。 */
export function useEscapeDirection(target: EscapeTarget | null): EscapeState {
  const key =
    target === null
      ? null
      : ([
          'hazard/escape',
          round(target.lon),
          round(target.lat),
          target.placeJa,
          target.disaster,
        ] as const)
  const { data, isLoading } = useSWR(key, fetchEscape, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
  return { escape: data, isLoading }
}
