/**
 * ドメイン：**駅を指標の値で色分けする**（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * | 指標 | 分け方 |
 * |---|---|
 * | 水準（人口・従業者・地価・乗降…） | エリアの駅を 5 等分（分位）。境目は有効 2 桁に丸め、丸めた境目で分ける。空の段は作らない |
 * | 増減・誤差（%） | **0 を中心**に 5 段。境目 a は値の絶対値の 8 割点に近い 1・2・5 の数、横ばいの幅 b は a/4 以下の 1・2・5 の数 |
 * | ⚠ の値 | 分け方に入れない（参考値の色で出す） |
 * | 値のある駅が 5 未満・値が 1 種類・段に分けられない | 色分けしない（理由を返し、駅は強調で出す） |
 *
 * 段の範囲は**下限を含み上限を含まない**（端の段は片側が開いている）。同じ規則で凡例の言葉を作る——画面・地図レポート・AI が
 * 同じ凡例を出すため、色と言葉はここで決める（`palette.ts`）。
 */

import { type CatalogEntry } from '@/shared/catalog'
import { type ClassScheme, type StationClass, type StationLegend } from '@/shared/area-summary'
import { largestNiceAtMost, nearestNice, roundSignificant } from './nice'
import { DIVERGING_COLORS, FLAGGED_COLOR, sequentialColors } from './palette'

/** 色分けに使う駅の値（⚠ は分け方に入れない）。 */
export type StyleInput = {
  readonly grp: string
  readonly value: number
  readonly flagged: boolean
}

/** 水準の段の数。 */
export const LEVEL_CLASS_COUNT = 5
/** 境目を丸める有効桁。 */
export const BREAK_DIGITS = 2
/** 色分けする最少の駅の数（これ未満は理由を返して色分けしない）。 */
export const MIN_STYLED_STATIONS = 5
/** 増減の境目 a を決める分位（値の絶対値の 8 割点）。 */
export const DIVERGING_EDGE_QUANTILE = 0.8
/** 横ばいの幅 b は a のこの割合以下（a/4）。 */
export const FLAT_BAND_RATIO = 0.25

export const FLAGGED_LABEL_JA = '参考値（⚠）'
const FLAT_LABEL_JA = 'ほぼ横ばい'

/** 分けた結果（凡例と、駅ごとの段）。 */
export type Classification = {
  readonly legend: StationLegend
  /** 値のある駅 grp → 段（null＝⚠ の参考値。色分けしないときはすべて null＝強調で出す）。 */
  readonly assignments: ReadonlyMap<string, number | null>
}

/** 0〜1 の分位（線形補間・SQL の percentile_cont と同じ）。`sorted` は昇順。 */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const lowerValue = sorted[lower] ?? Number.NaN
  const upperValue = sorted[Math.min(lower + 1, sorted.length - 1)] ?? lowerValue
  return lowerValue + (position - lower) * (upperValue - lowerValue)
}

/** 増減・誤差は 0 を中心に分ける。 */
export function schemeOf(entry: CatalogEntry): ClassScheme {
  return entry.kind === 'growth' || entry.kind === 'error' ? 'diverging' : 'sequential'
}

/** 値 → 段（境目は昇順・下限を含む）。 */
export function classIndexOf(value: number, breaks: readonly number[]): number {
  return breaks.filter((edge) => value >= edge).length
}

/**
 * 空の段を作らない：空の段の下の境目を外す（上の段と合わさる・先頭の段なら最初の境目を外す）を、空の段が無くなるまで。
 * 1 回で境目が 1 つ減り、境目が無くなれば止まる（境目は多くて 4 つなので、繰り返しは 4 回まで）。
 */
function pruneEmpty(breaks: readonly number[], sorted: readonly number[]): number[] {
  const empty = countsOf(sorted, breaks).findIndex((count) => count === 0)
  if (empty < 0 || breaks.length === 0) return [...breaks]
  const removed = Math.max(empty - 1, 0)
  return pruneEmpty(
    breaks.filter((_, index) => index !== removed),
    sorted,
  )
}

function countsOf(values: readonly number[], breaks: readonly number[]): number[] {
  const counts = Array.from({ length: breaks.length + 1 }, () => 0)
  for (const value of values) {
    const index = classIndexOf(value, breaks)
    counts[index] = (counts[index] ?? 0) + 1
  }
  return counts
}

/**
 * 値がすべて整数（バス停の数・乗降客数）なら、境目を整数に切り上げる。整数の値には同じ分け方
 * （v ≥ 1.8 と v ≥ 2 は同じ駅）で、凡例に「1.8 箇所未満」と書かずに済む。
 */
function integerBreaks(breaks: readonly number[], sorted: readonly number[]): number[] {
  return sorted.every((value) => Number.isInteger(value))
    ? breaks.map((edge) => Math.ceil(edge))
    : [...breaks]
}

/** 水準の境目：分位を有効 2 桁に丸め（整数の値なら整数に切り上げ）、重ならず、空の段が無いもの。 */
export function levelBreaks(sorted: readonly number[]): number[] {
  const raw = Array.from({ length: LEVEL_CLASS_COUNT - 1 }, (_, index) =>
    roundSignificant(quantile(sorted, (index + 1) / LEVEL_CLASS_COUNT), BREAK_DIGITS),
  )
  const unique = [...new Set(integerBreaks(raw, sorted))].sort((a, b) => a - b)
  return pruneEmpty(unique, sorted)
}

/** 増減の境目 [−a, −b, b, a]（a・b は 1・2・5 の数）。値がすべて 0 なら空。 */
export function divergingBreaks(sorted: readonly number[]): number[] {
  const magnitudes = sorted.map((value) => Math.abs(value)).sort((a, b) => a - b)
  const edge = nearestNice(quantile(magnitudes, DIVERGING_EDGE_QUANTILE))
  if (edge === 0) return []
  const flat = largestNiceAtMost(edge * FLAT_BAND_RATIO)
  return [-edge, -flat, flat, edge]
}

// --- 凡例の言葉 -------------------------------------------------------------------------

/** 境目を書く有効桁（境目は有効 2 桁・1・2・5 の数なので、6 桁あれば端数を落とさない）。 */
const BREAK_TEXT_DIGITS = 6

/**
 * 境目の数（単位なし）。**境目そのものを書く**——指標の書式（整数・小数 1 桁）で丸めると、1.5 で分けたのに「2 箇所未満」、
 * 0.45 で分けたのに「0.5 億円未満」と書いてしまう。端数のゼロは書かない（「+5」「120 億円」）。3 桁ごとに区切り、増減は符号を付ける。
 */
function numberText(value: number, signed: boolean): string {
  const [whole = '0', fraction] = String(
    Number(Math.abs(value).toPrecision(BREAK_TEXT_DIGITS)),
  ).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = value > 0 && signed ? '+' : value < 0 ? '-' : ''
  return `${sign}${fraction === undefined ? grouped : `${grouped}.${fraction}`}`
}

/** 単位の付け方（% は数に続けて、ほかは空白を入れる・`formatWithUnit` と同じ）。 */
function unitText(entry: CatalogEntry): string {
  if (entry.format === 'percent1' || entry.unit === '%') return '%'
  return entry.unit === null ? '' : ` ${entry.unit}`
}

function classLabels(
  breaks: readonly number[],
  entry: CatalogEntry,
  scheme: ClassScheme,
): string[] {
  const signed = scheme === 'diverging'
  const unit = unitText(entry)
  const text = (value: number): string => numberText(value, signed)
  const first = breaks[0]
  const last = breaks[breaks.length - 1]
  if (first === undefined || last === undefined) return ['すべての駅']
  const middle = breaks.slice(0, -1).map((edge, index) => {
    const upper = breaks[index + 1] ?? edge
    const flat = scheme === 'diverging' && edge < 0 && upper > 0 ? `（${FLAT_LABEL_JA}）` : ''
    return `${text(edge)}〜${text(upper)}${unit}${flat}`
  })
  return [`${text(first)}${unit}未満`, ...middle, `${text(last)}${unit}以上`]
}

/** 色の意味（AI はこの文で説明する）。増減は真ん中の段の範囲を「ほぼ横ばい」として書く。 */
function meaningOf(scheme: ClassScheme, classes: readonly StationClass[]): string {
  if (scheme === 'sequential') {
    return `色が濃いほど値が大きい（エリアの駅を ${classes.length} つに分け、境目は有効 2 桁に丸めた）。`
  }
  const flat = classes[Math.floor(classes.length / 2)]?.labelJa ?? ''
  return `赤は増加、青は減少、灰色はほぼ横ばい（${flat.replace(`（${FLAT_LABEL_JA}）`, '')}）。0 が真ん中。`
}

function classesOf(
  breaks: readonly number[],
  sorted: readonly number[],
  entry: CatalogEntry,
  scheme: ClassScheme,
): StationClass[] {
  const labels = classLabels(breaks, entry, scheme)
  const counts = countsOf(sorted, breaks)
  const colors = scheme === 'diverging' ? DIVERGING_COLORS : sequentialColors(counts.length)
  return counts.map((count, index) => ({
    index,
    color: colors[index] ?? colors[colors.length - 1] ?? FLAGGED_COLOR,
    lower: index === 0 ? null : (breaks[index - 1] ?? null),
    upper: index === breaks.length ? null : (breaks[index] ?? null),
    labelJa: labels[index] ?? '',
    count,
  }))
}

/** 境目と、色分けしない理由（分けられるなら null）。 */
type Styling = { readonly breaks: readonly number[]; readonly reasonJa: string | null }

/**
 * 境目を決める。**境目を作る前に**駅の数と値の種類を見る（値が無いと分位が作れない）。
 * 分位がそろって境目が残らない（同じ値の駅がほとんど）ときも色分けしない。
 */
function stylingOf(scheme: ClassScheme, sorted: readonly number[]): Styling {
  if (sorted.length < MIN_STYLED_STATIONS) {
    return {
      breaks: [],
      reasonJa: `値のある駅が ${sorted.length} しかないので色分けしない（${MIN_STYLED_STATIONS} 駅から）。`,
    }
  }
  if (sorted[0] === sorted[sorted.length - 1]) {
    return { breaks: [], reasonJa: '値が 1 種類しかないので色分けしない。' }
  }
  const breaks = scheme === 'diverging' ? divergingBreaks(sorted) : levelBreaks(sorted)
  if (breaks.length === 0) {
    return { breaks, reasonJa: 'ほとんどの駅が同じ値で、段に分けられないので色分けしない。' }
  }
  return { breaks, reasonJa: null }
}

/** 凡例（色分けしなければ段は空・色の意味は null・理由つき）。 */
function legendOf(
  entry: CatalogEntry,
  scheme: ClassScheme,
  classes: readonly StationClass[],
  reasonJa: string | null,
  counts: { readonly flagged: number; readonly missing: number },
): StationLegend {
  return {
    metricKey: entry.key,
    titleJa: entry.labelJa,
    unit: entry.unit,
    scheme,
    classes: [...classes],
    flagged: { color: FLAGGED_COLOR, labelJa: FLAGGED_LABEL_JA, count: counts.flagged },
    missingCount: counts.missing,
    meaningJa: reasonJa === null ? meaningOf(scheme, classes) : null,
    sourceJa: entry.source,
    reasonJa,
  }
}

/**
 * 駅の値 → 凡例と駅ごとの段。`stationCount` はエリアの駅の数（値の無い駅を数えるため）。
 * 指標がフラグ（0/1）のものは呼ばない（呼び出し側が 400 にする）。
 */
export function classifyStations(
  inputs: readonly StyleInput[],
  entry: CatalogEntry,
  stationCount: number,
): Classification {
  const scheme = schemeOf(entry)
  const sorted = inputs
    .filter((input) => !input.flagged)
    .map((input) => input.value)
    .sort((a, b) => a - b)
  const { breaks, reasonJa } = stylingOf(scheme, sorted)
  const classes = reasonJa === null ? classesOf(breaks, sorted, entry, scheme) : []
  const legend = legendOf(entry, scheme, classes, reasonJa, {
    flagged: inputs.length - sorted.length,
    missing: Math.max(stationCount - inputs.length, 0),
  })
  const classOf = (input: StyleInput): number | null =>
    reasonJa !== null || input.flagged ? null : classIndexOf(input.value, breaks)
  return { legend, assignments: new Map(inputs.map((input) => [input.grp, classOf(input)])) }
}
