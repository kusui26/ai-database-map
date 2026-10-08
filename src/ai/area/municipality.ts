/**
 * 市区町村の言い方を決める（純関数・2026-10-08 B2）。
 *
 * - 強い：名前そのもの（「港区」「横浜市港北区」「府中市」）、政令市の市全体（「横浜市」＝全区）、
 *   末尾の「市・区・町・村」を補った名前（「世田谷」→ 世田谷区、「横浜」→ 横浜市）
 * - 弱い：区の名前だけ（「港北区」「港北」→ 横浜市港北区、「港区」→ 名古屋市港区・大阪市港区）
 * - 頭の都道府県（「東京都港区」）は都道府県の条件として使う。都道府県だけの言い方（「東京」）は prefectures へ促す
 *
 * 同じ名前は、都道府県 → 地図の範囲の順に決め（`decide.ts`）、決まらなければ候補を返して聞き返す。
 * 決めた市区町村は、SQL に前方一致の値（`value`）で渡し、都道府県を添える（府中市は東京都と広島県にある）。
 */

import { type Viewport } from '@/shared/viewport'
import { decidePlace, type PlaceCandidate, type PlaceDecision } from './decide'
import { prefectureNamed, splitPrefecture } from './keys'
import { type AreaIndex, type PlaceEntry } from './place-index'
import {
  type AreaProblem,
  listNames,
  MAX_AREA_CANDIDATES,
  type MunicipalityCandidate,
} from './problems'

export type MunicipalityResult =
  | { readonly ok: true; readonly place: PlaceEntry; readonly notes: readonly string[] }
  | { readonly ok: false; readonly problem: AreaProblem }

/** 名前に補う末尾（「世田谷」→ 世田谷区）。 */
const SUFFIXES: readonly string[] = ['市', '区', '町', '村']
/** 近い名前として挙げる数。 */
const MAX_DID_YOU_MEAN = 5

/** 市区町村の見せ方（「港区（東京都）」「横浜市港北区（神奈川県）」）。 */
export function placeLabelOf(place: PlaceEntry): string {
  return `${place.value}（${place.prefecture}）`
}

function toCandidate(place: PlaceEntry): MunicipalityCandidate {
  return {
    municipality: place.value,
    prefecture: place.prefecture,
    stationCount: place.stationCount,
  }
}

/** 名前（市全体を含む）で当たる場所。 */
function named(key: string, index: AreaIndex): PlaceEntry[] {
  return [...(index.placesByName.get(key) ?? []), ...(index.citiesByName.get(key) ?? [])]
}

/**
 * 末尾を補った候補が 2 つ以上あるとき、駅の数で抜きん出た 1 つ（ほかのどれの 5 倍以上）を強い候補にする。
 * 「横浜」は横浜市（137 駅）で、青森県の横浜町（3 駅）を並べて聞き返さない。「府中」（府中市 14 駅・9 駅）は聞き返す。
 */
const DOMINANCE_RATIO = 5

function dominant(places: readonly PlaceEntry[]): PlaceEntry | null {
  const [top, ...rest] = [...places].sort((a, b) => b.stationCount - a.stationCount)
  if (top === undefined || rest.length === 0) return null
  return rest.every((place) => top.stationCount >= place.stationCount * DOMINANCE_RATIO)
    ? top
    : null
}

function candidate(place: PlaceEntry, strong: boolean): PlaceCandidate<PlaceEntry> {
  return { item: place, strong, points: place.points }
}

/** 末尾を補った言い方の候補（抜きん出た 1 つがあれば、それだけを強い候補に）。 */
function completed(key: string, index: AreaIndex): PlaceCandidate<PlaceEntry>[] {
  const places = SUFFIXES.flatMap((suffix) => named(`${key}${suffix}`, index))
  const top = dominant(places)
  return places.map((place) => candidate(place, top === null || place === top))
}

/**
 * 区の名前だけで当たる場所（「港北」も「港北区」として引く＝「中央」と「中央区」で同じ候補になる）。
 * 都道府県の言い方（「神奈川」）は区で補わない——横浜市神奈川区ではなく、prefectures へ促す。
 */
function wardsOf(key: string, index: AreaIndex): readonly PlaceEntry[] {
  if (key.endsWith('区')) return index.placesByWard.get(key) ?? []
  return prefectureNamed(key) === null ? (index.placesByWard.get(`${key}区`) ?? []) : []
}

/** 言い方 → 候補（強い → 弱いの順・同じ場所は 1 度だけ）。 */
function candidatesOf(key: string, index: AreaIndex): PlaceCandidate<PlaceEntry>[] {
  const exact = named(key, index)
  const strong =
    exact.length > 0 ? exact.map((place) => candidate(place, true)) : completed(key, index)
  const seen = new Set(strong.map((c) => c.item))
  const weak = wardsOf(key, index).filter((place) => !seen.has(place))
  return [...strong, ...weak.map((place) => candidate(place, false))]
}

/** 名前に含む市区町村（近い名前・駅の多い順）。 */
function similarPlaces(key: string, index: AreaIndex): string[] {
  if (key.length === 0) return []
  return index.places
    .filter((place) => place.value.includes(key))
    .sort((a, b) => b.stationCount - a.stationCount)
    .slice(0, MAX_DID_YOU_MEAN)
    .map(placeLabelOf)
}

function unknownPlace(input: string, key: string, index: AreaIndex): AreaProblem {
  const prefecture = prefectureNamed(key)
  if (prefecture !== null) {
    return {
      input,
      problem: `「${input}」は都道府県です。municipality ではなく prefectures に「${prefecture}」を渡してください。`,
    }
  }
  const didYouMean = similarPlaces(key, index)
  return {
    input,
    problem: `市区町村「${input}」の駅が見つかりません（駅のある市区町村だけを扱えます）。名前を確かめてください。`,
    ...(didYouMean.length > 0 ? { didYouMean } : {}),
  }
}

/** 駅の多い順（同じ数は元の順のまま）。説明と候補の並びを、索引の並び（たまたまの順）に左右させない。 */
function byStationCount(places: readonly PlaceEntry[]): PlaceEntry[] {
  return [...places].sort((a, b) => b.stationCount - a.stationCount)
}

function ambiguous(input: string, places: readonly PlaceEntry[]): AreaProblem {
  const sorted = byStationCount(places)
  return {
    input,
    problem: `市区町村「${input}」は ${sorted.length} か所にあります（${listNames(sorted.map(placeLabelOf))}）。どこか利用者に聞くか、candidates の municipality と prefectures で呼び直してください。`,
    candidates: sorted.slice(0, MAX_AREA_CANDIDATES).map(toCandidate),
  }
}

/** 決め方 → 説明（言い方と同じ名前で、ほかの候補も無ければ書かない）。`said` は都道府県を除いた言い方。 */
function placeNotes(
  input: string,
  said: string,
  decision: Extract<PlaceDecision<PlaceEntry>, { kind: 'one' }>,
): string[] {
  const chosen = placeLabelOf(decision.item)
  const others = listNames(byStationCount(decision.others).map(placeLabelOf))
  if (decision.how === 'viewport') {
    return [
      `市区町村「${input}」は、地図の表示範囲にある ${chosen} にしました（ほかの候補：${others}）。`,
    ]
  }
  if (decision.others.length > 0) {
    return [`市区町村「${input}」は ${chosen} として扱いました（ほかに ${others} があります）。`]
  }
  return decision.item.value === said ? [] : [`市区町村「${input}」は ${chosen} として扱いました。`]
}

/** 候補が都道府県の指定の外にしか無いとき（「横浜市」× 東京都）。 */
function outOfScope(
  input: string,
  scope: readonly string[],
  found: readonly PlaceCandidate<PlaceEntry>[],
): AreaProblem {
  const places = byStationCount(found.map((candidate) => candidate.item))
  return {
    input,
    problem: `市区町村「${input}」は ${scope.join('・')} にありません（${listNames(places.map(placeLabelOf))}）。`,
    candidates: places.slice(0, MAX_AREA_CANDIDATES).map(toCandidate),
  }
}

/** 言い方の頭の都道府県と、ツールの prefectures が食い違うか（「神奈川県横浜市」× 東京都）。 */
function conflict(
  input: string,
  fromInput: string | null,
  prefectures: readonly string[],
): AreaProblem | null {
  if (fromInput === null || prefectures.length === 0 || prefectures.includes(fromInput)) return null
  return {
    input,
    problem: `市区町村「${input}」は ${fromInput} で、prefectures の指定（${prefectures.join('・')}）と合いません。`,
  }
}

export function resolveMunicipality(
  input: string,
  prefectures: readonly string[],
  viewport: Viewport | null,
  index: AreaIndex,
): MunicipalityResult {
  const { prefecture, rest } = splitPrefecture(input)
  const clash = conflict(input, prefecture, prefectures)
  if (clash !== null) return { ok: false, problem: clash }
  const found = candidatesOf(rest, index)
  if (found.length === 0) return { ok: false, problem: unknownPlace(input, rest, index) }
  const scope = prefecture === null ? prefectures : [prefecture]
  const scoped = scope.length === 0 ? found : found.filter((c) => scope.includes(c.item.prefecture))
  if (scoped.length === 0) return { ok: false, problem: outOfScope(input, scope, found) }
  const decision = decidePlace(scoped, viewport)
  if (decision.kind === 'one') {
    return { ok: true, place: decision.item, notes: placeNotes(input, rest, decision) }
  }
  const items = decision.kind === 'ambiguous' ? decision.items : scoped.map((c) => c.item)
  return { ok: false, problem: ambiguous(input, items) }
}
