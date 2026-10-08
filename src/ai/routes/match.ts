/**
 * 1 つの名前（会社・路線）を、データの会社・路線に当てる（純関数・2026-10-07 B1 → 2026-10-08 L3）。
 *
 * 路線は駅データ.jp の路線（運行系統）。当たった路線を「利用者にとって 1 本の路線」に束ねる——
 * 区間に分かれた路線（JR東海道本線の 4 区間と、正式名がその区間の「琵琶湖線」「JR京都線」）は 1 本。
 * 束ねたあとで 2 本以上なら、利用者にとって別の路線が同じ名前を持っている（「山手線」＝JR・神戸市営地下鉄）——
 * どれかを推測で選ばず、決めるのは呼び出し側（`resolve.ts`：都道府県・地図の範囲・聞き返し）。
 *
 * 当て方の順：①名前の形・別名（`names.ts`）②会社名だけ（「小田急」）③頭の会社名（「東京急行電鉄東横線」→
 * 東急電鉄の中で「東横線」）④「線」を補う（「東横」）。強い形で当たれば弱い形（本線／線の言い換えなど）は
 * 候補に残すだけ（`weak`）。強い形で何も当たらなければ、弱い形が候補になる。
 */

import { CATEGORY_WORD_HINTS, LINE_ALIASES } from './aliases'
import {
  companyPrefixes,
  groupKeys,
  hasLegalCompanyName,
  legalNameIndex,
  lineForms,
  nameKey,
  operatorNameIndex,
  splitQualifier,
  withoutCompany,
  type CatalogLine,
  type FormTier,
  type NameCatalog,
} from './names'

/** 照合の形で当たった路線と、その強さ。 */
type LineHit = { readonly line: CatalogLine; readonly tier: FormTier }

/** 照合に使う索引（データの一覧から 1 回だけ作る）。 */
export type NameIndex = {
  readonly catalog: NameCatalog
  /** 照合の形の鍵 → 当たる路線（路線ごとに強いほう）。 */
  readonly lineForms: ReadonlyMap<string, readonly LineHit[]>
  /** 路線名（そのまま）→ 路線。別名表の行き先を引く。 */
  readonly linesByName: ReadonlyMap<string, CatalogLine>
  /** 路線コード → 束ねる鍵（`groupKeys`）。 */
  readonly groups: ReadonlyMap<number, readonly string[]>
  /** 会社の言い方の鍵 → S12 の会社名。 */
  readonly operatorKeys: ReadonlyMap<string, readonly string[]>
  /** 会社の言い方の鍵（長い順）。名前の頭の会社名を探す。 */
  readonly operatorPrefixKeys: readonly string[]
}

function addHit(
  index: Map<string, readonly LineHit[]>,
  key: string,
  hit: LineHit,
): Map<string, readonly LineHit[]> {
  const existing = index.get(key) ?? []
  const same = existing.find((other) => other.line.lineCd === hit.line.lineCd)
  if (same !== undefined && same.tier <= hit.tier) return index
  const others = existing.filter((other) => other.line.lineCd !== hit.line.lineCd)
  return index.set(key, [...others, hit])
}

/** 全路線の照合の形の索引。会社名を含むのが正式名の路線は、会社名を省いた形を弱くする。 */
function lineFormIndex(catalog: NameCatalog): ReadonlyMap<string, readonly LineHit[]> {
  const legal = legalNameIndex(catalog.legalRoutes)
  return catalog.lines
    .flatMap((line) =>
      lineForms(line, hasLegalCompanyName(line, legal)).map((form) => ({ form, line })),
    )
    .reduce(
      (index, { form, line }) => addHit(index, form.key, { line, tier: form.tier }),
      new Map<string, readonly LineHit[]>(),
    )
}

export function buildNameIndex(catalog: NameCatalog): NameIndex {
  const operatorKeys = operatorNameIndex(catalog)
  return {
    catalog,
    lineForms: lineFormIndex(catalog),
    linesByName: new Map(catalog.lines.map((line) => [line.name, line])),
    groups: new Map(catalog.lines.map((line) => [line.lineCd, groupKeys(line)])),
    operatorKeys,
    operatorPrefixKeys: [...operatorKeys.keys()].sort((a, b) => b.length - a.length),
  }
}

/** 利用者にとって 1 本の路線。`widened`＝別名が路線の一部を指す（集計範囲が広がる・`aliases.ts`）。 */
export type LineIdentity = { readonly lines: readonly CatalogLine[]; readonly widened: boolean }

export type OperatorMatch =
  | { readonly kind: 'operators'; readonly operators: readonly string[] }
  | { readonly kind: 'category'; readonly hint: string }
  | { readonly kind: 'unknown'; readonly didYouMean: readonly string[] }

export type LineMatch =
  /** 当たった路線。`strong` が 2 本以上なら同じ名前の別路線。`weak` は弱い形で当たった別の路線。 */
  | {
      readonly kind: 'lines'
      readonly strong: readonly LineIdentity[]
      readonly weak: readonly LineIdentity[]
    }
  /** 会社の全路線（「小田急」「東急線」）。 */
  | { readonly kind: 'operators'; readonly operators: readonly string[] }
  | { readonly kind: 'category'; readonly hint: string }
  | { readonly kind: 'unknown'; readonly didYouMean: readonly string[] }

/** 会社の範囲（null＝全社）。線路の持ち主の路線（会社が null）は、会社を指定すると範囲の外。 */
export type Scope = readonly string[] | null

function inScope(line: CatalogLine, scope: Scope): boolean {
  return scope === null || (line.operator !== null && scope.includes(line.operator))
}

function sameGroup(a: CatalogLine, b: CatalogLine, index: NameIndex): boolean {
  const keys = index.groups.get(a.lineCd) ?? []
  return (index.groups.get(b.lineCd) ?? []).some((key) => keys.includes(key))
}

/** 当たった路線を、1 本の路線に束ねる（束ねるのは当たった路線の中だけ・現れた順）。 */
export function identitiesOf(lines: readonly CatalogLine[], index: NameIndex): LineIdentity[] {
  const components = lines.reduce<CatalogLine[][]>((groups, line) => {
    const joined = groups.filter((group) => group.some((other) => sameGroup(other, line, index)))
    const rest = groups.filter((group) => !joined.includes(group))
    return [...rest, [...joined.flat(), line]]
  }, [])
  const order = (line: CatalogLine): number => lines.indexOf(line)
  const firstOf = (group: readonly CatalogLine[]): number => Math.min(...group.map(order))
  return components
    .map((group) => [...group].sort((a, b) => order(a) - order(b)))
    .sort((a, b) => firstOf(a) - firstOf(b))
    .map((group): LineIdentity => ({ lines: group, widened: false }))
}

/** 名前ではない言葉（新幹線・地下鉄…）の指定のしかた。 */
function categoryHint(key: string): string | null {
  const found = Object.entries(CATEGORY_WORD_HINTS).find(([word]) => nameKey(word) === key)
  return found?.[1] ?? null
}

/** 別名表で当たる路線（1 つの別名＝1 本の路線。行き先がデータに無い・範囲の外の路線は使わない）。 */
function aliasIdentities(key: string, index: NameIndex, scope: Scope): LineIdentity[] {
  return Object.entries(LINE_ALIASES)
    .filter(([alias]) => nameKey(alias) === key)
    .map(([, alias]): LineIdentity => {
      const lines = alias.lines.flatMap((name) => {
        const line = index.linesByName.get(name)
        return line !== undefined && inScope(line, scope) ? [line] : []
      })
      return { lines, widened: alias.widened === true }
    })
    .filter((identity) => identity.lines.length > 0)
}

/** すでに候補にある路線を外す（別名と形で同じ路線を 2 回数えない・強い候補の路線を弱い候補に入れない）。 */
function withoutTaken(
  lines: readonly CatalogLine[],
  taken: readonly LineIdentity[],
): CatalogLine[] {
  const codes = new Set(taken.flatMap((identity) => identity.lines.map((line) => line.lineCd)))
  return lines.filter((line) => !codes.has(line.lineCd))
}

/** 当たった形を強さで分ける。強い形で何も当たらなければ、弱い形が候補になる。 */
function tiered(hits: readonly LineHit[], aliased: LineIdentity[], index: NameIndex): LineMatch {
  const strongLines = withoutTaken(
    hits.filter((hit) => hit.tier === 1).map((hit) => hit.line),
    aliased,
  )
  const strong = [...aliased, ...identitiesOf(strongLines, index)]
  const weakLines = withoutTaken(
    hits.filter((hit) => hit.tier === 2).map((hit) => hit.line),
    strong,
  )
  const weak = identitiesOf(weakLines, index)
  return strong.length > 0
    ? { kind: 'lines', strong, weak }
    : { kind: 'lines', strong: weak, weak: [] }
}

/** 名前の形・別名で当たる路線（範囲で絞る）。 */
function formMatch(key: string, index: NameIndex, scope: Scope): LineMatch | null {
  const hits = (index.lineForms.get(key) ?? []).filter((hit) => inScope(hit.line, scope))
  const aliased = aliasIdentities(key, index, scope)
  if (hits.length === 0 && aliased.length === 0) return null
  return tiered(hits, aliased, index)
}

/** 会社の範囲の中の会社（範囲が無ければそのまま）。 */
function withinScope(operators: readonly string[], scope: Scope): string[] {
  return operators.filter((operator) => scope === null || scope.includes(operator))
}

/** 会社の名前だけが路線に渡された（routes:["小田急"]）＝その会社の全路線。 */
function operatorOnlyMatch(key: string, index: NameIndex, scope: Scope): LineMatch | null {
  const operators = withinScope(index.operatorKeys.get(key) ?? [], scope)
  return operators.length > 0 ? { kind: 'operators', operators } : null
}

/** 会社の「本線」（「京浜急行本線」→ 京急本線）。会社名つきの本線が 1 本に決まるときだけ。 */
function mainLineOf(operators: readonly string[], index: NameIndex): LineMatch | null {
  const lines = index.catalog.lines.filter((line) => {
    if (line.operator === null || !operators.includes(line.operator)) return false
    const { base } = splitQualifier(nameKey(line.name))
    return companyPrefixes(line).some((prefix) => base === `${prefix}本線`)
  })
  return lines.length === 1
    ? tiered(
        lines.map((line) => ({ line, tier: 1 })),
        [],
        index,
      )
    : null
}

/** 頭の会社名を外した残りを、その会社の中で当てる（「東京急行電鉄東横線」「都営地下鉄三田線」）。 */
function restMatch(rest: string, operators: readonly string[], index: NameIndex): LineMatch | null {
  if (rest === '線') return { kind: 'operators', operators }
  if (rest === '本線') return mainLineOf(operators, index)
  return formMatch(rest, index, operators) ?? withLineSuffix(rest, index, operators)
}

/**
 * 頭の会社名を外して、残りを路線として当てる。会社名は長い順に試す（「jr東海道線」は「jr東海」でも「jr」でも始まる）。
 * 会社名は分かったのに残りが当たらないときは、その会社の路線から近いものを返す（「東武本線」）。
 */
function prefixMatch(key: string, index: NameIndex, scope: Scope): LineMatch | null {
  const attempts = index.operatorPrefixKeys
    .filter((prefix) => key.startsWith(prefix) && key !== prefix)
    .map((prefix) => ({
      rest: key.slice(prefix.length),
      operators: withinScope(index.operatorKeys.get(prefix) ?? [], scope),
    }))
    .filter((attempt) => attempt.operators.length > 0)
  const matched = attempts
    .map((attempt) => restMatch(attempt.rest, attempt.operators, index))
    .find((match): match is LineMatch => match !== null)
  if (matched !== undefined) return matched
  const first = attempts[0]
  if (first === undefined) return null
  return { kind: 'unknown', didYouMean: suggestInCompany(first.rest, index, first.operators) }
}

/** 「線」を補って当てる（「東横」→「東横線」）。 */
function withLineSuffix(key: string, index: NameIndex, scope: Scope): LineMatch | null {
  if (/(線|ライン|ライナー)$/u.test(key)) return null
  return formMatch(`${key}線`, index, scope)
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

/** 近い路線名（路線名と、会社名を省いた名前で比べる）。 */
function suggestLines(key: string, index: NameIndex, scope: Scope): string[] {
  const options = index.catalog.lines
    .filter((line) => inScope(line, scope))
    .flatMap((line) => {
      const own = nameKey(line.name)
      const cores = withoutCompany(own, companyPrefixes(line))
      return [own, ...cores].map((form) => ({ key: form, name: line.name }))
    })
  return nearest(key, options)
}

/**
 * 会社は分かったのに路線が当たらないとき（「東武本線」）の候補：近い名前に、その会社の駅の多い路線を足す
 * （「本線」のような言い方は名前の近さでは何も拾えない）。
 */
function suggestInCompany(rest: string, index: NameIndex, operators: readonly string[]): string[] {
  const biggest = index.catalog.lines
    .filter((line) => line.operator !== null && operators.includes(line.operator))
    .sort((a, b) => b.stationCount - a.stationCount)
    .map((line) => line.name)
  const names = [...suggestLines(rest, index, operators), ...biggest]
  return [...new Set(names)].slice(0, MAX_SUGGESTIONS)
}

function suggestOperators(key: string, index: NameIndex): string[] {
  const options = [...index.operatorKeys.entries()].flatMap(([aliasKey, names]) =>
    names.map((name) => ({ key: aliasKey, name })),
  )
  return nearest(key, options)
}

/** 会社の名前を S12 の会社名へ（「東急」「東京急行電鉄」→ 東急電鉄・「JR」→ JR 各社・「東急線」も会社）。 */
export function matchOperator(input: string, index: NameIndex): OperatorMatch {
  const key = nameKey(input)
  const hint = categoryHint(key)
  if (hint !== null) return { kind: 'category', hint }
  const found = index.operatorKeys.get(key) ?? index.operatorKeys.get(key.replace(/線$/u, ''))
  if (found !== undefined) return { kind: 'operators', operators: found }
  return { kind: 'unknown', didYouMean: suggestOperators(key, index) }
}

/** 利用者の言い方の飾り（「東横線沿線」「東横線の沿線」「東横線の駅」「東横線沿線の駅」）を外す。 */
function withoutDecoration(input: string): string {
  return input.trim().replace(/(?:の?沿線)?(?:の各駅|の駅)?$/u, '')
}

/** 路線の名前を、データの路線へ。`scope` は会社の範囲（`operators` の指定・null＝全社）。 */
export function matchLine(input: string, index: NameIndex, scope: Scope): LineMatch {
  const key = nameKey(withoutDecoration(input))
  const hint = categoryHint(key)
  if (hint !== null) return { kind: 'category', hint }
  const matched =
    formMatch(key, index, scope) ??
    operatorOnlyMatch(key, index, scope) ??
    prefixMatch(key, index, scope) ??
    withLineSuffix(key, index, scope)
  return matched ?? { kind: 'unknown', didYouMean: suggestLines(key, index, scope) }
}
