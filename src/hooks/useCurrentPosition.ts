'use client'

/**
 * `watchPosition` の監視を 1 本だけ回す（`docs/260824_flood.md` §8.3）。
 *
 * **アプリ全体で 1 か所からしか呼ばない**（`MapShell`）。複数から呼ぶと監視が増え、
 * そのぶん電池を食う。結果は `geoStore` に入れ、地図もカードもそこから読む。
 *
 * 守っていること。
 * - **画面が見えている間だけ測る**（`visibilitychange`）。裏に回ったら止める＝電池対策
 * - 権限拒否・測位不能・タイムアウトを**理由ごとに**区別して文言を変える
 * - 使い終わったら必ず `clearWatch`（`active` を落とすだけで止まる）
 */

import { useEffect } from 'react'
import { useGeoStore, type GeoStatus } from '@/stores/geoStore'

/** 最初の 1 点を待つ上限。GPS は屋内だと本当に返らないことがある。 */
const TIMEOUT_MS = 15_000
/** これより新しい位置ならキャッシュを使ってよい（連続測位の電池対策）。 */
const MAX_AGE_MS = 10_000

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: TIMEOUT_MS,
  maximumAge: MAX_AGE_MS,
}

/** ブラウザのエラーコード → 状態と文言（**理由が違えば、できることも違う**）。 */
function describe(error: GeolocationPositionError): { status: GeoStatus; messageJa: string } {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      status: 'denied',
      messageJa:
        '位置情報の利用が許可されていません。ブラウザの設定でこのサイトの位置情報を許可すると、現在地の災害リスクを表示できます。',
    }
  }
  if (error.code === error.TIMEOUT) {
    return {
      status: 'timeout',
      messageJa:
        '現在地を取得できませんでした（時間切れ）。屋外や窓ぎわで、もう一度お試しください。',
    }
  }
  return {
    status: 'unavailable',
    messageJa: '現在地を取得できませんでした。端末の位置情報サービスをご確認ください。',
  }
}

/** 現在地の監視（`geoStore.active` に追随）。戻り値は無く、結果はストアに入る。 */
export function useCurrentPosition(): void {
  const active = useGeoStore((state) => state.active)
  const report = useGeoStore((state) => state.report)
  const fail = useGeoStore((state) => state.fail)

  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      fail('unavailable', 'このブラウザは位置情報に対応していません。')
      return
    }
    let watchId: number | null = null
    const stop = (): void => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    const start = (): void => {
      if (watchId !== null) return
      watchId = navigator.geolocation.watchPosition(
        ({ coords, timestamp }) =>
          report({
            lon: coords.longitude,
            lat: coords.latitude,
            accuracyM: coords.accuracy,
            at: timestamp,
          }),
        (error) => {
          const { status, messageJa } = describe(error)
          fail(status, messageJa)
        },
        OPTIONS,
      )
    }
    // 画面が見えている間だけ測る（裏に回ったら止める＝電池対策）。
    const onVisibility = (): void => (document.hidden ? stop() : start())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [active, report, fail])
}
