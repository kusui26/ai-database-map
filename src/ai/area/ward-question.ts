/**
 * 「この区」の問いか（純関数・2026-11-12・`docs/261110_fix_PLAN.md` §3.4.1）。
 *
 * 「この区」「この市」「この町」は**地図の範囲ではない**——地図の中心の駅の市区町村の全体である（地図の節の規則・
 * `system-prompt.ts` の `mapWardRule`）。プロンプトにも `inMapView` の説明にも言い切ってあるのに、関係の無い段落を
 * 書き換えるだけで、モデルが地図の範囲（`inMapView:true`）で絞る回が出た——B4（プロフィールの節を足した）・
 * B5d（道具の説明）・PR-1（おすすめの段落）の 3 回。**言葉で止めきれない取り違えは型から外す**（B5d の `near` と同じ）：
 * この判定が真の回は、モデルに見せる道具の型から `inMapView` を外す（`tools.ts`）。プロンプトと解く型は変えない。
 */

import { wardOfView, type MapView } from './map-view'

/**
 * 「この区」「この市」「この町」「この村」。後ろが助詞・句読点・「内」「全体」・文の終わりのときだけ数える——
 * 「この区間」「この市場」「この町並み」「この村上さん」は市区町村の話ではない。
 */
const WARD_DEIXIS = /この[区市町村](?=内|全体|[でのにはをがともへやかまだなっよ、。，？！?!\s]|$)/

/**
 * 地図の範囲そのものを指す言い方（「このあたり」「地図に出ている範囲」）。一緒にあれば外さない——
 * 「この区の、地図に出ている範囲で」は地図の範囲の話で、そのときは `inMapView` が正しい。
 */
const MAP_RANGE_WORDS =
  /このあたり|この辺|このへん|地図に(?:出|表示|映)|表示中|地図の範囲|画面の範囲|画面に(?:出|映)/

/** 質問が「この区」を指しているか（地図の範囲そのものを指す言い方が無いときだけ）。 */
export function asksAboutWard(question: string): boolean {
  return WARD_DEIXIS.test(question) && !MAP_RANGE_WORDS.test(question)
}

/**
 * その回、モデルに見せる道具の型から `inMapView` を外すか。地図の節が「この区」の規則を出すとき
 * （寄っていて、中心の駅の市区町村が分かる・`wardOfView`）と**同じ条件**で、質問が「この区」を指すときだけ。
 * 「このあたり」の問いには効かない（そちらは `inMapView` が正しい）。
 */
export function hidesMapViewOption(question: string, view: MapView | null): boolean {
  if (view === null || wardOfView(view) === null) return false
  return asksAboutWard(question)
}
