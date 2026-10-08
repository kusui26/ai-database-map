'use client'

/**
 * 場所の絞り込み（市区町村・範囲・起点から N km）の状態（2026-10-08 B2）。
 *
 * - 市区町村は都道府県を 1 つ選んだときだけ選べる（選択肢はその都道府県の駅一覧から・`useMunicipalities`）。
 *   都道府県が**変わったら**外す（別の県の市区町村が残ると 0 件になる）。初回は外さない——URL・チャットで
 *   渡された条件が、開いた瞬間に消えてしまう（おすすめ画面で決めた規則をここへ移した）
 * - 範囲・起点はチャットの図の ⤢ からだけ入る。画面では外すだけ（`AreaChips`）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Viewport } from '@/shared/viewport'
import { type NearFilter } from './filterLink'
import { type MunicipalitiesState, useMunicipalities } from './useMunicipalities'

export type AreaFilterInitial = {
  readonly municipality?: string
  readonly bbox?: Viewport | null
  readonly near?: NearFilter | null
}

export type AreaFiltersState = {
  /** 市区町村（前方一致の値・空＝絞らない）。 */
  readonly municipality: string
  readonly bbox: Viewport | null
  readonly near: NearFilter | null
  /** ちょうど 1 つ選んでいる都道府県（市区町村を選べるのはこのときだけ）。 */
  readonly singlePrefecture: string | null
  readonly municipalities: MunicipalitiesState
  readonly setMunicipality: (value: string) => void
  readonly clearBbox: () => void
  readonly clearNear: () => void
}

/** `open` が false の間は市区町村の選択肢を取りに行かない。 */
export function useAreaFilters(
  open: boolean,
  prefectures: readonly string[],
  initial?: AreaFilterInitial,
): AreaFiltersState {
  const [municipality, setMunicipality] = useState<string>(initial?.municipality ?? '')
  const [bbox, setBbox] = useState<Viewport | null>(initial?.bbox ?? null)
  const [near, setNear] = useState<NearFilter | null>(initial?.near ?? null)
  const single = prefectures.length === 1 ? (prefectures[0] ?? null) : null
  const municipalities = useMunicipalities(open ? single : null)

  const lastSingle = useRef(single)
  useEffect(() => {
    if (lastSingle.current === single) return
    lastSingle.current = single
    setMunicipality('')
  }, [single])

  const clearBbox = useCallback(() => setBbox(null), [])
  const clearNear = useCallback(() => setNear(null), [])
  return {
    municipality,
    bbox,
    near,
    singlePrefecture: single,
    municipalities,
    setMunicipality,
    clearBbox,
    clearNear,
  }
}
