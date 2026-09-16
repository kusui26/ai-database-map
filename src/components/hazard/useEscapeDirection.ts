'use client'

/**
 * 脱出方向を取る（`docs/260824_flood.md` §8.6・§8.3）。
 *
 * 共通API `/api/hazard/escape` をそのまま叩く。**AI ツール `findEscapeDirection` と
 * 同じ答え**が返るので、バナーから見た向きとチャットの答えが食い違わない。
 *
 * **避難先を開いたときに一緒に取る。** 「どこへ行くか」と「どちらへ動けば区域を出られるか」は
 * 同じ場面で要る問いなので、押す回数を増やさない。
 *
 * ## オンラインは共通API、オフラインは**同じ関数**をブラウザで走らせる
 *
 * `useHazardPoint` と同じ形にしてある。脱出方向は**配布済みの 250m メッシュだけで計算できる**
 * ——Service Worker が現在地のまわり 9 枚を落としてあるので、通信が切れても答えが出る。
 * **発災時にいちばん落ちるのが通信**（§11 リスク 4）なのだから、ここは落ちてはいけない。
 *
 * 違うのは「公式タイルとの照合ができない」ことだけで、その差は応答の `notesJa` に出る。
 */

import useSWR from 'swr'
import { hazardEscapeResponseSchema, type HazardEscapeResponse } from '@/shared/api'
import type { EvacuationDisasterKey } from '@/shared/evacuation'
import { escapeDirectionAt } from '@/lib/hazard/escape-source'
import { fetchJson } from '@/lib/fetch-json'
import { shouldFallBackOffline } from './fallback'

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

/** 端末の中だけで答える（**通信をしない**）。ドメイン関数はサーバと同じものを通る。 */
function offlineEscape(target: EscapeTarget): Promise<HazardEscapeResponse> {
  return escapeDirectionAt({
    lon: target.lon,
    lat: target.lat,
    placeJa: target.placeJa,
    disaster: target.disaster,
    online: false,
  })
}

async function fetchEscape(
  lon: number,
  lat: number,
  placeJa: string,
  disaster: string,
): Promise<HazardEscapeResponse> {
  const query = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    placeJa,
    for: disaster,
  })
  return fetchJson(`/api/hazard/escape?${query.toString()}`, hazardEscapeResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '脱出方向を取得できませんでした',
  })
}

/**
 * オンラインなら共通API、落ちたらブラウザで同じ関数を走らせる。
 * **沈黙させない**のが目的で、通信が途中で切れても「メッシュだけの答え」に静かに切り替わる。
 */
async function loadEscape([, lon, lat, placeJa, disaster]: readonly [
  string,
  number,
  number,
  string,
  EvacuationDisasterKey,
]): Promise<HazardEscapeResponse> {
  const target = { lon, lat, placeJa, disaster }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return offlineEscape(target)
  try {
    return await fetchEscape(lon, lat, placeJa, disaster)
  } catch (error) {
    // 地点のハザードと同じ理由（`shouldFallBackOffline`）。
    if (!shouldFallBackOffline(error)) throw error
    console.error('共通API から脱出方向を取れませんでした。メッシュだけで組み立てます', error)
    return offlineEscape(target)
  }
}

export type EscapeState = {
  readonly escape: HazardEscapeResponse | undefined
  readonly isLoading: boolean
  /** 4xx のときだけ出る（それ以外はメッシュだけの答えに切り替わるので `undefined`）。 */
  readonly error: Error | undefined
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
  const { data, error, isLoading } = useSWR(key, loadEscape, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
  return { escape: data, isLoading, error: error instanceof Error ? error : undefined }
}
