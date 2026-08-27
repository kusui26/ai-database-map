import { describe, expect, it } from 'vitest'
import {
  bearingJa,
  distanceJa,
  evacuationHeadlineJa,
  evacuationNotesJa,
  hazardAreaLabelJa,
  rankEvacuationSites,
  EVACUATION_LIMITATIONS_JA,
  EVACUATION_RADIUS_DEFAULT_M,
  EVACUATION_TOP_DEFAULT,
  type EvacuationCandidate,
  type HazardAreaCertainty,
} from '@/domain/hazard/evacuation'
import { evacuationDisasterFor } from '@/domain/hazard/warning-mode'
import {
  disastersOfFeature,
  evacuationDisaster,
  evacuationDisasterKeySchema,
  evacuationFeatureSchema,
  EVACUATION_DISASTERS,
  EVACUATION_HAZARD_GROUP,
  EVACUATION_SITE_KIND_JA,
} from '@/shared/evacuation'
import { boundingBoxAround, distanceM, tilesCovering } from '@/shared/geo'
import { evacuationListPanel } from '@/domain/hazard/panels'
import { panelSchema } from '@/shared/protocol'
import { hazardEvacuationResponseSchema } from '@/shared/api'

/**
 * 避難先（Phase 4 後半・`docs/260824_flood.md` §3.5・§8.5）。
 *
 * ここで守りたいのは §11 のリスク 10（**人命**）——
 * 「避難所に行けと言われて逆に危険な目に遭う」を起こさないことである。
 * だから **①災害種別で必ず絞る ②想定区域にかかるものを黙って先頭に出さない
 * ③開設状況を知っているふりをしない** の 3 つを、それぞれテストで固定する。
 */

const TOKYO = { lon: 139.767, lat: 35.681 }

function candidate(
  nameJa: string,
  lon: number,
  lat: number,
  hazardAreaCertainty: HazardAreaCertainty = null,
): EvacuationCandidate {
  return {
    nameJa,
    addressJa: '東京都千代田区',
    lon,
    lat,
    remarksJa: null,
    disastersJa: ['洪水'],
    hazardAreaCertainty,
    elevationM: null,
  }
}

describe('shared/evacuation: 災害種別の対応表', () => {
  it('国土地理院の 8 レイヤと 1 対 1（番号・キー・プロパティが揃っている）', () => {
    expect(EVACUATION_DISASTERS).toHaveLength(8)
    EVACUATION_DISASTERS.forEach((disaster, index) => {
      expect(disaster.layer).toBe(`skhb${String(index + 1).padStart(2, '0')}`)
      expect(disaster.property).toBe(`disaster${index + 1}`)
      expect(evacuationDisaster(disaster.key)).toBe(disaster)
    })
    // 型（z.enum）と表が同じ集合であること。片方だけ増えても気づけるようにする。
    expect(new Set(EVACUATION_DISASTERS.map((d) => d.key))).toEqual(
      new Set(evacuationDisasterKeySchema.options),
    )
  })

  it('「指定緊急避難場所」であって「指定避難所」ではない', () => {
    expect(EVACUATION_SITE_KIND_JA).toBe('指定緊急避難場所')
    // 限界の文にも必ず書いてある（混同すると「泊まれる」と読まれる）。
    expect(EVACUATION_LIMITATIONS_JA.join('')).toContain('指定避難所')
  })

  it('地物が対応している種別だけを拾う（キーが無いものは「対応していない」）', () => {
    const feature = evacuationFeatureSchema.parse({
      geometry: { type: 'Point', coordinates: [139.7, 35.6] },
      properties: { name: 'A小学校', address: '東京都', remarks: '', disaster1: 1, disaster4: 1 },
    })
    expect(disastersOfFeature(feature).map((d) => d.key)).toEqual(['flood', 'earthquake'])
  })

  it('メッシュで判定できる災害は洪水と内水だけ（決定 4）', () => {
    const withMesh = Object.entries(EVACUATION_HAZARD_GROUP)
      .filter(([, group]) => group !== null)
      .map(([key]) => key)
    expect(withMesh.sort()).toEqual(['flood', 'inland_flood'])
    // すべての種別に項目がある（増えたときに埋め忘れない）。
    expect(Object.keys(EVACUATION_HAZARD_GROUP).sort()).toEqual(
      [...evacuationDisasterKeySchema.options].sort(),
    )
  })
})

describe('domain/hazard: 避難先の並べ方', () => {
  it('八方位（北から時計回り）', () => {
    const north = { lon: TOKYO.lon, lat: TOKYO.lat + 0.1 }
    const east = { lon: TOKYO.lon + 0.1, lat: TOKYO.lat }
    const south = { lon: TOKYO.lon, lat: TOKYO.lat - 0.1 }
    const west = { lon: TOKYO.lon - 0.1, lat: TOKYO.lat }
    expect(bearingJa(TOKYO, north)).toBe('北')
    expect(bearingJa(TOKYO, east)).toBe('東')
    expect(bearingJa(TOKYO, south)).toBe('南')
    expect(bearingJa(TOKYO, west)).toBe('西')
    expect(bearingJa(TOKYO, { lon: TOKYO.lon + 0.1, lat: TOKYO.lat + 0.1 })).toBe('北東')
  })

  it('距離の言い方（1km 未満は 10m 刻み・以上は小数 1 桁の km）', () => {
    expect(distanceJa(0)).toBe('約0m')
    expect(distanceJa(123)).toBe('約120m')
    expect(distanceJa(999)).toBe('約1000m')
    expect(distanceJa(1_000)).toBe('約1.0km')
    expect(distanceJa(4_526)).toBe('約4.5km')
  })

  it('**想定区域にかからないものが先**（近くても区域の中なら下げる）', () => {
    const near = candidate('近いが区域の中', 139.768, 35.681, 'inside')
    const far = candidate('遠いが区域の外', 139.79, 35.681, 'outside')
    const ranked = rankEvacuationSites(TOKYO, [near, far])
    expect(ranked.map((site) => site.nameJa)).toEqual(['遠いが区域の外', '近いが区域の中'])
    // 距離そのものは正しく出る（並びと距離を混同しない）。
    expect(ranked[1]?.distanceM).toBeLessThan(ranked[0]?.distanceM ?? 0)
  })

  it('順は「外 → 判定できない → 一部 → 中」', () => {
    const order: readonly HazardAreaCertainty[] = ['inside', 'partial', null, 'outside']
    const candidates = order.map((certainty, index) =>
      candidate(String(certainty), 139.767 + index * 0.001, 35.681, certainty),
    )
    const ranked = rankEvacuationSites(TOKYO, candidates)
    expect(ranked.map((site) => site.nameJa)).toEqual(['outside', 'null', 'partial', 'inside'])
  })

  it('同じ重なり方なら近い順', () => {
    const ranked = rankEvacuationSites(TOKYO, [
      candidate('遠い', 139.79, 35.681, 'outside'),
      candidate('近い', 139.77, 35.681, 'outside'),
    ])
    expect(ranked.map((site) => site.nameJa)).toEqual(['近い', '遠い'])
  })

  it('既定は上位 5 件', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      candidate(`site-${index}`, 139.767 + index * 0.001, 35.681, 'outside'),
    )
    expect(rankEvacuationSites(TOKYO, many)).toHaveLength(EVACUATION_TOP_DEFAULT)
    expect(rankEvacuationSites(TOKYO, many, 3)).toHaveLength(3)
  })
})

describe('domain/hazard: 避難先の言い方', () => {
  it('先頭を「最寄り」と呼ばない（並びは距離順ではない）', () => {
    const sites = rankEvacuationSites(TOKYO, [
      candidate('近いが区域の中', 139.768, 35.681, 'inside'),
      candidate('遠いが区域の外', 139.79, 35.681, 'outside'),
    ])
    const headline = evacuationHeadlineJa('亀有駅', 'flood', sites, EVACUATION_RADIUS_DEFAULT_M)
    expect(headline).toContain('遠いが区域の外')
    expect(headline).not.toContain('最寄り')
    expect(headline).toContain('洪水')
  })

  it('区域の外が 1 つも無いときは、そう言う（黙って先頭を出さない）', () => {
    const sites = rankEvacuationSites(TOKYO, [candidate('区域の中', 139.77, 35.681, 'inside')])
    const headline = evacuationHeadlineJa('新宿駅', 'flood', sites, EVACUATION_RADIUS_DEFAULT_M)
    expect(headline).toContain('見つかりませんでした')
    expect(headline).toContain('市町村')
  })

  it('0 件でも黙らない（市町村を確認するよう添える）', () => {
    const headline = evacuationHeadlineJa('どこか', 'landslide', [], 5_000)
    expect(headline).toContain('見つかりませんでした')
    expect(headline).toContain('市町村')
    expect(headline).toContain('崖崩れ')
  })

  it('注記は「中」「一部」「判定できない」を数えて出す', () => {
    const sites = rankEvacuationSites(TOKYO, [
      candidate('外', 139.77, 35.681, 'outside'),
      candidate('中', 139.771, 35.681, 'inside'),
      candidate('一部', 139.772, 35.681, 'partial'),
      candidate('不明', 139.773, 35.681, null),
    ])
    const notes = evacuationNotesJa('flood', sites).join('\n')
    expect(notes).toContain('想定区域の中')
    expect(notes).toContain('一部')
    expect(notes).toContain('判定できませんでした')
    // 区域の外だけなら注記は増えない。
    expect(evacuationNotesJa('flood', sites.filter((s) => s.nameJa === '外'))).toEqual([])
  })

  it('言い切れるのは両端だけ（`partial` を「安全」とも「浸水する」とも言わない）', () => {
    expect(hazardAreaLabelJa('outside')).toBe('想定区域にかからない')
    expect(hazardAreaLabelJa('inside')).toBe('想定区域の中')
    expect(hazardAreaLabelJa('partial')).toContain('一部')
    expect(hazardAreaLabelJa(null)).toContain('不明')
  })

  it('限界の 3 点（開設状況・直線距離・指定避難所ではない）を必ず持つ', () => {
    const all = EVACUATION_LIMITATIONS_JA.join('\n')
    expect(all).toContain('開設されているか')
    expect(all).toContain('直線距離')
    expect(all).toContain('指定避難所')
    expect(all).toContain('市町村')
  })
})

describe('domain/hazard: 警戒モードからの橋渡し', () => {
  it('大雨（浸水害）は**内水氾濫**の避難場所を探す（洪水ではない）', () => {
    expect(evacuationDisasterFor([{ code: '03', nameJa: '大雨警報', alertLevel: 3 }], false)).toBe(
      'inland_flood',
    )
  })

  it('土砂・洪水・高潮はそのまま対応する', () => {
    expect(
      evacuationDisasterFor([{ code: '', nameJa: '土砂災害の危険度', alertLevel: 4 }], false),
    ).toBe('landslide')
    expect(evacuationDisasterFor([{ code: '04', nameJa: '洪水警報', alertLevel: 3 }], false)).toBe(
      'flood',
    )
    expect(evacuationDisasterFor([{ code: '08', nameJa: '高潮警報', alertLevel: 4 }], false)).toBe(
      'storm_surge',
    )
    // 指定河川洪水予報があれば必ず洪水。
    expect(evacuationDisasterFor([], true)).toBe('flood')
  })
})

describe('shared/geo: 距離とタイル範囲', () => {
  it('距離は既知の値と合う（東京駅 → 新宿駅 ≒ 6.2km）', () => {
    const metres = distanceM(139.767, 35.681, 139.7005, 35.6896)
    expect(metres).toBeGreaterThan(6_000)
    expect(metres).toBeLessThan(6_400)
    expect(distanceM(139.767, 35.681, 139.767, 35.681)).toBe(0)
  })

  it('矩形は半径を**必ず含む**（端の行き先を取りこぼさない）', () => {
    // 緯度・経度の両方向と、いちばん遠い四隅で確かめる。
    for (const [lon, lat] of [
      [139.767, 35.681],
      [141.35, 43.06], // 札幌（高緯度ほど経度方向の近似が効く）
      [127.68, 26.21], // 那覇
    ]) {
      const box = boundingBoxAround(lon ?? 0, lat ?? 0, 5_000)
      expect(distanceM(lon ?? 0, box.south, lon ?? 0, lat ?? 0)).toBeGreaterThanOrEqual(5_000)
      expect(distanceM(box.west, lat ?? 0, lon ?? 0, lat ?? 0)).toBeGreaterThanOrEqual(5_000)
      expect(distanceM(lon ?? 0, box.north, lon ?? 0, lat ?? 0)).toBeGreaterThanOrEqual(5_000)
      expect(distanceM(box.east, lat ?? 0, lon ?? 0, lat ?? 0)).toBeGreaterThanOrEqual(5_000)
    }
  })

  it('矩形に重なるタイルを列挙する（1〜4 枚に収まる）', () => {
    const tiles = tilesCovering(boundingBoxAround(139.767, 35.681, 5_000), 10)
    expect(tiles.length).toBeGreaterThanOrEqual(1)
    expect(tiles.length).toBeLessThanOrEqual(4)
    // 重複しない。
    expect(new Set(tiles.map((tile) => `${tile.x}/${tile.y}`)).size).toBe(tiles.length)
  })
})

describe('domain/hazard: evacuationList パネル', () => {
  const response = hazardEvacuationResponseSchema.parse({
    point: { lon: 139.847, lat: 35.7645, placeJa: '亀有駅' },
    forDisaster: 'flood',
    forDisasterJa: '洪水',
    siteKindJa: EVACUATION_SITE_KIND_JA,
    searchRadiusM: 5_000,
    headlineJa: '見出し',
    sites: [
      {
        nameJa: '矢切小学校',
        addressJa: '千葉県松戸市中矢切540',
        lon: 139.897,
        lat: 35.763,
        distanceM: 4_526,
        distanceJa: '約4.5km',
        bearingJa: '東',
        disastersJa: ['洪水', '地震'],
        hazardAreaCertainty: 'outside',
        hazardAreaJa: '想定区域にかからない',
        elevationM: 23.5,
        remarksJa: null,
      },
    ],
    limitationsJa: [...EVACUATION_LIMITATIONS_JA],
    notesJa: [],
    sources: [{ labelJa: '出典：国土地理院', url: null, license: '国土地理院コンテンツ利用規約' }],
    disclaimerJa: '免責',
  })

  it('応答をそのまま運ぶ（UI で意味づけを足さない）', () => {
    const panel = evacuationListPanel(response, 'compact')
    expect(panelSchema.parse(panel)).toBeTruthy()
    expect(panel.type).toBe('evacuationList')
    expect(panel.forDisasterJa).toBe('洪水')
    expect(panel.siteKindJa).toBe(EVACUATION_SITE_KIND_JA)
    expect(panel.items).toHaveLength(1)
    // 限界は**1 行も落とさない**。
    expect(panel.limitationsJa).toEqual(EVACUATION_LIMITATIONS_JA)
  })
})
