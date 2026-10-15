/**
 * 警報（`getHazardAlerts`）の場所を、名前（`placeJa`）から決める（純関数・2026-10-15・
 * `docs/261001_fix_user_feedback_ui.md` §6.23）。
 *
 * 以前は駅（grp）か緯度経度が無いと「地点を特定できません」を返していた。「札幌市はいま避難した方がいいですか？」で
 * モデルが placeJa に「札幌市」だけを入れると、警報を 1 つも見ないまま答え、市町村の避難情報に従う旨も落とした
 * （全問の評価で 2 回）。名前はサーバが決める（B1 の原則）。
 *
 * - 市区町村：エリアの要約（B5d）と同じ全区域の索引と決め方（`ai/area/municipality.ts`）。警報は区域ごとに出るので、
 *   決めた市区町村の発表区域を直接引く（名前から 1 点を作らない）
 * - 駅：起点の駅（B2）と同じ索引と決め方（`ai/area/origin.ts`）。駅の市区町村コードで発表区域を引き、駅の位置に印を置く
 * - 「◯◯駅」は駅から、ほかは市区町村から試し、当たらなければもう一方。同じ名前が複数なら候補を返して聞き返させる
 * - 都道府県・全国・現在地はまとめて引けない（警報は市区町村ごとに出る・チャットに位置は届かない）
 */

import { placeLabelOf, resolveMunicipality } from '@/ai/area/municipality'
import { placeKey, prefectureNamed } from '@/ai/area/keys'
import { stationPlace, resolveOrigin } from '@/ai/area/origin'
import { type AreaIndex, type LonLat } from '@/ai/area/place-index'
import { type AreaProblem, listNames } from '@/ai/area/problems'
import { COUNTRY_NAMES, type AdminIndex, type AdminPlace } from '@/ai/area-summary/admin-index'
import { parseAreaRef } from '@/shared/area-ref'
import { jmaMunicipality } from '@/shared/jma'
import { type Viewport } from '@/shared/viewport'

/** 名前を決める索引（全区域・全駅）。 */
export type AlertPlaceIndexes = {
  readonly admin: AdminIndex
  readonly stations: AreaIndex
}

/** 決まらなかったとき：モデルに返す問題（候補つき）と、画面のカードに出す一言。 */
export type AlertPlaceFailure = {
  readonly kind: 'none'
  readonly problem: AreaProblem
  readonly screenNoteJa: string
}

export type AlertPlace =
  | {
      readonly kind: 'municipality'
      readonly code: string
      readonly placeJa: string
      /** 地図を寄せる先（区域の駅の範囲の真ん中・駅の無い町村は null）。 */
      readonly center: LonLat | null
      readonly notes: readonly string[]
    }
  | {
      readonly kind: 'station'
      readonly lon: number
      readonly lat: number
      /** 駅の市区町村コード（あれば逆ジオを通さず発表区域を引く）。 */
      readonly code: string | null
      readonly placeJa: string
      readonly notes: readonly string[]
    }
  | AlertPlaceFailure

/** チャットには位置が届かない言い方。 */
const CURRENT_LOCATION_NAMES: readonly string[] = ['現在地', '現在位置', 'ここ', '今いる場所']
/** 東京 23 区の全体（警報は区ごとに出るので、全体の発表区域は無い）。 */
const SPECIAL_WARDS_CODE = '13100'

function failure(input: string, problem: string, screenNoteJa: string): AlertPlaceFailure {
  return { kind: 'none', problem: { input, problem }, screenNoteJa }
}

/** 都道府県・全国（まとめて引けない）。 */
function wholeRegionFailure(input: string): AlertPlaceFailure | null {
  const key = placeKey(input)
  const isCountry = COUNTRY_NAMES.some((name) => placeKey(name) === key)
  const prefecture = isCountry ? '全国' : prefectureNamed(input)
  if (prefecture === null) return null
  return failure(
    input,
    `「${input}」は${isCountry ? '全国' : '都道府県'}です。警報は市区町村ごとに出るので、${prefecture}をまとめては調べられません。市区町村か駅を placeJa に入れて呼び直すか、どこか利用者に聞いてください。`,
    `警報は市区町村ごとに出るので、${prefecture}をまとめては調べられません。市区町村か駅で聞いてください。`,
  )
}

function currentLocationFailure(input: string): AlertPlaceFailure | null {
  if (!CURRENT_LOCATION_NAMES.some((name) => placeKey(name) === placeKey(input))) return null
  return failure(
    input,
    'チャットには利用者の現在地が届きません。どの駅か市区町村かを利用者に聞いてください。',
    'チャットには現在地が届きません。駅か市区町村で聞いてください。',
  )
}

/** 区域の駅の範囲の真ん中（地図を寄せる先）。駅が無ければ null。 */
function centerOf(points: readonly LonLat[]): LonLat | null {
  if (points.length === 0) return null
  const lons = points.map((point) => point.lon)
  const lats = points.map((point) => point.lat)
  return {
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
  }
}

/** 決めた区域 → 警報を引く市区町村（気象庁の発表区域が無い区域は、決まらなかった扱い）。 */
function municipalityOf(input: string, place: AdminPlace, notes: readonly string[]): AlertPlace {
  const ref = parseAreaRef(place.key)
  const code = ref.ok && ref.ref.type === 'municipality' ? ref.ref.code : ''
  if (code === SPECIAL_WARDS_CODE) {
    return failure(
      input,
      '東京23区の全体はまとめて調べられません（警報は区ごとに出ます）。区の名前を placeJa に入れて呼び直すか、どの区か利用者に聞いてください。',
      '警報は区ごとに出るので、東京23区の全体はまとめて調べられません。区の名前で聞いてください。',
    )
  }
  if (jmaMunicipality(code) === undefined) {
    const label = placeLabelOf(place)
    return failure(
      input,
      `${label}は気象庁の発表区域に対応がありません。`,
      `${label}は、気象庁の発表区域に対応がありません。`,
    )
  }
  // 言い方を読み替えたとき（「港北」→ 横浜市港北区）は、都道府県まで書いて取り違えを見えるようにする。
  const placeJa = notes.length > 0 ? placeLabelOf(place) : place.value
  return { kind: 'municipality', code, placeJa, center: centerOf(place.points), notes }
}

/** 同じ名前の呼び直し方（市区町村は都道府県を添えた名前、駅は候補の grp）。 */
const RETRY_JA = {
  municipality: '都道府県を添えた名前（「東京都府中市」）を placeJa に入れて呼び直すか',
  station: 'candidates の station（grp）を grp に入れて呼び直すか',
} as const satisfies Record<'municipality' | 'station', string>

const WHAT_JA = { municipality: '市区町村', station: '駅' } as const

/** 同じ名前が複数（候補を返して聞き返させる）。 */
function ambiguousFailure(
  input: string,
  problem: AreaProblem,
  kind: 'municipality' | 'station',
): AlertPlaceFailure {
  const names = (problem.candidates ?? []).map((candidate) =>
    'station' in candidate
      ? `${candidate.name}（${candidate.prefecture}${candidate.municipality ?? ''}）`
      : `${candidate.municipality}（${candidate.prefecture}）`,
  )
  const listed = listNames(names)
  const problemJa = `${WHAT_JA[kind]}「${input}」は ${names.length} か所にあります（${listed}）。${RETRY_JA[kind]}、どこか利用者に聞いてください（地図の表示範囲はもう使ってあります）。`
  return {
    kind: 'none',
    problem: { ...problem, problem: problemJa },
    screenNoteJa: `「${input}」は ${listed} にあります。都道府県を添えて聞いてください。`,
  }
}

/** 市区町村として決める（見つからなければ null＝駅を試す）。 */
function asMunicipality(
  input: string,
  viewport: Viewport | null,
  admin: AdminIndex,
): AlertPlace | null {
  const result = resolveMunicipality(input, [], viewport, admin)
  if (result.ok) return municipalityOf(input, result.place, result.notes)
  return (result.problem.candidates ?? []).length > 0
    ? ambiguousFailure(input, result.problem, 'municipality')
    : null
}

/** 駅として決める（見つからなければ null＝市区町村を試す）。 */
function asStation(
  input: string,
  viewport: Viewport | null,
  stations: AreaIndex,
): AlertPlace | null {
  const result = resolveOrigin(input, [], viewport, stations)
  if (!result.ok) {
    return (result.problem.candidates ?? []).length > 0
      ? ambiguousFailure(input, result.problem, 'station')
      : null
  }
  const { station } = result
  const notes =
    result.notes.length === 0
      ? []
      : [
          `駅「${input}」は ${stationPlace(station)} として調べました（同じ名前の駅がほかにもあります）。`,
        ]
  return {
    kind: 'station',
    lon: station.lon,
    lat: station.lat,
    code: station.municipalityCode,
    placeJa: `${station.name}駅`,
    notes,
  }
}

function unknownFailure(input: string): AlertPlaceFailure {
  return failure(
    input,
    `「${input}」という市区町村も駅も見つかりません。searchStations で駅を探して grp で呼び直すか、市区町村の名前を確かめてください。`,
    `「${input}」という市区町村や駅が見つかりませんでした。名前を確かめて聞いてください。`,
  )
}

/** 名前 → 警報を引く場所（市区町村・駅）か、決まらなかった理由。 */
export function resolveAlertPlace(
  input: string,
  viewport: Viewport | null,
  indexes: AlertPlaceIndexes,
): AlertPlace {
  const special = currentLocationFailure(input) ?? wholeRegionFailure(input)
  if (special !== null) return special
  const station = (): AlertPlace | null => asStation(input, viewport, indexes.stations)
  const municipality = (): AlertPlace | null => asMunicipality(input, viewport, indexes.admin)
  const order = placeKey(input).endsWith('駅') ? [station, municipality] : [municipality, station]
  // 先に当たったほうで決める（当たらなければ次を試す・どちらも外れたら見つからない）。
  const found = order.reduce<AlertPlace | null>((place, attempt) => place ?? attempt(), null)
  return found ?? unknownFailure(input)
}
