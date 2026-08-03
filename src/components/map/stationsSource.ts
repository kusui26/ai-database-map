'use client'

/**
 * 全駅 geojson（`/api/stations/geojson`）の取得（260803）。
 *
 * **地図の初期化と並行に走らせる**ための小さな入口。以前は `map.on('load')` の中で
 * fetch していたため、スタイルとタイルの読み込みが終わるまで**取りに行きもしなかった**
 * （実測：取得開始 本番 2,988ms／ローカル 939ms・取得自体は 136ms・その間ネットワークは空）。
 * ここを先に呼んでおき、`load` では待つだけにする（docs/260803_processing_speed.md §4-②）。
 *
 * 取得は 1 回だけ（React の再マウント・StrictMode の二重実行でも重複させない）。
 * 失敗は記憶せず、次に呼ばれたときに取り直せるようにする。
 */

import { type FeatureCollection } from 'geojson'

const ENDPOINT = '/api/stations/geojson'
/**
 * 応答が返らないまま固まるのを防ぐ上限。他のフック（10〜15 秒）より長いのは、
 * 全駅ぶん（約 1.3MB）を回線の細い環境でも取り切れるようにするため。
 */
const FETCH_TIMEOUT_MS = 30_000

let pending: Promise<FeatureCollection> | null = null

async function fetchStations(): Promise<FeatureCollection> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(ENDPOINT, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`駅データの取得に失敗しました（${ENDPOINT} → HTTP ${response.status}）`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取得を開始する（すでに開始していれば同じ Promise を返す）。
 * 早く呼ぶほど早く始まる。地図の生成前に呼び、`load` で `await` する。
 */
export function loadStations(): Promise<FeatureCollection> {
  if (pending === null) {
    pending = fetchStations()
    // まだ誰も await していない段階での unhandledrejection を防ぐ。
    // あわせて失敗を忘れ、次のマウントで取り直せるようにする。
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}
