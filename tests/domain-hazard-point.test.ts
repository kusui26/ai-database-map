import { describe, expect, it } from 'vitest'
import { pointHazard, type PointHazardInput } from '@/domain/hazard/point'
import { hazardVerdict, type VerdictItem } from '@/domain/hazard/verdict'
import {
  certaintyOf,
  coverageAmountJa,
  GROUP_STATE_LABELS_JA,
  noHazardHeadlineJa,
  riverReasonsJa,
  valuePhraseJa,
  weakestCertainty,
} from '@/domain/hazard/wording'
import {
  hazardRankOfColor,
  hazardRankOfDepth,
  hazardLayersWithPointAnswer,
} from '@/domain/hazard/catalog'
import { hazardPointResponseSchema, type HazardPointResponse } from '@/shared/api'
import { HAZARD_GROUP_LABELS_JA } from '@/shared/constants'
import { getHazardLayer } from '@/shared/hazard'
import { SUMMARY_HAZARD_GROUPS } from '@/shared/hazard-summary'
import { HAZARD_GROUP_STATES, type HazardGroupState } from '@/shared/protocol'

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
    tileNearby: [],
    uncoveredLayerKeys: [],
    unreachedLayerKeys: [],
    rivers: [],
    elevationM: 0.2,
    onlineSourcesReached: true,
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
      {
        layerKey: 'flood_l2',
        labelJa: '洪水浸水想定区域（想定最大規模）',
        level: 'danger',
        source: 'mesh',
        proximityJa: '隣の 250m メッシュ',
      },
    ])
    expect(result.coverageNotesJa.some((note) => note.includes('隣の 250m メッシュ'))).toBe(true)
    // **「その場に留まる」とは言わない。** 近くが区域なら §6.2 の 6 番を適用しない。
    expect(result.verdict.evacuation).toBeNull()
  })
})

/**
 * 区域の**縁**（§6.2 の追記・PR-4d）。
 *
 * 実測で、土石流警戒区域の約 10m 外が `evacuation: 'stay'`（その場に留まる）になっていた。
 * 公式タイルは 1 画素しか見ておらず、土砂はメッシュ化していないので手掛かりがゼロだった。
 */
describe('hazard/point: 区域のすぐ外で「留まってよい」と言わない（§6.2 の追記）', () => {
  /** 土石流警戒区域（イエローゾーン）の塗り色。実測 2026-08-27・熱海。 */
  const DOSEKIRYU_YELLOW = '#E6C832'

  it('その点は区域外でも、約 20m 以内が区域ならそう言う', () => {
    const result = pointHazard(
      input({ tileNearby: [{ layerKey: 'dosekiryu', hex: DOSEKIRYU_YELLOW }] }),
      ALL_LAYERS,
    )
    expect(result.hazards).toHaveLength(0)
    expect(result.neighbours).toHaveLength(1)
    expect(result.neighbours[0]?.source).toBe('tile')
    expect(result.neighbours[0]?.proximityJa).toBe('約 20m 以内')
    // 見出しでも近さを言う（「入っていません」で終えない）。
    expect(result.verdict.headlineJa).toContain('約 20m 以内')
    expect(result.verdict.headlineJa).toContain('安全という意味ではありません')
    // **ここが本体。** 10m 先が土石流警戒区域なのに「その場に留まる」と言っていた。
    expect(result.verdict.evacuation).toBeNull()
    expect(result.verdict.reasonsJa.some((reason) => reason.includes('区域外ですが'))).toBe(true)
  })

  it('その点が区域内なら、近さの話は足さない（同じことを 2 回言わない）', () => {
    const result = pointHazard(
      input({
        tile: [{ layerKey: 'dosekiryu', hex: DOSEKIRYU_YELLOW }],
        tileNearby: [{ layerKey: 'dosekiryu', hex: DOSEKIRYU_YELLOW }],
      }),
      ALL_LAYERS,
    )
    expect(result.hazards).toHaveLength(1)
    expect(result.neighbours).toHaveLength(0)
    expect(result.verdict.evacuation).toBe('takeaway')
  })

  it('近いのがタイル・遠いのがメッシュなら、近い方だけを残す', () => {
    const result = pointHazard(
      input({
        mesh: [{ layerKey: 'dosekiryu', sourceCode: 0, coverage: 0, neighbourSourceCode: 1 }],
        tileNearby: [{ layerKey: 'dosekiryu', hex: DOSEKIRYU_YELLOW }],
      }),
      ALL_LAYERS,
    )
    expect(result.neighbours).toHaveLength(1)
    expect(result.neighbours[0]?.source).toBe('tile')
  })
})

/**
 * 注記は**この地点で言えること**に絞る（§7.5-2・PR-4d）。
 * 全国の一般論を毎回 8 行並べると、いちばん読ませたい 1 行が埋もれる。
 */
describe('hazard/point: 網羅性の注記', () => {
  it('この地域に区域図が無いレイヤは「ここには無い」と言う（全国の一般論に差し替える）', () => {
    const result = pointHazard(input({ uncoveredLayerKeys: ['naisui'] }), ALL_LAYERS)
    const notes = result.coverageNotesJa.join('\n')
    expect(notes).toContain('この地域には想定区域図がありません')
    // 「区域が無い」とは言わない（図が無いだけ）。
    expect(notes).toContain('区域が無いという意味ではない')
    // 内水の全国の一般論（22 府県）は出さない——ここに図が無いことの方が具体的。
    expect(notes).not.toContain('47 都道府県のうち 22')
  })

  it('キキクル（表示専用）は地点の答えにも注記にも出てこない（決定 5・§9.1）', () => {
    expect(ALL_LAYERS.some((key) => key.startsWith('kikikuru'))).toBe(false)
    const result = pointHazard(input(), ALL_LAYERS)
    expect(result.coverageNotesJa.join('\n')).not.toContain('10 分ごとに更新')
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

  it('公式タイルに届かなかった（メッシュだけ）なら unknown で、行動を断定しない', () => {
    const result = pointHazard(input({ onlineSourcesReached: false }), ALL_LAYERS)
    expect(result.certainty).toBe('unknown')
    expect(result.verdict.evacuation).toBeNull()
    expect(result.verdict.headlineJa).toContain('250m メッシュだけで判断')
    // ⚠ **理由は名乗らない。** ここに届くのは確からしさだけで、端末が切れていたのか
    //   こちらが届かなかったのかを知らない（260916 §7）。
    expect(result.verdict.headlineJa).not.toContain('オフライン')
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

// --- 災害の種類ごとの状態（`docs/261110_fix_PLAN.md` §8.4・§10.2 PR-4） -----------

/** 250m メッシュを持つレイヤ（洪水 5・内水）。カタログから引く。 */
const MESH_LAYERS = ALL_LAYERS.filter((key) => getHazardLayer(key)?.mesh?.available === true)

/** メッシュのどのレイヤも、そのセルも隣のセルも区域外。 */
const QUIET_MESH = MESH_LAYERS.map((layerKey) => ({
  layerKey,
  sourceCode: 0,
  coverage: 0,
  neighbourSourceCode: 0,
}))

/** そのレイヤの凡例の色（公式タイルの画素として渡す）。手で書くと凡例の改訂で黙って外れる。 */
function legendColor(layerKey: string): string {
  const color = getHazardLayer(layerKey)?.ranks.find((rank) => rank.color !== null)?.color
  if (color === undefined || color === null) throw new Error(`凡例に色がありません: ${layerKey}`)
  return color
}

function painted(layerKeys: readonly string[]): PointHazardInput['tile'] {
  return layerKeys.map((layerKey) => ({ layerKey, hex: legendColor(layerKey) }))
}

/** 種類 → 状態（5 つをまとめて見比べる）。 */
function statesOf(result: HazardPointResponse): Readonly<Record<string, string>> {
  return Object.fromEntries((result.groupStates ?? []).map((each) => [each.group, each.state]))
}

function groupOf(result: HazardPointResponse, group: string): HazardGroupState | undefined {
  return result.groupStates?.find((each) => each.group === group)
}

/**
 * 画面が「該当なし：内水・津波／想定区域図なし：土砂災害」と 1 行ずつ出すための材料。
 * 固定するのは**言ってはいけない「該当なし」**——図が無いのに、確かめていないのに「該当なし」と言わない。
 */
describe('hazard/point: 災害の種類ごとの状態（261110 §8.4）', () => {
  it('5 種類が必ずどれか 1 つの状態に入る（種類の順・どの経路でも）', () => {
    const cases: readonly PointHazardInput[] = [
      input(),
      input({ tile: painted(['flood_l2']), uncoveredLayerKeys: ['jisuberi'] }),
      input({ unreachedLayerKeys: ['hightide_l2'] }),
      input({ onlineSourcesReached: false, mesh: QUIET_MESH }),
      input({ onlineSourcesReached: false }),
    ]
    for (const each of cases) {
      const groupStates = pointHazard(each, ALL_LAYERS).groupStates ?? []
      expect(groupStates.map((group) => group.group)).toEqual([...SUMMARY_HAZARD_GROUPS])
      for (const group of groupStates) {
        expect(HAZARD_GROUP_STATES).toContain(group.state)
        expect(group.stateJa).toBe(GROUP_STATE_LABELS_JA[group.state])
        expect(group.labelJa).toBe(HAZARD_GROUP_LABELS_JA[group.group])
      }
    }
  })

  it('亀有の形（2026-11-11 の公式タイルの実測）：該当・該当なし・図なし', () => {
    const result = pointHazard(
      input({
        tile: painted(['flood_l2', 'flood_l1', 'flood_duration', 'hightide_l2']),
        uncoveredLayerKeys: ['dosekiryu', 'jisuberi'],
      }),
      ALL_LAYERS,
    )
    expect(statesOf(result)).toEqual({
      flood: 'hit',
      inland_flood: 'none',
      storm_surge: 'hit',
      tsunami: 'none',
      landslide: 'uncovered',
    })
  })

  it('立川の形：すぐ近く（隣の 250m メッシュ）・該当なし・図なし', () => {
    const result = pointHazard(
      input({
        mesh: [{ layerKey: 'flood_l2', sourceCode: 0, coverage: 0, neighbourSourceCode: 3 }],
        uncoveredLayerKeys: ['hightide_l2', 'tsunami_shinsui'],
      }),
      ALL_LAYERS,
    )
    expect(statesOf(result)).toEqual({
      flood: 'nearby',
      inland_flood: 'none',
      storm_surge: 'uncovered',
      tsunami: 'uncovered',
      landslide: 'none',
    })
    expect(groupOf(result, 'flood')).toMatchObject({
      stateJa: 'すぐ近くに区域',
      proximityJa: '隣の 250m メッシュ',
    })
  })

  /** 土砂災害の 3 レイヤ（土石流・急傾斜地・地すべり）に、状態の材料を重ねていく。 */
  it('決める順は 該当 → すぐ近く → 図なし → 未確認 → 該当なし', () => {
    const near = [{ layerKey: 'kyukeisha', hex: legendColor('kyukeisha') }]
    const cases: readonly (readonly [string, Partial<PointHazardInput>])[] = [
      ['hit', { tile: painted(['dosekiryu']), tileNearby: near, uncoveredLayerKeys: ['jisuberi'] }],
      [
        'nearby',
        { tileNearby: near, uncoveredLayerKeys: ['jisuberi'], unreachedLayerKeys: ['dosekiryu'] },
      ],
      ['uncovered', { uncoveredLayerKeys: ['jisuberi'], unreachedLayerKeys: ['dosekiryu'] }],
      ['unknown', { unreachedLayerKeys: ['dosekiryu'] }],
      ['none', {}],
    ]
    for (const [expected, overrides] of cases) {
      const result = pointHazard(input(overrides), ALL_LAYERS)
      expect(groupOf(result, 'landslide')?.state, expected).toBe(expected)
    }
    // 該当は未確認にも勝つ（洪水：想定最大規模が塗られ、計画規模は届かなかった）。
    const flood = pointHazard(
      input({ tile: painted(['flood_l2']), unreachedLayerKeys: ['flood_l1'] }),
      ALL_LAYERS,
    )
    expect(groupOf(flood, 'flood')?.state).toBe('hit')
  })

  it('図が無いのに「該当なし」と言わない（種類の中に 1 レイヤでも図が無ければ図なし）', () => {
    // 鎌倉（実測）：土石流・急傾斜地の図はあるが、地すべりの図が無い。
    const result = pointHazard(input({ uncoveredLayerKeys: ['jisuberi'] }), ALL_LAYERS)
    expect(groupOf(result, 'landslide')).toMatchObject({
      state: 'uncovered',
      stateJa: '想定区域図なし',
      proximityJa: null,
    })
  })

  it('確かめていないのに「該当なし」と言わない（公式タイルに届かなかったレイヤは未確認）', () => {
    const result = pointHazard(input({ unreachedLayerKeys: ['hightide_l2'] }), ALL_LAYERS)
    expect(groupOf(result, 'storm_surge')).toMatchObject({ state: 'unknown', stateJa: '未確認' })
    // 届いた種類は巻き込まない。
    expect(groupOf(result, 'tsunami')?.state).toBe('none')
  })

  it('参照しなかった種類も「該当なし」と言わない（未確認）', () => {
    const floodOnly = ALL_LAYERS.filter((key) => getHazardLayer(key)?.group === 'flood')
    const result = pointHazard(input(), floodOnly)
    expect(statesOf(result)).toEqual({
      flood: 'none',
      inland_flood: 'unknown',
      storm_surge: 'unknown',
      tsunami: 'unknown',
      landslide: 'unknown',
    })
  })

  it('公式タイルに届かなくても、250m メッシュで読めたレイヤは確かめたことにする', () => {
    const flood = MESH_LAYERS.filter((key) => getHazardLayer(key)?.group === 'flood')
    const unread = pointHazard(input({ unreachedLayerKeys: flood }), ALL_LAYERS)
    expect(groupOf(unread, 'flood')?.state).toBe('unknown')
    const onMesh = pointHazard(input({ unreachedLayerKeys: flood, mesh: QUIET_MESH }), ALL_LAYERS)
    expect(groupOf(onMesh, 'flood')?.state).toBe('none')
  })

  it('すぐ近くの距離感は近い方（約 20m）を採り、ほかの状態では null', () => {
    const result = pointHazard(
      input({
        tileNearby: [{ layerKey: 'flood_l1', hex: legendColor('flood_l1') }],
        mesh: [{ layerKey: 'flood_l2', sourceCode: 0, coverage: 0, neighbourSourceCode: 3 }],
      }),
      ALL_LAYERS,
    )
    expect(groupOf(result, 'flood')).toMatchObject({ state: 'nearby', proximityJa: '約 20m 以内' })
    const others = (result.groupStates ?? []).filter((each) => each.group !== 'flood')
    expect(others.map((each) => each.proximityJa)).toEqual([null, null, null, null])
  })
})

describe('hazard/point: 畳まずに見せる注意（keyNotesJa・261110 §8.4）', () => {
  it('該当なし・図なし・未確認の種類があれば必ず 1 文で、出ている言い方だけを挙げる', () => {
    const cases: readonly (readonly [Partial<PointHazardInput>, string])[] = [
      [{}, '「該当なし」は、安全という意味ではありません。'],
      [
        { tile: painted(['flood_l2']), uncoveredLayerKeys: ['jisuberi'] },
        '「該当なし」「想定区域図なし」は、安全という意味ではありません。',
      ],
      [
        { uncoveredLayerKeys: ['jisuberi'], unreachedLayerKeys: ['hightide_l2'] },
        '「該当なし」「想定区域図なし」「未確認」は、安全という意味ではありません。',
      ],
      [{ onlineSourcesReached: false }, '「未確認」は、安全という意味ではありません。'],
    ]
    for (const [overrides, expected] of cases) {
      const notes = pointHazard(input(overrides), ALL_LAYERS).keyNotesJa ?? []
      expect(notes).toEqual([expected])
      expect(notes.join('')).not.toMatch(/安全です|問題ありません/)
    }
  })

  it('5 種類とも該当かすぐ近くなら、注意の文は足さない（それ自体が注意として読める）', () => {
    const result = pointHazard(
      input({
        tile: painted(['flood_l2', 'naisui', 'hightide_l2', 'dosekiryu']),
        tileNearby: painted(['tsunami_shinsui']),
      }),
      ALL_LAYERS,
    )
    expect(statesOf(result)).toEqual({
      flood: 'hit',
      inland_flood: 'hit',
      storm_surge: 'hit',
      tsunami: 'nearby',
      landslide: 'hit',
    })
    expect(result.keyNotesJa).toEqual([])
  })
})

describe('hazard/point: その場所にしか無い事実（highlightsJa・261110 §8.4）', () => {
  it('浸水ナビの到達・継続（いちばん早い川・いちばん長い川）で、根拠の末尾と同じ文', () => {
    const rivers = [
      { nameJa: '荒川', maxDepthM: 3.66, arriveMin: 162, continueMin: 5283 },
      { nameJa: '中川', maxDepthM: 1.31, arriveMin: 30, continueMin: 5718 },
      { nameJa: '利根川', maxDepthM: 0.8, arriveMin: 1434, continueMin: 14508 },
    ]
    const result = pointHazard(input({ rivers }), ALL_LAYERS)
    expect(result.highlightsJa).toEqual(riverReasonsJa(rivers))
    expect(result.highlightsJa).toHaveLength(2)
    expect(result.verdict.reasonsJa.slice(-2)).toEqual(result.highlightsJa)
  })

  it('川の情報が無ければ空（その場所の事実が無いのに文を作らない）', () => {
    expect(pointHazard(input(), ALL_LAYERS).highlightsJa).toEqual([])
  })
})

/**
 * オフライン（端末の 250m メッシュだけ）。入力は `useHazardPoint` の `meshOnlyHazard` と同じ形
 * ——公式タイルは読みに行っていないので、タイル・近さ・図の有無・届かなかったレイヤはどれも空。
 * サーバとブラウザが同じ関数を通るので、3 項目も同じ形で出る。
 */
describe('hazard/point: オフライン（メッシュだけ）でも同じ形', () => {
  function offline(mesh: PointHazardInput['mesh']): PointHazardInput {
    return input({ mesh, onlineSourcesReached: false })
  }

  it('メッシュで読めた洪水・内水は該当なし、メッシュの無い高潮・津波・土砂は未確認', () => {
    const result = pointHazard(offline(QUIET_MESH), ALL_LAYERS)
    expect(statesOf(result)).toEqual({
      flood: 'none',
      inland_flood: 'none',
      storm_surge: 'unknown',
      tsunami: 'unknown',
      landslide: 'unknown',
    })
    expect(result.keyNotesJa).toEqual(['「該当なし」「未確認」は、安全という意味ではありません。'])
    expect(result.highlightsJa).toEqual([])
    expect(() => hazardPointResponseSchema.parse(result)).not.toThrow()
  })

  it('メッシュも読めなければ 5 種類とも未確認（「該当なし」と言わない）', () => {
    const result = pointHazard(offline([]), ALL_LAYERS)
    expect(new Set(Object.values(statesOf(result)))).toEqual(new Set(['unknown']))
  })

  it('メッシュで当たれば該当、隣のセルならすぐ近く（隣の 250m メッシュ）', () => {
    const result = pointHazard(
      offline([
        { layerKey: 'flood_l2', sourceCode: 3, coverage: 1, neighbourSourceCode: 3 },
        { layerKey: 'naisui', sourceCode: 0, coverage: 0, neighbourSourceCode: 1 },
      ]),
      ALL_LAYERS,
    )
    expect(groupOf(result, 'flood')?.state).toBe('hit')
    expect(groupOf(result, 'inland_flood')).toMatchObject({
      state: 'nearby',
      proximityJa: '隣の 250m メッシュ',
    })
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

  it('該当なしの見出しは、何で判断したかを言う（理由は名乗らない）', () => {
    expect(noHazardHeadlineJa('exact')).not.toContain('メッシュだけ')
    expect(noHazardHeadlineJa('unknown')).toContain('250m メッシュだけで判断')
    // 「オフライン」と言えるのは端末がそう言っているときだけ。ここでは分からない（260916 §7）。
    expect(noHazardHeadlineJa('unknown')).not.toContain('オフライン')
    // どちらの言い方でも「安全」とは言わない。
    for (const certainty of ['exact', 'unknown'] as const) {
      expect(noHazardHeadlineJa(certainty)).toContain('安全という意味ではありません')
    }
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
