'use client'

/**
 * エリアの図を開いた直後のエリア（`GET /api/areas/locate`）の取得フック（SWR・2026-10-15 B5e）。
 *
 * 選択中の駅があればその駅、無ければ地図の見えている範囲を手がかりにする。決め方（駅の市区町村・寄り方に合わせた
 * 市区町村／都道府県／全国）はサーバが持つ（`src/domain/area-summary/locate.ts`）。地図がまだ範囲を報告していなければ待つ。
 */

import useSWR from 'swr'
import { areaLocateResponseSchema, type AreaLocateResponse } from '@/shared/area-summary'
import { viewportToTuple, type Viewport } from '@/shared/viewport'
import { fetchJson } from '@/lib/fetch-json'

const FETCH_TIMEOUT_MS = 10_000

function fetchLocated(url: string): Promise<AreaLocateResponse> {
  return fetchJson(url, areaLocateResponseSchema, {
    timeoutMs: FETCH_TIMEOUT_MS,
    fallbackJa: '開いた直後のエリアを決められませんでした',
  })
}

/** API の URL（駅を先に見る・どちらも無ければ null＝まだ取りに行かない）。 */
export function locateUrl(grp: string | null, viewport: Viewport | null): string | null {
  if (grp !== null) return `/api/areas/locate?${new URLSearchParams({ grp }).toString()}`
  if (viewport === null) return null
  return `/api/areas/locate?bbox=${viewportToTuple(viewport).join(',')}`
}

export type LocatedAreaState = {
  readonly located: AreaLocateResponse | undefined
  readonly error: Error | undefined
}

/** `enabled` の間だけ取得する（エリアが決まったら取りに行かない）。 */
export function useLocatedArea(
  enabled: boolean,
  grp: string | null,
  viewport: Viewport | null,
): LocatedAreaState {
  const url = enabled ? locateUrl(grp, viewport) : null
  const { data, error } = useSWR(url, fetchLocated, { revalidateOnFocus: false })
  return { located: data, error: error instanceof Error ? error : undefined }
}
