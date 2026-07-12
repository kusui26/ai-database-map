/**
 * P8c 評価：ゴールデン問の期待と観測を照合してスコアリングする（純関数・DB/LLM 非依存）。
 *
 * 観測（ツール列・パネル型・地図操作・本文）に対し、期待（呼ばれるべきツール／出るべきパネル／
 * 駅選択／データ外の拒否／要点文字列）を機械判定する。全チェック通過で 1 問合格。
 */

/** 観測されたツール呼び出し（名前＋入力）。 */
export type ToolCallObserved = { readonly name: string; readonly input: Record<string, unknown> }

/** 1 問の観測結果（runner が SSE から組み立てる）。 */
export type EvalObserved = {
  readonly toolCalls: readonly ToolCallObserved[]
  readonly panelTypes: readonly string[]
  readonly actionTypes: readonly string[]
  readonly text: string
  /** 判定用の干し草（本文＋MapResponse の JSON）。contains 系はここを見る。 */
  readonly haystack: string
  readonly mapResponseValid: boolean
}

/** ツール呼び出しの期待（name 一致＋input の部分一致）。 */
export type ToolCallExpectation = {
  readonly name: string
  readonly inputIncludes?: Record<string, unknown>
}

/** 1 問の期待。 */
export type EvalExpectation = {
  /** これらにマッチする呼び出しが**それぞれ**存在すること。 */
  readonly toolCalls?: readonly ToolCallExpectation[]
  /** これらのパネル型が**すべて**現れること。 */
  readonly panels?: readonly string[]
  /** 駅が選択される（selectStation）。 */
  readonly select?: boolean
  /** データ外：パネルを一切出さない（天気・経路など）。 */
  readonly noPanels?: boolean
  /** ランキング/散布を出さない（予測要求など・現状データの提示は許容）。 */
  readonly noRankScatter?: boolean
  /** 本文が非空。 */
  readonly textNonEmpty?: boolean
  /** これらを**すべて**含む（本文＋パネル）。 */
  readonly contains?: readonly string[]
  /** これらの**いずれか**を含む（拒否・言い換えの許容）。 */
  readonly containsAny?: readonly string[]
}

export type CheckResult = { readonly name: string; readonly ok: boolean }
export type ScoreResult = { readonly pass: boolean; readonly checks: readonly CheckResult[] }

/** input の期待キーがすべて観測に含まれるか（配列は部分集合、他は厳密一致）。 */
function inputMatches(
  observed: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const actual = observed[key]
    if (Array.isArray(value)) {
      return Array.isArray(actual) && value.every((item) => actual.includes(item))
    }
    return actual === value
  })
}

/** 1 問を採点する（全チェック ok で pass）。 */
export function scoreCase(expectation: EvalExpectation, observed: EvalObserved): ScoreResult {
  const checks: CheckResult[] = [
    { name: 'MapResponse が Zod を通る', ok: observed.mapResponseValid },
  ]

  for (const expected of expectation.toolCalls ?? []) {
    const label = expected.inputIncludes ? `(${JSON.stringify(expected.inputIncludes)})` : ''
    const found = observed.toolCalls.some(
      (call) =>
        call.name === expected.name &&
        (expected.inputIncludes === undefined || inputMatches(call.input, expected.inputIncludes)),
    )
    checks.push({ name: `ツール ${expected.name}${label} が呼ばれる`, ok: found })
  }

  for (const panel of expectation.panels ?? []) {
    checks.push({ name: `パネル ${panel} が出る`, ok: observed.panelTypes.includes(panel) })
  }

  if (expectation.select === true) {
    checks.push({
      name: '駅が選択される (selectStation)',
      ok: observed.actionTypes.includes('selectStation'),
    })
  }
  if (expectation.noPanels === true) {
    checks.push({ name: 'データパネルを出さない', ok: observed.panelTypes.length === 0 })
  }
  if (expectation.noRankScatter === true) {
    const has =
      observed.panelTypes.includes('rankingTable') || observed.panelTypes.includes('scatter')
    checks.push({ name: 'ランキング/散布を出さない', ok: !has })
  }
  if (expectation.textNonEmpty === true) {
    checks.push({ name: '本文が非空', ok: observed.text.trim().length > 0 })
  }
  for (const needle of expectation.contains ?? []) {
    checks.push({ name: `「${needle}」を含む`, ok: observed.haystack.includes(needle) })
  }
  if (expectation.containsAny !== undefined) {
    const ok = expectation.containsAny.some((needle) => observed.haystack.includes(needle))
    checks.push({ name: `いずれかを含む (${expectation.containsAny.join(' / ')})`, ok })
  }

  return { pass: checks.every((check) => check.ok), checks }
}
