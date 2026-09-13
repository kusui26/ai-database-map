/**
 * **パネル（Map Edition）→ ECharts の option**（純関数・JSON だけ）。
 *
 * `docs/260912_gui_chat_protocol.md` §4.3(a)・PR-12。母艦（MulmoTerminal / MulmoClaude）は
 * `presentChart` という**共通の描画語彙**を持っていて、引数は「ECharts の option をそのまま」である。
 * だから当アプリは**チャート・ライブラリを配らず、チャートにできるデータを渡す**——
 * 「a business application does not ship its own chart library; it ships chart-ready data」
 * （GCP の AI_NATIVE_BUSINESS_APP_ARCHITECTURE）。
 *
 * 設計判断：
 * - **option はサーバが組む**。エージェントに組ませると、単位・年次・⚠・欠損の扱いが会話ごとに
 *   揺れる。ここで組めば「意味はサーバ」（CLAUDE.md §2）のまま、転記ミスもゼロになる
 * - **JSON だけ**：`JsonValue` で型づけしてあるので、関数（`formatter` のコールバック等）は
 *   **コンパイルが通らない**。ラベルが要る所は ECharts の**文字列テンプレート**で書く
 * - **数値のパネルだけ**を変換する。`hazardCard`・`evacuationList`・`escapeDirection` は
 *   **チャートにしない**——危険度は順序尺度で、色・記号・免責・時制が落ちると誤読される
 *   （`docs/260824_flood.md` §7.5）。`statTable`・`stationCard`・`markdown` は表と文が正しい形
 * - **色は Web UI・ビューアと同じ規則**（`shared/viewer/charts.ts` の `seriesColor`・
 *   共有定数の `clusterColor`）。同じ数字が経路によって違う色にならないようにする
 */

import { ACCENT_COLOR, clusterColor } from '@/shared/constants'
import {
  type BarChartPanel,
  type Panel,
  type RankingTablePanel,
  type ScatterPanel,
  type TrendChartPanel,
} from '@/shared/protocol'
import { CHART_BAR_COLOR, seriesColor } from '@/shared/viewer/charts'

// --- JSON だけの値（関数を型で禁じる） ----------------------------------

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonObject = { readonly [key: string]: JsonValue }

/** ECharts の option。**関数を含まない**ことを型が保証する。 */
export type EChartsOption = JsonObject

/** 1 枚のチャート（`presentChart` の `document.charts[]` にそのまま入る形）。 */
export type EChartsChart = {
  readonly title: string
  /** 参考の種別タグ（実際の種類は `option.series[].type`）。 */
  readonly type: 'line' | 'bar' | 'scatter'
  readonly option: EChartsOption
}

/** `presentChart` の `document` にそのまま渡せるひとまとまり。 */
export type EChartsDocument = {
  readonly title: string
  readonly charts: readonly EChartsChart[]
}

// --- 共通の部品 ---------------------------------------------------------

/** 図の余白（タイトルと凡例の居場所を空ける）。 */
const GRID: JsonObject = { left: 16, right: 28, top: 72, bottom: 44, containLabel: true }

/** 合計線の色（背景の棒より暗く・スレート 900）。 */
const TOTAL_COLOR = '#0f172a'

/** 見出し（副題は空なら出さない）。 */
function titleOf(text: string, subtext: string): JsonObject {
  return { text, left: 'center', top: 8, ...(subtext === '' ? {} : { subtext }) }
}

/** 副題の組み立て（空の断片は落とす）。 */
const subtextOf = (parts: readonly (string | null | undefined)[]): string =>
  parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ／ ')

/** 信頼性フラグの断片（⚠ は「黙って使わない」印）。 */
const flagParts = (flags: readonly { readonly label: string }[]): readonly string[] =>
  flags.map((flag) => `⚠ ${flag.label}`)

/** 軸の名前（単位があれば括弧で添える）。 */
const axisName = (label: string, unit: string | null): string =>
  unit === null ? label : `${label}（${unit}）`

/**
 * 図に置く値。**データが実際に持っている精度**（`float4`＝有効数字およそ 7 桁）へ丸める。
 *
 * ツールチップと軸ラベルは ECharts が生の値を出す（整形は関数でしかできず、option には
 * 関数を入れられない）。丸めないと `10.8` が **`10.8000001907349`** と表示される——
 * 実測で出た値で、保存形式に由来する見せかけの桁であって、データの精度ではない
 * （`docs/260816_supabase_restart.md`：容量対策で `station_values.value` を float8 → float4）。
 * 棒の長さ・点の位置は変わらず、読めない桁だけが消える。
 */
const plotValue = (value: number | null): number | null =>
  value === null || !Number.isFinite(value) ? value : Number(value.toPrecision(7))

/**
 * データ項目に固定のラベル文字列を置く。
 *
 * ECharts の `formatter` は**文字列テンプレート**でもよく、`{}` を含まない文字列はそのまま出る。
 * ドメインが作った整形済み文字列（`formatted`）を**そのまま**見せられるので、桁区切り・符号・
 * 単位の扱いが Web UI と一致する。`{}` を含む値だけはテンプレートと解釈されるため、
 * 既定（`{c}`＝生の値）へ落とす。
 */
const literalLabel = (formatted: string): string => (/[{}]/.test(formatted) ? '{c}' : formatted)

// --- 推移（折れ線／積み上げ縦棒） ---------------------------------------

/** x の目盛（全系列の和集合・昇順）。 */
const trendCategories = (panel: TrendChartPanel): readonly number[] =>
  [...new Set(panel.series.flatMap((series) => series.points.map((point) => point.x)))].sort(
    (a, b) => a - b,
  )

/** 目盛に合わせた値の列（無い年は null＝線が途切れる／棒が立たない）。 */
function alignedValues(
  points: readonly { readonly x: number; readonly y: number | null }[],
  categories: readonly number[],
): readonly JsonValue[] {
  const byX = new Map(points.map((point) => [point.x, plotValue(point.y)]))
  return categories.map((x) => byX.get(x) ?? null)
}

/** 合計の線（積み上げのとき・**内訳の丸め和ではなく宣言された合計**を出す）。 */
function totalsSeries(panel: TrendChartPanel, categories: readonly number[]): readonly JsonValue[] {
  if (panel.totals === undefined || panel.totals.length === 0) return []
  return [
    {
      name: '合計',
      type: 'line',
      data: alignedValues(panel.totals, categories),
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { width: 1, type: 'dotted' },
      itemStyle: { color: TOTAL_COLOR },
      label: { show: true, position: 'top', fontSize: 10 },
      z: 5,
    },
  ]
}

/** 推移チャートの option。 */
function trendOption(panel: TrendChartPanel): EChartsOption {
  const categories = trendCategories(panel)
  const stacked = panel.stacked === true
  const series: readonly JsonValue[] = [
    ...panel.series.map((each, index) => ({
      name: each.label,
      type: stacked ? 'bar' : 'line',
      data: alignedValues(each.points, categories),
      itemStyle: { color: seriesColor(each, index, panel.category) },
      ...(stacked
        ? { stack: 'total', barMaxWidth: 48 }
        : {
            connectNulls: false,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: {
              width: 2,
              ...(each.dashed === true ? { type: 'dashed' } : {}),
            },
          }),
    })),
    ...totalsSeries(panel, categories),
  ]
  return {
    title: titleOf(
      panel.title,
      subtextOf([
        ...flagParts(panel.flags),
        stacked && panel.totals !== undefined ? '合計は内訳を丸める前の値です' : null,
      ]),
    ),
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', bottom: 0 },
    grid: GRID,
    xAxis: { type: 'category', data: categories.map(String), boundaryGap: stacked },
    yAxis: {
      type: 'value',
      ...(panel.unit === null ? {} : { name: panel.unit }),
      nameTextStyle: { align: 'left' },
    },
    series,
  }
}

// --- 横棒（半径別・内訳・ランキング） -----------------------------------

/** 横棒の共通形（`categories` は**下から上**に並ぶので、呼び出し側で反転済みを渡す）。 */
function barOptionOf(args: {
  readonly title: JsonObject
  readonly unit: string | null
  readonly categories: readonly string[]
  readonly items: readonly JsonValue[]
}): EChartsOption {
  return {
    title: args.title,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: GRID,
    xAxis: { type: 'value', ...(args.unit === null ? {} : { name: args.unit }) },
    yAxis: { type: 'category', data: args.categories },
    series: [
      {
        type: 'bar',
        data: args.items,
        label: { show: true, position: 'right', fontSize: 10 },
      },
    ],
  }
}

/** 棒グラフの option（強調＝アクセント色・⚠ はラベルの頭に付ける）。 */
function barChartOption(panel: BarChartPanel): EChartsOption {
  const bars = [...panel.bars].reverse()
  return barOptionOf({
    title: titleOf(panel.title, subtextOf([...flagParts(panel.flags), panel.note])),
    unit: panel.unit,
    categories: bars.map((bar) => (bar.flagged ? `⚠ ${bar.label}` : bar.label)),
    items: bars.map((bar) => ({
      value: plotValue(bar.value),
      itemStyle: { color: bar.emphasis === true ? ACCENT_COLOR : CHART_BAR_COLOR },
      label: { formatter: literalLabel(bar.formatted) },
    })),
  })
}

/** ランキングの option（1 位が上・⚠ の件数を副題に出す）。 */
function rankingOption(panel: RankingTablePanel): EChartsOption {
  const rows = [...panel.rows].reverse()
  const flagged = panel.rows.filter((row) => row.flagged).length
  return barOptionOf({
    title: titleOf(
      panel.title,
      subtextOf([flagged === 0 ? null : `⚠ ${flagged} 件は信頼性フラグつき`]),
    ),
    unit: panel.unit,
    categories: rows.map((row) => `${row.rank}. ${row.flagged ? '⚠ ' : ''}${row.name}`),
    items: rows.map((row) => ({
      value: plotValue(row.value),
      itemStyle: { color: CHART_BAR_COLOR },
      label: { formatter: literalLabel(row.formatted) },
    })),
  })
}

// --- 散布 ---------------------------------------------------------------

/** 散布の option（色＝クラスタ。番号に意味は無いので**凡例を出さない**）。 */
function scatterOption(panel: ScatterPanel): EChartsOption {
  const clusters = [...new Set(panel.points.map((point) => point.cluster))].sort((a, b) => a - b)
  return {
    title: titleOf(panel.title, `色＝クラスタ（${panel.clusterCount}）。番号に意味はありません`),
    // ツールチップは**文字列テンプレート**（関数は option に入れられない）。`{b}`＝駅名・
    // `{c}`＝値。次元を指す記法（`{@[0]}` / `{c0}`）は `series.data` でも `dataset` でも
    // 解決しないことを実機で確かめたので、値は `value` に**座標だけ**を入れる。
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c}' },
    legend: { show: false },
    // 回した y 軸名の居場所を左に確保する（既定の余白だと画面の外に出る・実測）。
    grid: { ...GRID, left: 64, bottom: 56 },
    xAxis: {
      type: 'value',
      name: axisName(panel.xLabel, panel.xUnit),
      nameLocation: 'middle',
      nameGap: 28,
      scale: true,
    },
    yAxis: {
      type: 'value',
      name: axisName(panel.yLabel, panel.yUnit),
      // 指標名は長い（「地価増減率（2021→2026年・1km圏）（%）」）。軸の端に置くと副題に
      // 重なるので**回して真ん中**に置く（実機で確認）。
      nameLocation: 'middle',
      nameRotate: 90,
      nameGap: 52,
      scale: true,
    },
    series: clusters.map((cluster) => ({
      name: `クラスタ ${cluster + 1}`,
      type: 'scatter',
      symbolSize: 7,
      itemStyle: { color: clusterColor(cluster), opacity: 0.75 },
      // 駅名は `name`、座標は `value`。配列 1 本（`[x, y, 駅名]`）にすると option は約半分に
      // なるが、ツールチップが「2.4,70.5,ゆめが丘」と駅名を重ねて出す（実機で確認）。
      // 点が何駅なのかを読めることを優先する（Web UI の散布と同じ見せ方）。
      data: panel.points
        .filter((point) => point.cluster === cluster)
        .map((point) => ({ name: point.name, value: [plotValue(point.x), plotValue(point.y)] })),
    })),
  }
}

// --- 入口 ---------------------------------------------------------------

/**
 * パネル 1 枚 → チャート（**チャートにしない型は空**）。
 * 判別ユニオンを網羅する——protocol にパネル型を足すと、ここが型エラーになる。
 */
function chartsOf(panel: Panel): readonly EChartsChart[] {
  switch (panel.type) {
    case 'trendChart':
      return [
        {
          title: panel.title,
          type: panel.stacked === true ? 'bar' : 'line',
          option: trendOption(panel),
        },
      ]
    case 'barChart':
      return [{ title: panel.title, type: 'bar', option: barChartOption(panel) }]
    case 'rankingTable':
      return [{ title: panel.title, type: 'bar', option: rankingOption(panel) }]
    case 'scatter':
      return [{ title: panel.title, type: 'scatter', option: scatterOption(panel) }]
    // 以下はチャートにしない。危険度は順序尺度で、色・記号・免責・時制が落ちると誤読される
    // （`docs/260824_flood.md` §7.5）。表と文のままの方が正しく読める。
    case 'stationCard':
    case 'statTable':
    case 'hazardCard':
    case 'evacuationList':
    case 'escapeDirection':
    case 'markdown':
      return []
  }
}

/** ひとまとまりの題（駅が分かるなら頭に付ける＝ホスト側の一覧で見分けがつく）。 */
function documentTitle(panels: readonly Panel[], firstChartTitle: string): string {
  const station = panels.find((panel) => panel.type === 'stationCard')
  return station === undefined || station.type !== 'stationCard'
    ? firstChartTitle
    : `${station.label}・${firstChartTitle}`
}

/**
 * パネル列 → `presentChart` に渡せる document（**チャートが 1 枚も無ければ null**）。
 * null のときは何も足さない——空の器を返してホストに空の図を開かせない。
 */
export function toEChartsDocument(panels: readonly Panel[]): EChartsDocument | null {
  const charts = panels.flatMap(chartsOf)
  const first = charts[0]
  if (first === undefined) return null
  return { title: documentTitle(panels, first.title), charts }
}
