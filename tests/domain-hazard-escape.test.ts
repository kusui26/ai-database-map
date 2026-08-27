import { describe, expect, it } from 'vitest'
import {
  escapeHeadlineJa,
  escapeUnavailableJa,
  nearestOutsideCell,
  outsideAlreadyJa,
  ESCAPE_LIMITATIONS_JA,
  type EscapeCell,
} from '@/domain/hazard/escape'
import { escapeDirectionPanel } from '@/domain/hazard/panels'
import { hazardEscapeResponseSchema } from '@/shared/api'
import { panelSchema } from '@/shared/protocol'
import { meshCenterOfIndices, meshIndicesFromLonLat, type MeshIndices } from '@/shared/mesh'
import { distanceM } from '@/shared/geo'

/**
 * 脱出方向（Phase 5 前半・`docs/260824_flood.md` §8.6）。
 *
 * 守りたいのは 3 つ。
 *  1. **いちばん近い出口を返す**（輪の番号ではなく実距離で比べる。セルは正方形ではない）
 *  2. **「読めなかった」を「区域の外」にしない**（タイルの端が出口になってしまう）
 *  3. **経路案内にしない**（限界の 1 文を落とさない）
 */

const TOKYO = { lon: 139.767, lat: 35.681 }
const START = meshIndicesFromLonLat(TOKYO.lon, TOKYO.lat)

/** 指定したセルだけが「区域の外」で、残りは区域内という格子。 */
function probeWithOutside(outside: readonly MeshIndices[]) {
  const keys = new Set(outside.map((each) => `${each.latIndex}/${each.lonIndex}`))
  return (indices: MeshIndices): EscapeCell =>
    keys.has(`${indices.latIndex}/${indices.lonIndex}`) ? 'outside' : 'inside'
}

function offset(dLat: number, dLon: number): MeshIndices {
  return { latIndex: START.latIndex + dLat, lonIndex: START.lonIndex + dLon }
}

describe('domain/hazard: 脱出方向の探し方', () => {
  it('真北の 1 セル隣を見つける（方角と距離が付く）', () => {
    const result = nearestOutsideCell(TOKYO, START, probeWithOutside([offset(1, 0)]), 40)
    expect(result.target?.bearingJa).toBe('北')
    expect(result.target?.distanceM).toBeGreaterThan(0)
    expect(result.target?.distanceM).toBeLessThan(400)
    expect(result.sawUnknown).toBe(false)
  })

  it('八方位のどれでも見つけられる', () => {
    const cases: readonly [MeshIndices, string][] = [
      [offset(3, 0), '北'],
      [offset(-3, 0), '南'],
      [offset(0, 3), '東'],
      [offset(0, -3), '西'],
      [offset(3, 3), '北東'],
      [offset(-3, -3), '南西'],
    ]
    for (const [cell, bearing] of cases) {
      expect(nearestOutsideCell(TOKYO, START, probeWithOutside([cell]), 40).target?.bearingJa).toBe(
        bearing,
      )
    }
  })

  /**
   * ⚠ ここが要点。輪の番号（チェビシェフ距離）で止めると、**角のセルを先に採ってしまう**。
   * 250m セルは緯度方向 約231m・経度方向 約281m で正方形ではないので、必ず実距離で比べる。
   */
  it('輪の角より、次の輪の真横が近ければ、そちらを採る', () => {
    // 北東へ 2 セル（角）と、北へ 3 セル（真横）。実距離では後者の方が近い。
    const corner = offset(2, 2)
    const straight = offset(3, 0)
    const cornerM = distanceM(
      TOKYO.lon,
      TOKYO.lat,
      meshCenterOfIndices(corner).lon,
      meshCenterOfIndices(corner).lat,
    )
    const straightM = distanceM(
      TOKYO.lon,
      TOKYO.lat,
      meshCenterOfIndices(straight).lon,
      meshCenterOfIndices(straight).lat,
    )
    expect(straightM).toBeLessThan(cornerM)
    const result = nearestOutsideCell(TOKYO, START, probeWithOutside([corner, straight]), 40)
    expect(result.target?.indices).toEqual(straight)
  })

  it('見つからなければ null（**「区域の外が無い」とは言わない**）', () => {
    const result = nearestOutsideCell(TOKYO, START, () => 'inside', 5)
    expect(result.target).toBeNull()
    expect(result.searchedRadiusCells).toBe(5)
  })

  it('読めなかったセルを「外」にしない（タイルの端が出口にならない）', () => {
    const probe = (indices: MeshIndices): EscapeCell =>
      Math.abs(indices.latIndex - START.latIndex) > 2 ? 'unknown' : 'inside'
    const result = nearestOutsideCell(TOKYO, START, probe, 10)
    expect(result.target).toBeNull()
    // 呼び出し側が「範囲を広げるか、注記にする」を判断できる。
    expect(result.sawUnknown).toBe(true)
  })

  it('上限を超えて探さない（20km で打ち切る）', () => {
    let looked = 0
    nearestOutsideCell(
      TOKYO,
      START,
      () => {
        looked += 1
        return 'inside'
      },
      6,
    )
    // 輪 1..6 のセル数の合計（(2r+1)^2 − (2r−1)^2 の和）。
    expect(looked).toBe([1, 2, 3, 4, 5, 6].reduce((sum, r) => sum + 8 * r, 0))
  })
})

describe('domain/hazard: 脱出方向の言い方', () => {
  it('方向は言うが、「移動してください」とは言わない', () => {
    const target = nearestOutsideCell(TOKYO, START, probeWithOutside([offset(2, 0)]), 20).target
    const headline = escapeHeadlineJa('亀有駅', '洪水の想定区域', target, 5_000)
    expect(headline).toContain('北へ')
    expect(headline).toContain('参考情報')
    expect(headline).not.toMatch(/移動してください|避難してください|向かってください/)
  })

  it('見つからなかったときは、そう言って市町村へ送る', () => {
    const headline = escapeHeadlineJa('どこか', '洪水の想定区域', null, 20_000)
    expect(headline).toContain('見つかりませんでした')
    expect(headline).toContain('市町村')
  })

  it('判定できないときは「区域の外」と言い換えない', () => {
    const headline = escapeUnavailableJa('亀有駅', '土砂の想定区域', 'メッシュを持っていません')
    expect(headline).toContain('出せませんでした')
    expect(headline).not.toContain('外です')
  })

  it('すでに外にいるときも「安全」とは言わない', () => {
    expect(outsideAlreadyJa('新宿駅', '洪水の想定区域')).toContain('安全という意味ではありません')
  })

  it('限界の 4 点（直線距離・移動が安全とは限らない・250m の目安・別の災害）を必ず持つ', () => {
    const all = ESCAPE_LIMITATIONS_JA.join('\n')
    expect(all).toContain('直線距離')
    expect(all).toContain('移動する方が安全とは限りません')
    expect(all).toContain('250m メッシュ')
    expect(all).toContain('別の災害')
    expect(all).toContain('市町村')
  })
})

describe('domain/hazard: escapeDirection パネル', () => {
  const response = hazardEscapeResponseSchema.parse({
    point: { lon: 139.847, lat: 35.7645, placeJa: '亀有駅' },
    forDisaster: 'flood',
    forDisasterJa: '洪水の想定区域',
    inside: true,
    direction: {
      bearingJa: '南西',
      distanceM: 3197,
      distanceJa: '約3.2km',
      lon: 139.8171875,
      lat: 35.748958,
    },
    searchRadiusM: 20_000,
    headlineJa: '見出し',
    limitationsJa: [...ESCAPE_LIMITATIONS_JA],
    notesJa: [],
    sources: [{ labelJa: '出典：国土数値情報', url: null, license: '国土数値情報 利用約款' }],
    disclaimerJa: '免責',
  })

  it('応答をそのまま運ぶ（UI で意味づけを足さない）', () => {
    const panel = escapeDirectionPanel(response, 'compact')
    expect(panelSchema.parse(panel)).toBeTruthy()
    expect(panel.type).toBe('escapeDirection')
    expect(panel.direction?.bearingJa).toBe('南西')
    // 限界は**1 行も落とさない**。
    expect(panel.limitationsJa).toEqual(ESCAPE_LIMITATIONS_JA)
  })
})
