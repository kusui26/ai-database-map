/**
 * src/ai/eval/score：ゴールデン問の採点（純関数）。ツール入力の部分一致・パネル・選択・
 * データ外拒否・要点文字列の判定と、全チェック通過で pass になることを担保する。
 */

import { describe, expect, it } from 'vitest'
import { scoreCase, type EvalObserved } from '@/ai/eval/score'
import { EVAL_CASES } from '@/ai/eval/cases'

const base: EvalObserved = {
  toolCalls: [],
  panelTypes: [],
  actionTypes: [],
  text: '',
  haystack: '',
  mapResponseValid: true,
}

describe('scoreCase', () => {
  it('ツール名＋入力の部分一致（配列は部分集合）で判定', () => {
    const observed: EvalObserved = {
      ...base,
      toolCalls: [
        {
          name: 'rankStations',
          input: { metric: 'rate_covid', prefectures: ['神奈川県', '東京都'] },
        },
      ],
      panelTypes: ['rankingTable'],
    }
    const result = scoreCase(
      {
        toolCalls: [{ name: 'rankStations', inputIncludes: { prefectures: ['神奈川県'] } }],
        panels: ['rankingTable'],
      },
      observed,
    )
    expect(result.pass).toBe(true)
  })

  it('期待ツールが呼ばれない／パネルが出ないと不合格', () => {
    const result = scoreCase(
      {
        toolCalls: [{ name: 'getStationDetail', inputIncludes: { category: 'population' } }],
        panels: ['trendChart'],
      },
      { ...base, toolCalls: [{ name: 'searchStations', input: {} }] },
    )
    expect(result.pass).toBe(false)
    expect(result.checks.filter((check) => !check.ok).length).toBe(2)
  })

  it('select は selectStation アクションの有無で判定', () => {
    expect(scoreCase({ select: true }, { ...base, actionTypes: ['selectStation'] }).pass).toBe(true)
    expect(scoreCase({ select: true }, { ...base, actionTypes: ['flyTo'] }).pass).toBe(false)
  })

  it('noPanels は完全に空、noRankScatter は rank/scatter のみ禁止', () => {
    expect(scoreCase({ noPanels: true }, { ...base, panelTypes: [] }).pass).toBe(true)
    expect(scoreCase({ noPanels: true }, { ...base, panelTypes: ['trendChart'] }).pass).toBe(false)
    expect(scoreCase({ noRankScatter: true }, { ...base, panelTypes: ['trendChart'] }).pass).toBe(
      true,
    )
    expect(scoreCase({ noRankScatter: true }, { ...base, panelTypes: ['scatter'] }).pass).toBe(
      false,
    )
  })

  it('contains は全一致、containsAny はいずれか', () => {
    const observed: EvalObserved = { ...base, haystack: '尼崎（阪神電気鉄道・兵庫県）' }
    expect(scoreCase({ contains: ['尼崎'] }, observed).pass).toBe(true)
    expect(scoreCase({ contains: ['尼崎', '存在しない'] }, observed).pass).toBe(false)
    expect(scoreCase({ containsAny: ['存在しない', '兵庫県'] }, observed).pass).toBe(true)
  })

  it('mapResponse が不正なら常に不合格', () => {
    expect(
      scoreCase({ textNonEmpty: true }, { ...base, text: 'x', mapResponseValid: false }).pass,
    ).toBe(false)
  })
})

describe('scoreCase: 禁止応答（notContains）', () => {
  it('禁止語が入っていたら落ちる', () => {
    const observed = {
      toolCalls: [],
      panelTypes: [],
      actionTypes: [],
      text: 'この場所は安全です。',
      haystack: 'この場所は安全です。',
      mapResponseValid: true,
    }
    expect(scoreCase({ notContains: ['安全です'] }, observed).pass).toBe(false)
    expect(scoreCase({ notContains: ['避難しなくて'] }, observed).pass).toBe(true)
  })
})

describe('EVAL_CASES', () => {
  it('30 問・id 一意・全問に期待あり', () => {
    expect(EVAL_CASES.length).toBe(30)
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(30)
    for (const testCase of EVAL_CASES) {
      expect(testCase.query.length).toBeGreaterThan(0)
      expect(Object.keys(testCase.expect).length).toBeGreaterThan(0)
    }
  })

  it('災害の問は、すべて禁止応答を持つ（言わせないことが目的・§6.5）', () => {
    const hazard = EVAL_CASES.filter((testCase) => testCase.category === '災害')
    expect(hazard.length).toBe(6)
    for (const testCase of hazard) {
      expect(testCase.expect.notContains ?? [], testCase.id).toContain('安全です')
    }
  })
})
