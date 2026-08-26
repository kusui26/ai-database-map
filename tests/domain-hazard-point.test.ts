import { describe, expect, it } from 'vitest'
import { pointHazard, type PointHazardInput } from '@/domain/hazard/point'
import { hazardVerdict, type VerdictItem } from '@/domain/hazard/verdict'
import {
  certaintyOf,
  coverageAmountJa,
  noHazardHeadlineJa,
  valuePhraseJa,
  weakestCertainty,
} from '@/domain/hazard/wording'
import {
  hazardRankOfColor,
  hazardRankOfDepth,
  hazardLayersWithPointAnswer,
} from '@/domain/hazard/catalog'
import { hazardPointResponseSchema } from '@/shared/api'

/**
 * 地点のハザード（Phase 2・`docs/260824_flood.md` §6.1〜§6.3・§8.3）。
 *
 * ここで固定するのは**言い切ってよい場所と、言い切ってはいけない場所**である。
 * - 情報源は ①浸水ナビ → ②公式タイル → ③メッシュ の順で採り、`source` に必ず残す
 * - メッシュの区間でしか言えないときは「入っています」と**断定しない**
 * - 何にも当たらないときに「安全です」と**言わない**
 */

/** 亀有駅（荒川・中川の氾濫域）。座標は他のテストと同じものを使う。 */
const KAMEARI = { lon: 139.847, lat: 35.7645 }

const ALL_LAYERS = hazardLayersWithPointAnswer()

function input(overrides: Partial<PointHazardInput> = {}): PointHazardInput {
  return {
    lon: KAMEARI.lon,
    lat: KAMEARI.lat,
    placeJa: '亀有駅',
    mesh: [],
    tile: [],
    rivers: [],
    elevationM: 0.2,
    online: true,
    notesJa: [],
    ...overrides,
  }
}

describe('hazard/point: 情報源は良いものから順に採る（§6.3）', () => {
  const mesh = [{ layerKey: 'flood_l2', sourceCode: 2, coverage: 1, neighbourSourceCode: 2 }]
  const tile = [{ layerKey: 'flood_l2', hex: '#FFB7B7' }] // 3〜5m 未満
  const rivers = [{ nameJa: '荒川', maxDepthM: 3.66, arriveMin: 162, continueMin: 5283 }]

  it('浸水ナビがあれば実測 m を採り、階級も m から引く', () => {
    const result = pointHazard(input({ mesh, tile, rivers }), ALL_LAYERS)
    const flood = result.hazards.find((item) => item.layerKey === 'flood_l2')
    expect(flood?.source).toBe('suibou-navi')
    expect(flood?.valueJa).toBe('3.66m・3〜5m 未満')
    expect(flood?.certainty).toBe('exact')
    expect(flood?.coverage).toBeNull()
  })

  it('浸水ナビが無ければ公式タイルの画素（地図の色と必ず一致する）', () => {
    const result = pointHazard(input({ mesh, tile }), ALL_LAYERS)
    const flood = result.hazards.find((item) => item.layerKey === 'flood_l2')
    expect(flood?.source).toBe('tile')
    expect(flood?.valueJa).toBe('3〜5m 未満')
    expect(flood?.certainty).toBe('exact')
  })

  it('どちらも無ければメッシュ（区間・被覆率つき）', () => {
    const result = pointHazard(input({ mesh }), ALL_LAYERS)
    const flood = result.hazards.find((item) => item.layerKey === 'flood_l2')
    expect(flood?.source).toBe('mesh')
    expect(flood?.coverage).toBe(1)
    expect(flood?.certainty).toBe('exact') // 被覆率 1 ＝ セル全域が区域なので言い切れる
  })

  it('メッシュの被覆率が 1 未満なら partial で、値そのものに幅を織り込む', () => {
    const partial = [{ layerKey: 'flood_l2', sourceCode: 2, coverage: 0.4, neighbourSourceCode: 2 }]
    const flood = pointHazard(input({ mesh: partial }), ALL_LAYERS).hazards[0]
    expect(flood?.certainty).toBe('partial')
    expect(flood?.valueJa).toBe('0.5〜3m 未満（このメッシュの約 40%）')
  })
})

describe('hazard/point: 区間でしか言えないときは断定しない（§5.9）', () => {
  it('被覆率が 1 未満なら「入っています」と言わず、位置の確認を促す', () => {
    const mesh = [{ layerKey: 'flood_l2', sourceCode: 1, coverage: 1 / 15, neighbourSourceCode: 1 }]
    const result = pointHazard(input({ mesh }), ALL_LAYERS)
    expect(result.verdict.headlineJa).not.toContain('入っています')
    expect(result.verdict.headlineJa).toContain('ごく一部')
    expect(result.verdict.headlineJa).toContain('地図でご確認ください')
    expect(result.certainty).toBe('partial')
  })

  it('被覆率 1（全域）なら言い切ってよい', () => {
    const mesh = [{ layerKey: 'flood_l2', sourceCode: 3, coverage: 1, neighbourSourceCode: 3 }]
    const result = pointHazard(input({ mesh }), ALL_LAYERS)
    expect(result.verdict.headlineJa).toContain('入っています')
    expect(result.certainty).toBe('exact')
  })

  it('隣の 250m メッシュだけが区域なら、そう言う（GPS 誤差を補う・§8.3）', () => {
    const mesh = [{ layerKey: 'flood_l2', sourceCode: 0, coverage: 0, neighbourSourceCode: 3 }]
    const result = pointHazard(input({ mesh }), ALL_LAYERS)
    expect(result.hazards).toHaveLength(0)
    expect(result.neighbours).toEqual([
      { layerKey: 'flood_l2', labelJa: '洪水浸水想定区域（想定最大規模）', level: 'danger' },
    ])
    expect(result.coverageNotesJa.some((note) => note.includes('隣の 250m メッシュ'))).toBe(true)
  })
})

describe('hazard/point: 「該当なし」を「安全」と訳さない（§7.5）', () => {
  it('何にも当たらなくても「安全」とは言わない', () => {
    const result = pointHazard(input(), ALL_LAYERS)
    expect(result.hazards).toHaveLength(0)
    expect(result.verdict.headlineJa).toContain('安全という意味ではありません')
    expect(result.verdict.headlineJa).not.toMatch(/安全です|問題ありません/)
  })

  it('オンラインで全レイヤ確認できたなら「その場に留まる」と言える', () => {
    const result = pointHazard(input(), ALL_LAYERS)
    expect(result.certainty).toBe('exact')
    expect(result.verdict.evacuation).toBe('stay')
  })

  it('オフライン（メッシュだけ）なら確からしさは unknown で、行動を断定しない', () => {
    const result = pointHazard(input({ online: false }), ALL_LAYERS)
    expect(result.certainty).toBe('unknown')
    expect(result.verdict.evacuation).toBeNull()
    expect(result.verdict.headlineJa).toContain('オフライン')
  })

  it('網羅性の注記は必ず出て、同じ文は 1 行に畳まれる', () => {
    const notes = pointHazard(input(), ALL_LAYERS).coverageNotesJa
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.length).toBeLessThan(ALL_LAYERS.length) // 11 レイヤ → 畳んで数行
    expect(new Set(notes).size).toBe(notes.length)
    expect(notes.some((note) => note.includes('内水') && note.includes('22'))).toBe(true)
  })
})

describe('hazard/point: 応答の骨格', () => {
  it('メッシュコード・中心・標高・免責が揃う', () => {
    const result = pointHazard(input(), ALL_LAYERS)
    expect(result.mesh.code).toBe('5339561742')
    expect(result.mesh.sizeM).toBe(250)
    expect(result.mesh.center.lon).toBeCloseTo(139.8484, 3)
    expect(result.terrain.elevMeanM).toBe(0.2)
    expect(result.disclaimerJa.length).toBeGreaterThan(0)
  })

  it('危険度の重い順に並ぶ', () => {
    const mesh = [
      { layerKey: 'flood_l2', sourceCode: 1, coverage: 1, neighbourSourceCode: 1 }, // caution
      { layerKey: 'flood_kaoku_hanran', sourceCode: 1, coverage: 1, neighbourSourceCode: 1 }, // critical
    ]
    const result = pointHazard(input({ mesh }), ALL_LAYERS)
    expect(result.hazards.map((item) => item.layerKey)).toEqual(['flood_kaoku_hanran', 'flood_l2'])
  })

  it('部分応答であることを隠さない（notesJa をそのまま返す）', () => {
    const notesJa = ['河川別の浸水深・到達時間は取得できませんでした']
    expect(pointHazard(input({ notesJa }), ALL_LAYERS).notesJa).toEqual(notesJa)
  })

  it('共通API の契約（Zod）にそのまま通る', () => {
    const mesh = [{ layerKey: 'flood_l2', sourceCode: 3, coverage: 0.6, neighbourSourceCode: 3 }]
    const rivers = [{ nameJa: '荒川', maxDepthM: 3.66, arriveMin: 162, continueMin: 5283 }]
    const result = pointHazard(input({ mesh, rivers }), ALL_LAYERS)
    expect(() => hazardPointResponseSchema.parse(result)).not.toThrow()
  })
})

describe('hazard/verdict: §6.2 の表と 1 対 1', () => {
  function item(overrides: Partial<VerdictItem>): VerdictItem {
    return {
      layerKey: 'flood_l2',
      labelJa: '洪水浸水想定区域（想定最大規模）',
      valueJa: '3〜5m 未満',
      rankLabelJa: '3〜5m 未満',
      level: 'danger',
      min: 3,
      meaningJa: '2 階部分が浸水する高さ',
      certainty: 'exact',
      coverage: null,
      ...overrides,
    }
  }

  it('① 家屋倒壊等氾濫想定区域は、深さに関係なく立退き', () => {
    const verdict = hazardVerdict(
      [item({ layerKey: 'flood_kaoku_hanran', min: null, level: 'critical' })],
      'exact',
    )
    expect(verdict.evacuation).toBe('takeaway')
    expect(verdict.reasonsJa[0]).toContain('上階に留まるのは危険')
  })

  it('② 土砂災害警戒区域は立退き', () => {
    const verdict = hazardVerdict(
      [item({ layerKey: 'dosekiryu', labelJa: '土砂災害警戒区域（土石流）', min: null })],
      'exact',
    )
    expect(verdict.evacuation).toBe('takeaway')
  })

  it('③ 浸水深 3m 以上は立退き（2.9m は垂直）', () => {
    expect(hazardVerdict([item({ min: 3 })], 'exact').evacuation).toBe('takeaway')
    expect(hazardVerdict([item({ min: 2.9 })], 'exact').evacuation).toBe('vertical')
  })

  it('④ 浸水継続時間 72 時間以上は立退き', () => {
    const duration = item({
      layerKey: 'flood_duration',
      labelJa: '浸水継続時間（想定最大規模）',
      valueJa: '72〜168時間',
      rankLabelJa: '72〜168時間',
      min: 72,
    })
    expect(hazardVerdict([duration], 'exact').evacuation).toBe('takeaway')
  })

  it('⑤ 浸水深 3m 未満は垂直避難も選択肢', () => {
    expect(hazardVerdict([item({ min: 0 })], 'exact').evacuation).toBe('vertical')
  })

  it('⑥ 該当なし＋情報が揃っていれば「その場に留まる」', () => {
    expect(hazardVerdict([], 'exact').evacuation).toBe('stay')
  })

  it('優先順位どおり、より重い規則が勝つ', () => {
    const shallow = item({ min: 0, level: 'caution' })
    const collapse = item({ layerKey: 'flood_kaoku_kagan', min: null, level: 'critical' })
    expect(hazardVerdict([shallow, collapse], 'exact').evacuation).toBe('takeaway')
    expect(hazardVerdict([shallow, collapse], 'exact').level).toBe('critical')
  })

  it('同じ規則に複数当たっても根拠は 1 文（同じ文が並ばない）', () => {
    const verdict = hazardVerdict(
      [
        item({ min: 3 }),
        item({ layerKey: 'flood_l1', labelJa: '洪水浸水想定区域（計画規模）', min: 3 }),
      ],
      'exact',
    )
    expect(verdict.reasonsJa).toHaveLength(1)
  })
})

describe('hazard/wording: 確からしさと言い方', () => {
  it('メッシュ以外は点で確定、メッシュは被覆率で決まる', () => {
    expect(certaintyOf('suibou-navi', null)).toBe('exact')
    expect(certaintyOf('tile', null)).toBe('exact')
    expect(certaintyOf('mesh', 1)).toBe('exact')
    expect(certaintyOf('mesh', 0.5)).toBe('partial')
    expect(certaintyOf('mesh', null)).toBe('unknown')
  })

  it('全体の確からしさは最も弱いものに合わせる', () => {
    expect(weakestCertainty(['exact', 'exact'])).toBe('exact')
    expect(weakestCertainty(['exact', 'partial'])).toBe('partial')
    expect(weakestCertainty(['partial', 'unknown'])).toBe('unknown')
    expect(weakestCertainty([])).toBe('exact')
  })

  it('被覆率の量は両端だけが厳密（1/15 以下は「ごく一部」）', () => {
    expect(coverageAmountJa(1)).toBe('全域')
    expect(coverageAmountJa(1 / 15)).toBe('ごく一部')
    expect(coverageAmountJa(0.5)).toBe('約 50%')
  })

  it('値の言い方は情報源で変わる', () => {
    expect(valuePhraseJa('3〜5m 未満', 'suibou-navi', 3.66, null)).toBe('3.66m・3〜5m 未満')
    expect(valuePhraseJa('3〜5m 未満', 'tile', null, null)).toBe('3〜5m 未満')
    expect(valuePhraseJa('3〜5m 未満', 'mesh', null, 1)).toBe('3〜5m 未満')
    expect(valuePhraseJa('3〜5m 未満', 'mesh', null, 0.2)).toBe(
      '3〜5m 未満（このメッシュの約 20%）',
    )
  })

  it('該当なしの見出しは、オフラインかどうかで変わる', () => {
    expect(noHazardHeadlineJa('exact')).not.toContain('オフライン')
    expect(noHazardHeadlineJa('unknown')).toContain('オフライン')
  })
})

describe('hazard/catalog: 画素の色・実測 m から階級を引く', () => {
  it('公式凡例の色は完全一致だけを採る（中間色は丸めない）', () => {
    expect(hazardRankOfColor('flood_l2', '#FFB7B7')?.labelJa).toBe('3〜5m 未満')
    expect(hazardRankOfColor('flood_l2', '#FFB7B8')).toBeNull()
    expect(hazardRankOfColor('___missing___', '#FFB7B7')).toBeNull()
  })

  it('実測 m は、その値を含む階級（上限は開区間）', () => {
    expect(hazardRankOfDepth('flood_l2', 3.66)?.labelJa).toBe('3〜5m 未満')
    expect(hazardRankOfDepth('flood_l2', 5)?.labelJa).toBe('5〜10m 未満')
    expect(hazardRankOfDepth('flood_l2', 0.12)?.labelJa).toBe('0〜0.3m 未満')
    expect(hazardRankOfDepth('flood_l2', 0)).toBeNull()
    expect(hazardRankOfDepth('dosekiryu', 3)).toBeNull() // 量でない区分は引けない
  })

  it('点の答えを持てるのはタイルと色つき階級があるレイヤ（地形は含まない）', () => {
    expect(ALL_LAYERS).toContain('flood_l2')
    expect(ALL_LAYERS).toContain('dosekiryu')
    expect(ALL_LAYERS).not.toContain('relief')
    expect(ALL_LAYERS).not.toContain('chisui_chikei')
  })
})
