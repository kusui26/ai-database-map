/**
 * 入口の検証（`src/shared/api.ts` の `recommendQuerySchema` と
 * `src/domain/recommend/request.ts`）を固定する。
 *
 * ここが緩むと、**指定したつもりの重みで出ていない順位**を、指定どおりだと思って読むことになる。
 * だから「知らない指定は黙って捨てない」「絞り込みが無いときに勝手にどこかへ倒さない」を
 * 1 つずつ見る。DB もサーバも要らない。
 */

import { describe, expect, it } from 'vitest'
import { recommendQuerySchema, type RecommendQuery } from '@/shared/api'
import { buildRecommendInput, MAX_CANDIDATE_STATIONS, parseBbox } from '@/domain/recommend/request'
import { HAZARD_PENALTY_STEPS, RECOMMEND_PRESETS } from '@/domain/recommend/presets'

function query(raw: Record<string, unknown> = {}): RecommendQuery {
  return recommendQuerySchema.parse(raw)
}

describe('既定は宣言する（押しつけるのではなく、応答に出す）', () => {
  it('何も指定しなければ、ファミリー／パーセンタイル／1km になる', () => {
    const parsed = query()
    expect(parsed.preset).toBe('family')
    expect(parsed.method).toBe('percentile')
    expect(parsed.radiusM).toBe(1000)
    expect(parsed.flagged).toBe('annotate')
    expect(parsed.topN).toBe(5)
  })

  it('災害の既定は「洪水が危険以上を候補から外す」（スキルの実走と同じ方針）', () => {
    const parsed = query()
    expect(parsed.hazard).toBe('exclude')
    expect(parsed.hazardGroup).toBe('flood')
    expect(parsed.hazardAtOrAbove).toBe('danger')
  })
})

describe('半径はカタログにある 6 段だけ', () => {
  it('6 段は通る', () => {
    expect(query({ radiusM: '2000' }).radiusM).toBe(2000)
  })

  it('6 段以外は 400（存在しない列を引きにいかない）', () => {
    expect(() => query({ radiusM: '1234' })).toThrow()
  })

  it('空文字を 0 にして通さない（coerce の罠）', () => {
    expect(() => query({ radiusM: '' })).toThrow()
  })
})

describe('重みの指定', () => {
  it('「指標名:重み」をカンマで並べる', () => {
    expect(query({ weights: 'pop_gr:0.4,lp_med:0.1' }).weights).toEqual({
      pop_gr: 0.4,
      lp_med: 0.1,
    })
  })

  it('形が違えば 400（黙って無視しない）', () => {
    expect(() => query({ weights: 'pop_gr' })).toThrow()
    expect(() => query({ weights: 'pop_gr:abc' })).toThrow()
    expect(() => query({ weights: 'pop_gr:-1' })).toThrow()
  })

  it('大きすぎる重み・多すぎる指定は 400', () => {
    expect(() => query({ weights: 'pop_gr:101' })).toThrow()
    const many = Array.from({ length: 13 }, (_, index) => `m${index}:1`).join(',')
    expect(() => query({ weights: many })).toThrow()
  })
})

describe('絞り込みが無いときは走らせない', () => {
  it('何も指定が無ければ 400（全国 9,273 駅を対象にしない）', () => {
    const built = buildRecommendInput(query())
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.messageJa).toContain('絞り込')
  })

  it('市区町村・路線・地図範囲のどれか 1 つで走る', () => {
    expect(buildRecommendInput(query({ municipality: '横浜市' })).ok).toBe(true)
    expect(buildRecommendInput(query({ routes: ['東海道線'] })).ok).toBe(true)
    expect(buildRecommendInput(query({ bbox: '139.5,35.4,139.8,35.6' })).ok).toBe(true)
  })
})

describe('bbox', () => {
  it('4 つの数値だけを受ける', () => {
    expect(parseBbox('139.5,35.4,139.8,35.6')).toEqual({
      west: 139.5,
      south: 35.4,
      east: 139.8,
      north: 35.6,
    })
    expect(parseBbox('139.5,35.4,139.8')).toBeNull()
    expect(parseBbox('139.5,35.4,139.8,north')).toBeNull()
  })

  it('壊れた bbox は 400（黙って無視して全域を対象にしない）', () => {
    const built = buildRecommendInput(query({ bbox: '1,2,3' }))
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.messageJa).toContain('bbox')
  })
})

describe('プリセットと重みの上書き', () => {
  it('上書きが無ければプリセットのまま（customized は false）', () => {
    const built = buildRecommendInput(query({ municipality: '横浜市', preset: 'budget' }))
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.customized).toBe(false)
    expect(built.input.specs).toEqual(RECOMMEND_PRESETS.budget.metrics)
  })

  it('知っている指標名なら差し替わり、向きは保たれる', () => {
    const built = buildRecommendInput(
      query({ municipality: '横浜市', preset: 'budget', weights: 'lp_med:0.5' }),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.customized).toBe(true)
    const landPrice = built.input.specs.find((spec) => spec.metric === 'lp_med')
    expect(landPrice?.weight).toBe(0.5)
    // 予算重視の地価水準は「安いほど良い」のまま（重みを変えても向きは変えない）。
    expect(landPrice?.direction).toBe('lower')
  })

  it('知らない指標名は 400。使える名前を返す', () => {
    const built = buildRecommendInput(query({ municipality: '横浜市', weights: 'nope:0.5' }))
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.messageJa).toContain('nope')
    expect(built.messageJa).toContain('pop_gr_pred')
  })
})

describe('災害の方針', () => {
  it('off は何もしない', () => {
    const built = buildRecommendInput(query({ municipality: '横浜市', hazard: 'off' }))
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.input.hazard).toEqual({ mode: 'off' })
  })

  it('exclude は グループと下限を運ぶ', () => {
    const built = buildRecommendInput(
      query({ municipality: '横浜市', hazard: 'exclude', hazardGroup: 'tsunami' }),
    )
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.input.hazard).toEqual({
        mode: 'exclude',
        group: 'tsunami',
        atOrAbove: 'danger',
      })
    }
  })

  it('penalty は名前で選んだ表をそのまま運ぶ（係数を掛けない）', () => {
    const built = buildRecommendInput(
      query({ municipality: '横浜市', hazard: 'penalty', hazardPenalty: 'heavy' }),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.hazard).toEqual({
      mode: 'penalty',
      group: 'flood',
      steps: HAZARD_PENALTY_STEPS.heavy,
    })
  })
})

describe('候補集合の上限', () => {
  it('入力に必ず載る（切り詰めではなく 400 にするため）', () => {
    const built = buildRecommendInput(query({ municipality: '横浜市' }))
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.input.maxStations).toBe(MAX_CANDIDATE_STATIONS)
  })

  it('1 都道府県は必ず収まる（最多の東京都で 654 駅）', () => {
    expect(MAX_CANDIDATE_STATIONS).toBeGreaterThan(654)
  })

  it('PostgREST の 1,000 行の壁より下にある（超過を超過として検出できる）', () => {
    // 上限 +1 で「多すぎる」を判定するので、その +1 が壁に当たると永久に成立しない。
    expect(MAX_CANDIDATE_STATIONS + 1).toBeLessThanOrEqual(1000)
  })
})
