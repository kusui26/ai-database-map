/**
 * src/ai/eval/score：ゴールデン問の採点（純関数）。ツール入力の部分一致・パネル・選択・
 * データ外拒否・要点文字列の判定と、全チェック通過で pass になることを担保する。
 */

import { describe, expect, it } from 'vitest'
import { emptyFigureCount, scoreCase, type EvalObserved } from '@/ai/eval/score'
import { EVAL_CASES } from '@/ai/eval/cases'
import { viewportFromTuple } from '@/shared/viewport'

const base: EvalObserved = {
  toolCalls: [],
  panelTypes: [],
  actionTypes: [],
  text: '',
  haystack: '',
  mapResponseValid: true,
  emptyFigureCount: 0,
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

  it('入れ子のオブジェクトは部分一致（near: { withinM: 5000 }・2026-10-08 B2）', () => {
    const observed: EvalObserved = {
      ...base,
      toolCalls: [
        {
          name: 'rankStations',
          input: { metric: 'lp_near_price', near: { station: '立川', withinM: 5000 } },
        },
      ],
    }
    const expectNear = (near: Record<string, unknown>) =>
      scoreCase({ toolCalls: [{ name: 'rankStations', inputIncludes: { near } }] }, observed).pass
    expect(expectNear({ withinM: 5000 })).toBe(true)
    expect(expectNear({ withinM: 5000, station: '立川' })).toBe(true)
    expect(expectNear({ withinM: 3000 })).toBe(false)
    expect(expectNear({ radiusM: 5000 })).toBe(false)
    const flat: EvalObserved = {
      ...base,
      toolCalls: [{ name: 'rankStations', input: { near: 'たちかわ' } }],
    }
    expect(
      scoreCase(
        { toolCalls: [{ name: 'rankStations', inputIncludes: { near: { withinM: 5000 } } }] },
        flat,
      ).pass,
    ).toBe(false)
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
      emptyFigureCount: 0,
    }
    expect(scoreCase({ notContains: ['安全です'] }, observed).pass).toBe(false)
    expect(scoreCase({ notContains: ['避難しなくて'] }, observed).pass).toBe(true)
  })
})

describe('scoreCase: 空の図と呼び出し回数（2026-10-07 B1）', () => {
  it('emptyFigureCount は行の無い順位表・点の無い散布だけを数える', () => {
    expect(
      emptyFigureCount([
        { type: 'rankingTable', rows: [] },
        { type: 'rankingTable', rows: [{ rank: 1 }] },
        { type: 'scatter', points: [] },
        { type: 'scatter', points: [{ x: 1 }] },
        { type: 'stationCard' },
      ]),
    ).toBe(2)
  })

  it('noEmptyFigures は空の図が 1 つでもあれば落ちる', () => {
    expect(scoreCase({ noEmptyFigures: true }, { ...base, emptyFigureCount: 1 }).pass).toBe(false)
    expect(scoreCase({ noEmptyFigures: true }, base).pass).toBe(true)
  })

  it('maxCalls はそのツールの呼び出し回数だけを数える', () => {
    const call = (name: string) => ({ name, input: {} })
    const observed = {
      ...base,
      toolCalls: [call('searchStations'), call('rankStations'), call('rankStations')],
    }
    expect(scoreCase({ maxCalls: { rankStations: 1 } }, observed).pass).toBe(false)
    expect(scoreCase({ maxCalls: { rankStations: 2 } }, observed).pass).toBe(true)
    expect(scoreCase({ maxCalls: { compareGrowth: 0 } }, observed).pass).toBe(true)
  })
})

describe('EVAL_CASES', () => {
  it('48 問・id 一意・全問に期待あり', () => {
    expect(EVAL_CASES.length).toBe(48)
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(48)
    for (const testCase of EVAL_CASES) {
      expect(testCase.query.length).toBeGreaterThan(0)
      expect(Object.keys(testCase.expect).length).toBeGreaterThan(0)
    }
  })

  it('地図の表示範囲を持つ問は、画面が送るのと同じく使える範囲（[west, south, east, north]）', () => {
    const withViewport = EVAL_CASES.filter((testCase) => testCase.bbox !== undefined)
    expect(withViewport.map((testCase) => testCase.id)).toEqual([
      'rank-line-yamanote',
      'rank-line-osaka-chuo',
      'rank-line-shinjuku',
      'rank-municipality',
      'rank-near-suburb',
      'rank-near-screenshot',
    ])
    for (const testCase of withViewport) {
      expect(viewportFromTuple(testCase.bbox ?? []), testCase.id).not.toBeNull()
    }
  })

  it('災害の問は、すべて禁止応答を持つ（言わせないことが目的・§6.5）', () => {
    const hazard = EVAL_CASES.filter((testCase) => testCase.category === '災害')
    expect(hazard.length).toBe(13)
    for (const testCase of hazard) {
      expect(testCase.expect.notContains ?? [], testCase.id).toContain('安全です')
    }
  })
})
