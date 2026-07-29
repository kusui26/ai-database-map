/**
 * メトリクス・カタログのダイジェスト（Step2・純関数）。
 *
 * 自己記述カタログ（単一の真実）を、LLM が「どの指標が使えるか／正確なキーは何か」を
 * 把握できるコンパクトな要約に射影する。system-prompt.ts と getMetricsCatalog ツールが共有し、
 * 指標追加が UI/AI に同時反映される（.claude/CLAUDE.md §2「API こそがプロダクト」）。
 */

import { type CatalogEntry, rankableForCategory } from '@/shared/catalog'
import { CATEGORIES, CATEGORY_LABELS_JA, type Category } from '@/shared/constants'
import { baseMetricLabel } from '@/domain/metrics'
import { defaultKeyForBaseMetric } from './metric-resolver'

/**
 * 指標ファミリの詳細（**変種を全列挙しない**）。
 *
 * 以前は 1 ファミリで最大 114 変種・7〜15KB を返しており、ツールループの各ステップで
 * その全文が入力に積み上がっていた（docs/260728_chat_scatter_plot_timeout_mitigation.md §2.5）。
 * キーの確定は metric-resolver がサーバ側で行うため、LLM には
 * 「どの半径・どの年が使えるか」と「既定キー」だけを渡せば足りる。
 */
export type BaseMetricDetail = {
  readonly baseMetric: string
  readonly labelJa: string
  readonly variantCount: number
  /** 対応する集約半径（m・昇順）。空＝半径に依存しない指標。 */
  readonly radii: readonly number[]
  /** 対象年（増減率は `2015→2020` 形式）。 */
  readonly years: readonly string[]
  /** 将来推計の推計時点（2024=R6 / 2018=H30）。無い指標では省略。 */
  readonly vintages?: readonly number[]
  /** 既定で選ばれるキー（rank/compare に metric として渡せる）。 */
  readonly defaultKey: string | null
  readonly unit: string | null
  /** 指標の指定方法（LLM への案内）。 */
  readonly usage: string
}

/** baseMetric（指標ファミリ）の要約。 */
export type BaseMetricDigest = {
  readonly baseMetric: string
  readonly labelJa: string
  readonly exampleKey: string
  readonly radii: readonly number[]
}

/** カテゴリの要約（rankable な baseMetric の一覧）。 */
export type CategoryDigest = {
  readonly category: Category
  readonly labelJa: string
  readonly baseMetrics: readonly BaseMetricDigest[]
}

/** カテゴリ内の rankable を baseMetric ごとに畳む（登場順を保持）。 */
function groupByBaseMetric(entries: readonly CatalogEntry[]): Map<string, CatalogEntry[]> {
  const groups = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.baseMetric) ?? []
    list.push(entry)
    groups.set(entry.baseMetric, list)
  }
  return groups
}

/** 昇順・重複排除の半径一覧（null は除外）。 */
function radiiOf(entries: readonly CatalogEntry[]): number[] {
  const set = new Set<number>()
  for (const entry of entries) {
    if (entry.radiusM !== null) set.add(entry.radiusM)
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * カテゴリ 1 件の baseMetric ダイジェスト。
 * 例キーは **metric-resolver が既定で選ぶキー**にそろえる（プロンプトの例と実際の解決を一致させる）。
 */
function baseMetricsFor(category: Category): BaseMetricDigest[] {
  const groups = groupByBaseMetric(rankableForCategory(category))
  return [...groups.entries()].flatMap(([baseMetric, entries]) => {
    const example = entries[0]
    if (example === undefined) return []
    return [
      {
        baseMetric,
        labelJa: baseMetricLabel(baseMetric),
        exampleKey: defaultKeyForBaseMetric(baseMetric) ?? example.key,
        radii: radiiOf(entries),
      },
    ]
  })
}

/** 全カテゴリのダイジェスト（rankable な指標のみ）。 */
export function categoryDigests(): CategoryDigest[] {
  return CATEGORIES.map((category) => ({
    category,
    labelJa: CATEGORY_LABELS_JA[category],
    baseMetrics: baseMetricsFor(category),
  }))
}

/** ファミリに属する rankable エントリ。 */
function entriesForBaseMetric(baseMetric: string): readonly CatalogEntry[] {
  return CATEGORIES.flatMap((category) =>
    rankableForCategory(category).filter((entry) => entry.baseMetric === baseMetric),
  )
}

/** 年（増減率は年ペア）の一覧。 */
function yearsOf(entries: readonly CatalogEntry[]): string[] {
  const labels = new Set(
    entries.flatMap((entry) => {
      if (entry.year === null) return []
      return [entry.yearBase === null ? `${entry.year}` : `${entry.yearBase}→${entry.year}`]
    }),
  )
  return [...labels]
}

/** 推計時点（将来推計のみ・降順）。 */
function vintagesOf(entries: readonly CatalogEntry[]): number[] {
  const vintages = new Set(
    entries.flatMap((entry) => (entry.vintage === null ? [] : [entry.vintage])),
  )
  return [...vintages].sort((a, b) => b - a)
}

/**
 * baseMetric の詳細（**畳み込み済み**：半径一覧 × 年一覧 ＋ 既定キー）。
 * 変種の全列挙をやめ、返却量を数百バイト規模に抑える（§8 の決定 4）。
 */
export function baseMetricDetail(baseMetric: string): BaseMetricDetail {
  const entries = entriesForBaseMetric(baseMetric)
  const head = entries[0]
  const vintages = vintagesOf(entries)
  return {
    baseMetric,
    labelJa: baseMetricLabel(baseMetric),
    variantCount: entries.length,
    radii: radiiOf(entries),
    years: yearsOf(entries),
    ...(vintages.length > 0 ? { vintages } : {}),
    defaultKey: defaultKeyForBaseMetric(baseMetric),
    unit: head?.unit ?? null,
    usage: `rankStations / compareGrowth には metric="${baseMetric}" と radiusM（必要なら year）を渡せばよい。キーを組み立てる必要はない。`,
  }
}

/** getMetricsCatalog の返却（判別可能な 3 形）。 */
export type MetricsCatalogDigest =
  | BaseMetricDetail
  | CategoryDigest
  | {
      readonly categories: {
        readonly category: Category
        readonly labelJa: string
        readonly baseMetrics: { readonly baseMetric: string; readonly labelJa: string }[]
      }[]
    }

/**
 * getMetricsCatalog ツールの返却本体。
 * - baseMetric 指定：半径一覧 × 年一覧 ＋ 既定キー（**変種は列挙しない**）。
 * - category 指定：その配下の baseMetric 一覧（次に baseMetric で絞り込む）。
 * - 無指定：カテゴリ一覧。
 */
export function metricsCatalogDigest(input: {
  category?: Category
  baseMetric?: string
}): MetricsCatalogDigest {
  if (input.baseMetric !== undefined) {
    return baseMetricDetail(input.baseMetric)
  }
  if (input.category !== undefined) {
    const digest = categoryDigests().find((entry) => entry.category === input.category)
    return digest ?? { category: input.category, labelJa: '', baseMetrics: [] }
  }
  return {
    categories: categoryDigests().map((entry) => ({
      category: entry.category,
      labelJa: entry.labelJa,
      baseMetrics: entry.baseMetrics.map((base) => ({
        baseMetric: base.baseMetric,
        labelJa: base.labelJa,
      })),
    })),
  }
}

/** 集約半径の表示（system-prompt に埋める）。 */
function radiusHint(radii: readonly number[]): string {
  if (radii.length === 0) return '半径非依存'
  return radii.map((radius) => (radius >= 1000 ? `${radius / 1000}km` : `${radius}m`)).join('/')
}

/** 半径非依存で少数のファミリは**キーを列挙**する上限（別物の指標が同居しうるため）。 */
const ENUMERATE_KEYS_MAX = 4

/**
 * ツールに渡す指標トークン。
 * 通常はファミリ名だが、半径非依存で変種が少ないファミリ（例 `pax_rate` = 前年比／コロナ前後比）は
 * **意味の異なる指標が同居**しているため、キーを列挙して曖昧さを残さない。
 */
function familyToken(baseMetric: string, radii: readonly number[]): string {
  if (radii.length > 0) return baseMetric
  const keys = entriesForBaseMetric(baseMetric).map((entry) => entry.key)
  return keys.length > 0 && keys.length <= ENUMERATE_KEYS_MAX ? keys.join('/') : baseMetric
}

/**
 * system-prompt に埋め込むカタログ要約（カテゴリ→**ツールに渡す指標トークン**・対応半径）。
 *
 * ツールにはファミリ名（`pop_gr` 等）をそのまま渡せるため、キー文字列ではなく
 * **ファミリ名を見せる**（LLM がキーを組み立てずに済む）。カタログ駆動で自動更新。
 */
export function systemCatalogSummary(): string {
  const lines: string[] = []
  for (const category of categoryDigests()) {
    const bases = category.baseMetrics
      .map(
        (base) =>
          `${base.labelJa}[${familyToken(base.baseMetric, base.radii)}｜${radiusHint(base.radii)}]`,
      )
      .join('、')
    lines.push(`- ${category.labelJa}(${category.category})：${bases}`)
  }
  return lines.join('\n')
}

/** 検出できる rankable な baseMetric（不正キー時の再案内・ヒント用）。 */
export function knownBaseMetrics(): string[] {
  const set = new Set<string>()
  for (const category of CATEGORIES) {
    for (const entry of rankableForCategory(category)) set.add(entry.baseMetric)
  }
  return [...set]
}
