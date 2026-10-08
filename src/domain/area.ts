/**
 * ドメイン：エリアの条件（市区町村・地図の範囲・起点から N m）の解決（2026-10-08 B2・
 * `docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 共通 API（ランキング・散布・駅の一覧）が同じ規則で受ける。形が崩れた条件は**黙って捨てずに理由を返す**——
 * 捨てると、利用者が指定したのとは別の駅の集合（全国）で答えてしまう（L2 の路線コードと同じ扱い）。
 *
 * - 市区町村：名前か JIS コードの前方一致（「横浜市」で全区）。都道府県とは AND
 * - 範囲：経度・緯度の箱（西＜東・南＜北）
 * - 近傍：起点の**駅**（grp）と半径（m）。起点の座標と表示名はサーバが引く（題は「竹橋から 5km」）。
 *   起点からの距離は SQL が返す（AI に距離を作らせない）
 *
 * 言い方（「竹橋」「港北区」）を grp・市区町村に解決するのは AI のツールの入口（`src/ai/area/`）。ここは決まった値だけを受ける。
 */

import { stationByGrp, type StationFilter } from '@/db/queries'
import { type NearRef } from '@/shared/api'
import { viewportFromTuple, type Viewport } from '@/shared/viewport'

/** 共通 API のエリアの条件（クエリの値・検証前）。 */
export type AreaQuery = {
  readonly municipality?: string
  readonly bbox?: string
  readonly nearStation?: string
  readonly withinM?: number
}

/** 起点（駅）と半径。座標は SQL に、表示名は題に使う。 */
export type NearArea = NearRef & { readonly lon: number; readonly lat: number }

/** 解決したエリア（どれも null＝絞らない）。 */
export type ResolvedArea = {
  readonly municipality: string | null
  readonly bbox: Viewport | null
  readonly near: NearArea | null
}

/** 応答に返すエリア（`rankingResponseSchema` などの `municipality`・`bbox`・`near`）。 */
export type AreaEcho = {
  readonly municipality: string | null
  readonly bbox: Viewport | null
  readonly near: NearRef | null
}

export const NO_AREA: ResolvedArea = { municipality: null, bbox: null, near: null }

export type AreaResolution =
  | { readonly ok: true; readonly area: ResolvedArea }
  | { readonly ok: false; readonly messageJa: string }

/** 範囲の形の誤り（並び・数）を、直し方つきで言う。 */
export const BBOX_ERROR_JA =
  'bbox は「西,南,東,北」の 4 つの数（経度・緯度・西＜東・南＜北）で指定してください。'

/** "west,south,east,north" → 範囲（数でない・4 つでない・並びが逆・経度緯度の外は null）。 */
export function parseBbox(raw: string): Viewport | null {
  return viewportFromTuple(raw.split(',').map((part) => Number(part.trim())))
}

/** 起点の駅（座標と表示名）と半径 → 近傍。 */
export function nearOf(
  station: {
    readonly grp: string
    readonly label: string
    readonly lon: number
    readonly lat: number
  },
  radiusM: number,
): NearArea {
  return { grp: station.grp, label: station.label, lon: station.lon, lat: station.lat, radiusM }
}

type AreaNearResult =
  | { readonly ok: true; readonly near: NearArea | null }
  | { readonly ok: false; readonly messageJa: string }

/** 起点の駅（grp）を引く。知らない駅は理由を返す（黙って全国にしない）。 */
async function resolveNear(grp: string, radiusM: number): Promise<AreaNearResult> {
  const station = await stationByGrp(grp)
  if (station === null) {
    return {
      ok: false,
      messageJa: `知らない駅です: ${grp}（GET /api/stations?q= で調べた grp を nearStation に指定してください）`,
    }
  }
  return { ok: true, near: nearOf(station, radiusM) }
}

/** 近傍の条件（起点と半径は組で指定する）。 */
function nearOfQuery(query: AreaQuery): Promise<AreaNearResult> {
  const { nearStation, withinM } = query
  if (nearStation === undefined && withinM === undefined) {
    return Promise.resolve({ ok: true, near: null })
  }
  if (nearStation === undefined || withinM === undefined) {
    return Promise.resolve({
      ok: false,
      messageJa:
        'nearStation（起点の駅の grp）と withinM（起点から何 m 以内か）は組で指定してください。',
    })
  }
  return resolveNear(nearStation, withinM)
}

/** 共通 API のエリアの条件を検証し、解決する（起点の駅は DB で引く）。 */
export async function resolveArea(query: AreaQuery): Promise<AreaResolution> {
  const bbox = query.bbox === undefined ? null : parseBbox(query.bbox)
  if (query.bbox !== undefined && bbox === null) return { ok: false, messageJa: BBOX_ERROR_JA }
  const near = await nearOfQuery(query)
  if (!near.ok) return near
  const municipality = query.municipality?.trim() ?? ''
  return {
    ok: true,
    area: { municipality: municipality === '' ? null : municipality, bbox, near: near.near },
  }
}

/** エリア → DB の絞り込みの一部（ほかの条件と合わせて `StationFilter` にする）。 */
export function areaFilter(area: ResolvedArea): StationFilter {
  const { municipality, bbox, near } = area
  return {
    ...(municipality === null ? {} : { municipality }),
    ...(bbox === null ? {} : { bbox }),
    ...(near === null ? {} : { near: { lon: near.lon, lat: near.lat, radiusM: near.radiusM } }),
  }
}

/** エリア → 応答に返す形（座標は返さない・起点は grp と表示名と半径）。 */
export function areaEcho(area: ResolvedArea): AreaEcho {
  const { near } = area
  return {
    municipality: area.municipality,
    bbox: area.bbox,
    near: near === null ? null : { grp: near.grp, label: near.label, radiusM: near.radiusM },
  }
}

/** 応答に載せるエリア（指定が無ければ、どれも null）。ランキング・散布の組み立てが使う。 */
export function areaEchoOf(area: AreaEcho | undefined): AreaEcho {
  return area ?? { municipality: null, bbox: null, near: null }
}

/** エリアの条件が 1 つでもあるか。 */
export function hasArea(area: ResolvedArea): boolean {
  return area.municipality !== null || area.bbox !== null || area.near !== null
}
