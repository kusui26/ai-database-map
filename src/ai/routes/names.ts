/**
 * 会社・路線の名前の照合の土台（純関数・2026-10-07 B1 → 2026-10-08 L3）。
 *
 * 路線は駅データ.jp の路線（運行系統・`line_names()`）。返すのは**いつもデータの路線**で、ここで作るのは
 * 照合のための鍵と索引だけ（新しい名前は作らない）。路線名から、利用者が言いそうな形を規則で作る：
 *
 * - 会社名を省く：「JR山手線」→「山手線」、「東京メトロ丸ノ内線」→「丸ノ内線」、「都営浅草線」→「浅草線」
 * - 括弧書きを省く：「JR中央線(快速)」→「JR中央線」「中央線」（「中央線快速」とも）、区間名・系統番号も同じ。
 *   括弧の中の別名（「三角線（あまくさみすみ線）」）も名前にする
 * - 会社名を足す：会社名の無い路線名（JR の「宇都宮線」・神戸電鉄の「三田線」）に「JR宇都宮線」「神鉄三田線」
 * - 「本線」と「線」：「東海道線」→「JR東海道本線(…)」、「東上本線」→「東武東上線」——**弱い**（`tier: 2`）。
 *   「中央線」は「JR中央線(快速)」（強い）に当て、「JR中央本線(東京～塩尻)」（弱い）には当てない
 * - **会社名を含むのが正式名の路線**（法令上の名前＝S12 が「西武有楽町線」「東急多摩川線」「JR東西線」）は、
 *   会社名を省いた形を弱くする。会社が名前を言い分けているのは、その名前を先に持つ路線があるから
 *   （「有楽町線」は東京メトロ、「東西線」は東京メトロ・札幌・仙台・京都）
 */

import { JR_OPERATORS, OPERATOR_ALIASES } from './aliases'

/** 照合の鍵。全角・空白・中黒・波ダッシュ・「の／ノ」「ヶ／ケ」・大文字小文字の違いを吸収する。 */
export function nameKey(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s・･]/gu, '')
    .replace(/〜/gu, '~')
    .replace(/の/gu, 'ノ')
    .replace(/ヶ/gu, 'ケ')
    .toLowerCase()
}

/** 路線の一覧（`line_names()`）の 1 行のうち、照合に使うもの。 */
export type CatalogLine = {
  readonly lineCd: number
  readonly name: string
  readonly formalName: string
  readonly companyName: string
  readonly companyShort: string
  /** S12 の会社名（線路の持ち主の路線など、駅の会社が別のときは null）。 */
  readonly operator: string | null
  readonly stationCount: number
  /** 駅のある都道府県（駅の多い順）。 */
  readonly prefectures: readonly string[]
}

/** 会社の一覧（`operator_names()`・S12 の会社名）の 1 行。 */
export type CatalogOperator = {
  readonly name: string
  readonly stationCount: number
  readonly prefectures: readonly string[]
}

/** 法令上の路線（S12・`route_names()`）。会社名を含むのが正式名かどうかを見るのに使う。 */
export type CatalogLegalRoute = { readonly route: string; readonly operators: readonly string[] }

export type NameCatalog = {
  readonly lines: readonly CatalogLine[]
  readonly operators: readonly CatalogOperator[]
  readonly legalRoutes: readonly CatalogLegalRoute[]
}

/** 照合の形の強さ（1＝名前・会社名や括弧書きの省略・別名、2＝本線／線の言い換え・正式名の会社名の省略）。 */
export type FormTier = 1 | 2

export function isJrOperator(operator: string | null): boolean {
  return operator !== null && JR_OPERATORS.includes(operator)
}

/** 会社名だけ・「線」だけのような、路線を指さない形。 */
const GENERIC_FORMS: ReadonlySet<string> = new Set(['線', '本線', '支線', '鉄道線', '電鉄', '電軌'])
/** 会社名を省いた形の最短の長さ（「東横線」＝3）。 */
const MIN_CORE_LENGTH = 3

/** 末尾の括弧書き（区間・系統・快速・別名）を分ける。鍵の上で行う（全角括弧は NFKC で半角になる）。 */
export function splitQualifier(key: string): {
  readonly base: string
  readonly qualifier: string | null
} {
  const match = key.match(/^(.+?)[(【](.+)[)】]$/u)
  if (match?.[1] === undefined || match[2] === undefined) return { base: key, qualifier: null }
  return { base: match[1], qualifier: match[2] }
}

/** 括弧の中が別名か（「あまくさみすみ線」「都電荒川線」「宮島線」。区間・系統・支線・快速は名前ではない）。 */
function isAlternativeName(qualifier: string): boolean {
  return /線$/u.test(qualifier) && !/[~]|系統|支線$/u.test(qualifier)
}

/** 会社名の略し方（「京福電気鉄道」→「京福電鉄」・「長崎電気軌道」→「長崎電軌」）。 */
function abbreviations(name: string): string[] {
  return [name, name.replace('電気鉄道', '電鉄').replace('電気軌道', '電軌')]
}

/** その会社を指す別名（`OPERATOR_ALIASES` で S12 の会社名へ向くもの）。 */
function aliasesOf(operator: string | null): string[] {
  if (operator === null) return []
  return Object.entries(OPERATOR_ALIASES)
    .filter(([, targets]) => targets.includes(operator))
    .map(([alias]) => alias)
}

/** 路線の頭に付きうる会社名の鍵（長い順）。事業者名・略称・S12 の会社名・その別名。 */
export function companyPrefixes(line: CatalogLine): string[] {
  const names = [
    line.companyName,
    line.companyShort,
    line.operator ?? '',
    ...aliasesOf(line.operator),
  ]
  const keys = names
    .flatMap(abbreviations)
    .filter((name) => name.length > 0)
    .map(nameKey)
  return [...new Set(keys)].sort((a, b) => b.length - a.length)
}

/** 残りが路線を指すか（会社名だけ・「線」だけ・短すぎる形は指さない）。 */
function isLineName(rest: string): boolean {
  const { base } = splitQualifier(rest)
  return base.length >= MIN_CORE_LENGTH && !GENERIC_FORMS.has(base)
}

/**
 * 会社名を省いた形（「jr中央線(快速)」→「中央線(快速)」）。当てはまる会社名**すべて**で作る——
 * JR 東海の「jr東海道本線(熱海~浜松)」は「jr東海」でも「jr」でも始まり、正しいのは「jr」を省いた「東海道本線…」。
 */
export function withoutCompany(key: string, prefixes: readonly string[]): string[] {
  const rests = prefixes
    .filter((prefix) => key.startsWith(prefix) && key.length > prefix.length)
    .map((prefix) => key.slice(prefix.length))
  return rests.filter(isLineName)
}

/** 名前そのものの形（正式名・括弧書きを省いた形・括弧書きを付けた形・括弧の中の別名）。 */
function ownForms(line: CatalogLine): string[] {
  return [line.name, line.formalName].map(nameKey).flatMap((key) => {
    const { base, qualifier } = splitQualifier(key)
    if (qualifier === null) return [key]
    const alternative = isAlternativeName(qualifier) ? [qualifier] : []
    return [key, base, `${base}${qualifier}`, ...alternative]
  })
}

/** 「本線」と「線」の言い換え（括弧書きは残す）。会社名だけになる形（「京急線」）・新幹線は作らない。 */
export function lineSuffixVariant(form: string, prefixes: readonly string[]): string | null {
  const { base, qualifier } = splitQualifier(form)
  const tail = qualifier === null ? '' : `(${qualifier})`
  const stem = base.match(/^(.+?)(本線|線)$/u)
  if (stem?.[1] === undefined || base.endsWith('新幹線')) return null
  if (stem[1].length < 2 || prefixes.includes(stem[1])) return null
  return `${stem[1]}${stem[2] === '本線' ? '線' : '本線'}${tail}`
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function present<T>(item: T | null): item is T {
  return item !== null
}

/** 照合の形 1 つ（鍵と強さ）。 */
export type LineForm = { readonly key: string; readonly tier: FormTier }

/**
 * 1 本の路線から作る照合の形。`legalCompanyName`＝会社名を含むのが正式名（会社名を省いた形を弱くする）。
 * 会社名を足す形は、会社名で始まらない名前（「宇都宮線」→「jr宇都宮線」）にだけ作る。
 */
export function lineForms(line: CatalogLine, legalCompanyName: boolean): LineForm[] {
  const prefixes = companyPrefixes(line)
  const own = ownForms(line)
  const cores = own.flatMap((form) => withoutCompany(form, prefixes))
  const bare = own.filter((form) => !prefixes.some((prefix) => form.startsWith(prefix)))
  const added = bare.flatMap((form) => prefixes.map((prefix) => `${prefix}${form}`))
  const strong = unique([...own, ...(legalCompanyName ? [] : cores), ...added])
  const variants = [...strong, ...cores].map((form) => lineSuffixVariant(form, prefixes))
  const weak = unique([...(legalCompanyName ? cores : []), ...variants.filter(present)])
  return [
    ...strong.map((key): LineForm => ({ key, tier: 1 })),
    ...weak.filter((key) => !strong.includes(key)).map((key): LineForm => ({ key, tier: 2 })),
  ]
}

/** S12 の会社名 → その会社の法令上の路線名の鍵。 */
export type LegalNameIndex = ReadonlyMap<string, ReadonlySet<string>>

export function legalNameIndex(routes: readonly CatalogLegalRoute[]): LegalNameIndex {
  const pairs = routes.flatMap((row) =>
    row.operators.map((operator) => [operator, row.route] as const),
  )
  return pairs.reduce((index, [operator, route]) => {
    const keys = new Set(index.get(operator) ?? [])
    return index.set(operator, keys.add(nameKey(route)))
  }, new Map<string, ReadonlySet<string>>())
}

/**
 * 会社名を含むのが正式名か（S12 にその会社の同じ名前の路線がある：「西武有楽町線」「東急多摩川線」「JR東西線」）。
 * 会社名を省いた形（「有楽町線」）は、その名前を先に持つ路線（東京メトロ）に譲る。
 */
export function hasLegalCompanyName(line: CatalogLine, legal: LegalNameIndex): boolean {
  const routes = legal.get(line.operator ?? '')
  if (routes === undefined) return false
  const bases = [line.name, line.formalName].map((name) => splitQualifier(nameKey(name)).base)
  return bases.some(
    (base) => routes.has(base) && withoutCompany(base, companyPrefixes(line)).length > 0,
  )
}

/**
 * 1 本の路線として束ねる鍵。同じ会社（JR は 6 社で 1 つ）の、括弧書きを除いた名前・会社名を省いた名前が
 * 同じなら同じ路線（「JR東海道本線(東京～熱海)」と「(熱海～浜松)」、正式名が「JR東海道本線(京都～大阪)」の
 * 「JR京都線」）。束ねるのは**当たった路線の中だけ**（`match.ts`）——東海道本線と山陽本線は混ざらない。
 */
export function groupKeys(line: CatalogLine): string[] {
  const family = isJrOperator(line.operator) ? 'JR' : (line.operator ?? line.companyName)
  const prefixes = companyPrefixes(line)
  const bases = [line.name, line.formalName].map((name) => splitQualifier(nameKey(name)).base)
  const cores = bases.flatMap((base) => withoutCompany(base, prefixes))
  return unique([...bases, ...cores]).map((key) => `${family}|${key}`)
}

/** 会社の言い方と、それが指す S12 の会社名。 */
type OperatorName = readonly [name: string, operators: readonly string[]]

/** 路線の事業者名・略称（とその略し方）→ S12 の会社名（線路の持ち主の路線など、会社が無いものは除く）。 */
function companyNamesOf(line: CatalogLine, known: ReadonlySet<string>): OperatorName[] {
  const operator = line.operator
  if (operator === null || !known.has(operator)) return []
  return [line.companyName, line.companyShort]
    .flatMap(abbreviations)
    .map((name): OperatorName => [name, [operator]])
}

/**
 * 会社の言い方の鍵 → S12 の会社名。S12 の会社名・駅データ.jp の事業者名と略称（とその略し方）・別名表。
 * データに無い会社を指す別名は落とす。同じ鍵が複数の言い方から来たら、指す会社を合わせる。
 */
export function operatorNameIndex(catalog: NameCatalog): ReadonlyMap<string, readonly string[]> {
  const known = new Set(catalog.operators.map((operator) => operator.name))
  const fromLines = catalog.lines.flatMap((line) => companyNamesOf(line, known))
  const aliases = Object.entries(OPERATOR_ALIASES).map(([alias, targets]): OperatorName => [
    alias,
    targets.filter((target) => known.has(target)),
  ])
  const names = [...known].map((name): OperatorName => [name, [name]])
  return [...fromLines, ...aliases, ...names].reduce((index, [name, targets]) => {
    if (targets.length === 0) return index
    const key = nameKey(name)
    return index.set(key, unique([...(index.get(key) ?? []), ...targets]))
  }, new Map<string, readonly string[]>())
}
