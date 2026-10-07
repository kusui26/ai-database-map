/**
 * ツール 1 回分の会社・路線の指定を、データの正式名へ解決する（2026-10-07・B1・計画書 §6.4）。
 *
 * - 決まれば、正式名の `operators`・`routes` と、どう読んだかの説明（`notes`・LLM が本文で正しい名前を使えるように）
 * - 決まらなければ、**図を作らずに**候補つきの理由を返す（`problems`）。推測で 1 つ選ばない
 *   - 同じ名前の別路線（東西線＝東京メトロ・札幌・仙台・京都）は、都道府県の指定があればそれで絞る。
 *     それでも残れば候補（呼び直しにそのまま使える operators・routes と、駅の数・都道府県）を返す
 *   - 運行系統の名前（京浜東北線）は、正式な路線を候補として返す
 *
 * 会社の指定と路線は、SQL では**同じ行**で照らす（`station_matches_filters`）。会社が要るのは、同じ名前の
 * 別の会社の路線を除くときだけ（「東横線」は東急電鉄にしか無いので会社は付けない＝図の題が長くならない）。
 */

import { type RoutePair } from './aliases'
import {
  hasPair,
  matchOperator,
  matchRoute,
  pairLabel,
  uniquePairs,
  type NameIndex,
  type RouteIdentity,
  type RouteMatch,
} from './match'
import { nameKey, samePair } from './names'

/** 駅の数と都道府県。 */
export type PairStations = { readonly count: number; readonly prefectures: readonly string[] }

export type NameResolveDeps = {
  /** 照合の索引（データの一覧から作る）。 */
  readonly index: () => Promise<NameIndex>
  /** 会社 × 路線の組の駅（`prefectures` を渡すとその中だけ数える）。 */
  readonly stationsOf: (
    pairs: readonly RoutePair[],
    prefectures: readonly string[],
  ) => Promise<PairStations>
}

export type NameRequest = {
  readonly operators?: readonly string[]
  readonly routes?: readonly string[]
  /** 正規化済みの都道府県（同じ名前の路線を絞るのに使う）。 */
  readonly prefectures: readonly string[]
}

export type NameFilters = { readonly operators: string[]; readonly routes: string[] }

/** 呼び直しにそのまま使える候補。 */
export type NameCandidate = {
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly stationCount: number
  readonly prefectures: readonly string[]
}

export type NameProblem = {
  readonly input: string
  readonly problem: string
  readonly candidates?: readonly NameCandidate[]
  readonly didYouMean?: readonly string[]
}

export type NameResolution =
  | { readonly ok: true; readonly filters: NameFilters; readonly notes: readonly string[] }
  | {
      readonly ok: false
      readonly error: string
      readonly hint: string
      readonly problems: readonly NameProblem[]
    }

const MAX_CANDIDATES = 10

const NAME_HINT =
  'problems の各項目を見て呼び直してください。candidates は呼び直しにそのまま使える operators と routes です。' +
  '会話から地域や会社が分かるときだけ選び（地域が分かれば prefectures を添えてもよい）、分からなければどの路線かを利用者に聞いてください（推測で選ばない）。' +
  'didYouMean は近い正式名です。運行系統の名前（京浜東北線など）はデータに無く、正式な路線で集計するとその系統が走らない区間の駅も含むので、そう断って使うか利用者に確かめてください。'

type RouteOutcome =
  | {
      readonly kind: 'pairs'
      readonly pairs: readonly RoutePair[]
      readonly notes: readonly string[]
    }
  | { readonly kind: 'operators'; readonly operators: readonly string[] }
  | { readonly kind: 'problem'; readonly problem: NameProblem }

type OperatorOutcome = {
  /** 会社の指定（無ければ null＝全社）。 */
  readonly scope: string[] | null
  readonly problems: NameProblem[]
  readonly notes: string[]
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function trimmed(inputs: readonly string[] | undefined): string[] {
  return (inputs ?? []).map((input) => input.trim()).filter((input) => input.length > 0)
}

function identityLabel(identity: RouteIdentity): string {
  return identity.pairs.map(pairLabel).join('・')
}

/** 候補（駅の数と都道府県つき）。 */
async function candidatesOf(
  identities: readonly RouteIdentity[],
  deps: NameResolveDeps,
): Promise<NameCandidate[]> {
  return Promise.all(
    identities.slice(0, MAX_CANDIDATES).map(async (identity) => {
      const stations = await deps.stationsOf(identity.pairs, [])
      return {
        operators: unique(identity.pairs.map((pair) => pair.operator)),
        routes: unique(identity.pairs.map((pair) => pair.route)),
        stationCount: stations.count,
        prefectures: stations.prefectures,
      }
    }),
  )
}

/** 会社の指定を正式名へ。 */
function resolveOperators(inputs: readonly string[], index: NameIndex): OperatorOutcome {
  const matches = inputs.map((input) => ({ input, match: matchOperator(input, index) }))
  const problems = matches.flatMap(({ input, match }): NameProblem[] => {
    if (match.kind === 'category') return [{ input, problem: match.hint }]
    if (match.kind === 'unknown') {
      return [
        {
          input,
          problem: `「${input}」という会社はデータにありません。`,
          didYouMean: match.didYouMean,
        },
      ]
    }
    return []
  })
  const operators = matches.flatMap(({ match }) =>
    match.kind === 'operators' ? match.operators : [],
  )
  const notes = matches.flatMap(({ input, match }) =>
    match.kind === 'operators' && !match.operators.some((name) => nameKey(name) === nameKey(input))
      ? [`会社「${input}」は ${match.operators.join('・')} として扱いました。`]
      : [],
  )
  // 会社が 1 つも決まらなければ範囲は付けない（路線の理由を「会社と合わない」で隠さない）。
  return { scope: operators.length === 0 ? null : unique(operators), problems, notes }
}

type RoutesMatch = Extract<RouteMatch, { kind: 'routes' }>

/** 路線全体へ広げた読み替え（中央線快速 → 中央線）で決まったなら、そう断る説明。 */
function widenedNote(input: string, identity: RouteIdentity, match: RoutesMatch): string | null {
  const part = match.widenedPair
  if (part === null || !identity.pairs.some((pair) => samePair(pair, part))) return null
  return `「${input}」はデータに無い区間の名前なので、路線全体（${identityLabel(identity)}）で集計しました。その系統の停車駅・区間に限りません。`
}

/** 決まった 1 本の説明（名前を読み替えた・路線全体へ広げた・弱い候補を使わなかった）。 */
function notesFor(input: string, identity: RouteIdentity, match: RoutesMatch): string[] {
  const renamed = !identity.pairs.some((pair) => nameKey(pair.route) === nameKey(input))
  const reading =
    widenedNote(input, identity, match) ??
    (renamed ? `「${input}」は ${identityLabel(identity)} として集計しました。` : null)
  const others = match.others.map(
    (other) =>
      `「${input}」には ${identityLabel(other)} も当たりますが含めていません（そちらなら routes にその名前を指定）。`,
  )
  return [...(reading === null ? [] : [reading]), ...others]
}

/** 同じ名前の別路線を、都道府県で 1 つに絞る（駅のある路線だけ残す）。 */
async function narrowByPrefectures(
  identities: readonly RouteIdentity[],
  prefectures: readonly string[],
  deps: NameResolveDeps,
): Promise<RouteIdentity[]> {
  const counts = await Promise.all(
    identities.map((identity) => deps.stationsOf(identity.pairs, prefectures)),
  )
  return identities.filter((_, i) => (counts[i]?.count ?? 0) > 0)
}

/** 都道府県で 1 本に決めた（広げた読み替えの路線なら、そのことも書く）。 */
function chosenOutcome(
  input: string,
  chosen: RouteIdentity,
  match: RoutesMatch,
  prefectures: readonly string[],
): RouteOutcome {
  const note = `「${input}」に当たる路線が複数あるため、${prefectures.join('・')}に駅のある ${identityLabel(chosen)} に決めました。`
  const widened = widenedNote(input, chosen, match)
  return { kind: 'pairs', pairs: chosen.pairs, notes: widened === null ? [note] : [note, widened] }
}

/** 決まらなかった理由と候補（都道府県で絞って 2 本以上残ればそれだけ、0 本・指定なしならすべて）。 */
async function ambiguousOutcome(
  input: string,
  all: readonly RouteIdentity[],
  narrowed: readonly RouteIdentity[] | null,
  prefectures: readonly string[],
  deps: NameResolveDeps,
): Promise<RouteOutcome> {
  const remaining = narrowed !== null && narrowed.length > 1 ? narrowed : all
  const problem =
    narrowed?.length === 0
      ? `「${input}」に当たる路線は、${prefectures.join('・')}に駅がありません。`
      : `「${input}」に当たる路線が複数あります（${remaining.length} 本）。`
  const candidates = await candidatesOf(remaining, deps)
  return { kind: 'problem', problem: { input, problem, candidates } }
}

/** 当たった路線から 1 本に決める（決まらなければ候補つきの理由）。 */
async function decideRoutes(
  input: string,
  match: RoutesMatch,
  prefectures: readonly string[],
  deps: NameResolveDeps,
): Promise<RouteOutcome> {
  const only = match.identities.length === 1 ? match.identities[0] : undefined
  if (only !== undefined) {
    return { kind: 'pairs', pairs: only.pairs, notes: notesFor(input, only, match) }
  }
  // 弱い候補（「東西線」に対する JR東西線）も、都道府県で絞る対象に入れる（大阪府なら JR東西線に決まる）。
  const all = [...match.identities, ...match.others]
  const narrowed = prefectures.length > 0 ? await narrowByPrefectures(all, prefectures, deps) : null
  const chosen = narrowed?.length === 1 ? narrowed[0] : undefined
  if (chosen !== undefined) return chosenOutcome(input, chosen, match, prefectures)
  return ambiguousOutcome(input, all, narrowed, prefectures, deps)
}

/** 会社の指定と合わないとき、その路線の持ち主を示す（「東横線」は東急電鉄、「小田急線」は小田急電鉄）。 */
function mismatch(input: string, scope: readonly string[], index: NameIndex): NameProblem | null {
  const anywhere = matchRoute(input, index, null)
  const owners =
    anywhere.kind === 'routes'
      ? anywhere.identities.map(identityLabel).join('／')
      : anywhere.kind === 'operators'
        ? anywhere.operators.join('・')
        : null
  if (owners === null) return null
  return {
    input,
    problem: `「${input}」は ${owners} の路線で、operators の指定（${scope.join('・')}）と合いません。`,
  }
}

/** 路線 1 つを解決する。 */
async function resolveRoute(
  input: string,
  index: NameIndex,
  operators: OperatorOutcome,
  prefectures: readonly string[],
  deps: NameResolveDeps,
): Promise<RouteOutcome> {
  const match = matchRoute(input, index, operators.scope)
  if (match.kind === 'operators') return { kind: 'operators', operators: match.operators }
  if (match.kind === 'routes') return decideRoutes(input, match, prefectures, deps)
  if (match.kind === 'category') return { kind: 'problem', problem: { input, problem: match.hint } }
  if (match.kind === 'span') {
    const lines = match.candidates.map(identityLabel).join('・')
    const problem = `「${input}」は運行系統の名前で、データ（国土数値情報）の路線名にはありません。正式には ${lines} にまたがります。`
    return {
      kind: 'problem',
      problem: { input, problem, candidates: await candidatesOf(match.candidates, deps) },
    }
  }
  const unmatched = operators.scope === null ? null : mismatch(input, operators.scope, index)
  const unknown = {
    input,
    problem: `「${input}」という路線はデータにありません。`,
    didYouMean: match.didYouMean,
  }
  return { kind: 'problem', problem: unmatched ?? unknown }
}

/** 会社の全路線（路線の指定に混ざった「小田急線」を、ほかの路線と並べられるようにする）。 */
function allPairsOf(operators: readonly string[], index: NameIndex): RoutePair[] {
  return index.catalog.routes.flatMap((row) =>
    row.operators
      .filter((operator) => operators.includes(operator))
      .map((operator) => ({ operator, route: row.route })),
  )
}

/** 同じ名前の別の会社の路線を除くのに、会社の指定が要るか。 */
function needsOperators(pairs: readonly RoutePair[], index: NameIndex): boolean {
  return unique(pairs.map((pair) => pair.route)).some((route) => {
    const owners = index.catalog.routes.find((row) => row.route === route)?.operators ?? []
    const used = pairs.filter((pair) => pair.route === route).map((pair) => pair.operator)
    return owners.some((owner) => !used.includes(owner))
  })
}

/** 会社 × 路線の掛け合わせで、意図しない組（データにある組）が混ざらないか。 */
function leakedPairs(
  filters: NameFilters,
  intended: readonly RoutePair[],
  index: NameIndex,
): RoutePair[] {
  return filters.operators.flatMap((operator) =>
    filters.routes
      .map((route) => ({ operator, route }))
      .filter((pair) => !intended.some((used) => samePair(used, pair)) && hasPair(pair, index)),
  )
}

function failure(problems: readonly NameProblem[]): NameResolution {
  const inputs = problems.map((problem) => `「${problem.input}」`).join('・')
  return {
    ok: false,
    error: `会社・路線の名前を決められませんでした（${inputs}）。`,
    hint: NAME_HINT,
    problems,
  }
}

/** まとめた条件と、意図した会社 × 路線の組（掛け合わせの漏れを見るのに使う）。 */
type Combined = { readonly filters: NameFilters; readonly intended: readonly RoutePair[] }

/** 路線の指定を正式名の条件へまとめる（会社は要るときだけ付ける）。 */
function combine(
  outcomes: readonly RouteOutcome[],
  operators: OperatorOutcome,
  index: NameIndex,
): Combined {
  const routePairs = outcomes.flatMap((outcome) => (outcome.kind === 'pairs' ? outcome.pairs : []))
  const companyWide = outcomes.flatMap((outcome) =>
    outcome.kind === 'operators' ? outcome.operators : [],
  )
  if (routePairs.length === 0) {
    return {
      filters: { operators: unique([...(operators.scope ?? []), ...companyWide]), routes: [] },
      intended: [],
    }
  }
  const intended = uniquePairs([...routePairs, ...allPairsOf(companyWide, index)])
  const constrained = operators.scope !== null || needsOperators(intended, index)
  const filters = {
    operators: constrained ? unique(intended.map((pair) => pair.operator)) : [],
    routes: unique(intended.map((pair) => pair.route)),
  }
  return { filters, intended }
}

/** 会社・路線の指定を正式名へ解決する。どちらも無ければ一覧も読まない。 */
export async function resolveNameFilters(
  request: NameRequest,
  deps: NameResolveDeps,
): Promise<NameResolution> {
  const operatorInputs = trimmed(request.operators)
  const routeInputs = trimmed(request.routes)
  if (operatorInputs.length === 0 && routeInputs.length === 0) {
    return { ok: true, filters: { operators: [], routes: [] }, notes: [] }
  }
  const index = await deps.index()
  const operators = resolveOperators(operatorInputs, index)
  const outcomes = await Promise.all(
    routeInputs.map((input) => resolveRoute(input, index, operators, request.prefectures, deps)),
  )
  const problems = [
    ...operators.problems,
    ...outcomes.flatMap((o) => (o.kind === 'problem' ? [o.problem] : [])),
  ]
  if (problems.length > 0) return failure(problems)
  const { filters, intended } = combine(outcomes, operators, index)
  const leaked = leakedPairs(filters, intended, index)
  if (leaked.length > 0) return failure([combinationProblem(routeInputs, leaked)])
  const notes = [
    ...operators.notes,
    ...outcomes.flatMap((o) => (o.kind === 'pairs' ? o.notes : [])),
  ]
  return { ok: true, filters, notes }
}

function combinationProblem(inputs: readonly string[], leaked: readonly RoutePair[]): NameProblem {
  const pairs = leaked.map(pairLabel).join('・')
  return {
    input: inputs.join('・'),
    problem: `一度に指定すると、意図しない組合せ（${pairs}）まで含まれます。路線ごとに分けて呼んでください。`,
  }
}
