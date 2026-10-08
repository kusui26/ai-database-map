/**
 * 「竹橋から 5km」の起点の駅を決める（純関数・2026-10-08 B2）。
 *
 * 駅名の完全一致（末尾の「駅」は除いて引く）か grp。同じ名前の駅（府中は 4 か所・日本橋は東京と大阪）は、
 * 都道府県 → 地図の範囲の順に絞り、決まらなければ候補を返して聞き返す（推測で選ばない）。
 * 当たらなければ、名前に含む駅を近い名前として返す。
 */

import { type CatalogStation } from '@/db/queries'
import { type Viewport } from '@/shared/viewport'
import { decidePlace, type PlaceCandidate, type PlaceDecision } from './decide'
import { placeKey, stationKeys } from './keys'
import { type AreaIndex } from './place-index'
import { type AreaProblem, listNames, MAX_AREA_CANDIDATES, type StationCandidate } from './problems'

export type OriginResult =
  | { readonly ok: true; readonly station: CatalogStation; readonly notes: readonly string[] }
  | { readonly ok: false; readonly problem: AreaProblem }

/** 近い名前として挙げる数。 */
const MAX_DID_YOU_MEAN = 5

/** 駅の見せ方（「府中（東京都府中市）」）。 */
export function stationPlace(station: CatalogStation): string {
  return `${station.name}（${station.prefecture}${station.municipality ?? ''}）`
}

function toCandidate(station: CatalogStation): StationCandidate {
  return {
    station: station.grp,
    name: station.name,
    prefecture: station.prefecture,
    municipality: station.municipality,
  }
}

/** 名前（か grp）で当たる駅（乗降の多い順）。 */
function stationsNamed(input: string, index: AreaIndex): CatalogStation[] {
  const byGrp = index.stationsByGrp.get(input.trim())
  if (byGrp !== undefined) return [byGrp]
  const hit = stationKeys(input)
    .map((key) => index.stationsByKey.get(key) ?? [])
    .find((list) => list.length > 0)
  return [...(hit ?? [])].sort((a, b) => (b.paxLatest ?? 0) - (a.paxLatest ?? 0))
}

/** 名前に含む駅（近い名前・乗降の多い順）。 */
function similarStations(input: string, index: AreaIndex): string[] {
  const [key = ''] = stationKeys(input)
  if (key.length === 0) return []
  const matches = [...index.stationsByGrp.values()].filter((station) =>
    placeKey(station.name).includes(key),
  )
  return matches
    .sort((a, b) => (b.paxLatest ?? 0) - (a.paxLatest ?? 0))
    .slice(0, MAX_DID_YOU_MEAN)
    .map(stationPlace)
}

function unknownStation(input: string, index: AreaIndex): AreaProblem {
  const didYouMean = similarStations(input, index)
  return {
    input,
    problem: `起点の駅「${input}」が見つかりません。駅名を確かめるか、searchStations で調べた grp を near.station に渡してください。`,
    ...(didYouMean.length > 0 ? { didYouMean } : {}),
  }
}

function ambiguous(input: string, stations: readonly CatalogStation[]): AreaProblem {
  return {
    input,
    problem: `起点の「${input}」という駅は ${stations.length} か所にあります（${listNames(stations.map(stationPlace))}）。どの駅か利用者に聞くか、prefectures を添えるか、candidates の station（grp）で呼び直してください。`,
    candidates: stations.slice(0, MAX_AREA_CANDIDATES).map(toCandidate),
  }
}

/** 決め方 → 説明（1 つしか無ければ書かない）。 */
function originNotes(
  input: string,
  decision: Extract<PlaceDecision<CatalogStation>, { kind: 'one' }>,
): string[] {
  if (decision.others.length === 0) return []
  const others = listNames(decision.others.map(stationPlace))
  const chosen = stationPlace(decision.item)
  return decision.how === 'viewport'
    ? [`起点の「${input}」は、地図の表示範囲にある ${chosen} にしました（ほかの候補：${others}）。`]
    : [`起点の「${input}」は ${chosen} として扱いました（ほかに ${others} があります）。`]
}

/** 駅が指定の都道府県の外にしか無いとき（「竹橋」× 大阪府）。 */
function outOfScope(
  input: string,
  prefectures: readonly string[],
  found: readonly CatalogStation[],
): AreaProblem {
  const problem = `起点の「${input}」は ${prefectures.join('・')} にありません（${listNames(found.map(stationPlace))}）。`
  return { input, problem, candidates: found.slice(0, MAX_AREA_CANDIDATES).map(toCandidate) }
}

/** 駅 → 決め方の候補（駅名で当たった駅はどれも強い・点は駅の位置）。 */
function placeCandidate(station: CatalogStation): PlaceCandidate<CatalogStation> {
  return { item: station, strong: true, points: [{ lon: station.lon, lat: station.lat }] }
}

export function resolveOrigin(
  input: string,
  prefectures: readonly string[],
  viewport: Viewport | null,
  index: AreaIndex,
): OriginResult {
  const found = stationsNamed(input, index)
  if (found.length === 0) return { ok: false, problem: unknownStation(input, index) }
  const scoped =
    prefectures.length === 0 ? found : found.filter((s) => prefectures.includes(s.prefecture))
  if (scoped.length === 0) return { ok: false, problem: outOfScope(input, prefectures, found) }
  const decision = decidePlace(scoped.map(placeCandidate), viewport)
  if (decision.kind === 'one') {
    return { ok: true, station: decision.item, notes: originNotes(input, decision) }
  }
  const items = decision.kind === 'ambiguous' ? decision.items : scoped
  return { ok: false, problem: ambiguous(input, items) }
}
