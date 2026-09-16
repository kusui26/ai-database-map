/**
 * おすすめ駅の画面の「計算しない部分」を固定する——条件 → URL、駅一覧 → 市区町村の選択肢、
 * 重み → 色と割合、件数の言い方。
 *
 * 画面そのものの検査はヘッドレスの実レンダで行う（W4 の受け入れ）。ここで見るのは、
 * **その手前で静かに壊れるところ**である。たとえば重み 0 の指標に色を振ってしまうと、
 * 凡例と帯の色が 1 つずつずれ、見た目は正しいのに**別の指標の話を読むことになる**。
 */

import { describe, expect, it } from 'vitest'
import { shareOfWeights } from '@/domain/recommend/compose'
import { RECOMMEND_PRESETS } from '@/domain/recommend/presets'
import { colorIndexes } from '@/components/recommend/colors'
import { municipalityOptions } from '@/components/recommend/municipalities'
import {
  DEFAULT_CRITERIA,
  hasArea,
  recommendUrl,
  type RecommendCriteria,
} from '@/components/recommend/query'
import {
  barScale,
  barWidth,
  countsJa,
  exclusionsJa,
  flaggedLabelsJa,
  flaggedRowCount,
  percentJa,
  scoreJa,
} from '@/components/recommend/summary'

function criteria(overrides: Partial<RecommendCriteria> = {}): RecommendCriteria {
  return { ...DEFAULT_CRITERIA, ...overrides }
}

/** クエリ文字列 → キーと値（順不同で比べる）。 */
function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

describe('条件 → URL', () => {
  it('絞り込みが無ければ投げない（API が 400 にする条件を手前で止める）', () => {
    expect(hasArea(criteria())).toBe(false)
    expect(recommendUrl(criteria())).toBeNull()
  })

  it('市区町村・都道府県・路線はそのまま載る', () => {
    const params = paramsOf(
      recommendUrl(criteria({ municipality: '横浜市', routes: ['東海道線', '根岸線'] })) ?? '',
    )
    expect(params.get('municipality')).toBe('横浜市')
    expect(params.get('routes')).toBe('東海道線,根岸線')
  })

  it('既定のままの重みは送らない（URL を短く保ち、変更の有無が伝わる）', () => {
    const preset = RECOMMEND_PRESETS.budget
    const same = Object.fromEntries(preset.metrics.map((metric) => [metric.metric, metric.weight]))
    const url = recommendUrl(criteria({ municipality: '横浜市', preset: 'budget', weights: same }))
    expect(paramsOf(url ?? '').get('weights')).toBeNull()
  })

  it('変えた重みだけを「指標名:重み」で送る', () => {
    const url = recommendUrl(
      criteria({ municipality: '横浜市', preset: 'budget', weights: { lp_med: 0.5 } }),
    )
    expect(paramsOf(url ?? '').get('weights')).toBe('lp_med:0.5')
  })

  it('重みは刻みに丸める（浮動小数の誤差を URL に持ち込まない）', () => {
    const url = recommendUrl(
      criteria({ municipality: '横浜市', weights: { pop_gr: 0.30000000000000004 } }),
    )
    expect(paramsOf(url ?? '').get('weights')).toBe('pop_gr:0.3')
  })

  it('災害を見ないときは、使わないパラメータを載せない', () => {
    const params = paramsOf(recommendUrl(criteria({ municipality: '横浜市', hazard: 'off' })) ?? '')
    expect(params.get('hazard')).toBe('off')
    expect(params.get('hazardGroup')).toBeNull()
    expect(params.get('hazardAtOrAbove')).toBeNull()
  })

  it('足切りは下限を、段階減点は強さを載せる（もう一方は載せない）', () => {
    const cut = paramsOf(recommendUrl(criteria({ municipality: '横浜市' })) ?? '')
    expect(cut.get('hazardAtOrAbove')).toBe('danger')
    expect(cut.get('hazardPenalty')).toBeNull()

    const penalty = paramsOf(
      recommendUrl(criteria({ municipality: '横浜市', hazard: 'penalty' })) ?? '',
    )
    expect(penalty.get('hazardPenalty')).toBe('standard')
    expect(penalty.get('hazardAtOrAbove')).toBeNull()
  })

  it('画面の初期値は API の既定と同じ（入口が違うだけで答えが変わらない）', () => {
    expect(DEFAULT_CRITERIA.preset).toBe('family')
    expect(DEFAULT_CRITERIA.method).toBe('percentile')
    expect(DEFAULT_CRITERIA.hazard).toBe('exclude')
    expect(DEFAULT_CRITERIA.hazardAtOrAbove).toBe('danger')
    expect(DEFAULT_CRITERIA.radiusM).toBe(1000)
  })
})

describe('市区町村の選択肢', () => {
  const stations = [
    { municipality: '横浜市中区' },
    { municipality: '横浜市中区' },
    { municipality: '横浜市西区' },
    { municipality: '川崎市川崎区' },
    { municipality: '鎌倉市' },
    { municipality: null },
  ]

  it('区を持つ市は「市全体」も出す（前方一致でまとめられることを画面から使えるように）', () => {
    const options = municipalityOptions(stations)
    const city = options.find((option) => option.value === '横浜市')
    expect(city?.kind).toBe('city')
    expect(city?.stationCount).toBe(3)
    expect(city?.labelJa).toContain('全区')
  })

  it('区を持たない市区町村は「市全体」を作らない', () => {
    const options = municipalityOptions([{ municipality: '千代田区' }, { municipality: '市川市' }])
    expect(options.every((option) => option.kind === 'municipality')).toBe(true)
  })

  it('駅数を持つので、選ぶ前に候補の大きさが分かる', () => {
    const options = municipalityOptions(stations)
    expect(options.find((option) => option.value === '横浜市中区')?.stationCount).toBe(2)
  })

  it('市区町村が無い駅は数えない', () => {
    const total = municipalityOptions(stations)
      .filter((option) => option.kind === 'municipality')
      .reduce((sum, option) => sum + option.stationCount, 0)
    expect(total).toBe(5)
  })

  it('多い順に並ぶ（同数は名前順で決定的に）', () => {
    const counts = municipalityOptions(stations)
      .filter((option) => option.kind === 'municipality')
      .map((option) => option.stationCount)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })
})

describe('重み 0 の指標には色を振らない', () => {
  it('使われる指標だけに、連続した番号が付く', () => {
    expect(colorIndexes([0.3, 0, 0.2, 0.5])).toEqual([0, null, 1, 2])
  })

  it('全部 0 のときは全部に色を振る（domain が全指標を等しく扱うため）', () => {
    expect(colorIndexes([0, 0, 0])).toEqual([0, 1, 2])
  })

  it('ファミリーの既定（地価水準が 0）で 5 色になる', () => {
    const weights = RECOMMEND_PRESETS.family.metrics.map((metric) => metric.weight)
    const colors = colorIndexes(weights)
    expect(colors.filter((color) => color !== null)).toHaveLength(5)
    expect(colors[3]).toBeNull()
  })
})

describe('重みの割合は、サーバと同じ関数で出す', () => {
  it('合計 1 に揃う', () => {
    const shares = shareOfWeights([0.3, 0.2, 0.5])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10)
  })

  it('合計 0 は均等（割れないので）', () => {
    expect(shareOfWeights([0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('負の重みは 0 として扱う', () => {
    expect(shareOfWeights([-1, 1])).toEqual([0, 1])
  })

  it('プリセットの既定はそのまま % になる（合計が 1 なので）', () => {
    const weights = RECOMMEND_PRESETS.budget.metrics.map((metric) => metric.weight)
    expect(percentJa(shareOfWeights(weights)[0] ?? 0)).toBe('25%')
  })
})

describe('件数の言い方', () => {
  const base = {
    candidateCount: 18,
    rankedCount: 15,
    excludedCounts: { missing: 0, flagged: 0, hazard: 3, total: 3 },
  }

  it('候補の数を先に言う（候補が変われば順位も変わるため）', () => {
    const text = countsJa(base)
    expect(text.indexOf('候補')).toBeLessThan(text.indexOf('順位'))
    expect(text).toContain('18 駅')
    expect(text).toContain('15 駅')
  })

  it('除外は内訳つき。0 駅なら何も言わない', () => {
    expect(exclusionsJa(base.excludedCounts)).toBe('除外 3 駅（災害 3）')
    expect(exclusionsJa({ missing: 1, flagged: 2, hazard: 3, total: 6 })).toBe(
      '除外 6 駅（災害 3・欠損 1・⚠ 2）',
    )
    expect(exclusionsJa({ missing: 0, flagged: 0, hazard: 0, total: 0 })).toBeNull()
  })

  it('スコアは 3 桁で揃える', () => {
    expect(scoreJa(0.69214)).toBe('0.692')
    expect(scoreJa(0.5)).toBe('0.500')
  })
})

describe('内訳の帯', () => {
  const row = (score: number) => ({ score })

  it('目盛りは表示行の最大スコア', () => {
    expect(barScale([row(0.4), row(0.7), row(0.2)])).toBe(0.7)
  })

  it('スコアが負にしかならないとき（z-score）は帯を描かない', () => {
    expect(barScale([row(-0.3), row(-1.2)])).toBe(0)
    expect(barWidth(-0.3, 0)).toBe(0)
  })

  it('負の寄与は 0 幅にする（負の長さは描けない）', () => {
    expect(barWidth(-0.1, 1)).toBe(0)
    expect(barWidth(0.25, 0.5)).toBe(50)
  })
})

describe('⚠ は「どの指標が」まで言う', () => {
  const metrics = [
    { shortLabelJa: '将来人口' },
    { shortLabelJa: '地価水準' },
    { shortLabelJa: '乗降水準' },
  ]

  it('内訳と指標の並びで対応を取る', () => {
    const breakdown = [{ flagged: false }, { flagged: true }, { flagged: true }]
    expect(flaggedLabelsJa(breakdown, metrics)).toEqual(['地価水準', '乗降水準'])
  })

  it('1 つも立っていなければ空（印そのものを出さない）', () => {
    expect(flaggedLabelsJa([{ flagged: false }], metrics)).toEqual([])
  })

  it('⚠ が付いた駅を数える（例外なのか常態なのかが分かるように）', () => {
    const rows = [
      { breakdown: [{ flagged: false }, { flagged: false }] },
      { breakdown: [{ flagged: true }, { flagged: false }] },
      { breakdown: [{ flagged: true }, { flagged: true }] },
    ]
    expect(flaggedRowCount(rows)).toBe(2)
  })
})
