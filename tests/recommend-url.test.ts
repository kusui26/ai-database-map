/**
 * 条件の URL 往復（`src/components/recommend/url.ts` と `parse.ts`）を固定する。
 *
 * 共有リンクの約束は「**同じ URL なら同じ順位**」。だから見るのは「文字列が同じか」ではなく、
 * **URL を経由しても同じリクエストになるか**である（既定と同じ重みは URL に載せないので、
 * 文字列としては往復で変わりうる）。
 *
 * URL は人が手で書き換えられるし、古いリンクには消えた選択肢が残っている。
 * 知らない値で落ちず、**黙って別の条件にもならない**（既定に倒し、応答が条件を返す）ことを見る。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CRITERIA,
  hasArea,
  recommendUrl,
  type RecommendCriteria,
} from '@/components/recommend/query'
import { criteriaFromUrl, criteriaToUrl } from '@/components/recommend/url'
import { toLineCodes, toNumberList, toWeights } from '@/components/recommend/parse'

function criteria(overrides: Partial<RecommendCriteria> = {}): RecommendCriteria {
  return { ...DEFAULT_CRITERIA, ...overrides }
}

/** URL を 1 往復させる。 */
function roundTrip(value: RecommendCriteria): RecommendCriteria {
  return criteriaFromUrl(criteriaToUrl(value))
}

describe('URL を往復しても同じリクエストになる', () => {
  const cases: readonly (readonly [string, RecommendCriteria])[] = [
    ['市区町村だけ', criteria({ prefectures: ['神奈川県'], municipality: '横浜市' })],
    [
      '路線と会社で絞る',
      criteria({ routes: ['東海道線', '根岸線'], operators: ['東日本旅客鉄道'], routeTypes: [2] }),
    ],
    [
      '重みを変えた予算重視',
      criteria({ municipality: '世田谷区', preset: 'budget', weights: { lp_med: 0.5, pax: 0 } }),
    ],
    [
      '段階減点・z-score・⚠除外',
      criteria({
        municipality: '札幌市',
        method: 'zscore',
        hazard: 'penalty',
        hazardGroup: 'landslide',
        hazardPenalty: 'heavy',
        flagged: 'exclude',
        radiusM: 2000,
      }),
    ],
    ['災害を見ない', criteria({ prefectures: ['東京都'], hazard: 'off' })],
    ['路線（運行系統）で絞る', criteria({ lines: [11302, 28010] })],
    ['路線と都道府県を重ねる', criteria({ prefectures: ['東京都'], lines: [11302] })],
  ]

  for (const [label, value] of cases) {
    it(label, () => {
      expect(recommendUrl(roundTrip(value))).toBe(recommendUrl(value))
    })
  }
})

describe('既定は URL に残さない', () => {
  it('既定のままなら、載る値はすべて既定と同じ（nuqs が消せる形）', () => {
    const values = criteriaToUrl(DEFAULT_CRITERIA)
    expect(values.recPref).toBe('')
    expect(values.recMuni).toBe('')
    expect(values.recW).toBe('')
    expect(values.recPreset).toBe(DEFAULT_CRITERIA.preset)
    expect(values.recRadius).toBe(DEFAULT_CRITERIA.radiusM)
  })

  it('プリセットと同じ重みは載せない（「何を変えたか」が読めるように）', () => {
    const same = criteria({ municipality: '横浜市', preset: 'budget', weights: { lp_med: 0.15 } })
    expect(criteriaToUrl(same).recW).toBe('')
  })
})

describe('知らない値は既定に倒す（落ちない・黙って別条件にもしない）', () => {
  const broken = {
    recPref: '神奈川県',
    recMuni: '横浜市',
    recOps: '',
    recRoutes: '',
    recTypes: '',
    recLines: '',
    recPreset: 'nonsense',
    recW: '',
    recRadius: 1234,
    recNorm: 'nonsense',
    recHazard: 'nonsense',
    recGroup: 'nonsense',
    recLevel: 'none',
    recPenalty: 'nonsense',
    recFlag: 'nonsense',
  }

  it('列挙も半径も既定になる', () => {
    const value = criteriaFromUrl(broken)
    expect(value.preset).toBe(DEFAULT_CRITERIA.preset)
    expect(value.method).toBe(DEFAULT_CRITERIA.method)
    expect(value.hazard).toBe(DEFAULT_CRITERIA.hazard)
    expect(value.hazardGroup).toBe(DEFAULT_CRITERIA.hazardGroup)
    expect(value.hazardPenalty).toBe(DEFAULT_CRITERIA.hazardPenalty)
    expect(value.flagged).toBe(DEFAULT_CRITERIA.flagged)
    expect(value.radiusM).toBe(DEFAULT_CRITERIA.radiusM)
  })

  it('足切りの下限に `none` は使わせない（候補が全部消えるだけなので）', () => {
    expect(criteriaFromUrl(broken).hazardAtOrAbove).toBe(DEFAULT_CRITERIA.hazardAtOrAbove)
  })

  it('エリアの指定は残る（壊れた値に巻き込まれない）', () => {
    const value = criteriaFromUrl(broken)
    expect(value.prefectures).toEqual(['神奈川県'])
    expect(value.municipality).toBe('横浜市')
  })
})

describe('壊れた要素だけを落とす', () => {
  it('重みは、読めた指定だけを使う（1 文字の壊れで全部を捨てない）', () => {
    expect(toWeights('pop_gr:0.4,こわれ,lp_med:abc,pax:0.1')).toEqual({ pop_gr: 0.4, pax: 0.1 })
  })

  it('負の重みは受けない（重みは 0 以上）', () => {
    expect(toWeights('pop_gr:-1,pax:0.2')).toEqual({ pax: 0.2 })
  })

  it('重みは刻みに丸める（URL の誤差を持ち込まない）', () => {
    expect(toWeights('pop_gr:0.3000000001')).toEqual({ pop_gr: 0.3 })
  })

  it('事業者種別は整数だけ', () => {
    expect(toNumberList('2,x,4,1.5')).toEqual([2, 4])
  })

  it('路線コードは正の整数だけを、重ねずに選んだ順で', () => {
    expect(toLineCodes('11302,x,0,-5,28010,11302,1.5')).toEqual([11302, 28010])
    expect(toLineCodes('')).toEqual([])
  })

  it('知らない路線コードは残す（サーバが理由を返す。黙って全路線にしない）', () => {
    expect(toLineCodes('99999')).toEqual([99999])
  })
})

describe('路線（運行系統）の条件（2026-10-08 L4）', () => {
  it('路線だけでもエリアの指定になる（全国の 1 路線でおすすめを出せる）', () => {
    expect(hasArea(criteria({ lines: [11302] }))).toBe(true)
    expect(hasArea(DEFAULT_CRITERIA)).toBe(false)
  })

  it('リクエストに lines= で載る（選んだ順のまま）', () => {
    const url = recommendUrl(criteria({ lines: [28010, 11302] }))
    expect(new URL(url ?? '', 'http://x').searchParams.get('lines')).toBe('28010,11302')
  })

  it('路線を選ばなければ lines を載せない', () => {
    const url = recommendUrl(criteria({ prefectures: ['東京都'] }))
    expect(new URL(url ?? '', 'http://x').searchParams.has('lines')).toBe(false)
  })

  it('URL の recLines に載り、読み戻せる（既定＝空は載らない）', () => {
    expect(criteriaToUrl(criteria({ lines: [11302, 28010] })).recLines).toBe('11302,28010')
    expect(criteriaToUrl(DEFAULT_CRITERIA).recLines).toBe('')
    expect(roundTrip(criteria({ lines: [11302] })).lines).toEqual([11302])
  })
})
