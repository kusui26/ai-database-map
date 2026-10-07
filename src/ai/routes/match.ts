/**
 * 1 つの名前（会社・路線）を、データの正式名に当てる（純関数・2026-10-07・B1）。
 *
 * 路線は「持ち主」ごとに束ねる。持ち主は会社で、**JR だけは路線名**（東海道線は JR 東日本・東海・西日本に
 * 分かれているが 1 本の路線）。持ち主が 2 つ以上なら、利用者にとって別の路線が同じ名前を持っている
 * （東西線＝東京メトロ・札幌・仙台・京都）——どれかを推測で選ばず、決めるのは呼び出し側（`resolve.ts`）。
 *
 * 当て方の順：①名前の形（正式名・番号外し・本線／線・別名）②頭の会社名（「東急東横線」→ 東急電鉄の「東横線」）
 * ③「線」を補う（「東横」）。会社名を外した弱い形（「西武有楽町線」→「有楽町線」）は、強い形で何も当たらないときだけ使う。
 */

import {
  CATEGORY_WORD_HINTS,
  ROUTE_ALIASES,
  ROUTE_PART_ALIASES,
  SERVICE_SPANS,
  type RoutePair,
} from './aliases'
import {
  isJrOperator,
  nameKey,
  operatorKeyIndex,
  operatorPrefixes,
  routeFormIndex,
  samePair,
  type FormHit,
  type RouteCatalog,
  type RouteFormIndex,
} from './names'

/** 照合に使う索引（データの一覧から 1 回だけ作る）。 */
export type NameIndex = {
  readonly catalog: RouteCatalog
  readonly routeForms: RouteFormIndex
  readonly operatorKeys: ReadonlyMap<string, readonly string[]>
  /** 会社の言い方の鍵（長い順）。路線名の頭の会社名を探す。 */
  readonly operatorPrefixKeys: readonly string[]
}

export function buildNameIndex(catalog: RouteCatalog): NameIndex {
  const operatorKeys = operatorKeyIndex(catalog.operators)
  return {
    catalog,
    routeForms: routeFormIndex(catalog.routes),
    operatorKeys,
    operatorPrefixKeys: [...operatorKeys.keys()].sort((a, b) => b.length - a.length),
  }
}

/** 利用者にとって 1 本の路線（持ち主が同じ会社 × 路線の組）。 */
export type RouteIdentity = { readonly owner: string; readonly pairs: readonly RoutePair[] }

export type OperatorMatch =
  | { readonly kind: 'operators'; readonly operators: readonly string[] }
  | { readonly kind: 'category'; readonly hint: string }
  | { readonly kind: 'unknown'; readonly didYouMean: readonly string[] }

export type RouteMatch =
  /** 会社の全路線（「小田急線」「京急線」）。 */
  | { readonly kind: 'operators'; readonly operators: readonly string[] }
  /** 持ち主ごとの路線。2 つ以上は同じ名前の別路線。`others` は弱い形で当たったが使わなかったもの。 */
  | {
      readonly kind: 'routes'
      readonly identities: readonly RouteIdentity[]
      readonly others: readonly RouteIdentity[]
      /** 運行系統の名前を路線全体で読み替えた組（中央線快速 → JR東日本 中央線）。無ければ null。 */
      readonly widenedPair: RoutePair | null
    }
  /** 複数の路線にまたがる運行系統の名前（解決しない・正式な路線を候補として返す）。 */
  | { readonly kind: 'span'; readonly candidates: readonly RouteIdentity[] }
  | { readonly kind: 'category'; readonly hint: string }
  | { readonly kind: 'unknown'; readonly didYouMean: readonly string[] }

/** 会社の範囲（null＝全社）。 */
type Scope = readonly string[] | null

function inScope(pair: RoutePair, scope: Scope): boolean {
  return scope === null || scope.includes(pair.operator)
}

function ownerOf(pair: RoutePair): string {
  return isJrOperator(pair.operator) ? `JR:${pair.route}` : pair.operator
}

/** 同じ組を 1 回にする（現れた順）。 */
export function uniquePairs(pairs: readonly RoutePair[]): RoutePair[] {
  return pairs.filter((pair, i) => pairs.findIndex((other) => samePair(other, pair)) === i)
}

/** 組を持ち主ごとに束ねる（現れた順）。 */
export function identitiesOf(pairs: readonly RoutePair[]): RouteIdentity[] {
  const unique = uniquePairs(pairs)
  const owners = [...new Set(unique.map(ownerOf))]
  return owners.map((owner) => ({ owner, pairs: unique.filter((pair) => ownerOf(pair) === owner) }))
}

/** 名前ではない言葉（新幹線・地下鉄…）の指定のしかた。 */
function categoryHint(key: string): string | null {
  const found = Object.entries(CATEGORY_WORD_HINTS).find(([word]) => nameKey(word) === key)
  return found?.[1] ?? null
}

/** 2 文字ずつの組の重なり（Dice 係数・0〜1）。 */
function bigramSimilarity(a: string, b: string): number {
  const grams = (text: string): string[] =>
    Array.from({ length: Math.max(text.length - 1, 0) }, (_, i) => text.slice(i, i + 2))
  const left = grams(a)
  const right = grams(b)
  if (left.length === 0 || right.length === 0) return 0
  const shared = left.filter((gram) => right.includes(gram)).length
  return (2 * shared) / (left.length + right.length)
}

/** 近さ（片方がもう片方を含むなら高く、それ以外は 2 文字の組の重なり）。 */
function closeness(input: string, candidate: string): number {
  const contains = candidate.includes(input) || input.includes(candidate)
  if (!contains) return bigramSimilarity(input, candidate)
  const ratio = Math.min(input.length, candidate.length) / Math.max(input.length, candidate.length)
  return 0.6 + 0.4 * ratio
}

const SUGGESTION_THRESHOLD = 0.35
const MAX_SUGGESTIONS = 5

/** 鍵の候補から近い順に名前を返す（同じ名前は 1 回）。 */
function nearest(key: string, options: readonly { key: string; name: string }[]): string[] {
  const scored = options
    .map((option) => ({ name: option.name, score: closeness(key, option.key) }))
    .filter((option) => option.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
  return [...new Set(scored.map((option) => option.name))].slice(0, MAX_SUGGESTIONS)
}

export function pairLabel(pair: RoutePair): string {
  return `${pair.operator} ${pair.route}`
}

function suggestRoutes(key: string, index: NameIndex, scope: Scope): string[] {
  const options = [...index.routeForms.entries()].flatMap(([formKey, hits]) =>
    hits
      .filter((hit) => inScope(hit.pair, scope))
      .map((hit) => ({ key: formKey, name: pairLabel(hit.pair) })),
  )
  return nearest(key, options)
}

function suggestOperators(key: string, index: NameIndex): string[] {
  const options = [...index.operatorKeys.entries()].flatMap(([aliasKey, names]) =>
    names.map((name) => ({ key: aliasKey, name })),
  )
  return nearest(key, options)
}

/** 会社の名前を正式名へ（「東急」「東京急行電鉄」→ 東急電鉄・「JR」→ JR 6 社・「東急線」も会社）。 */
export function matchOperator(input: string, index: NameIndex): OperatorMatch {
  const key = nameKey(input)
  const hint = categoryHint(key)
  if (hint !== null) return { kind: 'category', hint }
  const found = index.operatorKeys.get(key) ?? index.operatorKeys.get(key.replace(/線$/u, ''))
  if (found !== undefined) return { kind: 'operators', operators: found }
  return { kind: 'unknown', didYouMean: suggestOperators(key, index) }
}

/** 別名表で当たる組（`partPair`＝路線全体へ広げた読み替えの組）。 */
function aliasHits(key: string): { readonly hits: FormHit[]; readonly partPair: RoutePair | null } {
  const same = Object.entries(ROUTE_ALIASES).find(([alias]) => nameKey(alias) === key)?.[1] ?? []
  const part = Object.entries(ROUTE_PART_ALIASES).find(([alias]) => nameKey(alias) === key)?.[1]
  const pairs = part === undefined ? same : [...same, part]
  return { hits: pairs.map((pair): FormHit => ({ pair, tier: 1 })), partPair: part ?? null }
}

/** データにその会社 × 路線があるか。 */
export function hasPair(pair: RoutePair, index: NameIndex): boolean {
  return index.catalog.routes.some(
    (row) => row.route === pair.route && row.operators.includes(pair.operator),
  )
}

/** データの「X分岐線」「X支線」（同じ会社）も同じ路線として足す（丸ノ内線の方南町支線など）。 */
function withBranches(pairs: readonly RoutePair[], index: NameIndex): RoutePair[] {
  const branches = pairs.flatMap((pair) =>
    [`${pair.route}分岐線`, `${pair.route}支線`]
      .map((route) => ({ operator: pair.operator, route }))
      .filter((branch) => hasPair(branch, index)),
  )
  return uniquePairs([...pairs, ...branches])
}

/** 当たった組（範囲で絞ったあと）→ 強い形を優先して持ち主ごとに。 */
function decideHits(
  hits: readonly FormHit[],
  widenedPair: RoutePair | null,
  index: NameIndex,
): RouteMatch | null {
  if (hits.length === 0) return null
  const strong = hits.filter((hit) => hit.tier === 1).map((hit) => hit.pair)
  const weak = hits.filter((hit) => hit.tier === 2).map((hit) => hit.pair)
  const used = withBranches(strong.length > 0 ? strong : weak, index)
  const identities = identitiesOf(used)
  const unused = strong.length > 0 ? weak : []
  const others = identitiesOf(unused).filter(
    (other) => !identities.some((id) => id.owner === other.owner),
  )
  return { kind: 'routes', identities, others, widenedPair }
}

/**
 * 名前の形・別名で当たる組（範囲で絞る）。別名表の組は**データにあるものだけ**を使う
 * （データの名前が変わっても、無い路線を候補に出さない）。
 */
function formMatch(key: string, index: NameIndex, scope: Scope): RouteMatch | null {
  const span = Object.entries(SERVICE_SPANS).find(([name]) => nameKey(name) === key)?.[1]
  if (span !== undefined) {
    const inside = span.filter((pair) => inScope(pair, scope) && hasPair(pair, index))
    if (inside.length > 0) return { kind: 'span', candidates: identitiesOf(inside) }
  }
  const aliases = aliasHits(key)
  const forms = index.routeForms.get(key) ?? []
  const hits = [...forms, ...aliases.hits.filter((hit) => hasPair(hit.pair, index))].filter((hit) =>
    inScope(hit.pair, scope),
  )
  const part = aliases.partPair
  const widenedPair = part !== null && hits.some((hit) => samePair(hit.pair, part)) ? part : null
  return decideHits(hits, widenedPair, index)
}

/** 会社の「本線」（「京急本線」→ 京浜急行電鉄の「本線」・「南海本線」も）。会社名つきの本線だけを見る。 */
function isMainLineOf(route: string, operator: string): boolean {
  return route === '本線' || operatorPrefixes(operator).some((name) => route === `${name}本線`)
}

/** 会社の中で本線を探す（1 本に決まるときだけ）。 */
function mainLineOf(scope: readonly string[], index: NameIndex): RouteMatch | null {
  const pairs = index.catalog.routes.flatMap((row) =>
    row.operators
      .filter((operator) => scope.includes(operator) && isMainLineOf(row.route, operator))
      .map((operator): FormHit => ({ pair: { operator, route: row.route }, tier: 1 })),
  )
  return pairs.length === 1 ? decideHits(pairs, null, index) : null
}

/** 会社の範囲の中の会社（範囲が無ければそのまま）。 */
function withinScope(operators: readonly string[], scope: Scope): string[] {
  return operators.filter((operator) => scope === null || scope.includes(operator))
}

/**
 * 頭の会社名を外して、残りを路線として当てる（「東急東横線」「東京メトロ東西線」「都営浅草線」）。
 * 会社名は分かったのに残りが当たらないときは、その会社の路線から近いものを返す（「東武本線」）。
 */
function prefixMatch(key: string, index: NameIndex, scope: Scope): RouteMatch | null {
  const prefix = index.operatorPrefixKeys.find(
    (candidate) => key.startsWith(candidate) && key !== candidate,
  )
  if (prefix === undefined) return null
  const operators = withinScope(index.operatorKeys.get(prefix) ?? [], scope)
  if (operators.length === 0) return null
  const rest = key.slice(prefix.length)
  if (rest === '線') return { kind: 'operators', operators }
  const matched =
    rest === '本線'
      ? mainLineOf(operators, index)
      : (formMatch(rest, index, operators) ?? withLineSuffix(rest, index, operators))
  return matched ?? { kind: 'unknown', didYouMean: suggestRoutes(rest, index, operators) }
}

/** 会社の名前だけが路線に渡された（routes:["小田急"]）＝その会社の全路線。 */
function operatorOnlyMatch(key: string, index: NameIndex, scope: Scope): RouteMatch | null {
  const operators = withinScope(index.operatorKeys.get(key) ?? [], scope)
  return operators.length > 0 ? { kind: 'operators', operators } : null
}

/** 「線」を補って当てる（「東横」→「東横線」）。 */
function withLineSuffix(key: string, index: NameIndex, scope: Scope): RouteMatch | null {
  if (/(線|ライン|ライナー)$/u.test(key)) return null
  return formMatch(`${key}線`, index, scope)
}

/** 利用者の言い方の飾り（「東横線沿線」「東横線の沿線」「東横線の駅」「東横線沿線の駅」）を外す。 */
function withoutDecoration(input: string): string {
  return input.trim().replace(/(?:の?沿線)?(?:の各駅|の駅)?$/u, '')
}

/** 路線の名前を正式名へ。`scope` は会社の範囲（`operators` の指定・null＝全社）。 */
export function matchRoute(input: string, index: NameIndex, scope: Scope): RouteMatch {
  const key = nameKey(withoutDecoration(input))
  const hint = categoryHint(key)
  if (hint !== null) return { kind: 'category', hint }
  const matched =
    formMatch(key, index, scope) ??
    operatorOnlyMatch(key, index, scope) ??
    prefixMatch(key, index, scope) ??
    withLineSuffix(key, index, scope)
  return matched ?? { kind: 'unknown', didYouMean: suggestRoutes(key, index, scope) }
}
