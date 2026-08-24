import { describe, expect, it } from 'vitest'
import {
  CELLS_PER_PRIMARY,
  MESH_LEVELS,
  MESH_SIZE_M,
  isCellIndex,
  isMeshCode,
  meshBoundsOf,
  meshCellFromLonLat,
  meshCenterOf,
  meshCodeFromCell,
  meshCodeFromLonLat,
  meshLevelOf,
  meshOffsetInPrimary,
  primaryMeshOf,
} from '@/shared/mesh'

/**
 * 標準地域メッシュの純関数。**ここが静かに間違うと全部が静かに間違う**ので、
 * 境界値（各次のメッシュの角・区画番号 1–4・1 次メッシュの端）を厚く張る。
 *
 * 参照値は独立実装（パイプライン側の Python）で算出したもので、
 * 実データ（2020 年国勢調査 250m メッシュ）に実在するコードを使っている。
 */

/** 実在する 250m メッシュコード → 重心（独立実装で算出・全国に散らした 12 点）。 */
const CENTROID_FIXTURES: readonly { code: string; lon: number; lat: number }[] = [
  { code: '5339452011', lon: 139.6265625, lat: 35.684375 }, // 東京・新宿付近
  { code: '5339452044', lon: 139.6359375, lat: 35.690625 },
  { code: '6441426011', lon: 141.2515625, lat: 43.051041667 }, // 札幌
  { code: '3623076044', lon: 123.8859375, lat: 24.057291667 }, // 与那国（最西端）
  { code: '5237344032', lon: 137.5046875, lat: 34.955208333 },
  { code: '4028072011', lon: 128.8765625, lat: 26.684375 },
  { code: '5133157023', lon: 133.6328125, lat: 34.144791667 },
  { code: '5240256014', lon: 140.6296875, lat: 34.886458333 },
  { code: '5030057041', lon: 130.6328125, lat: 33.396875 },
  { code: '3927463012', lon: 127.7546875, lat: 26.359375 }, // 沖縄本島
  { code: '6039556033', lon: 139.6265625, lat: 40.473958333 },
  { code: '5438116044', lon: 138.1359375, lat: 36.140625 },
]

const EPS_DEG = 1e-9

describe('mesh: 定数', () => {
  it('1 次メッシュは 320 × 320 の 250m セル（2次8 × 3次10 × 4次2 × 5次2）', () => {
    expect(CELLS_PER_PRIMARY).toBe(8 * 10 * 2 * 2)
    expect(MESH_SIZE_M).toBe(250)
    expect([...MESH_LEVELS]).toEqual([1, 2, 3, 4, 5])
  })
})

describe('mesh: コード → 緯度経度', () => {
  it('実データのメッシュコードの重心が独立実装と一致する（12 点）', () => {
    for (const fixture of CENTROID_FIXTURES) {
      const center = meshCenterOf(fixture.code)
      expect(center.lon, fixture.code).toBeCloseTo(fixture.lon, 9)
      expect(center.lat, fixture.code).toBeCloseTo(fixture.lat, 9)
    }
  })

  it('1 次メッシュの範囲は緯度 40 分 × 経度 1 度（5339 → 35.3333–36.0 / 139–140）', () => {
    const bounds = meshBoundsOf('5339')
    expect(bounds.south).toBeCloseTo(53 / 1.5, 9)
    expect(bounds.north).toBeCloseTo(53 / 1.5 + 2 / 3, 9)
    expect(bounds.north).toBeCloseTo(36, 9)
    expect(bounds.west).toBe(139)
    expect(bounds.east).toBe(140)
  })

  it('各次の 1 区画の大きさ（緯度 2/3 → 1/12 → 1/120 → 1/240 → 1/480 度）', () => {
    const codes = ['5339', '533945', '53394520', '533945201', '5339452011']
    const expectedLat = [2 / 3, 1 / 12, 1 / 120, 1 / 240, 1 / 480]
    const expectedLon = [1, 1 / 8, 1 / 80, 1 / 160, 1 / 320]
    codes.forEach((code, index) => {
      const bounds = meshBoundsOf(code)
      expect(bounds.north - bounds.south, code).toBeCloseTo(expectedLat[index] ?? 0, 9)
      expect(bounds.east - bounds.west, code).toBeCloseTo(expectedLon[index] ?? 0, 9)
    })
  })

  it('4 次・5 次の区画番号は 南西1・南東2・北西3・北東4', () => {
    const base = meshBoundsOf('53394520')
    const corners = {
      1: meshBoundsOf('533945201'),
      2: meshBoundsOf('533945202'),
      3: meshBoundsOf('533945203'),
      4: meshBoundsOf('533945204'),
    }
    expect(corners[1].south).toBeCloseTo(base.south, 9)
    expect(corners[1].west).toBeCloseTo(base.west, 9)
    expect(corners[2].south).toBeCloseTo(base.south, 9)
    expect(corners[2].east).toBeCloseTo(base.east, 9)
    expect(corners[3].north).toBeCloseTo(base.north, 9)
    expect(corners[3].west).toBeCloseTo(base.west, 9)
    expect(corners[4].north).toBeCloseTo(base.north, 9)
    expect(corners[4].east).toBeCloseTo(base.east, 9)
  })

  it('meshLevelOf は桁数からレベルを返す', () => {
    expect(meshLevelOf('5339')).toBe(1)
    expect(meshLevelOf('533945')).toBe(2)
    expect(meshLevelOf('53394520')).toBe(3)
    expect(meshLevelOf('533945201')).toBe(4)
    expect(meshLevelOf('5339452011')).toBe(5)
  })

  it('primaryMeshOf は上 4 桁（不正なコードは throw）', () => {
    expect(primaryMeshOf('5339452011')).toBe('5339')
    expect(primaryMeshOf('5339')).toBe('5339')
    expect(() => primaryMeshOf('53394')).toThrow()
  })
})

describe('mesh: 緯度経度 → コード', () => {
  it('重心を戻すと同じコードになる（往復・12 点）', () => {
    for (const fixture of CENTROID_FIXTURES) {
      expect(meshCodeFromLonLat(fixture.lon, fixture.lat), fixture.code).toBe(fixture.code)
    }
  })

  it('区画の南西端は自分のセル・北東端は隣のセル（[south,north) × [west,east)）', () => {
    const code = '5339452011'
    const bounds = meshBoundsOf(code)
    expect(meshCodeFromLonLat(bounds.west, bounds.south)).toBe(code)
    expect(meshCodeFromLonLat(bounds.east - EPS_DEG, bounds.north - EPS_DEG)).toBe(code)
    expect(meshCodeFromLonLat(bounds.east, bounds.south)).not.toBe(code)
    expect(meshCodeFromLonLat(bounds.west, bounds.north)).not.toBe(code)
  })

  it('1 次メッシュの南西端は row/col 0、北東端の直前は 319', () => {
    const bounds = meshBoundsOf('5339')
    const southWest = meshCellFromLonLat(bounds.west, bounds.south)
    expect(southWest).toEqual({ primary: '5339', row: 0, col: 0 })
    const northEast = meshCellFromLonLat(bounds.east - EPS_DEG, bounds.north - EPS_DEG)
    expect(northEast).toEqual({ primary: '5339', row: 319, col: 319 })
  })

  it('セル → コード → セル の往復が 320×320 の代表点で一致する', () => {
    const samples = [0, 1, 39, 40, 41, 159, 160, 161, 318, 319]
    for (const row of samples) {
      for (const col of samples) {
        const cell = { primary: '5339', row, col }
        const roundTrip = meshCellFromLonLat(
          meshCenterOf(meshCodeFromCell(cell)).lon,
          meshCenterOf(meshCodeFromCell(cell)).lat,
        )
        expect(roundTrip, `row=${row} col=${col}`).toEqual(cell)
      }
    }
  })

  it('meshOffsetInPrimary は行優先（0 〜 102,399）', () => {
    expect(meshOffsetInPrimary({ primary: '5339', row: 0, col: 0 })).toBe(0)
    expect(meshOffsetInPrimary({ primary: '5339', row: 0, col: 319 })).toBe(319)
    expect(meshOffsetInPrimary({ primary: '5339', row: 1, col: 0 })).toBe(320)
    expect(meshOffsetInPrimary({ primary: '5339', row: 319, col: 319 })).toBe(
      CELLS_PER_PRIMARY * CELLS_PER_PRIMARY - 1,
    )
  })

  it('1 次メッシュ内の全セルでオフセットが一意（320×320 = 102,400 通り）', () => {
    const seen = new Set<number>()
    for (let row = 0; row < CELLS_PER_PRIMARY; row += 1) {
      for (let col = 0; col < CELLS_PER_PRIMARY; col += 1) {
        seen.add(meshOffsetInPrimary({ primary: '5339', row, col }))
      }
    }
    expect(seen.size).toBe(CELLS_PER_PRIMARY * CELLS_PER_PRIMARY)
  })

  it('1 次メッシュ内の全セルでコードが一意（生成の衝突を全数で否定）', () => {
    const codes = new Set<string>()
    for (let row = 0; row < CELLS_PER_PRIMARY; row += 1) {
      for (let col = 0; col < CELLS_PER_PRIMARY; col += 1) {
        codes.add(meshCodeFromCell({ primary: '5339', row, col }))
      }
    }
    expect(codes.size).toBe(CELLS_PER_PRIMARY * CELLS_PER_PRIMARY)
  })
})

describe('mesh: 型ガードと異常系', () => {
  it('isMeshCode は 4/6/8/9/10 桁の数字列だけを受ける', () => {
    expect(isMeshCode('5339')).toBe(true)
    expect(isMeshCode('5339452011')).toBe(true)
    expect(isMeshCode('53394')).toBe(false) // 5 桁は無い
    expect(isMeshCode('533945201x')).toBe(false)
    expect(isMeshCode(5339452011)).toBe(false)
    expect(isMeshCode(null)).toBe(false)
    expect(isMeshCode('')).toBe(false)
  })

  it('isCellIndex は 0–319 の整数だけを受ける', () => {
    expect(isCellIndex(0)).toBe(true)
    expect(isCellIndex(319)).toBe(true)
    expect(isCellIndex(320)).toBe(false)
    expect(isCellIndex(-1)).toBe(false)
    expect(isCellIndex(1.5)).toBe(false)
    expect(isCellIndex(Number.NaN)).toBe(false)
  })

  it('不正なコードは文脈付きで throw する', () => {
    expect(() => meshCenterOf('53394')).toThrow(/メッシュコード/)
    expect(() => meshCenterOf('533945201x')).toThrow(/メッシュコード/)
    // 4 次・5 次の区画番号は 1–4（0 と 5 は不正）
    expect(() => meshCenterOf('533945200')).toThrow(/区画番号/)
    expect(() => meshCenterOf('533945205')).toThrow(/区画番号/)
    expect(() => meshCenterOf('5339452010')).toThrow(/区画番号/)
    expect(() => meshCenterOf('5339452015')).toThrow(/区画番号/)
  })

  it('範囲外の緯度経度は文脈付きで throw する', () => {
    expect(() => meshCodeFromLonLat(139.7, -1)).toThrow(/緯度が範囲外/)
    expect(() => meshCodeFromLonLat(139.7, 70)).toThrow(/緯度が範囲外/)
    expect(() => meshCodeFromLonLat(99, 35)).toThrow(/経度が範囲外/)
    expect(() => meshCodeFromLonLat(200, 35)).toThrow(/経度が範囲外/)
    expect(() => meshCodeFromLonLat(Number.NaN, 35)).toThrow(/数値ではない/)
    expect(() => meshCodeFromLonLat(139.7, Number.POSITIVE_INFINITY)).toThrow(/数値ではない/)
  })

  it('不正なセルは文脈付きで throw する', () => {
    expect(() => meshCodeFromCell({ primary: '533945', row: 0, col: 0 })).toThrow(
      /1 次メッシュコード/,
    )
    expect(() => meshCodeFromCell({ primary: '5339', row: 320, col: 0 })).toThrow(/row\/col/)
    expect(() => meshOffsetInPrimary({ primary: '5339', row: 0, col: -1 })).toThrow(/row\/col/)
  })
})
