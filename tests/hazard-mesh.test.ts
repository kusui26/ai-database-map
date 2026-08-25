import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CELLS_PER_TILE,
  ELEVATION_MISSING_DM,
  ELEVATION_TILE_BYTES,
  HAZARD_TILE_BYTES,
  elevationAtCell,
  elevationTilePath,
  hasTile,
  hazardMeshIndexSchema,
  isElevationTile,
  isHazardTile,
  offsetOfCell,
  rankAtCell,
  rankAtOffset,
  tilePath,
  type HazardMeshIndex,
} from '@/shared/hazard-mesh'
import { meshCellFromLonLat, meshCodeFromLonLat, primaryMeshOf } from '@/shared/mesh'
import { hazardRankOfSourceCode } from '@/domain/hazard/catalog'

/**
 * 配布アーティファクト（`public/hazard/**`）の**規約が読み手と書き手で一致している**ことを、
 * 実物を読んで確かめる。Python が書き、TypeScript が読む形式なので、
 * ここがズレると現在地判定が静かに間違う（`docs/260824_flood.md` §5.3・§10.2）。
 */

const PUBLIC_HAZARD = path.join(process.cwd(), 'public', 'hazard')

function readTile(relative: string): Uint8Array {
  return new Uint8Array(gunzipSync(readFileSync(path.join(PUBLIC_HAZARD, relative))))
}

const index: HazardMeshIndex = hazardMeshIndexSchema.parse(
  JSON.parse(readFileSync(path.join(PUBLIC_HAZARD, 'index.json'), 'utf-8')),
)

/** 東京・亀有駅（荒川・中川の氾濫域。浸水ナビでも最大 3.66m）。 */
const KAMEARI = { lon: 139.847, lat: 35.7645 }
/** 高尾山の山中（同じ 1 次メッシュ 5339 の高台）。 */
const TAKAO = { lon: 139.2438, lat: 35.6252 }

describe('hazard-mesh: ニブル詰めのデコード（純関数）', () => {
  it('上位ニブルが偶数番目・下位が奇数番目', () => {
    const tile = new Uint8Array(HAZARD_TILE_BYTES)
    tile[0] = 0x36 // セル 0 → 3、セル 1 → 6
    tile[1] = 0x0f // セル 2 → 0、セル 3 → 15
    expect(rankAtOffset(tile, 0)).toBe(3)
    expect(rankAtOffset(tile, 1)).toBe(6)
    expect(rankAtOffset(tile, 2)).toBe(0)
    expect(rankAtOffset(tile, 3)).toBe(15)
  })

  it('セル位置 → 添字は行優先（row * 320 + col）', () => {
    expect(offsetOfCell({ primary: '5339', row: 0, col: 0 })).toBe(0)
    expect(offsetOfCell({ primary: '5339', row: 1, col: 0 })).toBe(320)
    expect(offsetOfCell({ primary: '5339', row: 319, col: 319 })).toBe(CELLS_PER_TILE - 1)
  })

  it('大きさが違うバイト列・範囲外の添字は文脈付きで throw', () => {
    expect(() => rankAtOffset(new Uint8Array(10), 0)).toThrow(/ハザードタイルは/)
    expect(() => rankAtOffset(new Uint8Array(HAZARD_TILE_BYTES), CELLS_PER_TILE)).toThrow(
      /タイル添字/,
    )
    expect(() => rankAtOffset(new Uint8Array(HAZARD_TILE_BYTES), -1)).toThrow(/タイル添字/)
    expect(() => offsetOfCell({ primary: '5339', row: 320, col: 0 })).toThrow(/row\/col/)
  })

  it('型ガードは大きさで判定する', () => {
    expect(isHazardTile(new Uint8Array(HAZARD_TILE_BYTES))).toBe(true)
    expect(isHazardTile(new Uint8Array(ELEVATION_TILE_BYTES))).toBe(false)
    expect(isElevationTile(new Uint8Array(ELEVATION_TILE_BYTES))).toBe(true)
    expect(isHazardTile('tile')).toBe(false)
  })

  it('標高はリトルエンディアンの int16 デシメートル・欠損は null', () => {
    const tile = new Uint8Array(ELEVATION_TILE_BYTES)
    const view = new DataView(tile.buffer)
    view.setInt16(0, 32, true) // 3.2m
    view.setInt16(2, -15, true) // -1.5m（海面下）
    view.setInt16(4, ELEVATION_MISSING_DM, true)
    expect(elevationAtCell(tile, { primary: '5339', row: 0, col: 0 })).toBeCloseTo(3.2, 6)
    expect(elevationAtCell(tile, { primary: '5339', row: 0, col: 1 })).toBeCloseTo(-1.5, 6)
    expect(elevationAtCell(tile, { primary: '5339', row: 0, col: 2 })).toBeNull()
  })
})

describe('hazard-mesh: 索引（public/hazard/index.json）', () => {
  it('Zod で読め、規約が読み手の定数と一致する', () => {
    expect(index.cellsPerPrimary).toBe(320)
    expect(index.tileBytes).toBe(HAZARD_TILE_BYTES)
    expect(index.generatedFrom).toBe('pipeline/build_hazard_mesh.py')
    expect(index.elevation.missing).toBe(ELEVATION_MISSING_DM)
  })

  it('メッシュ化したのは洪水 5 種＋内水（決定 4）', () => {
    expect(Object.keys(index.layers).sort()).toEqual(
      [
        'flood_duration',
        'flood_kaoku_hanran',
        'flood_kaoku_kagan',
        'flood_l1',
        'flood_l2',
        'naisui',
      ].sort(),
    )
  })

  it('判定の考え方（代表点・取りこぼしは隣接セルで補う）を索引が明記している', () => {
    expect(index.matchJa).toContain('代表点')
    expect(index.matchJa).toContain('隣接セル')
    expect(index.sourceJa).toContain('国土数値情報')
  })

  it('hasTile / tilePath は索引にあるものだけを返す', () => {
    expect(hasTile(index, 'flood_l2', '5339')).toBe(true)
    expect(hasTile(index, 'flood_l2', '9999')).toBe(false)
    expect(tilePath(index, 'flood_l2', '5339')).toBe('flood_l2/5339.bin.gz')
    expect(tilePath(index, 'flood_l2', '9999')).toBeNull()
    expect(tilePath(index, '___missing___', '5339')).toBeNull()
    expect(elevationTilePath(index, '5339')).toBe('terrain/elev/5339.bin.gz')
    expect(elevationTilePath(index, '9999')).toBeNull()
  })
})

describe('hazard-mesh: 実物のタイルを読む', () => {
  it('タイルは 51,200 バイト（gzip を解いた後）', () => {
    const tile = readTile('flood_l2/5339.bin.gz')
    expect(tile.byteLength).toBe(HAZARD_TILE_BYTES)
    expect(isHazardTile(tile)).toBe(true)
  })

  it('亀有駅は想定最大規模の浸水域内で、床上以上（浸水ナビの 3.66m と整合）', () => {
    const cell = meshCellFromLonLat(KAMEARI.lon, KAMEARI.lat)
    expect(cell.primary).toBe('5339')
    const code = rankAtCell(readTile('flood_l2/5339.bin.gz'), cell)
    expect(code).toBeGreaterThanOrEqual(2) // 2 ＝ 0.5〜3.0m 未満 以上
    const rank = hazardRankOfSourceCode('flood_l2', code)
    expect(
      rank?.level === 'warning' || rank?.level === 'danger' || rank?.level === 'critical',
    ).toBe(true)
  })

  it('高尾山の山中は浸水域外（0・公式タイルの z16 画素とも一致）', () => {
    const cell = meshCellFromLonLat(TAKAO.lon, TAKAO.lat)
    expect(cell.primary).toBe('5339')
    expect(rankAtCell(readTile('flood_l2/5339.bin.gz'), cell)).toBe(0)
  })

  it('標高タイルが読め、亀有は低地・高尾山は山（大小関係が正しい）', () => {
    const tile = readTile('terrain/elev/5339.bin.gz')
    expect(tile.byteLength).toBe(ELEVATION_TILE_BYTES)
    const lowland = elevationAtCell(tile, meshCellFromLonLat(KAMEARI.lon, KAMEARI.lat))
    const mountain = elevationAtCell(tile, meshCellFromLonLat(TAKAO.lon, TAKAO.lat))
    expect(lowland).not.toBeNull()
    expect(mountain).not.toBeNull()
    expect(lowland ?? 0).toBeLessThan(15) // 東京東部低地
    expect(mountain ?? 0).toBeGreaterThan(200) // 高尾山地
  })

  it('値はすべて 0–15 のニブルに収まる（抜き取り 3 レイヤ）', () => {
    for (const layer of ['flood_l2', 'flood_duration', 'flood_kaoku_hanran']) {
      const primary = index.layers[layer]?.primaries[0]
      expect(primary, layer).toBeDefined()
      const tile = readTile(`${layer}/${primary}.bin.gz`)
      let max = 0
      for (let offset = 0; offset < CELLS_PER_TILE; offset += 1) {
        max = Math.max(max, rankAtOffset(tile, offset))
      }
      expect(max, `${layer}/${primary}`).toBeGreaterThan(0)
      expect(max, `${layer}/${primary}`).toBeLessThanOrEqual(15)
    }
  })

  it('メッシュコード経由でも同じセルを引ける（mesh.ts との整合）', () => {
    const code = meshCodeFromLonLat(KAMEARI.lon, KAMEARI.lat)
    expect(primaryMeshOf(code)).toBe('5339')
    const tile = readTile('flood_l2/5339.bin.gz')
    const viaCell = rankAtCell(tile, meshCellFromLonLat(KAMEARI.lon, KAMEARI.lat))
    const viaOffset = rankAtOffset(tile, offsetOfCell(meshCellFromLonLat(KAMEARI.lon, KAMEARI.lat)))
    expect(viaCell).toBe(viaOffset)
  })
})

describe('hazard-mesh: 原典コード → 意味（カタログとの橋渡し）', () => {
  it('浸水深は原典の 6 階級に束ね直される（タイルの 8 階級ではない）', () => {
    const shallow = hazardRankOfSourceCode('flood_l2', 1)
    expect(shallow?.labelJa).toBe('0〜0.5m 未満')
    expect(shallow?.level).toBe('caution')
    const middle = hazardRankOfSourceCode('flood_l2', 2)
    expect(middle?.labelJa).toBe('0.5〜3m 未満')
    expect(middle?.level).toBe('warning')
    const deep = hazardRankOfSourceCode('flood_l2', 3)
    expect(deep?.labelJa).toBe('3〜5m 未満')
    expect(deep?.level).toBe('danger')
    expect(hazardRankOfSourceCode('flood_l2', 6)?.labelJa).toBe('20m 以上')
  })

  it('継続時間は 1 対 1（束ねない）', () => {
    expect(hazardRankOfSourceCode('flood_duration', 5)?.labelJa).toBe('168〜336時間 未満')
    expect(hazardRankOfSourceCode('flood_duration', 7)?.labelJa).toBe('672時間 以上')
  })

  it('家屋倒壊は単一階級で critical', () => {
    expect(hazardRankOfSourceCode('flood_kaoku_hanran', 1)?.level).toBe('critical')
    expect(hazardRankOfSourceCode('flood_kaoku_kagan', 2)?.level).toBe('critical')
  })

  it('0（該当なし）・未知のコード・未知のレイヤは null', () => {
    expect(hazardRankOfSourceCode('flood_l2', 0)).toBeNull()
    expect(hazardRankOfSourceCode('flood_l2', 9)).toBeNull()
    expect(hazardRankOfSourceCode('___missing___', 1)).toBeNull()
  })
})
