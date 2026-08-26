/**
 * 現在地の状態（Zustand）。`docs/260824_flood.md` §8.3。
 *
 * URL には載せない——**現在地は共有リンクに乗せてはいけない**（他人の居場所になる）。
 * 選択駅（`?grp`）や表示レイヤ（`?hz`）と扱いが違うのはそのため。
 *
 * `active` は「現在地を使っている最中か」で、**パネルの開閉と測位の ON/OFF を兼ねる**。
 * 別々に持つと「パネルは閉じたのに `watchPosition` が回り続けて電池を食う」が簡単に起きる。
 */

import { create } from 'zustand'

/** 測位の状態。エラーは**理由ごとに文言を変える**ので、1 つの boolean に畳まない。 */
export type GeoStatus =
  /** まだ使っていない。 */
  | 'idle'
  /** 権限を尋ねている・最初の 1 点を待っている。 */
  | 'locating'
  /** 位置が取れている。 */
  | 'watching'
  /** 権限を拒否された。**再要求はできない**ので、案内だけ出す。 */
  | 'denied'
  /** 端末が測位できない（GPS 無効・機内モードで測位不可など）。 */
  | 'unavailable'
  /** 時間内に取れなかった。 */
  | 'timeout'

/** 測った現在地。`accuracyM` は端末が申告する誤差半径（メートル）。 */
export type CurrentPosition = {
  readonly lon: number
  readonly lat: number
  readonly accuracyM: number
  /** 取得時刻（ミリ秒）。古い位置で判断していないかを UI が示すため。 */
  readonly at: number
}

type GeoStore = {
  /** 現在地を使っている最中か（測位の ON/OFF ＝ パネルの開閉）。 */
  active: boolean
  status: GeoStatus
  position: CurrentPosition | null
  errorJa: string | null
  start: () => void
  stop: () => void
  /** 測位できたときに監視側が呼ぶ。 */
  report: (position: CurrentPosition) => void
  /** 測位できなかったときに監視側が呼ぶ。 */
  fail: (status: GeoStatus, errorJa: string) => void
}

export const useGeoStore = create<GeoStore>((set) => ({
  active: false,
  status: 'idle',
  position: null,
  errorJa: null,
  start: () => set({ active: true, status: 'locating', errorJa: null }),
  // 位置も消す。**更新されない古いピンを地図に残さない**——
  // 「今ここにいる」と読める印が止まったまま残るのは、防災の画面では嘘に近い。
  // 開き直しても `maximumAge` の範囲ならすぐ返るので、体感の損はほぼ無い。
  stop: () => set({ active: false, status: 'idle', position: null }),
  report: (position) => set({ position, status: 'watching', errorJa: null }),
  fail: (status, errorJa) => set({ status, errorJa }),
}))
