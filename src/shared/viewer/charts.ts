/**
 * ビューアのチャート（SVG）——**依存ゼロ・DOM 非依存**の描画（`vnode.ts` の木を返す）。
 *
 * `docs/260912_gui_chat_protocol.md` 決定 11 の「残す部品」。旧 MCP Apps ビューアが
 * 文字列 JS で持っていた手書き SVG を、型のついた純関数に移した。ライブラリを積まないのは、
 * T1（サーバで組む地図レポート HTML）と T2（母艦のビューア・プラグイン）の**どちらでも
 * そのまま使える**ようにするため——チャート・ライブラリの選択は消費側に残す。
 *
 * 単位・年次・⚠ の意味づけは **パネル（protocol）が持っている**ので、ここは座標と色だけを扱う。
 * 軸ラベルの整形は Web UI と同じ `formatCompact`（万・億で桁を抑える）を使う。
 */

import { CATEGORY_COLORS, clusterColor } from '@/shared/constants'
import { formatCompact } from '@/shared/format'
import { type ScatterPanel, type TrendChartPanel, type TrendSeries } from '@/shared/protocol'
import { el, type VNode } from './vnode'

/** 図の寸法（px・viewBox 座標）。幅はパネル幅に対して等倍で伸縮する。 */
const WIDTH = 560
const TREND_HEIGHT = 220
const SCATTER_HEIGHT = 260
/** 左と下の余白（軸ラベルの居場所）。 */
const PAD = 44
/** 右と上の余白（線が枠に触れないように）。 */
const MARGIN = 16

/**
 * 系列色の予備。**通常は domain が `series.color` を入れる**（カテゴリ配色が単一の真実）ので、
 * ここが効くのは色を持たない系列だけ。カテゴリが分かるときは先頭系列にその色を使う。
 */
const SERIES_FALLBACK_COLORS: readonly [string, ...string[]] = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
]

/**
 * **色として受け入れる形**（`#rgb` / `#rrggbb` / `#rrggbbaa`）。
 *
 * 系列色はパネル（＝サーバの応答）から来る値で、そのまま `style` や属性へ書くと
 * CSS 注入の口になる。この部品は**別のサーバの応答も描きうる**（T2 のビューア・プラグイン）ので、
 * 形の合わない色は黙って予備の色に落とす——描けない色より、読める図を優先する。
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** 色として安全なら採用し、そうでなければ予備を返す。 */
const safeColor = (value: string | undefined, fallback: string): string =>
  value !== undefined && HEX_COLOR.test(value) ? value : fallback

/** 棒の色（ビューアの CSS `.bar-fill` と ECharts のプレゼンタで共有する）。 */
export const CHART_BAR_COLOR = '#6366f1'

/** 軸線の色（本文の罫線と揃える）。 */
const AXIS_COLOR = '#cbd5e1'
/** 軸ラベルの色。 */
const TICK_COLOR = '#64748b'

/** 系列の色（`series.color` ＞ カテゴリ色 ＞ 予備パレット）。 */
export function seriesColor(
  series: TrendSeries,
  index: number,
  category: TrendChartPanel['category'],
): string {
  const size = SERIES_FALLBACK_COLORS.length
  const fallback =
    index === 0 && category !== undefined
      ? CATEGORY_COLORS[category]
      : (SERIES_FALLBACK_COLORS[index % size] ?? SERIES_FALLBACK_COLORS[0])
  return safeColor(series.color, fallback)
}

/** 値域（min, max）。空・同値は描けないので幅を持たせる（旧ビューアと同じ規則）。 */
type Extent = readonly [number, number]

function extentOf(values: readonly number[]): Extent {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  return min === max ? [min - 1, max + 1] : [min, max]
}

/** 座標は小数 2 桁で丸める（属性を短く・出力を決定的に）。 */
const round = (value: number): number => Math.round(value * 100) / 100

/** 値 → x 座標。 */
const xScaleOf =
  ([lo, hi]: Extent) =>
  (value: number): number =>
    round(PAD + ((value - lo) / (hi - lo)) * (WIDTH - PAD - MARGIN))

/** 値 → y 座標（上下反転）。 */
const yScaleOf =
  ([lo, hi]: Extent, height: number) =>
  (value: number): number =>
    round(height - PAD - ((value - lo) / (hi - lo)) * (height - PAD - MARGIN))

/** 軸の 2 本線。 */
function axisLines(height: number): readonly VNode[] {
  return [
    el('line', {
      attrs: {
        x1: PAD,
        y1: height - PAD,
        x2: WIDTH - MARGIN / 2,
        y2: height - PAD,
        stroke: AXIS_COLOR,
      },
    }),
    el('line', {
      attrs: { x1: PAD, y1: MARGIN / 2, x2: PAD, y2: height - PAD, stroke: AXIS_COLOR },
    }),
  ]
}

/** 軸ラベル 1 つ。 */
function tick(x: number, y: number, label: string, anchor: 'middle' | 'end'): VNode {
  return el('text', {
    text: label,
    attrs: { x: round(x), y: round(y), 'font-size': 10, fill: TICK_COLOR, 'text-anchor': anchor },
  })
}

/** SVG のがわ（`role="img"` と説明をつけて読み上げにも意味が残るように）。 */
function svgRoot(height: number, labelJa: string, children: readonly VNode[]): VNode {
  return el('svg', {
    attrs: { viewBox: `0 0 ${WIDTH} ${height}`, role: 'img', 'aria-label': labelJa },
    children,
  })
}

/** 積み上げの合計（x ごと）。`totals` が無いときの上書き表示に使う。 */
function stackTotals(panel: TrendChartPanel): ReadonlyMap<number, number> {
  return panel.series.reduce<Map<number, number>>((totals, series) => {
    series.points.forEach((point) => {
      if (point.y === null) return
      totals.set(point.x, (totals.get(point.x) ?? 0) + point.y)
    })
    return totals
  }, new Map())
}

/** 欠損（null）で切れた連続区間に分ける。 */
function runsOf(series: TrendSeries): readonly (readonly { x: number; y: number }[])[] {
  return series.points
    .reduce<{ x: number; y: number }[][]>(
      (runs, point) => {
        if (point.y === null) return [...runs, []]
        const last = runs[runs.length - 1] ?? []
        return [...runs.slice(0, -1), [...last, { x: point.x, y: point.y }]]
      },
      [[]],
    )
    .filter((run) => run.length > 0)
}

/** 折れ線（1 点だけの区間は点で描く＝線にならない値を消さない）。 */
function lineNodes(
  series: TrendSeries,
  color: string,
  x: (value: number) => number,
  y: (value: number) => number,
): readonly VNode[] {
  return runsOf(series).map((run) => {
    const first = run[0]
    if (run.length === 1 && first !== undefined) {
      return el('circle', { attrs: { cx: x(first.x), cy: y(first.y), r: 2.5, fill: color } })
    }
    return el('polyline', {
      attrs: {
        points: run.map((point) => `${x(point.x)},${y(point.y)}`).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': 2,
        ...(series.dashed === true ? { 'stroke-dasharray': '5 4' } : {}),
      },
    })
  })
}

/** 積み上げ縦棒（合計の数値は棒の上に置く）。 */
function stackedNodes(
  panel: TrendChartPanel,
  xs: readonly number[],
  x: (value: number) => number,
  y: (value: number) => number,
): readonly VNode[] {
  const width = Math.max(6, Math.min(28, 300 / Math.max(1, xs.length)))
  return xs.flatMap((at) => {
    const bars = panel.series.reduce<{ base: number; nodes: VNode[] }>(
      (acc, series, index) => {
        const point = series.points.find((each) => each.x === at && each.y !== null)
        if (point === undefined || point.y === null) return acc
        const top = acc.base + point.y
        return {
          base: top,
          nodes: [
            ...acc.nodes,
            el('rect', {
              attrs: {
                x: round(x(at) - width / 2),
                y: y(top),
                width: round(width),
                height: round(Math.max(0, y(acc.base) - y(top))),
                fill: seriesColor(series, index, panel.category),
              },
            }),
          ],
        }
      },
      { base: 0, nodes: [] },
    )
    // 合計は**丸める前から作った正しい値**（protocol の `totals`）を優先する。
    const declared = panel.totals?.find((total) => total.x === at)?.y
    const total = declared === undefined || declared === null ? bars.base : declared
    return [...bars.nodes, tick(x(at), y(bars.base) - 4, formatCompact(total), 'middle')]
  })
}

/** 推移チャート（折れ線／積み上げ縦棒）。 */
export function trendChartSvg(panel: TrendChartPanel): VNode {
  const xs = panel.series.flatMap((series) => series.points.map((point) => point.x))
  const ys = panel.series.flatMap((series) =>
    series.points.flatMap((point) => (point.y === null ? [] : [point.y])),
  )
  const stacked = panel.stacked === true
  const xExtent = extentOf(xs)
  const yExtent = extentOf([...ys, ...(stacked ? [...stackTotals(panel).values()] : []), 0])
  const x = xScaleOf(xExtent)
  const y = yScaleOf(yExtent, TREND_HEIGHT)
  const uniqueXs = [...new Set(xs)].sort((a, b) => a - b)
  const step = Math.max(1, Math.ceil(uniqueXs.length / 8))
  return svgRoot(TREND_HEIGHT, panel.title, [
    ...axisLines(TREND_HEIGHT),
    ...[yExtent[0], (yExtent[0] + yExtent[1]) / 2, yExtent[1]].map((value) =>
      tick(PAD - 6, y(value) + 3, formatCompact(value), 'end'),
    ),
    ...uniqueXs.flatMap((value, index) =>
      index % step === 0 ? [tick(x(value), TREND_HEIGHT - PAD + 14, String(value), 'middle')] : [],
    ),
    ...(stacked
      ? stackedNodes(panel, uniqueXs, x, y)
      : panel.series.flatMap((series, index) =>
          lineNodes(series, seriesColor(series, index, panel.category), x, y),
        )),
  ])
}

/** 散布図（色＝クラスタ。番号自体に意味はないので凡例は出さない）。 */
export function scatterSvg(panel: ScatterPanel): VNode {
  const xExtent = extentOf(panel.points.map((point) => point.x))
  const yExtent = extentOf(panel.points.map((point) => point.y))
  const x = xScaleOf(xExtent)
  const y = yScaleOf(yExtent, SCATTER_HEIGHT)
  return svgRoot(SCATTER_HEIGHT, `${panel.xLabel} × ${panel.yLabel}`, [
    ...axisLines(SCATTER_HEIGHT),
    ...xExtent.map((value) =>
      tick(x(value), SCATTER_HEIGHT - PAD + 14, formatCompact(value), 'middle'),
    ),
    ...yExtent.map((value) => tick(PAD - 6, y(value) + 3, formatCompact(value), 'end')),
    ...panel.points.map((point) =>
      el('circle', {
        attrs: {
          cx: x(point.x),
          cy: y(point.y),
          r: 3,
          fill: clusterColor(point.cluster),
          'fill-opacity': 0.75,
        },
        // ホバーで駅名が読める（`<title>` は SVG の標準のツールチップ）。
        children: [
          el('title', {
            text: `${point.name}（${formatCompact(point.x)}, ${formatCompact(point.y)}）`,
          }),
        ],
      }),
    ),
  ])
}
