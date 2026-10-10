/**
 * 起点の駅名・市区町村名を引く索引（純関数・2026-10-08 B2）。全駅の索引（`station_catalog()`）から作る。
 *
 * - 駅：名前の鍵 → 駅（同じ名前の駅は 406 組：府中は東京都・徳島県・広島県・京都府）、grp → 駅
 * - 市区町村：
 *   - 名前そのもの（「港区」「横浜市港北区」「府中市」は東京都と広島県の 2 つ）
 *   - 政令市の市全体（「横浜市」＝区をまとめる。前方一致で全区を束ねる）
 *   - 区の名前だけ（「港北区」→ 横浜市港北区、「中区」→ 横浜市・名古屋市・広島市…）
 *
 * 地図の範囲で決めるため、市区町村ごとに駅の座標を持つ。
 */

import { type CatalogStation } from '@/db/queries'
import { cityOfWard, wardOf } from '@/shared/municipality'
import { placeKey } from './keys'

/** 経度・緯度。 */
export type LonLat = { readonly lon: number; readonly lat: number }

/** 市区町村（または政令市の市全体）。`value` は前方一致で SQL に渡す値。 */
export type PlaceEntry = {
  readonly prefecture: string
  readonly value: string
  readonly stationCount: number
  readonly points: readonly LonLat[]
}

export type AreaIndex = {
  readonly stationsByKey: ReadonlyMap<string, readonly CatalogStation[]>
  readonly stationsByGrp: ReadonlyMap<string, CatalogStation>
  /** 名前そのもの（鍵 → 都道府県ごとの市区町村）。 */
  readonly placesByName: ReadonlyMap<string, readonly PlaceEntry[]>
  /** 政令市の市全体（「横浜市」→ 区をまとめた 1 つ）。 */
  readonly citiesByName: ReadonlyMap<string, readonly PlaceEntry[]>
  /** 区の名前だけ（「港北区」→ 横浜市港北区）。 */
  readonly placesByWard: ReadonlyMap<string, readonly PlaceEntry[]>
  /** 全部の市区町村と市全体（近い名前を挙げるとき）。 */
  readonly places: readonly PlaceEntry[]
}

/** 鍵ごとにまとめる（鍵が null のものは入れない・入った順を保つ）。 */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  return items.reduce((map, item) => {
    const key = keyOf(item)
    if (key !== null) map.set(key, [...(map.get(key) ?? []), item])
    return map
  }, new Map<string, T[]>())
}

/** いくつかの市区町村（または駅）を 1 つの場所にまとめる。 */
function placeOf(
  prefecture: string,
  value: string,
  members: readonly { readonly points: readonly LonLat[]; readonly count: number }[],
): PlaceEntry {
  return {
    prefecture,
    value,
    stationCount: members.reduce((sum, member) => sum + member.count, 0),
    points: members.flatMap((member) => member.points),
  }
}

/** 駅 → 市区町村ごと（都道府県と名前の組）にまとめる。 */
function groupPlaces(stations: readonly CatalogStation[]): PlaceEntry[] {
  const groups = groupBy(stations, (station) =>
    station.municipality === null || station.municipality === ''
      ? null
      : `${station.prefecture}\t${station.municipality}`,
  )
  return [...groups.values()].flatMap((members) => {
    const first = members[0]
    if (first === undefined || first.municipality === null) return []
    const points = members.map((member) => ({ lon: member.lon, lat: member.lat }))
    return [placeOf(first.prefecture, first.municipality, [{ points, count: members.length }])]
  })
}

/** 政令市の区をまとめて、市全体を作る（都道府県と市の組ごと）。 */
function groupCities(places: readonly PlaceEntry[]): PlaceEntry[] {
  const cities = groupBy(places, (place) => {
    const city = cityOfWard(place.value)
    return city === null ? null : `${place.prefecture}\t${city}`
  })
  return [...cities.entries()].map(([key, wards]) => {
    const [prefecture = '', city = ''] = key.split('\t')
    const members = wards.map((ward) => ({ points: ward.points, count: ward.stationCount }))
    return placeOf(prefecture, city, members)
  })
}

function wardKey(place: PlaceEntry): string | null {
  const ward = wardOf(place.value)
  return ward === null ? null : placeKey(ward)
}

export function buildAreaIndex(stations: readonly CatalogStation[]): AreaIndex {
  const places = groupPlaces(stations)
  const cities = groupCities(places)
  return {
    stationsByKey: groupBy(stations, (station) => placeKey(station.name)),
    stationsByGrp: new Map(stations.map((station) => [station.grp, station])),
    placesByName: groupBy(places, (place) => placeKey(place.value)),
    citiesByName: groupBy(cities, (city) => placeKey(city.value)),
    placesByWard: groupBy(places, wardKey),
    places: [...places, ...cities],
  }
}
