'use client'

/**
 * 市区町村の選択（都道府県を 1 つ選んだときだけ・2026-09 おすすめ → 2026-10-08 B2 で共通の絞り込みへ）。
 *
 * 選択肢は駅一覧に実在する市区町村だけ（`municipalities.ts`）。自由入力にすると、綴りが 1 文字違うだけで 0 件になり、
 * 理由が画面から分からない。政令市は「市全体（区をまとめる）」も選べる（前方一致で全区を束ねる）。
 *
 * 都道府県を 1 つ選ぶまでは、選べないセレクタを小さく置く（理由はホバー）。以前のおすすめ画面の説明文
 * （「都道府県を 1 つ選ぶと…」）は、ランキング・散布の絞り込みの行では幅を食い、1024px のモーダルで「詳しい条件」が
 * 2 行目に落ちた。チャットから来た市区町村（都道府県が 2 つ以上）は外せるチップが出すので、ここでは出さない。
 */

import { cn } from '@/lib/utils'
import { METRIC_SELECT_CLASS } from './MetricSelect'
import { type MunicipalitiesState } from './useMunicipalities'

/** 選べない理由（ホバーと読み上げ）。 */
const NEEDS_PREFECTURE_JA = '都道府県を 1 つ選ぶと市区町村を選べます'

export function MunicipalitySelect({
  value,
  prefecture,
  state,
  onChange,
}: {
  value: string
  prefecture: string | null
  state: MunicipalitiesState
  onChange: (value: string) => void
}) {
  if (prefecture === null) {
    if (value !== '') return null
    return (
      <select
        className={cn(METRIC_SELECT_CLASS, 'cursor-not-allowed bg-slate-50 text-slate-400')}
        aria-label="市区町村"
        title={NEEDS_PREFECTURE_JA}
        disabled
      >
        <option value="">市区町村</option>
      </select>
    )
  }
  // 選択肢に無い値（手で書き換えた URL など）も出す——「全域」と見せたまま絞り込みが効く、を作らない。
  const unknown =
    value !== '' && !state.isLoading && !state.options.some((option) => option.value === value)
  return (
    <select
      // 狭い画面では折り返して 1 行を占める（詰めると「横…」まで縮んで選べなくなる）。
      className={cn(METRIC_SELECT_CLASS, 'w-full min-w-40 sm:w-auto sm:max-w-64 sm:flex-1')}
      aria-label="市区町村"
      value={value}
      disabled={state.isLoading}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{state.isLoading ? '読み込み中…' : `${prefecture}（全域）`}</option>
      {unknown && (
        <option value={value}>{state.error === undefined ? `${value}（駅なし）` : value}</option>
      )}
      <optgroup label="市全体（区をまとめる）">
        {state.options
          .filter((option) => option.kind === 'city')
          .map((option) => (
            <option key={`city:${option.value}`} value={option.value}>
              {option.labelJa}・{option.stationCount} 駅
            </option>
          ))}
      </optgroup>
      <optgroup label="市区町村">
        {state.options
          .filter((option) => option.kind === 'municipality')
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.labelJa}・{option.stationCount} 駅
            </option>
          ))}
      </optgroup>
    </select>
  )
}
