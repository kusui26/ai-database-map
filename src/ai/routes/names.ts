/**
 * 会社・路線の名前の照合の土台（純関数・2026-10-07・B1）。
 *
 * 返す名前は**いつもデータの正式名**で、ここで作るのは照合のための鍵と索引だけ（新しい名前は作らない）。
 *
 * データの路線名から、利用者が言いそうな形を規則で作る（別名の表は `aliases.ts`）：
 * - 番号を外す：「4号線丸ノ内線」→「丸ノ内線」、「1号線(御堂筋線)」→「御堂筋線」（東京・大阪・名古屋・福岡の地下鉄）
 * - 「本線」と「線」：JR は「東海道線」だが利用者は「東海道本線」とも言う。私鉄は「東上本線」だが「東上線」とも言う
 * - 会社名を外す：「東急多摩川線」「相鉄いずみ野線」「JR東西線」→「多摩川線」「いずみ野線」「東西線」。
 *   ほかの形より**弱い**（`tier: 2`）——「有楽町線」は東京メトロであって、「西武有楽町線」は名前で言い分ける
 */

import { JR_OPERATORS, OPERATOR_ALIASES, type RoutePair } from './aliases'

/** 照合の鍵。全角・空白・中黒・「の／ノ」「ヶ／ケ」・大文字小文字の違いを吸収する。 */
export function nameKey(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s・･]/gu, '')
    .replace(/の/gu, 'ノ')
    .replace(/ヶ/gu, 'ケ')
    .toLowerCase()
}

/** 路線の一覧（`route_names()`）の 1 行。 */
export type CatalogRoute = {
  readonly route: string
  readonly stationCount: number
  readonly operators: readonly string[]
  readonly routeTypes: readonly number[]
}

/** 会社の一覧（`operator_names()`）の 1 行。 */
export type CatalogOperator = {
  readonly name: string
  readonly stationCount: number
  readonly prefectures: readonly string[]
}

export type RouteCatalog = {
  readonly routes: readonly CatalogRoute[]
  readonly operators: readonly CatalogOperator[]
}

/** 照合の形が当たった会社 × 路線。`tier` が小さいほど強い（1＝正式名・番号外し・本線、2＝会社名外し）。 */
export type FormHit = { readonly pair: RoutePair; readonly tier: 1 | 2 }

export function isJrOperator(operator: string): boolean {
  return JR_OPERATORS.includes(operator)
}

/** 番号を外した形（「4号線丸ノ内線」→「丸ノ内線」・「2号線(谷町線)」→「谷町線」）。外せなければ null。 */
function withoutLineNumber(route: string): string | null {
  const parenthesized = route.match(/\(([^()]+)\)$/u)
  if (parenthesized?.[1] !== undefined) return parenthesized[1]
  const bare = route.replace(/^\d+号線/u, '')
  return bare !== route && bare.length > 0 ? bare : null
}

/**
 * 会社の言い方（正式名と、その会社を指す別名）。会社名を外した形・会社の本線を探すのに使う。
 * 「JR」のように複数社を指す別名も含める（JR 西日本の「JR東西線」→「東西線」）。
 */
export function operatorPrefixes(operator: string): string[] {
  const aliases = Object.entries(OPERATOR_ALIASES)
    .filter(([, targets]) => targets.includes(operator))
    .map(([alias]) => alias)
  return [operator, ...aliases]
}

/** 「本線」と「線」の言い換え（JR は X線 → X本線、私鉄は X本線 → X線。会社名だけになる形は作らない）。 */
function lineSuffixVariant(route: string, operator: string): string | null {
  if (isJrOperator(operator)) {
    return /線$/u.test(route) && !/(本|新幹)線$/u.test(route) ? route.replace(/線$/u, '本線') : null
  }
  const stem = route.match(/^(.+)本線$/u)?.[1]
  if (stem === undefined) return null
  // 「相鉄本線」→「相鉄線」は作らない（「相鉄線」は相鉄の全路線を指す言い方）。
  const isOperatorName = operatorPrefixes(operator).some((prefix) => prefix === stem)
  return isOperatorName ? null : `${stem}線`
}

/** 会社名を外した形（「東急多摩川線」→「多摩川線」）。残りが短すぎる・「本線」だけのときは作らない。 */
function withoutOperatorName(route: string, operator: string): string | null {
  const prefix = operatorPrefixes(operator).find(
    (name) => route.startsWith(name) && route.length > name.length,
  )
  if (prefix === undefined) return null
  const rest = route.slice(prefix.length)
  return rest.length >= 3 && rest !== '本線' ? rest : null
}

/** 1 つの会社 × 路線から作る照合の形。 */
function formsOf(pair: RoutePair): { readonly key: string; readonly tier: 1 | 2 }[] {
  const strong = [
    pair.route,
    withoutLineNumber(pair.route),
    lineSuffixVariant(pair.route, pair.operator),
  ]
  const weak = [withoutOperatorName(pair.route, pair.operator)]
  return [
    ...strong.flatMap((form) => (form === null ? [] : [{ key: nameKey(form), tier: 1 as const }])),
    ...weak.flatMap((form) => (form === null ? [] : [{ key: nameKey(form), tier: 2 as const }])),
  ]
}

export function samePair(a: RoutePair, b: RoutePair): boolean {
  return a.operator === b.operator && a.route === b.route
}

/** データの全路線の照合の形 → 当たる会社 × 路線（鍵ごと・同じ組は 1 回・強い形が先）。 */
export type RouteFormIndex = ReadonlyMap<string, readonly FormHit[]>

export function routeFormIndex(routes: readonly CatalogRoute[]): RouteFormIndex {
  const hits = routes
    .flatMap((row) => row.operators.map((operator) => ({ operator, route: row.route })))
    .flatMap((pair) =>
      formsOf(pair).map((form) => ({ key: form.key, hit: { pair, tier: form.tier } })),
    )
  return hits.reduce((index, { key, hit }) => {
    const existing = index.get(key) ?? []
    if (existing.some((other) => samePair(other.pair, hit.pair))) return index
    return index.set(key, [...existing, hit])
  }, new Map<string, readonly FormHit[]>())
}

/** 会社の言い方（正式名・別名）の鍵 → 正式名。データに無い会社を指す別名は落とす。 */
export function operatorKeyIndex(
  operators: readonly CatalogOperator[],
): ReadonlyMap<string, readonly string[]> {
  const known = new Set(operators.map((operator) => operator.name))
  const aliases = Object.entries(OPERATOR_ALIASES)
    .map(
      ([alias, targets]) =>
        [nameKey(alias), targets.filter((target) => known.has(target))] as const,
    )
    .filter(([, present]) => present.length > 0)
  const names = [...known].map((name) => [nameKey(name), [name]] as const)
  return new Map<string, readonly string[]>([...aliases, ...names])
}
