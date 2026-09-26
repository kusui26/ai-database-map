/**
 * eval の集計とレポート（純関数）。
 *
 * ## なぜ合否だけでは足りないか（2026-09-26・モデルの検証）
 *
 * `gemini-flash-lite-latest` の中身が、こちらの知らないうちに 3.1 → 3.5 Flash-Lite（思考型）へ
 * 差し替わっていた。モデルを比べるとき、見るべきものは合格数だけではない——
 *
 * - **所要時間**：思考型は遅くなりうる。p95 が延びれば、50 秒の打ち切りに近づく
 * - **再試行**：runner は失敗した問を 65 秒待って 1 度だけ流し直す。合格数はこれで**隠れる**ので、
 *   何問が再試行に頼ったかを別に数える（＝そのモデルの安定性）
 * - **分野別**：災害・拒否は 1 問も落とせない。全体の数に埋もれさせない
 */

export type EvalRun = {
  readonly id: string
  readonly category: string
  readonly pass: boolean
  readonly failedChecks: readonly string[]
  /** 採点した回の所要時間（ms）。再試行したなら 2 回目。 */
  readonly elapsedMs: number
  /** 1 回目がエラー・data-map なしで、流し直した。 */
  readonly retried: boolean
  readonly toolCallCount: number
}

export type CategoryTally = {
  readonly category: string
  readonly passed: number
  readonly total: number
}

export type EvalSummary = {
  readonly passed: number
  readonly total: number
  readonly retried: number
  readonly criticalFailures: readonly string[]
  readonly p50Ms: number
  readonly p95Ms: number
  readonly maxMs: number
  readonly byCategory: readonly CategoryTally[]
}

/** 最近順位法の分位（p は 0〜100）。空なら 0。 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0
}

/** 出てきた順を保ったまま、分野ごとに数える。 */
function tallyByCategory(runs: readonly EvalRun[]): CategoryTally[] {
  const order = [...new Set(runs.map((run) => run.category))]
  return order.map((category) => {
    const inCategory = runs.filter((run) => run.category === category)
    return {
      category,
      passed: inCategory.filter((run) => run.pass).length,
      total: inCategory.length,
    }
  })
}

export function summarizeRuns(
  runs: readonly EvalRun[],
  criticalCategories: readonly string[],
): EvalSummary {
  const elapsed = runs.map((run) => run.elapsedMs)
  return {
    passed: runs.filter((run) => run.pass).length,
    total: runs.length,
    retried: runs.filter((run) => run.retried).length,
    criticalFailures: runs
      .filter((run) => !run.pass && criticalCategories.includes(run.category))
      .map((run) => `${run.id}（${run.failedChecks.join('；')}）`),
    p50Ms: percentile(elapsed, 50),
    p95Ms: percentile(elapsed, 95),
    maxMs: Math.max(0, ...elapsed),
    byCategory: tallyByCategory(runs),
  }
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

export type ReportContext = {
  /** 何を測ったか（例「gemini-3.5-flash-lite / temperature 既定」）。 */
  readonly label: string
  readonly baseUrl: string
  readonly threshold: number
  readonly criticalCategories: readonly string[]
}

/** Markdown のレポート。比べるときに並べやすいよう、見出しの数値は固定の順に出す。 */
export function renderReport(
  runs: readonly EvalRun[],
  summary: EvalSummary,
  context: ReportContext,
): string {
  const header = [
    `# eval レポート — ${context.label}`,
    '',
    `対象: ${context.baseUrl}`,
    '',
    `**合格率: ${summary.passed}/${summary.total}（閾値 ${context.threshold}）**`,
    '',
    `**落としてはいけない分野（${context.criticalCategories.join('・')}）の失敗: ${
      summary.criticalFailures.length === 0 ? 'なし' : summary.criticalFailures.join('、')
    }**`,
    '',
    `所要時間 p50 ${seconds(summary.p50Ms)}・p95 ${seconds(summary.p95Ms)}・最大 ${seconds(summary.maxMs)}／` +
      `再試行に頼った問 ${summary.retried}`,
    '',
    '| 分野 | 合格 |',
    '|---|---|',
    ...summary.byCategory.map((tally) => `| ${tally.category} | ${tally.passed}/${tally.total} |`),
    '',
  ]
  const table = [
    '| # | id | 分野 | 合否 | 所要 | 再試行 | ツール | 失敗チェック |',
    '|---|---|---|---|---|---|---|---|',
    ...runs.map(
      (run, index) =>
        `| ${index + 1} | ${run.id} | ${run.category} | ${run.pass ? '✅' : '❌'} | ` +
        `${seconds(run.elapsedMs)} | ${run.retried ? '↻' : ''} | ${run.toolCallCount} | ` +
        `${run.failedChecks.join('；') || '—'} |`,
    ),
    '',
  ]
  return [...header, ...table].join('\n')
}
