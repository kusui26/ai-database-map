import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { blockingUnknownArgs, unknownArgsForLlm, unknownArgsOf } from '@/ai/mcp-unknown-args'

/**
 * **広告していない引数を黙って外さない**（2026-10-13・`docs/261001_fix_user_feedback_ui.md` §6.18）。
 *
 * 見ること：広告した型に無い引数を場所つきで見つける（一番上・入れ子・配列の要素・任意や null 可や既定値の包みの中）。
 * 値が無い・null・false は頼んでいないので見逃し、一番上の `present`（表示用）も見逃す。断りの文は、どれも集計して
 * いないことと、その場所で使える引数、知っている名前（inMapView）の呼び直し方を返す。
 */

const SCHEMA = z.looseObject({
  metric: z.string(),
  prefectures: z.array(z.string()).optional(),
  near: z.object({ station: z.string(), withinM: z.number() }).optional(),
  limit: z.number().default(10),
  label: z.string().nullable().optional(),
  areas: z
    .array(z.looseObject({ municipality: z.string().optional(), line: z.string().optional() }))
    .optional(),
})

describe('unknownArgsOf（広告した型に無い引数を、場所つきで見つける）', () => {
  it('型どおりなら空（入れ子・配列・包みの中も）', () => {
    const input = {
      metric: 'pop_gr',
      prefectures: ['東京都'],
      near: { station: '竹橋', withinM: 5000 },
      limit: 5,
      label: null,
      areas: [{ municipality: '横浜市' }, { line: '東急東横線' }],
    }
    expect(unknownArgsOf(SCHEMA, input)).toEqual([])
  })

  it('一番上の知らない引数は、その場所で使える引数（shape の順）と一緒に返す', () => {
    expect(unknownArgsOf(SCHEMA, { metric: 'pop_gr', inMapView: true })).toEqual([
      {
        arg: 'inMapView',
        usable: ['metric', 'prefectures', 'near', 'limit', 'label', 'areas'],
      },
    ])
  })

  it('配列の要素は番号つき、入れ子のオブジェクトは点でつなぐ', () => {
    const input = {
      metric: 'pop_gr',
      near: { station: '竹橋', withinM: 5000, radius: 1 },
      areas: [{ municipality: '横浜市' }, { inMapView: true }],
    }
    expect(unknownArgsOf(SCHEMA, input).map((each) => each.arg)).toEqual([
      'near.radius',
      'areas[1].inMapView',
    ])
    expect(unknownArgsOf(SCHEMA, input)[1]?.usable).toEqual(['municipality', 'line'])
  })

  it('値が無い・null・false は頼んでいないので見逃す（0 や空の文字は頼んでいる）', () => {
    const quiet = { metric: 'pop_gr', a: undefined, b: null, c: false }
    expect(unknownArgsOf(SCHEMA, quiet)).toEqual([])
    const loud = { metric: 'pop_gr', d: 0, e: '' }
    expect(unknownArgsOf(SCHEMA, loud).map((each) => each.arg)).toEqual(['d', 'e'])
  })

  it('型の違う値（配列のはずが文字など）はたどらない（型の誤りは SDK の検めが言う）', () => {
    expect(unknownArgsOf(SCHEMA, { metric: 'pop_gr', areas: 'x', near: 'y' })).toEqual([])
    expect(unknownArgsOf(SCHEMA, 'not an object')).toEqual([])
  })
})

describe('blockingUnknownArgs（断る理由になるものだけ）', () => {
  it('一番上の present は答えを変えないので見逃す。入れ子の present は見逃さない', () => {
    const unknown = unknownArgsOf(SCHEMA, {
      metric: 'pop_gr',
      present: 'echarts',
      areas: [{ present: 'echarts' }],
    })
    expect(blockingUnknownArgs(unknown).map((each) => each.arg)).toEqual(['areas[0].present'])
  })
})

describe('unknownArgsForLlm（LLM に返す断り）', () => {
  it('どれも集計していないことと、引数の名前・使える引数・知っている名前の呼び直し方を返す', () => {
    const result = unknownArgsForLlm([
      { arg: 'areas[1].inMapView', usable: ['municipality', 'line'] },
      { arg: 'prefecture', usable: ['metric', 'prefectures'] },
    ])
    expect(result.error).toBe(
      '広告していない引数があります（areas[1].inMapView・prefecture）。黙って外すと条件の違う答えになるので、集計していません。',
    )
    expect(result.hint).toContain('unknownArgs の usable')
    expect(result.unknownArgs[0]).toMatchObject({
      arg: 'areas[1].inMapView',
      note: expect.stringContaining('bbox'),
    })
    // 知らない名前には呼び直し方を作らない（推測しない）
    expect(result.unknownArgs[1]).toEqual({ arg: 'prefecture', usable: ['metric', 'prefectures'] })
  })
})
