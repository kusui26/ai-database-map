import { describe, expect, it } from 'vitest'
import { toEChartsDocument } from '@/shared/presenters/echarts'
import { ACCENT_COLOR, clusterColor } from '@/shared/constants'
import { type Panel } from '@/shared/protocol'
import { CHART_BAR_COLOR } from '@/shared/viewer/charts'
import { PANEL_FIXTURES, PANEL_TYPES, panelFixture, stackedTrendFixture } from './fixtures/panels'

/**
 * **パネル → ECharts の option**（PR-12・`docs/260912_gui_chat_protocol.md` §4.3(a)）。
 *
 * 母艦の `presentChart` は「ECharts の option をそのまま」受け取るので、ここが作る document は
 * **転記せずにそのまま渡せる**必要がある。固定するのは
 * ①**数値のパネルだけ**を変換すること（危険度・避難系はチャートにしない＝免責と時制が落ちる）、
 * ②option が **JSON だけ**であること（関数が 1 つでも混ざるとホストへ渡せない）、
 * ③読み違えを生む規則が option に載ること（欠損は途切れ・積み上げの合計は丸め前の値・
 * ⚠ が見える・単位が軸名・色が Web UI と同じ）、
 * ④整形済み文字列（`formatted`）が**そのまま**ラベルに出ること。
 */

/** 入れ子の JSON を型なしで辿る（`as` を使わずに深い値を取る）。 */
function pick(value: unknown, ...path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined
    if (typeof key === 'number') return Array.isArray(current) ? current[key] : undefined
    return key in current ? Reflect.get(current, key) : undefined
  }, value)
}

/** 関数がどこかに混ざっていないか（JSON だけ、の実行時検査）。 */
function hasFunction(value: unknown): boolean {
  if (typeof value === 'function') return true
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some(hasFunction)
}

/** 型 1 つぶんの document（無ければ落とす）。 */
function documentOf(panel: Panel): unknown {
  const document = toEChartsDocument([panel])
  if (document === null) throw new Error(`チャートにならないパネル: ${panel.type}`)
  return document
}

/** 型 1 つぶんの option。 */
const optionOf = (panel: Panel): unknown => pick(documentOf(panel), 'charts', 0, 'option')

/** チャートになる型と、ならない型（この 2 つで protocol の全型を覆う）。 */
const CHARTABLE = ['trendChart', 'barChart', 'rankingTable', 'scatter']
const NOT_CHARTABLE = [
  'stationCard',
  'statTable',
  'hazardCard',
  'evacuationList',
  'escapeDirection',
  'markdown',
]

describe('どのパネルを変換するか', () => {
  it('仕分けが protocol の全型を覆う（型を足すとここで気づく）', () => {
    expect(new Set([...CHARTABLE, ...NOT_CHARTABLE])).toEqual(new Set(PANEL_TYPES))
  })

  it('数値のパネルはチャートになる', () => {
    for (const type of CHARTABLE) {
      expect(pick(documentOf(panelFixture(type)), 'charts', 0, 'title'), type).toEqual(
        expect.any(String),
      )
    }
  })

  it('危険度・避難・表・文はチャートにしない（免責と時制を落とさないため）', () => {
    for (const type of NOT_CHARTABLE) {
      expect(toEChartsDocument([panelFixture(type)]), type).toBeNull()
    }
  })

  it('チャートが 1 枚も無ければ null（空の器を渡さない）', () => {
    expect(toEChartsDocument([])).toBeNull()
    expect(toEChartsDocument([panelFixture('markdown'), panelFixture('statTable')])).toBeNull()
  })

  it('複数パネルは 1 つの document にまとまり、題に駅名が付く', () => {
    const document = toEChartsDocument(PANEL_FIXTURES)
    expect(document).not.toBeNull()
    if (document === null) return
    // 見本には trendChart が 2 枚（折れ線・積み上げ）＋ barChart ＋ rankingTable ＋ scatter。
    expect(document.charts.length).toBe(5)
    expect(document.title).toBe('横浜駅・乗降客数の推移')
    expect(document.charts.map((chart) => chart.type)).toEqual([
      'line',
      'bar',
      'bar',
      'bar',
      'scatter',
    ])
  })
})

describe('option は JSON だけ（ホストへそのまま渡せる形）', () => {
  it('関数が 1 つも混ざらず、JSON 往復で同一になる', () => {
    const document = toEChartsDocument(PANEL_FIXTURES)
    expect(document).not.toBeNull()
    if (document === null) return
    expect(hasFunction(document)).toBe(false)
    const roundTrip: unknown = JSON.parse(JSON.stringify(document))
    expect(roundTrip).toEqual(document)
  })
})

describe('推移（折れ線）', () => {
  const option = optionOf(panelFixture('trendChart'))

  it('欠損は null のまま残る（線が途切れる＝つながっていないと分かる）', () => {
    expect(pick(option, 'xAxis', 'data')).toEqual(['2018', '2019', '2020', '2021', '2022'])
    expect(pick(option, 'series', 0, 'data')).toEqual([450_000, 420_000, null, 300_000, 330_000])
    expect(pick(option, 'series', 0, 'connectNulls')).toBe(false)
  })

  it('単位は y 軸の名前に出る（値だけを裸で見せない）', () => {
    expect(pick(option, 'yAxis', 'name')).toBe('人/日')
  })

  it('種別は折れ線・凡例は出す（系列名を読ませる）', () => {
    expect(pick(option, 'series', 0, 'type')).toBe('line')
    expect(pick(option, 'series', 0, 'name')).toBe('乗降客数')
    expect(pick(option, 'legend', 'bottom')).toBe(0)
  })
})

describe('推移（積み上げ）', () => {
  const panel = stackedTrendFixture()
  const option = optionOf(panel)

  it('積み上げ棒になり、内訳は同じ stack に載る', () => {
    expect(pick(option, 'series', 0, 'type')).toBe('bar')
    expect(pick(option, 'series', 0, 'stack')).toBe('total')
    expect(pick(option, 'series', 1, 'stack')).toBe('total')
  })

  it('合計は**内訳の丸め和ではなく宣言された値**を、別の線で出す', () => {
    expect(pick(option, 'series', 2, 'name')).toBe('合計')
    expect(pick(option, 'series', 2, 'type')).toBe('line')
    expect(pick(option, 'series', 2, 'data')).toEqual([1_902.3, 2_010.0])
    expect(pick(option, 'series', 2, 'label', 'show')).toBe(true)
    // 内訳の和（1,732.5）は合計として現れない。
    expect(JSON.stringify(option)).not.toContain('1732.5')
  })

  it('その注記が副題に出る（読んだ人が食い違いに気づける）', () => {
    expect(pick(option, 'title', 'subtext')).toContain('合計は内訳を丸める前の値です')
  })
})

describe('棒グラフ', () => {
  const option = optionOf(panelFixture('barChart'))

  it('並びは**上から**元の順（ECharts の category 軸は下から積むので反転して渡す）', () => {
    expect(pick(option, 'yAxis', 'data')).toEqual(['⚠ 2km', '1km', '500m'])
  })

  it('強調はアクセント色・他は共通の棒色（Web UI と同じ規則）', () => {
    expect(pick(option, 'series', 0, 'data', 1, 'itemStyle', 'color')).toBe(ACCENT_COLOR)
    expect(pick(option, 'series', 0, 'data', 2, 'itemStyle', 'color')).toBe(CHART_BAR_COLOR)
  })

  it('整形済みの文字列がそのままラベルに出る（桁区切り・欠損記号を作り直さない）', () => {
    expect(pick(option, 'series', 0, 'data', 1, 'label', 'formatter')).toBe('34,000')
    expect(pick(option, 'series', 0, 'data', 0, 'value')).toBeNull()
    expect(pick(option, 'series', 0, 'data', 0, 'label', 'formatter')).toBe('—')
  })

  it('信頼性フラグと注記は副題に出る', () => {
    expect(pick(option, 'title', 'subtext')).toContain('⚠ 低分母')
  })

  it('`{}` を含む整形文字列はテンプレートと誤解されないよう既定へ落とす', () => {
    const braced: Panel = {
      type: 'barChart',
      title: 'x',
      unit: null,
      format: null,
      bars: [{ label: 'a', value: 1, formatted: '{value} 台', flagged: false }],
      flags: [],
      note: null,
    }
    expect(pick(optionOf(braced), 'series', 0, 'data', 0, 'label', 'formatter')).toBe('{c}')
  })
})

describe('ランキング', () => {
  const option = optionOf(panelFixture('rankingTable'))

  it('1 位が上に来る（順位つきのラベル）', () => {
    expect(pick(option, 'yAxis', 'data')).toEqual(['1. 武蔵小杉'])
    expect(pick(option, 'series', 0, 'data', 0, 'label', 'formatter')).toBe('+12.3%')
  })

  it('単位は x 軸の名前に出る', () => {
    expect(pick(option, 'xAxis', 'name')).toBe('%')
  })
})

describe('散布', () => {
  const option = optionOf(panelFixture('scatter'))

  it('クラスタごとに系列を分け、色は共有の定数', () => {
    expect(pick(option, 'series', 0, 'itemStyle', 'color')).toBe(clusterColor(0))
    expect(pick(option, 'series', 1, 'itemStyle', 'color')).toBe(clusterColor(2))
  })

  it('凡例は出さない（クラスタ番号に意味は無い）', () => {
    expect(pick(option, 'legend', 'show')).toBe(false)
    expect(pick(option, 'title', 'subtext')).toContain('番号に意味はありません')
  })

  it('軸名に単位が入り、点は駅名つき（どの駅かをツールチップで読める）', () => {
    expect(pick(option, 'xAxis', 'name')).toBe('人口増減率（%）')
    expect(pick(option, 'yAxis', 'name')).toBe('地価増減率（%）')
    expect(pick(option, 'series', 0, 'data', 0, 'name')).toBe('A')
    expect(pick(option, 'series', 0, 'data', 0, 'value')).toEqual([1, 2])
    // ツールチップは**文字列テンプレート**（関数を使わない）。`{b}`＝駅名・`{c}`＝座標。
    expect(pick(option, 'tooltip', 'formatter')).toBe('{b}<br/>{c}')
  })
})

describe('値の丸め（float4 由来の見せかけの桁を消す）', () => {
  /** `10.8` を float4 で往復させると出る実測値。 */
  const NOISY = 10.8000001907349

  it('棒・ランキング・散布・推移のどれでも、読めない桁が図に出ない', () => {
    const bars: Panel = {
      type: 'barChart',
      title: 'x',
      unit: null,
      format: null,
      bars: [{ label: 'a', value: NOISY, formatted: '+10.8%', flagged: false }],
      flags: [],
      note: null,
    }
    const trend: Panel = {
      type: 'trendChart',
      title: 'x',
      unit: null,
      format: null,
      flags: [],
      series: [{ label: 'a', points: [{ x: 2020, y: NOISY }] }],
    }
    for (const [name, panel] of [
      ['barChart', bars],
      ['trendChart', trend],
    ] as const) {
      expect(JSON.stringify(optionOf(panel)), name).not.toContain('10.8000001907349')
      expect(JSON.stringify(optionOf(panel)), name).toContain('10.8')
    }
  })

  it('大きい値・小さい値は変えない（丸めが意味を壊さない）', () => {
    const bars: Panel = {
      type: 'barChart',
      title: 'x',
      unit: null,
      format: null,
      bars: [
        { label: 'big', value: 393_622, formatted: '393,622', flagged: false },
        { label: 'small', value: 0.0012345, formatted: '0.0012', flagged: false },
      ],
      flags: [],
      note: null,
    }
    const option = optionOf(bars)
    // 反転して渡すので small が先。
    expect(pick(option, 'series', 0, 'data', 0, 'value')).toBe(0.0012345)
    expect(pick(option, 'series', 0, 'data', 1, 'value')).toBe(393_622)
  })
})
