/**
 * エリアの名前の解決のテスト用の小さな一覧（2026-10-11 B5d）。区域は本物の `area_catalog` と同じ形・同じ鍵で、
 * 同じ名前の扱いを見るのに要るものだけ（「中区」は横浜市と名古屋市・「港区」は東京都と名古屋市・「府中」は東京都と広島県・
 * 駅の無い町＝大島町と府中町）。駅は区域ごとに 1〜2 つ（地図の範囲で決めるときの座標）。
 */

import { type AreaCatalogRow, type CatalogStation } from '@/db/queries'
import { type AreaKind } from '@/shared/area-catalog'

type RowSpec = {
  readonly key: string
  readonly kind: AreaKind
  readonly nameJa: string
  readonly prefecture: string | null
  readonly parentKey: string | null
  readonly groupKey?: string
  readonly stationCount: number
}

function row(spec: RowSpec): AreaCatalogRow {
  const code = spec.key.includes(':') ? (spec.key.split(':')[1] ?? null) : null
  return {
    key: spec.key,
    kind: spec.kind,
    code,
    nameJa: spec.nameJa,
    labelJa: `${spec.prefecture ?? ''}${spec.nameJa}`,
    prefecture: spec.prefecture,
    parentKey: spec.parentKey,
    groupKey: spec.groupKey ?? null,
    missing: [],
    stationCount: spec.stationCount,
  }
}

export const NAME_ROWS: readonly AreaCatalogRow[] = [
  row({
    key: 'jp',
    kind: 'country',
    nameJa: '全国',
    prefecture: null,
    parentKey: null,
    stationCount: 9273,
  }),
  row({
    key: 'pref:13',
    kind: 'prefecture',
    nameJa: '東京都',
    prefecture: '東京都',
    parentKey: 'jp',
    stationCount: 654,
  }),
  row({
    key: 'pref:14',
    kind: 'prefecture',
    nameJa: '神奈川県',
    prefecture: '神奈川県',
    parentKey: 'jp',
    stationCount: 348,
  }),
  row({
    key: 'pref:23',
    kind: 'prefecture',
    nameJa: '愛知県',
    prefecture: '愛知県',
    parentKey: 'jp',
    stationCount: 500,
  }),
  row({
    key: 'pref:34',
    kind: 'prefecture',
    nameJa: '広島県',
    prefecture: '広島県',
    parentKey: 'jp',
    stationCount: 300,
  }),
  row({
    key: 'muni:13100',
    kind: 'special_wards',
    nameJa: '東京23区',
    prefecture: '東京都',
    parentKey: 'pref:13',
    stationCount: 3,
  }),
  row({
    key: 'muni:13101',
    kind: 'municipality',
    nameJa: '千代田区',
    prefecture: '東京都',
    parentKey: 'pref:13',
    groupKey: 'muni:13100',
    stationCount: 2,
  }),
  row({
    key: 'muni:13103',
    kind: 'municipality',
    nameJa: '港区',
    prefecture: '東京都',
    parentKey: 'pref:13',
    groupKey: 'muni:13100',
    stationCount: 1,
  }),
  row({
    key: 'muni:13206',
    kind: 'municipality',
    nameJa: '府中市',
    prefecture: '東京都',
    parentKey: 'pref:13',
    stationCount: 9,
  }),
  row({
    key: 'muni:13361',
    kind: 'municipality',
    nameJa: '大島町',
    prefecture: '東京都',
    parentKey: 'pref:13',
    stationCount: 0,
  }),
  row({
    key: 'muni:14100',
    kind: 'city',
    nameJa: '横浜市',
    prefecture: '神奈川県',
    parentKey: 'pref:14',
    stationCount: 137,
  }),
  row({
    key: 'muni:14104',
    kind: 'ward',
    nameJa: '横浜市中区',
    prefecture: '神奈川県',
    parentKey: 'muni:14100',
    stationCount: 14,
  }),
  row({
    key: 'muni:14109',
    kind: 'ward',
    nameJa: '横浜市港北区',
    prefecture: '神奈川県',
    parentKey: 'muni:14100',
    stationCount: 13,
  }),
  row({
    key: 'muni:14130',
    kind: 'city',
    nameJa: '川崎市',
    prefecture: '神奈川県',
    parentKey: 'pref:14',
    stationCount: 53,
  }),
  row({
    key: 'muni:23100',
    kind: 'city',
    nameJa: '名古屋市',
    prefecture: '愛知県',
    parentKey: 'pref:23',
    stationCount: 120,
  }),
  row({
    key: 'muni:23106',
    kind: 'ward',
    nameJa: '名古屋市中区',
    prefecture: '愛知県',
    parentKey: 'muni:23100',
    stationCount: 20,
  }),
  row({
    key: 'muni:23111',
    kind: 'ward',
    nameJa: '名古屋市港区',
    prefecture: '愛知県',
    parentKey: 'muni:23100',
    stationCount: 10,
  }),
  row({
    key: 'muni:34208',
    kind: 'municipality',
    nameJa: '府中市',
    prefecture: '広島県',
    parentKey: 'pref:34',
    stationCount: 3,
  }),
  row({
    key: 'muni:34302',
    kind: 'municipality',
    nameJa: '府中町',
    prefecture: '広島県',
    parentKey: 'pref:34',
    stationCount: 0,
  }),
]

type StationSpec = readonly [
  grp: string,
  name: string,
  prefecture: string,
  municipality: string,
  code: string,
  lon: number,
  lat: number,
]

function station([
  grp,
  name,
  prefecture,
  municipality,
  code,
  lon,
  lat,
]: StationSpec): CatalogStation {
  return {
    grp,
    name,
    label: name,
    prefecture,
    municipality,
    municipalityCode: code,
    lon,
    lat,
    paxLatest: null,
  }
}

const STATION_SPECS: readonly StationSpec[] = [
  ['竹橋#0', '竹橋', '東京都', '千代田区', '13101', 139.758, 35.69],
  ['東京#0', '東京', '東京都', '千代田区', '13101', 139.767, 35.681],
  ['浜松町#0', '浜松町', '東京都', '港区', '13103', 139.757, 35.655],
  ['府中#0', '府中', '東京都', '府中市', '13206', 139.479, 35.672],
  ['関内#0', '関内', '神奈川県', '横浜市中区', '14104', 139.635, 35.444],
  ['新横浜#0', '新横浜', '神奈川県', '横浜市港北区', '14109', 139.617, 35.507],
  ['栄#0', '栄', '愛知県', '名古屋市中区', '23106', 136.908, 35.17],
  ['名古屋港#0', '名古屋港', '愛知県', '名古屋市港区', '23111', 136.88, 35.09],
  ['府中#1', '府中', '広島県', '府中市', '34208', 133.236, 34.568],
]

export const NAME_STATIONS: readonly CatalogStation[] = STATION_SPECS.map(station)

/** 横浜（中区・港北区が入る）。 */
export const YOKOHAMA_VIEW = { west: 139.55, south: 35.4, east: 139.72, north: 35.55 }
/** 名古屋（中区・港区が入る）。 */
export const NAGOYA_VIEW = { west: 136.8, south: 35.05, east: 137.0, north: 35.25 }
/** 日本全体（「このあたり」が決まらない）。 */
export const JAPAN_VIEW = { west: 122.9, south: 24.0, east: 153.9, north: 45.6 }
