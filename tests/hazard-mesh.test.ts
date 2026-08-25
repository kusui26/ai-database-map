import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CELLS_PER_TILE,
  COVERAGE_STEPS,
  ELEVATION_MISSING_DM,
  ELEVATION_TILE_BYTES,
  HAZARD_TILE_BYTES,
  MESH_FORMAT_VERSION,
  cellAt,
  cellAtOffset,
  certaintyAtCell,
  coverageAtCell,
  elevationAtCell,
  elevationTilePath,
  hasTile,
  hazardMeshIndexSchema,
  isElevationTile,
  isHazardTile,
  offsetOfCell,
  parseHazardMeshIndex,
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
 * ここがズレると現在地判定が静かに間違う（`docs/260824_flood.md` §5.9・§10.2）。
 *
 * v2 の要点は **1 セル ＝ (最大ランク, 被覆率) の「区間」**であること。
 * 「点の神託」として読んではいけない、というのがこの一連のテストの主張である。
 */

const PUBLIC_HAZARD = path.join(process.cwd(), 'public', 'hazard')

function readTile(relative: string): Uint8Array {
  return new Uint8Array(gunzipSync(readFileSync(path.join(PUBLIC_HAZARD, relative))))
}

const rawIndex: unknown = JSON.parse(
  readFileSync(path.join(PUBLIC_HAZARD, 'index.json'), 'utf-8'),
)
const index: HazardMeshIndex = parseHazardMeshIndex(rawIndex)

/** 東京・亀有駅（荒川・中川の氾濫域。浸水ナビでも最大 3.66m）。 */
const KAMEARI = { lon: 139.847, lat: 35.7645 }
/** 高尾山の山頂付近（同じ 1 次メッシュ 5339 の高台。谷の浸水域が 250m セルを掠める）。 */
const TAKAO = { lon: 139.2438, lat: 35.6252 }
/** 高尾山の南西の尾根（周囲 5×5 セルまで浸水域が一切かからない）。 */
const RIDGE = { lon: 139.21094, lat: 35.61979 }

describe('hazard-mesh: 1 バイトの分解（純関数）', () => {
  it('上位ニブルが最大ランク・下位ニブルが被覆率', () => {
    const tile = new Uint8Array(HAZARD_TILE_BYTES)
    tile[0] = 0x3f // 最大 3・被覆率 15（全域）
    tile[1] = 0x21 // 最大 2・被覆率 1（ごく一部）
    tile[2] = 0x00 // 一切かからない
    expect(cellAtOffset(tile, 0)).toEqual({ rank: 3, coverage: 1, certainty: 'inside' })
    expect(cellAtOffset(tile, 1)).toEqual({
      rank: 2,
      coverage: 1 / COVERAGE_STEPS,
      certainty: 'partial',
    })
    expect(cellAtOffset(tile, 2)).toEqual({ rank: 0, coverage: 0, certainty: 'outside' })
  })

  it('確定した主張ができるのは被覆率の両端だけ', () => {
    const tile = new Uint8Array(HAZARD_TILE_BYTES)
    const certainties = [0, 1, 7, 14, 15].map((steps, offset) => {
      tile[offset] = (1 << 4) | steps
      return cellAtOffset(tile, offset).certainty
    })
    expect(certainties).toEqual(['outside', 'partial', 'partial', 'partial', 'inside'])
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
    expect(index.version).toBe(MESH_FORMAT_VERSION)
    expect(index.cellsPerPrimary).toBe(320)
    expect(index.tileBytes).toBe(HAZARD_TILE_BYTES)
    expect(index.coverageSteps).toBe(COVERAGE_STEPS)
    expect(index.subcellsPerCell).toBe(64)
    expect(index.generatedFrom).toBe('pipeline/build_hazard_mesh.py')
    expect(index.elevation.missing).toBe(ELEVATION_MISSING_DM)
  })

  it('版や規約がズレた索引は読まずに落とす（静かに間違うより落ちる）', () => {
    const parsed = hazardMeshIndexSchema.parse(rawIndex)
    expect(() => parseHazardMeshIndex({ ...parsed, version: 1 })).toThrow(/版が読み手と違う/)
    expect(() => parseHazardMeshIndex({ ...parsed, tileBytes: 51200 })).toThrow(
      /規約が読み手と違う/,
    )
    expect(() => parseHazardMeshIndex({ ...parsed, coverageSteps: 7 })).toThrow(
      /規約が読み手と違う/,
    )
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

  it('セルが「点ではなく区間」であることを索引が明記している', () => {
    expect(index.matchJa).toContain('区間')
    expect(index.matchJa).toContain('上界')
    expect(index.matchJa).toContain('被覆率')
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
  const floodTokyo = readTile('flood_l2/5339.bin.gz')

  it('タイルは 102,400 バイト（gzip を解いた後）', () => {
    expect(floodTokyo.byteLength).toBe(HAZARD_TILE_BYTES)
    expect(isHazardTile(floodTokyo)).toBe(true)
  })

  it('亀有駅は想定最大規模の浸水域に全域が入り、床上以上（浸水ナビの 3.66m と整合）', () => {
    const cell = meshCellFromLonLat(KAMEARI.lon, KAMEARI.lat)
    expect(cell.primary).toBe('5339')
    const { rank, certainty } = cellAt(floodTokyo, cell)
    expect(certainty).toBe('inside') // 東京東部低地。セルの端まで浸水域
    expect(rank).toBeGreaterThanOrEqual(2) // 2 ＝ 0.5〜3.0m 未満 以上
    const meaning = hazardRankOfSourceCode('flood_l2', rank)
    expect(
      meaning?.level === 'warning' || meaning?.level === 'danger' || meaning?.level === 'critical',
    ).toBe(true)
  })

  it('高尾山の山頂は「一部」——谷の浸水域がセルを掠めるが、被覆率はごく僅か', () => {
    const cell = meshCellFromLonLat(TAKAO.lon, TAKAO.lat)
    expect(cell.primary).toBe('5339')
    const { rank, coverage, certainty } = cellAt(floodTokyo, cell)
    // v1 は代表点で「0（浸水域外）」と言い切っていた。実際にはセルの端に浸水域があり、
    // かといって「浸水想定区域内」と言うのも嘘。v2 はこれを「一部」と表せる。
    expect(certainty).toBe('partial')
    expect(rank).toBeGreaterThan(0)
    expect(coverage).toBeGreaterThan(0)
    expect(coverage).toBeLessThan(0.2)
  })

  it('尾根の上は「一切かからない」と言い切れる（被覆率 0）', () => {
    const cell = meshCellFromLonLat(RIDGE.lon, RIDGE.lat)
    expect(cellAt(floodTokyo, cell)).toEqual({ rank: 0, coverage: 0, certainty: 'outside' })
  })

  it('不変条件：最大 > 0 ⟺ 被覆率 > 0（タイル全数）', () => {
    let mismatched = 0
    for (let offset = 0; offset < CELLS_PER_TILE; offset += 1) {
      const { rank, coverage } = cellAtOffset(floodTokyo, offset)
      if (rank > 0 !== coverage > 0) mismatched += 1
    }
    expect(mismatched).toBe(0)
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

  it('値はすべてニブルに収まり、混在セルが実在する（抜き取り 3 レイヤ）', () => {
    for (const layer of ['flood_l2', 'flood_duration', 'flood_kaoku_hanran']) {
      const primary = index.layers[layer]?.primaries[0]
      expect(primary, layer).toBeDefined()
      const tile = readTile(`${layer}/${primary}.bin.gz`)
      let maxRank = 0
      let partial = 0
      for (let offset = 0; offset < CELLS_PER_TILE; offset += 1) {
        const cell = cellAtOffset(tile, offset)
        maxRank = Math.max(maxRank, cell.rank)
        if (cell.certainty === 'partial') partial += 1
      }
      expect(maxRank, `${layer}/${primary}`).toBeGreaterThan(0)
      expect(maxRank, `${layer}/${primary}`).toBeLessThanOrEqual(15)
      // 混在セルが 0 なら、それは「区間で持つ意味が無い」＝焼き方が壊れている合図。
      expect(partial, `${layer}/${primary}`).toBeGreaterThan(0)
    }
  })

  it('メッシュコード経由でも同じセルを引ける（mesh.ts との整合）', () => {
    const code = meshCodeFromLonLat(KAMEARI.lon, KAMEARI.lat)
    expect(primaryMeshOf(code)).toBe('5339')
    const cell = meshCellFromLonLat(KAMEARI.lon, KAMEARI.lat)
    expect(rankAtCell(floodTokyo, cell)).toBe(rankAtOffset(floodTokyo, offsetOfCell(cell)))
    expect(coverageAtCell(floodTokyo, cell)).toBe(cellAt(floodTokyo, cell).coverage)
    expect(certaintyAtCell(floodTokyo, cell)).toBe(cellAt(floodTokyo, cell).certainty)
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
