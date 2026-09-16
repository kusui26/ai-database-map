/**
 * 応答の組み立て（`src/domain/recommend/presenter.ts`）を固定する。
 *
 * 見るのは数字ではなく、**順位と一緒に必ず出るもの**——採った方法・重み・候補集合・
 * 外した駅と理由・敏感度・限界・出典（§13.4 の規範 6 項目）。合成スコアはそれらが
 * 添わなければ読めないので、型で必須にしたうえで、ここで中身を見る。
 *
 * DB は使わない。`gatherCandidates` が返すはずの形を組み立てて渡す。
 */

import { describe, expect, it } from 'vitest'
import { recommendQuerySchema, recommendResponseSchema, type StationListItem } from '@/shared/api'
import type { HazardLevel } from '@/shared/constants'
import type { StationHazardSummary } from '@/shared/hazard-summary'
import { recommendStations } from '@/domain/recommend'
import { columnsFor, resolveMetrics } from '@/domain/recommend/metrics'
import { sensitivityJa } from '@/domain/recommend/labels'
import { presentRecommendation } from '@/domain/recommend/presenter'
import { RECOMMEND_PRESETS } from '@/domain/recommend/presets'
import { buildRecommendInput } from '@/domain/recommend/request'
import type { RecommendRunOk } from '@/domain/recommend/run'
import type { CandidateStation } from '@/domain/recommend/types'

const RADIUS_M = 1000
const resolved = resolveMetrics(RECOMMEND_PRESETS.budget.metrics, RADIUS_M)
const METRICS = resolved.metrics
const KEYS = METRICS.map((metric) => metric.key)

function hazardSummary(grp: string, flood: HazardLevel): StationHazardSummary {
  const clear = { level: 'none', worstJa: null, nearby: false, uncovered: false } as const
  return {
    grp,
    level: flood,
    evacuation: null,
    headlineJa: '想定区域の重さで並べたものです',
    certainty: 'exact',
    elevationM: 10,
    groups: {
      flood: {
        level: flood,
        worstJa: flood === 'none' ? null : '洪水浸水想定区域',
        ...{ nearby: false, uncovered: false },
      },
      inland_flood: clear,
      storm_surge: clear,
      tsunami: clear,
      landslide: clear,
    },
  }
}

function listItem(grp: string, name: string, index: number): StationListItem {
  return {
    grp,
    stationName: name,
    label: `${name}駅`,
    prefecture: '神奈川県',
    municipality: '横浜市中区',
    municipalityCode: '14104',
    lon: 139.6 + index / 100,
    lat: 35.4 + index / 100,
    nOp: 1,
    paxLatest: 10_000 * (index + 1),
  }
}

/** 指標に値を配る。`skip` の列だけ欠損にする（0 で埋めない）。 */
function valuesFor(index: number, skip?: string): Record<string, number> {
  const values: Record<string, number> = {}
  for (const [order, key] of KEYS.entries()) {
    if (key === skip) continue
    values[key] = 100 + index * 10 + order
  }
  return values
}

type Fixture = { readonly stations: StationListItem[]; readonly candidates: CandidateStation[] }

/** A〜F の 6 駅。除外の 3 種類（欠損・災害）と「災害サマリが無い駅」を全部含む。 */
function fixture(): Fixture {
  const spec = [
    { name: 'あお', flood: 'none' as const, skip: undefined, hazard: true },
    { name: 'みどり', flood: 'none' as const, skip: undefined, hazard: true },
    { name: 'きいろ', flood: 'warning' as const, skip: undefined, hazard: true },
    { name: 'あか', flood: 'critical' as const, skip: undefined, hazard: true },
    { name: 'かけ', flood: 'none' as const, skip: KEYS[0], hazard: true },
    { name: 'ふめい', flood: 'none' as const, skip: undefined, hazard: false },
  ]
  const stations = spec.map((item, index) => listItem(`g${index}`, item.name, index))
  const candidates = spec.map((item, index) => ({
    grp: `g${index}`,
    name: item.name,
    values: valuesFor(index, item.skip),
    hazard: item.hazard ? hazardSummary(`g${index}`, item.flood) : null,
  }))
  return { stations, candidates }
}

function present(raw: Record<string, unknown> = {}) {
  const query = recommendQuerySchema.parse({ municipality: '横浜市', preset: 'budget', ...raw })
  const built = buildRecommendInput(query)
  if (!built.ok) throw new Error(built.messageJa)
  const { stations, candidates } = fixture()
  // `runRecommendation` と同じ順（解決 → 合成）。プリセットを変えると重みと向きが変わる。
  const { metrics, labels, notes, unresolved } = resolveMetrics(
    built.input.specs,
    built.input.radiusM,
  )
  const result = recommendStations(candidates, {
    metrics,
    method: built.input.method,
    hazard: built.input.hazard,
    flagged: built.input.flagged ?? 'annotate',
    topN: query.topN,
  })
  const run: RecommendRunOk = {
    kind: 'ok',
    result,
    metrics,
    labels,
    gathered: {
      candidates,
      stations,
      stationCount: stations.length,
      columns: columnsFor(metrics),
      overLimit: false,
    },
    notes,
    unresolved,
  }
  return presentRecommendation({ query, input: built.input, customized: built.customized, run })
}

describe('応答は契約どおりの形をしている', () => {
  it('recommendResponseSchema をそのまま通る', () => {
    expect(() => recommendResponseSchema.parse(present())).not.toThrow()
  })

  it('採った方法と重みが 1 行で出る（§13.4-1/2）', () => {
    const response = present({ method: 'minmax' })
    expect(response.method).toBe('minmax')
    expect(response.methodJa).toContain('min-max')
    const total = response.metrics.reduce((sum, metric) => sum + metric.weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })
})

describe('何を候補にしたかを隠さない（W2 の知見）', () => {
  it('絞り込みと駅数を返し、注記の 1 行目にも書く', () => {
    const response = present()
    expect(response.area.municipality).toBe('横浜市')
    expect(response.area.labelJa).toContain('横浜市')
    expect(response.candidateCount).toBe(6)
    expect(response.notesJa[0]).toContain('6 駅を候補にしました')
  })

  it('エリアの名前は住所と同じ順（広い → 狭い）', () => {
    const response = present({ prefecture: ['神奈川県'], municipality: '横浜市' })
    expect(response.area.labelJa.indexOf('神奈川県')).toBeLessThan(
      response.area.labelJa.indexOf('横浜市'),
    )
  })

  it('限界に「候補が変われば順位も変わる」が必ず入る', () => {
    expect(present().limitationsJa.some((line) => line.includes('候補が変われば'))).toBe(true)
  })
})

describe('外した駅は、件数と理由つきで返す（§13.4-3/5）', () => {
  it('欠損と災害を別々に数える', () => {
    const response = present()
    expect(response.excludedCounts.missing).toBe(1)
    expect(response.excludedCounts.hazard).toBe(1)
    expect(response.excludedCounts.total).toBe(2)
    expect(response.rankedCount).toBe(4)
  })

  it('理由が日本語で付く（黙って消さない）', () => {
    const reasons = present().excluded.map((entry) => entry.reasonJa)
    expect(reasons.some((line) => line.includes('値がないため'))).toBe(true)
    expect(reasons.some((line) => line.includes('洪水'))).toBe(true)
  })
})

describe('危険度は「不明」と「想定区域外」を混ぜない', () => {
  it('サマリが取れなかった駅は level が null（none にしない）', () => {
    const response = present()
    const unknown = response.rows.find((row) => row.name === 'ふめい')
    expect(unknown?.hazard?.level).toBeNull()
    expect(unknown?.hazard?.levelJa).toContain('不明')
    expect(unknown?.hazard?.uncovered).toBe(true)
  })

  it('その駅数を注記に書く（「安全」とは言わない）', () => {
    const note = present().notesJa.find((line) => line.includes('災害サマリ'))
    expect(note).toContain('1 駅')
    expect(note).toContain('安全という意味ではありません')
  })

  it('災害を見ないときは、危険度の欄そのものを返さない', () => {
    const response = present({ hazard: 'off' })
    expect(response.rows.every((row) => row.hazard === null)).toBe(true)
    expect(response.hazard.mode).toBe('off')
    expect(response.excludedCounts.hazard).toBe(0)
  })
})

describe('段階減点は表のまま返す', () => {
  it('掛け算ではなく 5 段の表が応答に載る', () => {
    const response = present({ hazard: 'penalty', hazardPenalty: 'heavy' })
    expect(response.hazard.penalty).toBe('heavy')
    expect(response.hazard.steps).toEqual({
      none: 0,
      caution: 0.05,
      warning: 0.12,
      danger: 0.25,
      critical: 0.4,
    })
    // 足切りではないので、critical の駅も順位に残る（減点されたうえで）。
    expect(response.rows.some((row) => row.name === 'あか')).toBe(true)
  })

  it('z-score と段階減点を混ぜたら、目盛りが違うことを断る', () => {
    const response = present({ hazard: 'penalty', method: 'zscore' })
    expect(response.notesJa.some((line) => line.includes('z-score'))).toBe(true)
  })
})

describe('表がそのまま描ける', () => {
  it('順位・座標・整形済みの値が入る', () => {
    const [top] = present().rows
    expect(top?.rank).toBe(1)
    expect(top?.lon).toBeGreaterThan(139)
    expect(top?.breakdown).toHaveLength(METRICS.length)
    expect(top?.breakdown[0]?.formatted.length).toBeGreaterThan(0)
  })

  it('凡例に使う短い名前が付く（カタログの長いラベルとは別に）', () => {
    const [metric] = present().metrics
    expect(metric?.shortLabelJa).toBe('将来人口')
    expect(metric?.labelJa).toContain('1km圏')
    expect(metric?.labelJa.length).toBeGreaterThan(metric?.shortLabelJa.length ?? 0)
  })

  it('列（metrics）と内訳（breakdown）の key が一致する', () => {
    const response = present()
    const columns = response.metrics.map((metric) => metric.key)
    for (const row of response.rows) {
      expect(row.breakdown.map((item) => item.key)).toEqual(columns)
    }
  })

  it('重み 0 の指標は列にも内訳にも出ない（使っていないものを出さない）', () => {
    // ファミリーは地価水準の重みが 0。
    const response = present({ preset: 'family' })
    expect(response.metrics.some((metric) => metric.baseMetric === 'lp_med')).toBe(false)
    expect(RECOMMEND_PRESETS.family.metrics.some((spec) => spec.metric === 'lp_med')).toBe(true)
  })

  it('limit で表は切れるが、順位が付いた総数は別に返す', () => {
    const response = present({ limit: '2' })
    expect(response.rows).toHaveLength(2)
    expect(response.rankedCount).toBe(4)
  })
})

describe('限界と出典は必ず末尾に付く（§13.4-6）', () => {
  it('地価を使ったら、地価公示であることを断る', () => {
    const lines = present().limitationsJa
    expect(lines.some((line) => line.includes('地価公示'))).toBe(true)
    expect(lines.some((line) => line.includes('将来人口は推計値'))).toBe(true)
  })

  it('災害を使ったら、サマリの限界も足す', () => {
    expect(present().limitationsJa.some((line) => line.includes('駅の代表点'))).toBe(true)
    expect(present({ hazard: 'off' }).limitationsJa.some((line) => line.includes('順序尺度'))).toBe(
      false,
    )
  })

  it('出典は使った列のぶんだけ（重複しない）', () => {
    const sources = present().sources
    expect(sources.length).toBeGreaterThan(0)
    const keys = sources.map((entry) => `${entry.source} ${entry.license}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('敏感度は駅名で返す（§13.4-4）', () => {
  it('頑健か僅差かを 1 行で言う', () => {
    const response = present()
    expect(response.sensitivity.runs).toBe(METRICS.length * 2)
    expect(response.sensitivity.verdictJa).toMatch(/頑健|僅差/)
  })

  it('順位が 0〜1 駅のとき「頑健」と言わない（振っても変わらないのは相手がいないから）', () => {
    const stable = { runs: 10, stable: true, swaps: [], enteredTop: [], leftTop: [] }
    expect(sensitivityJa(stable, 5, 0)).toContain('比べる相手がいません')
    expect(sensitivityJa(stable, 5, 1)).toContain('比べる相手がいません')
    // 2 駅あれば入れ替わりうるので、そこからは頑健／僅差を言ってよい。
    expect(sensitivityJa(stable, 5, 2)).toContain('頑健')
  })
})
