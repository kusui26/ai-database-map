/**
 * エリアの要約の名前の索引（純関数・2026-10-11 B5d・`docs/261001_fix_user_feedback_ui.md` §6.12.9）。
 *
 * エリアの一覧（`area_catalog`・行政区域 1,961）から作る。駅の索引（B2・駅のある市区町村だけ）と違い、
 * **駅の無い町村も引ける**（区域の値はあり、駅の分布は空）。決め方（名前そのもの・政令市の市全体・末尾の補い・
 * 区の名前だけ・都道府県 → 地図の範囲）は B2 と同じ関数を通す（`ai/area/municipality.ts`）。
 *
 * - 東京 23 区の全体は「東京23区」「23区」「東京都区部」「特別区部」で引く（`muni:13100`）
 * - 都道府県（「神奈川県」「神奈川」）と全国（「全国」「日本」）は名前の表で引く
 * - 地図の範囲で決めるため、区域ごとに駅の座標を持つ（政令市の全体は区の駅、23 区は 23 の区の駅）
 */

import { type AreaCatalogRow, type CatalogStation } from '@/db/queries'
import {
  groupBy,
  type LonLat,
  type PlaceEntry,
  type PlaceIndex,
  wardKey,
} from '@/ai/area/place-index'
import { placeKey } from '@/ai/area/keys'

/** 区域（市区町村・政令市の区と全体・東京 23 区の全体）。`key` はエリアの文字列（`muni:14100`）。 */
export type AdminPlace = PlaceEntry & { readonly key: string }

export type AdminIndex = PlaceIndex<AdminPlace> & {
  /** 都道府県の名前 → エリアの文字列（`神奈川県` → `pref:14`）。 */
  readonly prefectureKeys: ReadonlyMap<string, string>
}

/** 全国のエリアの文字列。 */
export const COUNTRY_KEY = 'jp'
/** 全国の言い方（都道府県の欄に書かれることもある）。 */
export const COUNTRY_NAMES: readonly string[] = ['全国', '日本', '日本全国', '全国計']
/**
 * 東京 23 区の全体の言い方（名前そのもの「東京23区」も含む）。頭の「東京都」は都道府県として切り分けてから引くので
 * （「東京都区部」→ 東京都・区部）、切り分けたあとの形（「区部」「23区」）も持つ。
 */
const SPECIAL_WARDS_NAMES: readonly string[] = [
  '東京23区',
  '23区',
  '区部',
  '特別区部',
  '東京特別区',
  '特別区',
]

/** 市区町村の名前で引く区域の種類（全国・都道府県・沿線は別に引く）。 */
const PLACE_KINDS: ReadonlySet<string> = new Set(['municipality', 'ward', 'city', 'special_wards'])

/** 区域の駅の座標（市区町村・区はその区域の駅、政令市の全体は区の、23 区の全体は 23 の区の）。 */
function pointsOf(
  row: AreaCatalogRow,
  rows: readonly AreaCatalogRow[],
  pointsByCode: ReadonlyMap<string, readonly LonLat[]>,
): readonly LonLat[] {
  if (row.kind === 'municipality' || row.kind === 'ward') {
    return row.code === null ? [] : (pointsByCode.get(row.code) ?? [])
  }
  const members = rows.filter((each) => each.parentKey === row.key || each.groupKey === row.key)
  return members.flatMap((member) =>
    member.code === null ? [] : (pointsByCode.get(member.code) ?? []),
  )
}

function placeOf(
  row: AreaCatalogRow,
  rows: readonly AreaCatalogRow[],
  pointsByCode: ReadonlyMap<string, readonly LonLat[]>,
): AdminPlace {
  const points = pointsOf(row, rows, pointsByCode)
  return {
    key: row.key,
    prefecture: row.prefecture ?? '',
    value: row.nameJa,
    stationCount: row.stationCount,
    points,
  }
}

/** 駅の座標を市区町村コードごとに（駅の市区町村コードは区域のコードと同じ形）。 */
function pointsByCodeOf(stations: readonly CatalogStation[]): Map<string, LonLat[]> {
  const grouped = groupBy(stations, (station) => station.municipalityCode)
  return new Map(
    [...grouped.entries()].map(([code, members]) => [
      code,
      members.map((member) => ({ lon: member.lon, lat: member.lat })),
    ]),
  )
}

/** その種類の区域だけ（`kinds` は区域の文字列 → 種類）。 */
function ofKind(
  places: readonly AdminPlace[],
  kinds: ReadonlyMap<string, string>,
  kind: string,
): AdminPlace[] {
  return places.filter((place) => kinds.get(place.key) === kind)
}

/** 名前そのもので引く表（市区町村・区・23 区の全体。23 区の全体は言い方を足す）。 */
function byName(
  places: readonly AdminPlace[],
  kinds: ReadonlyMap<string, string>,
): Map<string, AdminPlace[]> {
  const named = groupBy(
    places.filter((place) => kinds.get(place.key) !== 'city'),
    (place) => placeKey(place.value),
  )
  const specialWards = ofKind(places, kinds, 'special_wards')
  const aliases = SPECIAL_WARDS_NAMES.map((name): [string, AdminPlace[]] => [
    placeKey(name),
    specialWards,
  ])
  return new Map([...named, ...aliases])
}

/** 都道府県の名前 → エリアの文字列。 */
function prefectureKeysOf(rows: readonly AreaCatalogRow[]): Map<string, string> {
  return new Map(
    rows.filter((row) => row.kind === 'prefecture').map((row) => [row.nameJa, row.key]),
  )
}

export function buildAdminIndex(
  rows: readonly AreaCatalogRow[],
  stations: readonly CatalogStation[],
): AdminIndex {
  const pointsByCode = pointsByCodeOf(stations)
  const places = rows
    .filter((row) => PLACE_KINDS.has(row.kind))
    .map((row) => placeOf(row, rows, pointsByCode))
  const kinds = new Map(rows.map((row) => [row.key, row.kind]))
  return {
    scope: 'areas',
    placesByName: byName(places, kinds),
    citiesByName: groupBy(ofKind(places, kinds, 'city'), (place) => placeKey(place.value)),
    placesByWard: groupBy(ofKind(places, kinds, 'ward'), wardKey),
    places,
    prefectureKeys: prefectureKeysOf(rows),
  }
}
