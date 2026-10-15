/**
 * ドメイン：エリアの図を開いた直後のエリアを決める（純関数・2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * - 選択中の駅 → その駅の市区町村（政令市は区・東京 23 区は区）
 * - 地図の見えている範囲 → 中心に最も近い駅で決める（広さの規則は B3 の「このあたり」と同じ・`domain/map/view-scale.ts`）
 *   - 区や市が画面の主役になる寄り方（縦横の長い方が 50km 以下）→ その駅の市区町村
 *   - 「このあたり」と言える広さ → その駅の都道府県（首都圏の初期表示〔約 180km〕で千代田区を選ばない）
 *   - それより広い（日本全体に近い）→ 全国
 *
 * 決めた手がかりを言葉で返す——図は「なぜこのエリアか」を出す（黙って選ばない）。共通 API `GET /api/areas/locate` が呼ぶ。
 */

import { type CatalogStation } from '@/db/queries'
import { formatAreaRef } from '@/shared/area-ref'
import { PREFECTURES } from '@/shared/constants'
import { type Viewport } from '@/shared/viewport'
import { isTooWideForArea, isWardScale, nearestTo, viewCenter } from '@/domain/map/view-scale'

/** 決めるのに使う駅の列。 */
export type LocatableStation = Pick<
  CatalogStation,
  'grp' | 'label' | 'prefecture' | 'municipalityCode' | 'lon' | 'lat'
>

/** 手がかり：選択中の駅か、地図の見えている範囲。 */
export type LocateInput =
  | { readonly kind: 'station'; readonly grp: string }
  | { readonly kind: 'view'; readonly viewport: Viewport }

export type LocatedArea = {
  /** エリアの文字列（`muni:14109`・`pref:13`・`jp`）。 */
  readonly ref: string
  /** 決めた手がかり（「選択中の駅（新横浜）の市区町村」）。 */
  readonly basisJa: string
}

export type LocateResult =
  | { readonly ok: true; readonly area: LocatedArea }
  | { readonly ok: false; readonly messageJa: string }

const COUNTRY_REF = formatAreaRef({ type: 'country' })
const TOO_WIDE_JA = '地図が日本全体に近い広さなので全国'
const NO_STATION_JA = '地図の中心に近い駅が見つからないので全国'

function located(ref: string, basisJa: string): LocateResult {
  return { ok: true, area: { ref, basisJa } }
}

/** 駅の都道府県（知らない名前なら全国）。 */
function prefectureOf(station: LocatableStation, basisJa: string): LocateResult {
  const code = PREFECTURES.find((prefecture) => prefecture.name === station.prefecture)?.code
  if (code === undefined) return located(COUNTRY_REF, NO_STATION_JA)
  return located(formatAreaRef({ type: 'prefecture', code }), `${basisJa}の都道府県`)
}

/** 駅の市区町村（市区町村が分からない駅は都道府県）。 */
function municipalityOf(station: LocatableStation, basisJa: string): LocateResult {
  const code = station.municipalityCode
  if (code === null) return prefectureOf(station, basisJa)
  return located(formatAreaRef({ type: 'municipality', code }), `${basisJa}の市区町村`)
}

/** 地図の見えている範囲 → 寄り方に合うエリア。 */
function locateInView(
  viewport: Viewport,
  stations: ReadonlyMap<string, LocatableStation>,
): LocateResult {
  if (isTooWideForArea(viewport)) return located(COUNTRY_REF, TOO_WIDE_JA)
  const nearest = nearestTo(viewCenter(viewport), stations.values())
  if (nearest === null) return located(COUNTRY_REF, NO_STATION_JA)
  const basisJa = `地図の中心に近い駅（${nearest.item.label}）`
  return isWardScale(viewport)
    ? municipalityOf(nearest.item, basisJa)
    : prefectureOf(nearest.item, basisJa)
}

/** 手がかり → 開いた直後のエリア（知らない駅は理由）。 */
export function locateArea(
  input: LocateInput,
  stations: ReadonlyMap<string, LocatableStation>,
): LocateResult {
  if (input.kind === 'view') return locateInView(input.viewport, stations)
  const station = stations.get(input.grp)
  if (station === undefined) return { ok: false, messageJa: `駅が見つかりません: ${input.grp}` }
  return municipalityOf(station, `選択中の駅（${station.label}）`)
}
