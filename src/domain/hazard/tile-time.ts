/**
 * ドメイン：**時刻を差し込むタイル**（キキクル）の URL を組み立てる（`docs/260824_flood.md` §7.4）。
 *
 * 静的なハザードタイル（重ねるハザードマップ）は URL が固定だが、キキクルは
 * **10 分ごとに新しい面が出る**ので、`{basetime}` / `{member}` / `{validtime}` を
 * 最新時刻で埋めてからでないと 1 枚も描けない。
 *
 * ここが持つのは**選び方と埋め方だけ**（純関数）。取得は `lib/hazard/tile-times` が担う。
 *
 * ## 差し込まないまま地図に渡してはいけない
 *
 * プレースホルダ入りの URL をそのまま渡すと **404 が延々と出るだけで、画面は「真っ白」になる**。
 * 白は「危険なし」に見えるので、防災の画面ではいちばん危ない壊れ方である（§7.5-1）。
 * だから `resolveTileUrl` は埋め残しを**例外にし**、呼び出し側は解決できるまでレイヤを足さない。
 *
 * ## 時刻は UTC で来る
 *
 * `targetTimes.json` の `basetime` は **UTC の `yyyyMMddHHmmss`**（実測 2026-08-27：
 * UTC 01:24 の時点で最新が `20260827011000`）。表示は日本時間に直す。
 */

import { getHazardLayer } from '@/shared/hazard'
import { jstDateTimeJa, parseCompactUtc } from '@/shared/time'

/**
 * `targetTimes.json` の 1 件（生の形）。**未知のフィールドは無視してよい**ので、
 * ここでは読むものだけを宣言する（`level.ts` の `RawWarning` と同じ流儀）。
 */
export type HazardTileTime = {
  readonly basetime: string
  readonly validtime: string
  readonly member: string
  /** その時刻に配信されている要素（`land` / `inund` / `flood` …）。 */
  readonly elements?: readonly string[]
}

/** URL に埋め込む時刻の差し込み口。 */
const PLACEHOLDERS = ['{basetime}', '{member}', '{validtime}'] as const

/** `.../surf/<element>/{z}/{x}/{y}.png` から要素名を取り出す。 */
const ELEMENT_IN_URL = /\/surf\/([a-z_]+)\//

/** そのレイヤは時刻を差し込む必要があるか（＝キキクル）。 */
export function needsTileTime(layerKey: string): boolean {
  const url = getHazardLayer(layerKey)?.tile?.url
  return url !== undefined && PLACEHOLDERS.some((placeholder) => url.includes(placeholder))
}

/** 時刻を差し込むレイヤの取得先（`timesUrl`）。要らないレイヤは null。 */
export function tileTimesUrlOf(layerKey: string): string | null {
  return needsTileTime(layerKey) ? (getHazardLayer(layerKey)?.tile?.timesUrl ?? null) : null
}

/** そのレイヤが要求する要素名（`land` など。URL から読む）。 */
export function tileElementOf(layerKey: string): string | null {
  const matched = ELEMENT_IN_URL.exec(getHazardLayer(layerKey)?.tile?.url ?? '')
  return matched?.[1] ?? null
}

/**
 * その要素を配信している**いちばん新しい**時刻（無ければ null）。
 *
 * 気象庁のビューアと同じく先頭（最新）を採る。`targetTimes.json` はタイルが出来てから
 * 書き換わるので、最新を指しても「まだ無い面」を掴むことはない。
 * ただし**並び順は信用せず**、`basetime` で最大を選ぶ（配信側の並びに依存させない）。
 */
export function newestTileTime(
  times: readonly HazardTileTime[],
  element: string,
): HazardTileTime | null {
  return times
    .filter((time) => time.elements === undefined || time.elements.includes(element))
    .reduce<HazardTileTime | null>(
      (newest, time) => (newest === null || time.basetime > newest.basetime ? time : newest),
      null,
    )
}

/**
 * テンプレートに時刻を差し込む。**埋め残しがあれば例外**（白い地図を出さないため）。
 * `{z}/{x}/{y}` は MapLibre が埋めるので、ここでは触らない。
 */
export function resolveTileUrl(template: string, time: HazardTileTime): string {
  const url = template
    .replace('{basetime}', time.basetime)
    .replace('{member}', time.member)
    .replace('{validtime}', time.validtime)
  const left = PLACEHOLDERS.find((placeholder) => url.includes(placeholder))
  if (left !== undefined) throw new Error(`タイル URL に ${left} が残っています`)
  return url
}

/** 差し込み済みのタイル。**どの時刻の面か**を URL と一緒に持ち歩く（表示に必ず要る）。 */
export type ResolvedHazardTile = {
  readonly url: string
  /** その面の基準時刻（UTC の `yyyyMMddHHmmss`）。 */
  readonly basetime: string
}

/** レイヤと時刻の一覧 → 実際に取りに行くタイル（解決できなければ null）。 */
export function resolveHazardTile(
  layerKey: string,
  times: readonly HazardTileTime[],
): ResolvedHazardTile | null {
  const template = getHazardLayer(layerKey)?.tile?.url
  const element = tileElementOf(layerKey)
  if (template === undefined || element === null) return null
  const time = newestTileTime(times, element)
  return time === null ? null : { url: resolveTileUrl(template, time), basetime: time.basetime }
}

/**
 * 面の時刻の表示（日本時間）。**「今」と言い切らないための本体**——
 * 10 分前の面を「今」と読ませない（§7.4）。読めない値は null（推測で書かない）。
 */
export function tileTimeLabelJa(basetime: string): string | null {
  const epochMs = parseCompactUtc(basetime)
  return epochMs === null ? null : `${jstDateTimeJa(epochMs)} 現在`
}
