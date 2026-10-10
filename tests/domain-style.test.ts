/**
 * 駅の色分け（`src/domain/style/`・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * 見ること：
 * - 読みやすい数：有効 2 桁の丸め・いちばん近い 1・2・5 の数（比で測る）・それ以下で最大の 1・2・5 の数
 * - 分位は SQL の percentile_cont と同じ（線形補間）。段の範囲は**下限を含み上限を含まない**（境目ちょうどの駅は上の段）
 * - 水準：5 分位を有効 2 桁に丸め、丸めた境目で分ける。同じ境目は 1 つにし、空の段は作らない
 * - 増減：0 を中心に対称（−a・−b・b・a）。a は絶対値の 8 割点に近い 1・2・5、b は a/4 以下の 1・2・5
 * - 色分けしない：値のある駅が 5 未満（**0 でも止まる**——以前は空の段を外す繰り返しが終わらなかった）・値が 1 種類・
 *   段に分けられない。凡例は理由を持ち、色の意味は null、駅は全部 null（強調で出す）
 * - ⚠ は分け方に入れず数だけ・値の無い駅は数だけ（描かない）
 * - 凡例の言葉：境目を丸めずに書く（1.5 を「2」にしない）、増減は符号、真ん中は「ほぼ横ばい」
 * - 本物の横浜市の 137 駅：人口の増減は −5・−1・+1・+5% で 4・16・25・59・32 駅、地価は 5 段・⚠ 40・値なし 3
 */

import { describe, expect, it } from 'vitest'
import { requireEntry, type CatalogEntry } from '@/shared/catalog'
import { stationClassesResponseSchema } from '@/shared/area-summary'
import { largestNiceAtMost, nearestNice, roundSignificant } from '@/domain/style/nice'
import {
  AREA_SERIES_COLORS,
  areaSeriesColor,
  DIVERGING_COLORS,
  FLAGGED_COLOR,
  SEQUENTIAL_COLORS,
  sequentialColors,
} from '@/domain/style/palette'
import {
  classIndexOf,
  classifyStations,
  divergingBreaks,
  levelBreaks,
  MIN_STYLED_STATIONS,
  quantile,
  schemeOf,
  type StyleInput,
} from '@/domain/style/classify'
import { colorableEntry, defaultColorEntry, notColorableJa } from '@/domain/style/load'
import { classRows } from '@/domain/style/rows'
import { KAWASAKI_POP_GR, YOKOHAMA_LP_MED, YOKOHAMA_POP_GR } from './fixtures/area-summary'

const POP_GR = requireEntry('pop_gr_2020_2015_1km')
const POP = requireEntry('pop_2020_1km')
const LP_MED = requireEntry('lp_med_2026_1km')
const BUS = requireEntry('bus_n_1km')
const SALES = requireEntry('sales_dest_2021_1km')

/** 値の並び → 色分けの入力（⚠ なし）。 */
function inputs(values: readonly number[], flagged: readonly number[] = []): StyleInput[] {
  return [
    ...values.map((value, index) => ({ grp: `駅${index}`, value, flagged: false })),
    ...flagged.map((value, index) => ({ grp: `⚠駅${index}`, value, flagged: true })),
  ]
}

/** 本物の値（値の無い駅は落とす）→ 色分けの入力。 */
function fromValues(values: typeof YOKOHAMA_POP_GR): StyleInput[] {
  return values.flatMap((each) =>
    each.value === null ? [] : [{ grp: each.grp, value: each.value, flagged: each.flagged }],
  )
}

function labels(entry: CatalogEntry, values: readonly number[]): string[] {
  return classifyStations(inputs(values), entry, values.length).legend.classes.map(
    (each) => each.labelJa,
  )
}

describe('読みやすい数', () => {
  it.each([
    [25432, 25000],
    [315000, 320000],
    [0.000123, 0.00012],
    [-12345, -12000],
    [95, 95],
    [0, 0],
  ])('有効 2 桁：%s → %s', (value, expected) => {
    expect(roundSignificant(value, 2)).toBe(expected)
  })

  it.each([
    [6.3, 5],
    [7.5, 10],
    [30, 20],
    [1, 1],
    [0.7, 0.5],
    [140, 100],
    [160, 200],
  ])('いちばん近い 1・2・5（比で測る）：%s → %s', (value, expected) => {
    expect(nearestNice(value)).toBe(expected)
  })

  it.each([
    [1.25, 1],
    [12.5, 10],
    [0.3, 0.2],
    [5, 5],
    [2.5, 2],
    [50, 50],
  ])('それ以下で最大の 1・2・5：%s → %s', (value, expected) => {
    expect(largestNiceAtMost(value)).toBe(expected)
  })

  it('正でない・有限でない数は 0（境目を作らない）', () => {
    expect(nearestNice(0)).toBe(0)
    expect(nearestNice(-3)).toBe(0)
    expect(nearestNice(Number.NaN)).toBe(0)
    expect(largestNiceAtMost(0)).toBe(0)
    expect(largestNiceAtMost(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('分位と段の決め方', () => {
  it('分位は線形補間（percentile_cont と同じ）', () => {
    const sorted = [1, 2, 3, 4, 5]
    expect(quantile(sorted, 0)).toBe(1)
    expect(quantile(sorted, 0.5)).toBe(3)
    expect(quantile(sorted, 0.25)).toBe(2)
    expect(quantile([10, 20], 0.5)).toBe(15)
    expect(quantile([7], 0.8)).toBe(7)
    expect(quantile([], 0.5)).toBeNaN()
  })

  it('境目ちょうどの駅は上の段（下限を含み上限を含まない）', () => {
    const breaks = [-5, -1, 1, 5]
    expect(classIndexOf(-5.1, breaks)).toBe(0)
    expect(classIndexOf(-5, breaks)).toBe(1)
    expect(classIndexOf(-1, breaks)).toBe(2)
    expect(classIndexOf(0.99, breaks)).toBe(2)
    expect(classIndexOf(1, breaks)).toBe(3)
    expect(classIndexOf(5, breaks)).toBe(4)
  })

  it('増減・誤差は 0 を中心（diverging）、水準は 5 分位（sequential）', () => {
    expect(schemeOf(POP_GR)).toBe('diverging')
    expect(schemeOf(requireEntry('pop_err_2020_pred_2018_1km'))).toBe('diverging')
    expect(schemeOf(POP)).toBe('sequential')
    expect(schemeOf(LP_MED)).toBe('sequential')
  })
})

describe('水準の境目（5 分位・有効 2 桁・空の段なし）', () => {
  it('分位を有効 2 桁に丸めた境目で分ける', () => {
    const values = Array.from({ length: 100 }, (_, index) => 10000 + index * 523)
    const breaks = levelBreaks(values)
    expect(breaks).toEqual([20000, 31000, 41000, 51000])
    expect(breaks.every((edge) => roundSignificant(edge, 2) === edge)).toBe(true)
  })

  it('同じ値が多く、丸めた境目が重なれば 1 つにする（分位 100・100・100・220 → 100・220 → 空の段を外して 220）', () => {
    const values = [100, 100, 100, 100, 100, 100, 100, 200, 300, 400]
    expect(levelBreaks(values)).toEqual([220])
    const counts = classifyStations(inputs(values), POP, 10).legend.classes.map(
      (each) => each.count,
    )
    expect(counts).toEqual([8, 2])
  })

  it('空の段は作らない（空の段の下の境目を外して上の段と合わせる）', () => {
    // 分位 1.8・2.6・3.4・4.2 → 2・2.6・3.4・4.2。2 未満の駅（1）はあるが…
    const breaks = levelBreaks([1, 2, 3, 4, 5])
    const counts = classifyStations(inputs([1, 2, 3, 4, 5]), POP, 5).legend.classes.map(
      (each) => each.count,
    )
    expect(counts.every((count) => count > 0)).toBe(true)
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(5)
    expect(breaks.length + 1).toBe(counts.length)
  })

  it('境目が 1 つも残らなければ空（呼び出し側が色分けしない）', () => {
    expect(levelBreaks([3, 3, 3, 3, 3, 3])).toEqual([])
  })

  it('値が 1 つも無くても止まる（空の段を外す繰り返しは、境目が無くなれば終わる）', () => {
    expect(levelBreaks([])).toEqual([])
    expect(divergingBreaks([])).toEqual([])
  })

  it('値がすべて整数（バス停の数）なら、境目を整数に切り上げる（分け方は同じ・「1.8 箇所」と書かない）', () => {
    const values = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    // 分位は 1.8・3.6・5.4・7.2
    expect(levelBreaks(values)).toEqual([2, 4, 6, 8])
    const legend = classifyStations(inputs(values), BUS, 10).legend
    expect(legend.classes.map((each) => [each.labelJa, each.count])).toEqual([
      ['2 箇所未満', 2],
      ['2〜4 箇所', 2],
      ['4〜6 箇所', 2],
      ['6〜8 箇所', 2],
      ['8 箇所以上', 2],
    ])
  })
})

describe('増減の境目（0 を中心に対称）', () => {
  it('a＝絶対値の 8 割点に近い 1・2・5、b＝a/4 以下の 1・2・5', () => {
    // 絶対値の 8 割点が 4.6 → a＝5、a/4＝1.25 → b＝1
    const values = [-6, -4.6, -2, -0.5, 0, 0.3, 1.2, 2.5, 4.6, 8]
    expect(divergingBreaks([...values].sort((x, y) => x - y))).toEqual([-5, -1, 1, 5])
  })

  it('ずっと増えていても、境目は 0 を中心に対称（減少の段は空のまま凡例に残る）', () => {
    const values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12]
    const legend = classifyStations(inputs(values), POP_GR, values.length).legend
    expect(legend.classes.map((each) => [each.lower, each.upper])).toEqual([
      [null, -10],
      [-10, -2],
      [-2, 2],
      [2, 10],
      [10, null],
    ])
    expect(legend.classes.map((each) => each.count)).toEqual([0, 0, 0, 8, 2])
  })

  it('8 割以上が 0 なら境目を作らない', () => {
    expect(divergingBreaks([0, 0, 0, 0, 0, 0, 0, 0, 0, 3])).toEqual([])
  })
})

describe('色分けしない（理由を返す）', () => {
  it.each([0, 1, MIN_STYLED_STATIONS - 1])('値のある駅が %s（5 未満）', (count) => {
    for (const entry of [POP, POP_GR]) {
      const values = Array.from({ length: count }, (_, index) => index + 1)
      const { legend, assignments } = classifyStations(inputs(values), entry, count + 2)
      expect(legend.reasonJa).toBe(`値のある駅が ${count} しかないので色分けしない（5 駅から）。`)
      expect(legend.classes).toEqual([])
      expect(legend.meaningJa).toBeNull()
      expect(legend.missingCount).toBe(2)
      expect([...assignments.values()].every((cls) => cls === null)).toBe(true)
      expect(assignments.size).toBe(count)
    }
  })

  it('⚠ ばかりで、数えられる駅が 5 未満', () => {
    const { legend } = classifyStations(inputs([1, 2], [3, 4, 5, 6]), POP, 6)
    expect(legend.reasonJa).toContain('値のある駅が 2 しかない')
    expect(legend.flagged.count).toBe(4)
  })

  it('値が 1 種類だけ（水準・増減とも）', () => {
    expect(classifyStations(inputs([7, 7, 7, 7, 7]), POP, 5).legend.reasonJa).toBe(
      '値が 1 種類しかないので色分けしない。',
    )
    expect(classifyStations(inputs([2.5, 2.5, 2.5, 2.5, 2.5]), POP_GR, 5).legend.reasonJa).toBe(
      '値が 1 種類しかないので色分けしない。',
    )
  })

  it('ほとんどの駅が同じ値で段に分けられない（増減の 8 割以上が 0）', () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3]
    expect(classifyStations(inputs(values), POP_GR, 10).legend.reasonJa).toBe(
      'ほとんどの駅が同じ値で、段に分けられないので色分けしない。',
    )
  })
})

describe('凡例と駅の段', () => {
  it('⚠ は分け方に入れず参考値の色で数だけ、値の無い駅は数だけ（描かない）', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const { legend, assignments } = classifyStations(inputs(values, [100, 200]), POP, 15)
    expect(legend.flagged).toEqual({ color: FLAGGED_COLOR, labelJa: '参考値（⚠）', count: 2 })
    expect(legend.missingCount).toBe(3)
    expect(assignments.get('⚠駅0')).toBeNull()
    expect(assignments.get('駅0')).toBe(0)
    expect(assignments.get('駅9')).toBe(legend.classes.length - 1)
    // ⚠ の 100・200 は境目を引き上げない
    expect(
      Math.max(...legend.classes.flatMap((each) => [each.lower ?? 0, each.upper ?? 0])),
    ).toBeLessThan(10)
  })

  it('凡例の数は、駅ごとの段を数えたものと一致する', () => {
    const values = Array.from({ length: 40 }, (_, index) => (index - 15) * 0.7)
    const { legend, assignments } = classifyStations(inputs(values), POP_GR, 40)
    const counted = legend.classes.map(
      (each) => [...assignments.values()].filter((cls) => cls === each.index).length,
    )
    expect(counted).toEqual(legend.classes.map((each) => each.count))
  })

  it('増減の言葉：符号・「ほぼ横ばい」・端の段は「未満」「以上」', () => {
    expect(labels(POP_GR, [-6, -4.6, -2, -0.5, 0, 0.3, 1.2, 2.5, 4.6, 8])).toEqual([
      '-5%未満',
      '-5〜-1%',
      '-1〜+1%（ほぼ横ばい）',
      '+1〜+5%',
      '+5%以上',
    ])
  })

  it('小数の境目は丸めずに書く（%・水準とも）', () => {
    const small = [-0.9, -0.6, -0.3, -0.1, 0, 0.1, 0.2, 0.4, 0.6, 0.8]
    expect(labels(POP_GR, small)).toEqual([
      '-0.5%未満',
      '-0.5〜-0.1%',
      '-0.1〜+0.1%（ほぼ横ばい）',
      '+0.1〜+0.5%',
      '+0.5%以上',
    ])
    // 売上（小数 1 桁の指標）の境目 0.28 を、書式で丸めて「0.3」と書かない（0.28 で分けている）
    expect(labels(SALES, [0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.6, 0.8, 1, 2])).toEqual([
      '0.28 億円未満',
      '0.28〜0.43 億円',
      '0.43〜0.54 億円',
      '0.54〜0.84 億円',
      '0.84 億円以上',
    ])
  })

  it('水準の言葉：3 桁区切り・単位は空白のあと', () => {
    const values = Array.from({ length: 100 }, (_, index) => 10000 + index * 523)
    expect(labels(POP, values)).toEqual([
      '20,000 人未満',
      '20,000〜31,000 人',
      '31,000〜41,000 人',
      '41,000〜51,000 人',
      '51,000 人以上',
    ])
  })

  it('色の意味（AI はこの文で説明する）', () => {
    const values = [-6, -4.6, -2, -0.5, 0, 0.3, 1.2, 2.5, 4.6, 8]
    expect(classifyStations(inputs(values), POP_GR, 10).legend.meaningJa).toBe(
      '赤は増加、青は減少、灰色はほぼ横ばい（-1〜+1%）。0 が真ん中。',
    )
    const levels = Array.from({ length: 100 }, (_, index) => 10000 + index * 523)
    expect(classifyStations(inputs(levels), POP, 100).legend.meaningJa).toBe(
      '色が濃いほど値が大きい（エリアの駅を 5 つに分け、境目は有効 2 桁に丸めた）。',
    )
  })

  it('凡例は指標の名前（年・半径つき）・単位・出典を持つ', () => {
    const legend = classifyStations(inputs([1, 2, 3, 4, 5]), POP_GR, 5).legend
    expect(legend).toMatchObject({
      metricKey: 'pop_gr_2020_2015_1km',
      titleJa: POP_GR.labelJa,
      unit: '%',
      scheme: 'diverging',
      sourceJa: POP_GR.source,
      reasonJa: null,
    })
  })
})

describe('色（ColorBrewer・良い悪いの色にしない）', () => {
  it('水準は淡い → 濃い（段が少なければ両端を含んで間を空ける）', () => {
    expect(sequentialColors(5)).toEqual([...SEQUENTIAL_COLORS])
    expect(sequentialColors(2)).toEqual([SEQUENTIAL_COLORS[0], SEQUENTIAL_COLORS[4]])
    expect(sequentialColors(3)).toEqual([
      SEQUENTIAL_COLORS[0],
      SEQUENTIAL_COLORS[2],
      SEQUENTIAL_COLORS[4],
    ])
    expect(sequentialColors(1)).toEqual([SEQUENTIAL_COLORS[4]])
  })

  it('増減は青（減少）→ 灰（横ばい）→ 赤（増加）', () => {
    const values = [-6, -4.6, -2, -0.5, 0, 0.3, 1.2, 2.5, 4.6, 8]
    const colors = classifyStations(inputs(values), POP_GR, 10).legend.classes.map(
      (each) => each.color,
    )
    expect(colors).toEqual([...DIVERGING_COLORS])
    expect(colors[2]).toBe('#d4d4d4')
  })

  it('比べる推移の系列の色は 4 色で循環する', () => {
    expect(areaSeriesColor(0)).toBe(AREA_SERIES_COLORS[0])
    expect(areaSeriesColor(3)).toBe(AREA_SERIES_COLORS[3])
    expect(areaSeriesColor(4)).toBe(AREA_SERIES_COLORS[0])
    expect(new Set(AREA_SERIES_COLORS).size).toBe(4)
  })
})

describe('本物の値（横浜市の 137 駅・川崎市の 53 駅）', () => {
  it('人口の増減：−5・−1・+1・+5% で 4・16・25・59・32 駅、値なし 1', () => {
    const { legend } = classifyStations(fromValues(YOKOHAMA_POP_GR), POP_GR, YOKOHAMA_POP_GR.length)
    expect(legend.classes.map((each) => [each.labelJa, each.count])).toEqual([
      ['-5%未満', 4],
      ['-5〜-1%', 16],
      ['-1〜+1%（ほぼ横ばい）', 25],
      ['+1〜+5%', 59],
      ['+5%以上', 32],
    ])
    expect(legend.missingCount).toBe(1)
  })

  it('地価の中央値：5 段・⚠ 40 駅・値なし 3 駅', () => {
    const { legend } = classifyStations(fromValues(YOKOHAMA_LP_MED), LP_MED, YOKOHAMA_LP_MED.length)
    expect(legend.classes.map((each) => [each.labelJa, each.count])).toEqual([
      ['260,000 円/㎡未満', 19],
      ['260,000〜330,000 円/㎡', 18],
      ['330,000〜400,000 円/㎡', 19],
      ['400,000〜540,000 円/㎡', 19],
      ['540,000 円/㎡以上', 19],
    ])
    expect(legend.flagged.count).toBe(40)
    expect(legend.missingCount).toBe(3)
  })

  it('2 つのエリアは合わせて 1 つの凡例（横浜市＋川崎市）', () => {
    const both = [...fromValues(YOKOHAMA_POP_GR), ...fromValues(KAWASAKI_POP_GR)]
    const total = YOKOHAMA_POP_GR.length + KAWASAKI_POP_GR.length
    const { legend, assignments } = classifyStations(both, POP_GR, total)
    expect(legend.classes.map((each) => each.count)).toEqual([5, 17, 28, 82, 57])
    const response = stationClassesResponseSchema.parse({
      areas: ['muni:14100', 'muni:14130'],
      areaLabelsJa: ['神奈川県横浜市', '神奈川県川崎市'],
      legend,
      stations: classRows(both, assignments, POP_GR),
    })
    expect(response.stations).toHaveLength(189)
  })
})

describe('色分けできる指標', () => {
  it('ランキングできる key だけ（フラグ・知らない key は null）', () => {
    expect(colorableEntry('pop_gr_2020_2015_1km')?.key).toBe('pop_gr_2020_2015_1km')
    expect(colorableEntry('pax_2024')?.key).toBe('pax_2024')
    expect(colorableEntry('pop_2020_1km_flag')).toBeNull()
    expect(colorableEntry('nope')).toBeNull()
    expect(notColorableJa('nope')).toBe(
      '色分けできない指標です: nope（GET /api/metrics で rankable な key を選ぶ）',
    )
  })

  it('既定は人口の増減（5 年・その半径。地価のように半径の無いものは近い半径に替える規則と同じ）', () => {
    expect(defaultColorEntry(1000)?.key).toBe('pop_gr_2020_2015_1km')
    expect(defaultColorEntry(500)?.key).toBe('pop_gr_2020_2015_500m')
    expect(defaultColorEntry(20000)?.key).toBe('pop_gr_2020_2015_20km')
  })
})
