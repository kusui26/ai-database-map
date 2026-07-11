/**
 * メトリクス・カタログのダイジェスト（Step2・純関数）。
 *
 * 自己記述カタログ（単一の真実）を、LLM が「どの指標が使えるか／正確なキーは何か」を
 * 把握できるコンパクトな要約に射影する。system-prompt.ts と getMetricsCatalog ツールが共有し、
 * 指標追加が UI/AI に同時反映される（.claude/CLAUDE.md §2「API こそがプロダクト」）。
 */

import { type CatalogEntry, entriesForCategory, rankableForCategory } from '@/shared/catalog'
import { CATEGORIES, CATEGORY_LABELS_JA, type Category } from '@/shared/constants'
import { baseMetricLabel, variantLabel } from '@/domain/metrics'

/** 指標変種 1 件の要約（ランキング/散布に渡す正確なキーつき）。 */
export type VariantDigest = {
  readonly key: string
  readonly labelJa: string
  readonly radiusM: number | null
  readonly year: number | null
  readonly yearBase: number | null
  readonly vintage: number | null
  readonly unit: string | null
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

/** カテゴリ 1 件の baseMetric ダイジェスト。 */
function baseMetricsFor(category: Category): BaseMetricDigest[] {
  const groups = groupByBaseMetric(rankableForCategory(category))
  return [...groups.entries()].flatMap(([baseMetric, entries]) => {
    const example = entries[0]
    if (example === undefined) return []
    return [
      {
        baseMetric,
        labelJa: baseMetricLabel(baseMetric),
        exampleKey: example.key,
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

/** baseMetric の全変種（rankable）を正確なキー付きで返す（getMetricsCatalog の絞り込み）。 */
export function variantsForBaseMetric(baseMetric: string): VariantDigest[] {
  return CATEGORIES.flatMap((category) =>
    rankableForCategory(category)
      .filter((entry) => entry.baseMetric === baseMetric)
      .map((entry) => ({
        key: entry.key,
        labelJa: variantLabel(entry),
        radiusM: entry.radiusM,
        year: entry.year,
        yearBase: entry.yearBase,
        vintage: entry.vintage,
        unit: entry.unit,
      })),
  )
}

/**
 * getMetricsCatalog ツールの返却本体。
 * - baseMetric 指定：その変種の正確なキー一覧（ランキング/散布にそのまま渡せる）。
 * - category 指定：その配下の baseMetric 一覧（次に baseMetric で絞り込む）。
 * - 無指定：カテゴリ一覧。
 */
export function metricsCatalogDigest(input: { category?: Category; baseMetric?: string }): unknown {
  if (input.baseMetric !== undefined) {
    const variants = variantsForBaseMetric(input.baseMetric)
    return {
      baseMetric: input.baseMetric,
      labelJa: baseMetricLabel(input.baseMetric),
      variantCount: variants.length,
      variants,
    }
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

/**
 * system-prompt に埋め込むカタログ要約（カテゴリ→baseMetric・例キー・半径）。
 * カタログ駆動で生成するため、指標追加で自動的に更新される。
 */
export function systemCatalogSummary(): string {
  const lines: string[] = []
  for (const category of categoryDigests()) {
    const bases = category.baseMetrics
      .map((base) => `${base.labelJa}[例:${base.exampleKey}｜${radiusHint(base.radii)}]`)
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

/** 指標キーの推定候補（不正キー時に近い baseMetric の例キーを返す）。 */
export function suggestMetricKeys(bad: string): string[] {
  const lowered = bad.toLowerCase()
  const suggestions: string[] = []
  for (const category of CATEGORIES) {
    for (const entry of entriesForCategory(category)) {
      if (!entry.rankable) continue
      if (entry.baseMetric.toLowerCase().startsWith(lowered.split('_')[0] ?? lowered)) {
        suggestions.push(entry.key)
      }
    }
  }
  return suggestions.slice(0, 8)
}
