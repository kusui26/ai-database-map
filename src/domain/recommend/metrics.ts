/**
 * ドメイン：**プリセットの指標をカタログの key に解決する**（純関数）。
 *
 * プリセットは「ファミリ名（`pop_gr`）」か「正確な key（`rate_covid`）」で書いてある
 * （§13.5・`build_dataset` と同じ規約）。半径・年を決めるのはここ。
 *
 * ## 既定を使ったら、使ったと言う
 *
 * ファミリ名だけ渡されたら半径と年をこちらで埋める。**埋めた事実は `notes` で返す**——
 * 「1km 圏・2020→2040 年」のように、表の脚注へそのまま写せる形で。黙って埋めると、
 * 別の年で計算された順位を同じ順位だと思って比べることになる。
 *
 * ## `higherIsBetter` はカタログから取らない
 *
 * カタログの `higherIsBetter` は全エントリ `null`（未設定）。地価は資産価値重視なら高いほど良く、
 * 予算重視なら安いほど良い——**指標の属性ではなく用途の属性**なので、プリセット側の指定を使う。
 */

import { entries, getEntry, type CatalogEntry } from '@/shared/catalog'
import type { PresetMetric } from './presets'
import type { ScoredMetric } from './types'

export type ResolvedMetrics = {
  readonly metrics: readonly ScoredMetric[]
  /**
   * 解決した key → **レシピが付けた短い名前**（「将来人口」）。
   * カタログのラベルは年と半径まで入った長いもの（「将来人口増減率（2020→2040年・R6推計・1km圏）」）で、
   * 凡例に並べると読めない。長い方は注記に出るので、見出しには短い方を使う。
   */
  readonly labels: Readonly<Record<string, string>>
  /** 埋めた既定（半径・年）。本文の脚注にそのまま使う。 */
  readonly notes: readonly string[]
  /** カタログに無くて解決できなかった指定。 */
  readonly unresolved: readonly string[]
}

/** 年の新しい順。増減率は終点年（`year`）で比べる。 */
function newestFirst(a: CatalogEntry, b: CatalogEntry): number {
  return (b.year ?? 0) - (a.year ?? 0) || (b.yearBase ?? 0) - (a.yearBase ?? 0)
}

/** 増減率が見ている期間（年）。水準（`year` だけ）は null。 */
function spanOf(entry: CatalogEntry): number | null {
  return entry.year === null || entry.yearBase === null ? null : entry.year - entry.yearBase
}

/**
 * ファミリ名 → その半径で使えるエントリ（新しい年が先）。
 *
 * 期間の指定があれば**まず期間で絞る**。「いちばん新しい」だけで選ぶと、
 * 将来人口（終点年が動く）は最も遠い年、地価トレンド（起点年が動く）は最も短い期間、と
 * **同じ規則が逆の意味になる**。期間を先に見れば、どちらも指定どおりになる。
 * 指定した期間が無ければ新しい順に倒す（notes に選んだ key が出るので、黙って消えはしない）。
 */
function familyCandidates(
  family: string,
  radiusM: number,
  spanYears?: number,
): readonly CatalogEntry[] {
  const all = entries
    .filter((entry) => entry.baseMetric === family && entry.kind !== 'flag')
    .filter((entry) => entry.radiusM === radiusM || entry.radiusM === null)
    .sort(newestFirst)
  if (spanYears === undefined) return all
  const matched = all.filter((entry) => spanOf(entry) === spanYears)
  return matched.length > 0 ? matched : all
}

/** 何を既定で埋めたかを 1 行で。 */
function noteFor(entry: CatalogEntry): string {
  return `${entry.labelJa}（${entry.key}）を使いました`
}

/** 指定 1 件を解決する。正確な key が優先、無ければファミリ名として扱う。 */
function resolveOne(
  spec: PresetMetric,
  radiusM: number,
): { readonly metric: ScoredMetric; readonly note: string | null } | null {
  const exact = getEntry(spec.metric)
  const entry = exact ?? familyCandidates(spec.metric, radiusM, spec.spanYears)[0]
  if (entry === undefined) return null
  return {
    metric: {
      key: entry.key,
      direction: spec.direction,
      weight: spec.weight,
      reliabilityFlagKey: entry.reliabilityFlagKey,
    },
    note: exact === undefined ? noteFor(entry) : null,
  }
}

/**
 * プリセットの指標をカタログの key に解決する。
 * 解決できなかったものは落とさず `unresolved` に積む（黙って減らさない）。
 */
export function resolveMetrics(specs: readonly PresetMetric[], radiusM: number): ResolvedMetrics {
  const metrics: ScoredMetric[] = []
  const labels: Record<string, string> = {}
  const notes: string[] = []
  const unresolved: string[] = []
  for (const spec of specs) {
    const resolved = resolveOne(spec, radiusM)
    if (resolved === null) {
      unresolved.push(spec.metric)
      continue
    }
    metrics.push(resolved.metric)
    labels[resolved.metric.key] = spec.labelJa
    if (resolved.note !== null) notes.push(resolved.note)
  }
  return { metrics, labels, notes, unresolved }
}

/** 値の取得に要る列（指標＋その信頼性フラグ）。重複は畳む。 */
export function columnsFor(metrics: readonly ScoredMetric[]): readonly string[] {
  const keys = metrics.flatMap((metric) =>
    metric.reliabilityFlagKey === null ? [metric.key] : [metric.key, metric.reliabilityFlagKey],
  )
  return [...new Set(keys)]
}
