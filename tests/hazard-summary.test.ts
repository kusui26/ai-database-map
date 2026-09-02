import { describe, expect, it } from 'vitest'
import { type HazardPointResponse } from '@/shared/api'
import {
  HAZARD_SUMMARY_LIMITATIONS_JA,
  hazardSummarySources,
  stationHazardSummary,
} from '@/domain/hazard/summary'
import {
  HAZARD_DATASET_COLUMNS,
  hazardCsvCells,
  stationHazardSummarySchema,
} from '@/shared/hazard-summary'

/**
 * **駅別ハザードサマリの射影**（PR-6・`docs/260828_research_claude_auth.md` §5.3 ③）。
 *
 * 固定するのは、①グループ対応（レイヤ → flood/inland_flood/…）と最重の選び方、
 * ②「白＝安全」と読ませない印（nearby / uncovered）が落ちないこと、
 * ③CSV 列（hazard_*）との 1:1 対応と欠損の表現（evacuation null → 空欄・フラグ 0/1）、
 * ④limitations と出典が**空でない**こと（削られたら §7.5 の事故に戻る）。
 */

type Item = HazardPointResponse['hazards'][number]

function item(layerKey: string, labelJa: string, valueJa: string, level: Item['level']): Item {
  return {
    layerKey,
    labelJa,
    valueJa,
    meaningJa: null,
    level,
    color: null,
    source: 'tile',
    coverage: null,
    certainty: 'exact',
  }
}

const point: HazardPointResponse = {
  point: { lon: 139.6, lat: 35.4, placeJa: 'テスト#0' },
  mesh: { code: '53393599', sizeM: 250, center: { lon: 139.6, lat: 35.4 } },
  terrain: { elevMeanM: 12.3 },
  // pointHazard の出力どおり「危険度の重い順」に並べてある。
  hazards: [
    item('flood_l2', '洪水浸水想定区域（想定最大規模）', '3.0〜5.0m 未満', 'danger'),
    item('dosekiryu', '土石流警戒区域', '警戒区域', 'warning'),
    item('flood_duration', '浸水継続時間', '24〜72時間', 'caution'),
  ],
  neighbours: [
    {
      layerKey: 'hightide_l2',
      labelJa: '高潮浸水想定区域',
      level: 'warning',
      source: 'tile',
      proximityJa: '約 20m 以内',
    },
  ],
  rivers: [],
  verdict: { level: 'danger', headlineJa: 'この場所は…', evacuation: 'takeaway', reasonsJa: [] },
  certainty: 'exact',
  coverageNotesJa: [],
  sources: [],
  notesJa: [],
  disclaimerJa: '免責',
}

const summary = stationHazardSummary('テスト#0', point, ['naisui'])

describe('stationHazardSummary（射影）', () => {
  it('形は shared のスキーマに一致し、総合判定を写す', () => {
    expect(stationHazardSummarySchema.parse(summary)).toEqual(summary)
    expect(summary.level).toBe('danger')
    expect(summary.evacuation).toBe('takeaway')
    expect(summary.headlineJa).toBe('この場所は…')
    expect(summary.elevationM).toBe(12.3)
  })

  it('グループごとに最重の該当を採る（洪水＝深さ＋継続時間から danger の方）', () => {
    expect(summary.groups.flood.level).toBe('danger')
    expect(summary.groups.flood.worstJa).toBe('洪水浸水想定区域（想定最大規模）：3.0〜5.0m 未満')
    expect(summary.groups.landslide.level).toBe('warning')
    expect(summary.groups.tsunami).toEqual({
      level: 'none',
      worstJa: null,
      nearby: false,
      uncovered: false,
    })
  })

  it('「白＝安全」と読ませない印：近接（高潮）と図なし（内水）が残る', () => {
    expect(summary.groups.storm_surge.level).toBe('none')
    expect(summary.groups.storm_surge.nearby).toBe(true)
    expect(summary.groups.inland_flood.uncovered).toBe(true)
    expect(summary.groups.inland_flood.worstJa).toBeNull()
  })
})

describe('hazardCsvCells（include_hazard の列）', () => {
  it('列定義と 1:1 のセルを作る', () => {
    const cells = hazardCsvCells(summary)
    expect(new Set(Object.keys(cells))).toEqual(
      new Set(HAZARD_DATASET_COLUMNS.map((column) => column.key)),
    )
    expect(cells['hazard_level']).toBe('danger')
    expect(cells['hazard_evacuation']).toBe('takeaway')
    expect(cells['hazard_flood_level']).toBe('danger')
    expect(cells['hazard_tsunami_level']).toBe('none')
    expect(cells['hazard_elev_m']).toBe(12.3)
    expect(cells['hazard_storm_surge_nearby']).toBe(1)
    expect(cells['hazard_inland_flood_uncovered']).toBe(1)
    expect(cells['hazard_flood_nearby']).toBe(0)
  })

  it('判定できない避難（null）と標高なしは空欄になる', () => {
    const undecided = stationHazardSummary(
      'テスト#1',
      {
        ...point,
        terrain: { elevMeanM: null },
        verdict: { ...point.verdict, evacuation: null },
      },
      [],
    )
    const cells = hazardCsvCells(undecided)
    expect(cells['hazard_evacuation']).toBe('')
    expect(cells['hazard_elev_m']).toBe('')
  })
})

describe('limitations と出典（削らない）', () => {
  it('limitations は「代表点」「順序尺度」「浸水ナビを含まない」を必ず言う', () => {
    const joined = HAZARD_SUMMARY_LIMITATIONS_JA.join('\n')
    expect(HAZARD_SUMMARY_LIMITATIONS_JA.length).toBeGreaterThanOrEqual(4)
    expect(joined).toContain('代表点')
    expect(joined).toContain('順序尺度')
    expect(joined).toContain('浸水ナビ')
    expect(joined).toContain('安全')
  })

  it('出典はカタログ由来で空でない', () => {
    const sources = hazardSummarySources()
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source.source.length).toBeGreaterThan(0)
      expect(source.license.length).toBeGreaterThan(0)
    }
  })
})
