/**
 * ドメイン：共通 API のエリアの条件（`src/domain/area.ts`・`src/domain/filters.ts`・2026-10-08 B2）。
 *
 * 共通 API（ランキング・散布・駅の一覧）は決まった値だけを受ける（言い方の解決は AI の入口）。ここで固定するのは：
 *
 * - 範囲は「西,南,東,北」の 4 つの数（並び・数・経度緯度の外は理由つきで断る＝黙って全国にしない）
 * - 起点は駅（grp）と半径の組。座標と表示名はサーバが引く。知らない駅は理由を返す
 * - DB へは座標と半径を、応答へは起点の grp・表示名・半径を（座標は返さない）
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { type StationRow } from '@/shared/api'

const db = vi.hoisted(() => ({ stationByGrp: vi.fn(), linesByCodes: vi.fn(), lineNames: vi.fn() }))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const {
  BBOX_ERROR_JA,
  NO_AREA,
  areaEcho,
  areaEchoOf,
  areaFilter,
  hasArea,
  nearOf,
  parseBbox,
  resolveArea,
} = await import('@/domain/area')
const { resolveFilters } = await import('@/domain/filters')

const TAKEBASHI: StationRow = {
  grp: '竹橋#0',
  stationName: '竹橋',
  label: '竹橋',
  searchLabel: '竹橋（東京都）',
  prefecture: '東京都',
  municipality: '千代田区',
  lon: 139.75852,
  lat: 35.69028,
  nOp: 1,
  operators: '東京地下鉄',
  paxLatest: 42156,
  lpNearUse: null,
  levelComplete: true,
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('parseBbox（「西,南,東,北」）', () => {
  it('4 つの数（空白も許す）', () => {
    expect(parseBbox('139.5,35.4,139.8,35.6')).toEqual({
      west: 139.5,
      south: 35.4,
      east: 139.8,
      north: 35.6,
    })
    expect(parseBbox(' 139.5 , 35.4 ,139.8, 35.6 ')).toEqual({
      west: 139.5,
      south: 35.4,
      east: 139.8,
      north: 35.6,
    })
  })

  it.each([
    ['3 つ', '139.5,35.4,139.8'],
    ['5 つ', '139.5,35.4,139.8,35.6,1'],
    ['数でない', '139.5,35.4,east,35.6'],
    ['空', ''],
    ['西と東が逆', '139.8,35.4,139.5,35.6'],
    ['南と北が同じ', '139.5,35.4,139.8,35.4'],
    ['経度の外', '139.5,35.4,181,35.6'],
    ['緯度の外', '139.5,-91,139.8,35.6'],
  ])('%s は null', (_label, raw) => {
    expect(parseBbox(raw)).toBeNull()
  })
})

describe('resolveArea（共通 API の値の検証と解決）', () => {
  it('何も無ければエリアは無く、DB にも行かない', async () => {
    expect(await resolveArea({})).toEqual({ ok: true, area: NO_AREA })
    expect(db.stationByGrp).not.toHaveBeenCalled()
  })

  it('市区町村は前後の空白を除く。空なら絞らない', async () => {
    expect(await resolveArea({ municipality: ' 横浜市 ' })).toEqual({
      ok: true,
      area: { municipality: '横浜市', bbox: null, near: null },
    })
    expect(await resolveArea({ municipality: '  ' })).toEqual({ ok: true, area: NO_AREA })
  })

  it('形の崩れた範囲は、直し方を返す', async () => {
    expect(await resolveArea({ bbox: '139.8,35.4,139.5,35.6' })).toEqual({
      ok: false,
      messageJa: BBOX_ERROR_JA,
    })
  })

  it('起点の駅は座標と表示名を DB で引く', async () => {
    db.stationByGrp.mockResolvedValue(TAKEBASHI)
    expect(await resolveArea({ nearStation: '竹橋#0', withinM: 5000 })).toEqual({
      ok: true,
      area: {
        municipality: null,
        bbox: null,
        near: { grp: '竹橋#0', label: '竹橋', lon: 139.75852, lat: 35.69028, radiusM: 5000 },
      },
    })
    expect(db.stationByGrp).toHaveBeenCalledWith('竹橋#0')
  })

  it('知らない起点は、調べ方つきで断る', async () => {
    db.stationByGrp.mockResolvedValue(null)
    expect(await resolveArea({ nearStation: '無い駅#0', withinM: 5000 })).toEqual({
      ok: false,
      messageJa:
        '知らない駅です: 無い駅#0（GET /api/stations?q= で調べた grp を nearStation に指定してください）',
    })
  })

  it.each([
    ['起点だけ', { nearStation: '竹橋#0' }],
    ['半径だけ', { withinM: 5000 }],
  ])('%s は、組で指定するよう断る（DB に行かない）', async (_label, query) => {
    const result = await resolveArea(query)
    expect(result).toEqual({
      ok: false,
      messageJa:
        'nearStation（起点の駅の grp）と withinM（起点から何 m 以内か）は組で指定してください。',
    })
    expect(db.stationByGrp).not.toHaveBeenCalled()
  })

  it('範囲が崩れていれば、起点を引きに行かない', async () => {
    await resolveArea({ bbox: '1,2,3', nearStation: '竹橋#0', withinM: 5000 })
    expect(db.stationByGrp).not.toHaveBeenCalled()
  })
})

describe('areaFilter・areaEcho（DB へ・応答へ）', () => {
  const near = nearOf({ grp: '竹橋#0', label: '竹橋', lon: 139.75852, lat: 35.69028 }, 5000)
  const bbox = { west: 139.5, south: 35.4, east: 139.8, north: 35.6 }
  const area = { municipality: '横浜市', bbox, near }

  it('DB へは座標と半径（起点の名前は渡さない）。無い条件は載せない', () => {
    expect(areaFilter(area)).toEqual({
      municipality: '横浜市',
      bbox,
      near: { lon: 139.75852, lat: 35.69028, radiusM: 5000 },
    })
    expect(areaFilter(NO_AREA)).toEqual({})
  })

  it('応答へは起点の grp・表示名・半径（座標は返さない）', () => {
    expect(areaEcho(area)).toEqual({
      municipality: '横浜市',
      bbox,
      near: { grp: '竹橋#0', label: '竹橋', radiusM: 5000 },
    })
    expect(areaEchoOf(undefined)).toEqual({ municipality: null, bbox: null, near: null })
  })

  it('hasArea：どれか 1 つでもあれば true', () => {
    expect(hasArea(NO_AREA)).toBe(false)
    expect(hasArea({ ...NO_AREA, municipality: '港区' })).toBe(true)
    expect(hasArea({ ...NO_AREA, bbox })).toBe(true)
    expect(hasArea({ ...NO_AREA, near })).toBe(true)
  })
})

describe('resolveFilters（ランキング・散布の絞り込みをまとめて解決）', () => {
  const BASE = {
    prefectures: ['東京都'],
    operators: [],
    routes: ['山手線'],
    routeTypes: [1],
    lines: [],
  }

  it('エリアを DB の絞り込みと応答の名前の両方に入れる（法令上の路線・種別もそのまま）', async () => {
    db.stationByGrp.mockResolvedValue(TAKEBASHI)
    const result = await resolveFilters({
      ...BASE,
      municipality: '千代田区',
      nearStation: '竹橋#0',
      withinM: 3000,
    })
    if (!result.ok) throw new Error(result.messageJa)
    expect(result.filters.filter).toEqual({
      prefectures: ['東京都'],
      operators: [],
      routes: ['山手線'],
      routeTypes: [1],
      lines: [],
      municipality: '千代田区',
      near: { lon: 139.75852, lat: 35.69028, radiusM: 3000 },
    })
    expect(result.filters.area).toEqual({
      municipality: '千代田区',
      bbox: null,
      near: { grp: '竹橋#0', label: '竹橋', radiusM: 3000 },
    })
    // 路線コード・会社の指定が無ければ、名前を引きにも行かない
    expect(db.linesByCodes).not.toHaveBeenCalled()
    expect(db.lineNames).not.toHaveBeenCalled()
  })

  it('エリアが崩れていれば理由を返す（DB の絞り込みを作らない）', async () => {
    expect(await resolveFilters({ ...BASE, bbox: 'x' })).toEqual({
      ok: false,
      messageJa: BBOX_ERROR_JA,
    })
  })
})
