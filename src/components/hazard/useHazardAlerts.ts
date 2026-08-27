'use client'

/**
 * 「いま、その地域に何が出ているか」を取る（`docs/260824_flood.md` §7.4・§8.4）。
 *
 * 共通API `/api/hazard/alerts` をそのまま叩く。**AI ツール `getHazardAlerts` と同じ答え**が
 * 返るので、バナーとチャットで言うことが食い違わない（`.claude/CLAUDE.md` §2）。
 *
 * ## どこの「今」を見るか
 *
 * 測位しているなら**現在地**、していないなら**地図の中心**。地図の中心を使うのは、
 * **何も操作していない人にもバナーを出す**ため——災害時にアプリを開いたとき、
 * 位置情報を許可しないと何も出ない、では役に立たない。
 *
 * ## 取りに行く間隔は状況で変える
 *
 * 何も出ていないときに 1 分ごとに叩いても、返るのは毎回「発表なし」である。
 * 発表があるときだけ細かく追い、平時は 5 分に落とす（気象庁の配信は `max-age=60`）。
 * オフラインでは**取りに行かない**——古い発表を「今」として出さないため。
 */

import useSWR from 'swr'
import { hazardAlertsResponseSchema, type HazardAlertsResponse } from '@/shared/api'
import { useGeoStore } from '@/stores/geoStore'
import { useMapStore } from '@/stores/mapStore'
import { isWarningMode } from '@/domain/hazard/warning-mode'

/** 問い合わせに使う座標の丸め（小数 3 桁 ≒ 110m）。現在地の揺れを畳む。 */
const COORD_DECIMALS = 3
const FETCH_TIMEOUT_MS = 8_000
/** 発表があるときの取り直し間隔。 */
const REFRESH_ACTIVE_MS = 60_000
/** 平時の取り直し間隔。 */
const REFRESH_CALM_MS = 5 * 60 * 1000

/** バナーが対象にしている地点（`null`＝まだ分からない）。 */
export type AlertTarget = {
  readonly lon: number
  readonly lat: number
  /** 現在地を見ているか（バナーの主語を変える）。 */
  readonly isCurrentPosition: boolean
}

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS))
}

/** 現在地があればそれ、無ければ地図の中心。 */
export function useAlertTarget(): AlertTarget | null {
  const position = useGeoStore((state) => state.position)
  const center = useMapStore((state) => state.center)
  if (position !== null)
    return { lon: position.lon, lat: position.lat, isCurrentPosition: true }
  return center === null ? null : { ...center, isCurrentPosition: false }
}

async function fetchAlerts([, lon, lat]: readonly [string, number, number]): Promise<
  HazardAlertsResponse
> {
  const query = new URLSearchParams({ lon: String(lon), lat: String(lat) })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`/api/hazard/alerts?${query.toString()}`, {
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`いまの発表を取得できません（${response.status}）`)
    return hazardAlertsResponseSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export type HazardAlertState = {
  readonly alerts: HazardAlertsResponse | undefined
  readonly error: Error | undefined
}

/** その地点の「今」（`null`＝まだ問い合わせない）。 */
export function useHazardAlerts(target: AlertTarget | null): HazardAlertState {
  const key = target === null ? null : (['hazard/alerts', round(target.lon), round(target.lat)] as const)
  const { data, error } = useSWR(key, fetchAlerts, {
    refreshInterval: (latest) =>
      latest !== undefined && isWarningMode(latest.alertLevel) ? REFRESH_ACTIVE_MS : REFRESH_CALM_MS,
    // 通信できないときに古い発表を「今」として出さない。
    isPaused: () => typeof navigator !== 'undefined' && !navigator.onLine,
    keepPreviousData: false,
    revalidateOnFocus: true,
  })
  return { alerts: data, error: error instanceof Error ? error : undefined }
}
