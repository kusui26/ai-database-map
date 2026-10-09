/**
 * ツール 1 回分のエリアの言い方（市区町村・起点の駅と半径・範囲）を解決する（2026-10-08 B2）。
 *
 * - 市区町村・起点は名前で受け、索引（全駅）で決める（`municipality.ts`・`origin.ts`）。決めた市区町村の都道府県を
 *   prefectures に添える（題が「神奈川県・横浜市」になり、画面の市区町村の選択が都道府県 1 つを前提にできる）
 * - 半径は withinM（m）。範囲の外は丸めて説明に書く
 * - どれも無ければ索引を読まない（いつもの呼び出しを遅くしない）
 * - 決められなければ、図を作らずに候補を返す（路線の名前と同じ `problems` の形）
 *
 * 地図の表示範囲（`viewport`）は、同じ名前を決めるのに使う。駅を範囲で絞るのは `bbox`（数で受ける）か、
 * 「このあたり」の `inMapView`（地図の範囲そのもの・2026-10-09 B3）。
 */

import { nearOf, type NearArea, type ResolvedArea } from '@/domain/area'
import { NEAR_MAX_RADIUS_M, NEAR_MIN_RADIUS_M, distanceLabel } from '@/shared/constants'
import { isValidLonLat, viewportFromTuple, type Viewport } from '@/shared/viewport'
import { resolveMunicipality } from './municipality'
import { resolveOrigin } from './origin'
import { isTooWideForArea } from './map-view'
import { type AreaIndex } from './place-index'
import { type AreaProblem } from './problems'

/** 起点（駅名か grp）と半径。座標で受けるのは一覧・データセットだけ（図は駅で受ける＝⤢ で同じ条件を開ける）。 */
export type NearInput = {
  readonly station?: string
  readonly lon?: number
  readonly lat?: number
  readonly withinM?: number
}

export type AreaInput = {
  readonly municipality?: string
  readonly near?: NearInput
  readonly bbox?: readonly number[]
  /** 地図に表示中の範囲の駅だけ（「このあたり」・アプリのチャットだけ・B3）。 */
  readonly inMapView?: boolean
}

export type AreaResolveContext = {
  readonly prefectures: readonly string[]
  readonly viewport: Viewport | null
}

export type AreaResolveDeps = { readonly index: () => Promise<AreaIndex> }

export type AreaInputResolution =
  | {
      readonly ok: true
      readonly area: ResolvedArea
      /** 決めた市区町村の都道府県を添えた prefectures。 */
      readonly prefectures: readonly string[]
      readonly notes: readonly string[]
    }
  | {
      readonly ok: false
      readonly error: string
      readonly hint: string
      readonly problems: readonly AreaProblem[]
    }

/** 座標で受けた起点の見せ方（題・説明）。 */
const POINT_LABEL_JA = '指定した地点'

const AREA_HINT =
  'problems の各項目を見てください。candidates は呼び直しにそのまま使える値です（起点は station に grp、市区町村は municipality と prefectures）。' +
  '会話から地域が分かるときだけ選び、分からなければどれかを利用者に聞いてください（推測で選ばない。地図の表示範囲はもう使ってあり、それでも決まらなかった候補です）。'

type Step<T> =
  | { readonly ok: true; readonly value: T; readonly notes: readonly string[] }
  | { readonly ok: false; readonly problem: AreaProblem }

const NONE: Step<null> = { ok: true, value: null, notes: [] }

/** 半径を範囲に収める（外れていたら説明に書く）。 */
function clampRadius(withinM: number): {
  readonly radiusM: number
  readonly notes: readonly string[]
} {
  const radiusM = Math.min(Math.max(Math.round(withinM), NEAR_MIN_RADIUS_M), NEAR_MAX_RADIUS_M)
  const notes =
    radiusM === Math.round(withinM)
      ? []
      : [
          `半径は ${distanceLabel(NEAR_MIN_RADIUS_M)}〜${distanceLabel(NEAR_MAX_RADIUS_M)} なので、${distanceLabel(radiusM)} にしました。`,
        ]
  return { radiusM, notes }
}

function bboxStep(bbox: readonly number[] | undefined): Step<Viewport | null> {
  if (bbox === undefined) return NONE
  const viewport = viewportFromTuple(bbox)
  if (viewport !== null) return { ok: true, value: viewport, notes: [] }
  const problem =
    'bbox は [west, south, east, north]（経度・緯度・west < east・south < north）の 4 つの数です。'
  return { ok: false, problem: { input: 'bbox', problem } }
}

const MAP_VIEW_WITH_BBOX: AreaProblem = {
  input: 'inMapView',
  problem:
    'inMapView と bbox は一緒に使いません（地図に表示中の範囲なら inMapView だけ。範囲はサーバが持っています）。',
}
const NO_MAP_VIEW: AreaProblem = {
  input: 'inMapView',
  problem:
    '地図の表示範囲が届いていません（地図のある画面のチャットだけで使えます）。地名・駅名で絞るか、範囲を bbox に [west, south, east, north] で渡してください。',
}
const MAP_VIEW_TOO_WIDE: AreaProblem = {
  input: 'inMapView',
  problem:
    '地図が日本全体に近い広さなので、「このあたり」がどこか決められません。どのあたりかを利用者に聞いてください（地名・駅名を聞くか、地図を拡大してもらう）。',
}

/** 範囲：数の bbox か、地図に表示中の範囲（「このあたり」）。 */
function rangeStep(input: AreaInput, viewport: Viewport | null): Step<Viewport | null> {
  if (input.inMapView !== true) return bboxStep(input.bbox)
  if (input.bbox !== undefined) return { ok: false, problem: MAP_VIEW_WITH_BBOX }
  if (viewport === null) return { ok: false, problem: NO_MAP_VIEW }
  if (isTooWideForArea(viewport)) return { ok: false, problem: MAP_VIEW_TOO_WIDE }
  return { ok: true, value: viewport, notes: [] }
}

const NEEDS_RADIUS: AreaProblem = {
  input: 'near',
  problem: 'near.withinM（起点から何 m 以内か・5km → 5000）が要ります。',
}
const NEEDS_ORIGIN: AreaProblem = {
  input: 'near',
  problem: 'near は station（起点の駅名か grp）か、lon・lat で起点を指定してください。',
}
const BAD_POINT: AreaProblem = {
  input: 'near',
  problem:
    'near の lon・lat は経度・緯度です（lon は -180〜180、lat は -90〜90。日本なら lon ≈ 123〜154・lat ≈ 20〜46）。',
}

/** 起点（駅の座標と表示名・駅でない地点は「指定した地点」）。 */
type Origin = Parameters<typeof nearOf>[0]

/** 起点を決める（駅名か grp なら索引で、座標ならそのまま）。 */
function originStep(
  near: NearInput,
  scope: readonly string[],
  viewport: Viewport | null,
  index: AreaIndex | null,
): Step<Origin> {
  if (near.station !== undefined && index !== null) {
    const origin = resolveOrigin(near.station, scope, viewport, index)
    return origin.ok ? { ok: true, value: origin.station, notes: origin.notes } : origin
  }
  if (near.lon === undefined || near.lat === undefined) return { ok: false, problem: NEEDS_ORIGIN }
  if (!isValidLonLat(near.lon, near.lat)) return { ok: false, problem: BAD_POINT }
  const point = { grp: '', label: POINT_LABEL_JA, lon: near.lon, lat: near.lat }
  return { ok: true, value: point, notes: [] }
}

function nearStep(
  near: NearInput | undefined,
  scope: readonly string[],
  viewport: Viewport | null,
  index: AreaIndex | null,
): Step<NearArea | null> {
  if (near === undefined) return NONE
  if (near.withinM === undefined) return { ok: false, problem: NEEDS_RADIUS }
  const origin = originStep(near, scope, viewport, index)
  if (!origin.ok) return origin
  const { radiusM, notes } = clampRadius(near.withinM)
  return { ok: true, value: nearOf(origin.value, radiusM), notes: [...origin.notes, ...notes] }
}

/** 市区町村を決め、その都道府県を prefectures に添える（指定が無いときだけ）。 */
function municipalityStep(
  input: string | undefined,
  context: AreaResolveContext,
  index: AreaIndex | null,
): Step<{ readonly value: string; readonly prefecture: string } | null> {
  const name = input?.trim() ?? ''
  if (name === '' || index === null) return NONE
  const result = resolveMunicipality(name, context.prefectures, context.viewport, index)
  if (!result.ok) return result
  return {
    ok: true,
    value: { value: result.place.value, prefecture: result.place.prefecture },
    notes: result.notes,
  }
}

/** 都道府県の指定が無ければ、決めた市区町村の都道府県を添える（指定があれば、市区町村はその中から決めてある）。 */
function withPrefecture(
  prefectures: readonly string[],
  prefecture: string | undefined,
): readonly string[] {
  return prefecture === undefined || prefectures.length > 0 ? prefectures : [prefecture]
}

function needsIndex(input: AreaInput): boolean {
  return (input.municipality?.trim() ?? '') !== '' || input.near?.station !== undefined
}

function failure(steps: readonly Step<unknown>[]): AreaInputResolution {
  const problems = steps.flatMap((step) => (step.ok ? [] : [step.problem]))
  return {
    ok: false,
    error: '場所（市区町村・起点の駅・範囲）を決められませんでした',
    hint: AREA_HINT,
    problems,
  }
}

/** ツールのエリアの言い方 → 解決したエリア（決められなければ候補つきの問題）。 */
export async function resolveAreaInput(
  input: AreaInput,
  context: AreaResolveContext,
  deps: AreaResolveDeps,
): Promise<AreaInputResolution> {
  const index = needsIndex(input) ? await deps.index() : null
  const municipality = municipalityStep(input.municipality, context, index)
  const chosen = municipality.ok ? municipality.value?.prefecture : undefined
  const prefectures = withPrefecture(context.prefectures, chosen)
  const near = nearStep(input.near, prefectures, context.viewport, index)
  const bbox = rangeStep(input, context.viewport)
  if (!municipality.ok || !near.ok || !bbox.ok) return failure([municipality, near, bbox])
  return {
    ok: true,
    area: { municipality: municipality.value?.value ?? null, bbox: bbox.value, near: near.value },
    prefectures: [...prefectures],
    notes: [...municipality.notes, ...near.notes, ...bbox.notes],
  }
}
