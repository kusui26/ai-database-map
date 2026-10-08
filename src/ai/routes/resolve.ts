/**
 * ツール 1 回分の会社・路線の指定を、データの会社と路線（運行系統）へ解決する
 * （2026-10-07 B1 → 2026-10-08 L3・計画書 §6.8.5〜§6.8.6）。
 *
 * - 決まれば、会社（S12 の会社名）か路線（路線コードと名前）と、どう読んだかの説明（`notes`・LLM が本文で
 *   正しい名前を使えるように）
 * - 決まらなければ、**図を作らずに**候補つきの理由を返す（`problems`）。推測で 1 つ選ばない
 *
 * 同じ名前の路線（「山手線」＝JR・神戸市営地下鉄、「中央線」＝JR中央線(快速)・大阪メトロ中央線）は、
 * **明示の都道府県 → 地図の表示範囲**の順に絞り、1 本に決まらなければ聞き返す。名前ごとの既定（「山手線＝JR」）は
 * 持たない——大阪を見ている人の「中央線」は大阪メトロ。区間に分かれた路線（JR東海道本線）は 1 本として扱い、
 * 地図の範囲で区間を絞る。
 *
 * 路線を決めたら、会社は条件に入れない。路線コードが駅の集合を決めるので、会社を掛け合わせると他社の駅を通る路線
 * （北陸新幹線の金沢・相鉄・JR直通線の武蔵小杉）の駅が落ちる。会社の指定は、名前を当てる範囲にだけ使う。
 */

import { MAX_LINES_PER_QUERY } from '@/shared/constants'
import { type LineRef } from '@/shared/api'
import { type Viewport } from '@/shared/viewport'
import {
  matchLine,
  matchOperator,
  type LineIdentity,
  type LineMatch,
  type NameIndex,
} from './match'
import { operatorLabelOf } from '@/domain/operators'
import { companyPrefixes, isJrOperator, nameKey, type CatalogLine } from './names'

export type NameResolveDeps = {
  /** 照合の索引（データの一覧から作る）。 */
  readonly index: () => Promise<NameIndex>
  /** 路線（束ねたもの）の駅の数（重なる駅は 1 つ）。 */
  readonly countStations: (lineCds: readonly number[]) => Promise<number>
  /** 路線（束ねたもの）の駅が、範囲の中に 1 つでもあるか。 */
  readonly hasStationsIn: (lineCds: readonly number[], viewport: Viewport) => Promise<boolean>
}

export type NameRequest = {
  readonly operators?: readonly string[]
  readonly routes?: readonly string[]
  /** 正規化済みの都道府県（同じ名前の路線を絞るのに使う・地図の範囲より強い）。 */
  readonly prefectures: readonly string[]
  /** 地図の表示範囲（チャットの送信に同送される。MCP には無い）。 */
  readonly viewport?: Viewport | null
}

/** 会社（S12 の会社名）か路線（運行系統）のどちらか（両方は入れない・路線が駅の集合を決める）。 */
export type NameFilters = { readonly operators: string[]; readonly lines: LineRef[] }

/** 呼び直しにそのまま使える候補。 */
export type NameCandidate = {
  readonly routes: readonly string[]
  readonly operators: readonly string[]
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
/** 説明に並べるほかの候補の数（多ければ「など」）。 */
const MAX_LISTED = 3

const NAME_HINT =
  'problems の各項目を見て呼び直してください。candidates は呼び直しにそのまま使える routes（と operators）です。' +
  '会話から地域や会社が分かるときだけ選び（地域が分かれば prefectures を添えてもよい）、分からなければどの路線かを利用者に聞いてください（推測で選ばない。地図の表示範囲はもう使ってあり、それでも決まらなかった候補です）。' +
  'didYouMean は近い路線名・会社名です。'

/** 名前を当てる範囲（都道府県は明示の指定、地図の範囲はチャットの同送）。 */
type Area = { readonly prefectures: readonly string[]; readonly viewport: Viewport | null }

type RouteOutcome =
  | {
      readonly kind: 'lines'
      readonly lines: readonly CatalogLine[]
      readonly notes: readonly string[]
    }
  | {
      readonly kind: 'operators'
      readonly operators: readonly string[]
      readonly notes: readonly string[]
    }
  | { readonly kind: 'problem'; readonly problem: NameProblem }

type OperatorOutcome = {
  /** 会社の指定（無ければ null＝全社）。 */
  readonly scope: string[] | null
  readonly problems: NameProblem[]
  readonly notes: string[]
}

type LinesMatch = Extract<LineMatch, { kind: 'lines' }>

/** 同じ名前の路線から 1 本を選んだ理由（null＝候補が 1 本だった）。 */
type ChoiceReason = 'prefectures' | 'viewport' | null

type Decision =
  | {
      readonly kind: 'chosen'
      readonly identity: LineIdentity
      readonly reason: ChoiceReason
      /** 選ばなかったほかの候補（説明に使う）。 */
      readonly others: readonly LineIdentity[]
    }
  | {
      readonly kind: 'ask'
      readonly problem: string
      readonly candidates: readonly LineIdentity[]
    }

/** 範囲で絞った結果：範囲に合う最初の層の路線と、それより弱い層で範囲に合う路線。 */
type Narrowed = {
  readonly identities: readonly LineIdentity[]
  readonly lower: readonly LineIdentity[]
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function trimmed(inputs: readonly string[] | undefined): string[] {
  return (inputs ?? []).map((input) => input.trim()).filter((input) => input.length > 0)
}

function codesOf(lines: readonly CatalogLine[]): number[] {
  return lines.map((line) => line.lineCd)
}

/** 会社の表示名の並び（説明に使う：「東京地下鉄」ではなく「東京メトロ」・L4）。 */
function operatorsLabel(operators: readonly string[], index: NameIndex): string {
  return operators.map((name) => operatorLabelOf(name, index.operatorLabels)).join('・')
}

// --- 候補（聞き返しに使う） ----------------------------------------------------

/** 名前だけで（会社の範囲も地図も無しに）その 1 本に決まるか。 */
function resolvesTo(name: string, line: CatalogLine, index: NameIndex): boolean {
  const match = matchLine(name, index, null)
  if (match.kind !== 'lines' || match.strong.length !== 1) return false
  const lines = match.strong[0]?.lines ?? []
  return lines.length === 1 && lines[0]?.lineCd === line.lineCd
}

/**
 * 呼び直しにそのまま使える言い方（名前だけで 1 本に決まるもの）。「三田線」は都営と神戸電鉄にあるので
 * 「神鉄三田線」（正式名）、JR の「宇都宮線」は東武にもあるので「JR宇都宮線」。どれでも決まらなければ会社を添える。
 */
function handleOf(
  line: CatalogLine,
  index: NameIndex,
): { readonly route: string; readonly operators: readonly string[] } {
  const prefixes = isJrOperator(line.operator) ? ['JR'] : [line.companyShort, line.companyName]
  const names = [line.name, line.formalName, ...prefixes.map((prefix) => `${prefix}${line.name}`)]
  const found = names.find((name) => resolvesTo(name, line, index))
  if (found !== undefined) return { route: found, operators: [] }
  return { route: line.name, operators: line.operator === null ? [] : [line.operator] }
}

async function candidateOf(
  identity: LineIdentity,
  index: NameIndex,
  deps: NameResolveDeps,
): Promise<NameCandidate> {
  const handles = identity.lines.map((line) => handleOf(line, index))
  const [only] = identity.lines
  const stationCount =
    identity.lines.length === 1 && only !== undefined
      ? only.stationCount
      : await deps.countStations(codesOf(identity.lines))
  return {
    routes: handles.map((handle) => handle.route),
    operators: unique(handles.flatMap((handle) => handle.operators)),
    stationCount,
    prefectures: unique(identity.lines.flatMap((line) => line.prefectures)),
  }
}

function candidatesOf(
  identities: readonly LineIdentity[],
  index: NameIndex,
  deps: NameResolveDeps,
): Promise<NameCandidate[]> {
  return Promise.all(
    identities.slice(0, MAX_CANDIDATES).map((identity) => candidateOf(identity, index, deps)),
  )
}

// --- 同じ名前の路線から 1 本を決める ----------------------------------------------

function inPrefectures(identity: LineIdentity, prefectures: readonly string[]): boolean {
  return identity.lines.some((line) => line.prefectures.some((pref) => prefectures.includes(pref)))
}

async function inViewport(
  identities: readonly LineIdentity[],
  viewport: Viewport,
  deps: NameResolveDeps,
): Promise<LineIdentity[]> {
  const inside = await Promise.all(
    identities.map((identity) => deps.hasStationsIn(codesOf(identity.lines), viewport)),
  )
  return identities.filter((_, i) => inside[i] === true)
}

/**
 * 強い形の候補から順に、範囲に合う路線が 1 本でもある最初の層（無ければ null）。`lower` は、それより弱い層で
 * 範囲に合う路線（聞き返すときは候補に並べる：大阪で「東西線」なら、京都市営・神戸高速に JR東西線も）。
 */
async function firstTier(
  tiers: readonly (readonly LineIdentity[])[],
  keep: (identities: readonly LineIdentity[]) => Promise<LineIdentity[]>,
): Promise<Narrowed | null> {
  const kept = await Promise.all(tiers.map(keep))
  const tier = kept.findIndex((identities) => identities.length > 0)
  const identities = kept[tier]
  if (identities === undefined) return null
  return { identities, lower: kept.slice(tier + 1).flat() }
}

/** 範囲で絞った結果から決める（1 本なら決める・2 本以上なら範囲の中の候補で聞く）。 */
function fromNarrowed(
  input: string,
  narrowed: Narrowed,
  match: LinesMatch,
  reason: Exclude<ChoiceReason, null>,
  areaLabel: string,
): Decision {
  const [only] = narrowed.identities
  if (narrowed.identities.length === 1 && only !== undefined) {
    const others = [...match.strong, ...match.weak].filter((identity) => identity !== only)
    return { kind: 'chosen', identity: only, reason, others }
  }
  const candidates = [...narrowed.identities, ...narrowed.lower]
  const problem = `「${input}」に当たる路線が、${areaLabel}に複数あります（${candidates.length} 本）。`
  return { kind: 'ask', problem, candidates }
}

/** 範囲の手がかりが無い・効かないときは聞き返す（候補はすべて）。 */
function askAll(input: string, match: LinesMatch): Decision {
  const all = [...match.strong, ...match.weak]
  const problem = `「${input}」に当たる路線が複数あります（${all.length} 本）。`
  return { kind: 'ask', problem, candidates: all }
}

/** 明示の都道府県で絞る（2 本以上残れば、その中を地図の範囲でさらに絞る）。 */
async function byPrefectures(
  input: string,
  match: LinesMatch,
  area: Area,
  deps: NameResolveDeps,
): Promise<Decision> {
  const prefs = area.prefectures
  const keep = async (ids: readonly LineIdentity[]) => ids.filter((id) => inPrefectures(id, prefs))
  const narrowed = await firstTier([match.strong, match.weak], keep)
  if (narrowed === null) {
    const problem = `「${input}」に当たる路線は、${prefs.join('・')}に駅がありません。`
    return { kind: 'ask', problem, candidates: [...match.strong, ...match.weak] }
  }
  const viewport = area.viewport
  if (narrowed.identities.length > 1 && viewport !== null) {
    const inView = await inViewport(narrowed.identities, viewport, deps)
    const viewed = { identities: inView, lower: narrowed.lower }
    if (inView.length > 0) return fromNarrowed(input, viewed, match, 'viewport', '地図の表示範囲')
  }
  return fromNarrowed(input, narrowed, match, 'prefectures', prefs.join('・'))
}

/**
 * 1 本に決める。強い形で 1 本だけ当たればそれ（地図の範囲で別の路線に寄せない——大阪を見ていても
 * 「中央本線」は JR）。2 本以上なら、明示の都道府県 → 地図の表示範囲の順に絞り、決まらなければ聞き返す。
 */
async function decide(
  input: string,
  match: LinesMatch,
  area: Area,
  deps: NameResolveDeps,
): Promise<Decision> {
  const [only] = match.strong
  if (match.strong.length === 1 && only !== undefined) {
    return { kind: 'chosen', identity: only, reason: null, others: match.weak }
  }
  if (area.prefectures.length > 0) return byPrefectures(input, match, area, deps)
  const viewport = area.viewport
  if (viewport === null) return askAll(input, match)
  const keep = (ids: readonly LineIdentity[]) => inViewport(ids, viewport, deps)
  const narrowed = await firstTier([match.strong, match.weak], keep)
  if (narrowed === null) return askAll(input, match)
  return fromNarrowed(input, narrowed, match, 'viewport', '地図の表示範囲')
}

// --- 決めた路線の区間と説明 ----------------------------------------------------

/** 区間を絞った結果（残した区間と、範囲の外で外した区間）。 */
type Sections = { readonly lines: readonly CatalogLine[]; readonly dropped: readonly CatalogLine[] }

/**
 * 区間に分かれた路線（束ねた 2 本以上）を、範囲で絞る。都道府県なら駅のある区間だけ（駅の集合は変わらない＝
 * 題が短くなるだけ）。地図の範囲なら範囲に駅のある区間だけ（「東海道線」を首都圏で見ていれば東京〜熱海）。
 * どの区間も範囲に無い・すべてが範囲にあるなら絞らない。
 */
async function narrowSections(
  identity: LineIdentity,
  area: Area,
  deps: NameResolveDeps,
): Promise<Sections> {
  const all = identity.lines
  if (all.length < 2) return { lines: all, dropped: [] }
  if (area.prefectures.length > 0) {
    const kept = all.filter((line) => line.prefectures.some((p) => area.prefectures.includes(p)))
    return { lines: kept.length > 0 ? kept : all, dropped: [] }
  }
  const viewport = area.viewport
  if (viewport === null) return { lines: all, dropped: [] }
  const inside = await Promise.all(all.map((line) => deps.hasStationsIn([line.lineCd], viewport)))
  const kept = all.filter((_, i) => inside[i] === true)
  if (kept.length === 0 || kept.length === all.length) return { lines: all, dropped: [] }
  return { lines: kept, dropped: all.filter((line) => !kept.includes(line)) }
}

/** 説明に書く路線の名前（名前だけで 1 本に決まる言い方。「三田線」は「神鉄三田線」）。 */
function displayName(line: CatalogLine, index: NameIndex): string {
  const handle = handleOf(line, index)
  return handle.operators.length === 0 ? handle.route : `${line.name}（${line.companyName}）`
}

function namesLabel(lines: readonly CatalogLine[], index: NameIndex): string {
  return lines.map((line) => displayName(line, index)).join('・')
}

/** ほかの候補の並び（多ければ先頭だけ＋「など」）。 */
function othersLabel(identities: readonly LineIdentity[], index: NameIndex): string {
  const labels = identities.map((identity) => namesLabel(identity.lines, index))
  const listed = labels.slice(0, MAX_LISTED).join('、')
  return labels.length > MAX_LISTED ? `${listed} など` : listed
}

/** 同じ名前の路線から選んだ理由の説明（理由が無ければ null）。 */
function reasonNote(
  input: string,
  decision: Extract<Decision, { kind: 'chosen' }>,
  label: string,
  area: Area,
  index: NameIndex,
): string | null {
  if (decision.reason === null) return null
  const where = decision.reason === 'viewport' ? '地図の表示範囲' : area.prefectures.join('・')
  const others = othersLabel(decision.others, index)
  return `「${input}」に当たる路線が複数あるため、${where}に駅のある ${label} に決めました（ほかの候補：${others}）。`
}

/** 名前を読み替えたことの説明（言い方とデータの名前が同じなら書かない）。 */
function renamedNote(input: string, lines: readonly CatalogLine[], label: string): string | null {
  const same = lines.some((line) => nameKey(line.name) === nameKey(input))
  return same ? null : `「${input}」は ${label} として集計しました。`
}

/**
 * 会社の名前の路線（「小田急線」＝小田急小田原線・「京王線」）を指したとき、会社のほかの路線は含まないことの説明。
 * 「小田急線の沿線」は会社の全路線のつもりのこともあるので、そちらの指定のしかたも添える。
 */
function companyLineNote(
  input: string,
  lines: readonly CatalogLine[],
  index: NameIndex,
): string | null {
  const [line] = lines
  if (lines.length !== 1 || line === undefined || line.operator === null) return null
  const key = nameKey(input)
  if (!key.endsWith('線') || !companyPrefixes(line).includes(key.slice(0, -1))) return null
  const siblings = index.catalog.lines.filter(
    (other) => other.operator === line.operator && other.lineCd !== line.lineCd,
  )
  if (siblings.length === 0) return null
  const listed = siblings
    .slice(0, MAX_LISTED)
    .map((other) => other.name)
    .join('・')
  const more = siblings.length > MAX_LISTED ? ` など ${siblings.length} 本` : ''
  const formal = line.formalName === line.name ? '' : `（正式名 ${line.formalName}）`
  return `「${input}」は ${line.name}${formal}だけで集計しました。${line.companyName}のほかの路線（${listed}${more}）は含めていません（会社の全路線なら operators に「${line.companyShort}」）。`
}

/** 決めた 1 本の説明（選んだ理由か読み替え・広げた別名・外した区間・使わなかった候補・会社の名前の路線）。 */
function chosenNotes(
  input: string,
  decision: Extract<Decision, { kind: 'chosen' }>,
  sections: Sections,
  area: Area,
  index: NameIndex,
): string[] {
  const label = namesLabel(sections.lines, index)
  const widened = decision.identity.widened
  const reading =
    reasonNote(input, decision, label, area, index) ??
    (widened ? null : renamedNote(input, sections.lines, label))
  const wide = widened
    ? `「${input}」は路線全体（${label}）で集計しました。その系統・区間の駅に限りません。`
    : null
  const section =
    sections.dropped.length === 0
      ? null
      : `区間に分かれた路線のため、地図の表示範囲の外の区間（${namesLabel(sections.dropped, index)}）は含めていません（含めるなら routes に区間の名前を指定）。`
  const unused =
    decision.reason !== null || decision.others.length === 0
      ? null
      : `「${input}」には ${othersLabel(decision.others, index)} も当たりますが含めていません（そちらなら routes にその名前を指定）。`
  const company = companyLineNote(input, sections.lines, index)
  return [reading, wide, section, unused, company].filter((note) => note !== null)
}

// --- 1 つの名前 → 結果 ----------------------------------------------------------

/** 当たった路線から 1 本に決める（決まらなければ候補つきの理由）。 */
async function decideLines(
  input: string,
  match: LinesMatch,
  area: Area,
  index: NameIndex,
  deps: NameResolveDeps,
): Promise<RouteOutcome> {
  const decision = await decide(input, match, area, deps)
  if (decision.kind === 'ask') {
    const candidates = await candidatesOf(decision.candidates, index, deps)
    return { kind: 'problem', problem: { input, problem: decision.problem, candidates } }
  }
  const sections = await narrowSections(decision.identity, area, deps)
  const notes = chosenNotes(input, decision, sections, area, index)
  return { kind: 'lines', lines: sections.lines, notes }
}

/** 会社の指定と合わないとき、その路線の持ち主を示す（「東横線」は東急東横線、「小田急線」は小田急電鉄）。 */
function mismatch(input: string, scope: readonly string[], index: NameIndex): NameProblem | null {
  const anywhere = matchLine(input, index, null)
  const owners =
    anywhere.kind === 'lines'
      ? [...anywhere.strong, ...anywhere.weak].map((id) => namesLabel(id.lines, index)).join('／')
      : anywhere.kind === 'operators'
        ? operatorsLabel(anywhere.operators, index)
        : null
  if (owners === null) return null
  return {
    input,
    problem: `「${input}」は ${owners} の路線で、operators の指定（${operatorsLabel(scope, index)}）と合いません。`,
  }
}

/** 路線 1 つを解決する。 */
async function resolveRoute(
  input: string,
  index: NameIndex,
  operators: OperatorOutcome,
  area: Area,
  deps: NameResolveDeps,
): Promise<RouteOutcome> {
  const match = matchLine(input, index, operators.scope)
  if (match.kind === 'lines') return decideLines(input, match, area, index, deps)
  if (match.kind === 'operators') return companyWide(input, match.operators, index)
  if (match.kind === 'category') return { kind: 'problem', problem: { input, problem: match.hint } }
  const unmatched = operators.scope === null ? null : mismatch(input, operators.scope, index)
  const unknown = {
    input,
    problem: `「${input}」という路線はデータにありません。`,
    didYouMean: match.didYouMean,
  }
  return { kind: 'problem', problem: unmatched ?? unknown }
}

/** 会社の全路線（「京急線」「小田急」）。路線名ではなく会社として扱ったことを説明に残す。 */
function companyWide(input: string, operators: readonly string[], index: NameIndex): RouteOutcome {
  const note = `「${input}」は ${operatorsLabel(operators, index)} の全路線として扱いました。`
  return { kind: 'operators', operators, notes: [note] }
}

/** 会社の言い方を読み替えたことの説明（言い方が会社名か表示名と同じなら書かない）。 */
function operatorNote(input: string, operators: readonly string[], index: NameIndex): string[] {
  const key = nameKey(input)
  const names = [
    ...operators,
    ...operators.map((name) => operatorLabelOf(name, index.operatorLabels)),
  ]
  if (names.some((name) => nameKey(name) === key)) return []
  return [`会社「${input}」は ${operatorsLabel(operators, index)} として扱いました。`]
}

/** 会社の指定を S12 の会社名へ。 */
function resolveOperators(inputs: readonly string[], index: NameIndex): OperatorOutcome {
  const matches = inputs.map((input) => ({ input, match: matchOperator(input, index) }))
  const problems = matches.flatMap(({ input, match }): NameProblem[] => {
    if (match.kind === 'category') return [{ input, problem: match.hint }]
    if (match.kind === 'unknown') {
      const problem = `「${input}」という会社はデータにありません。`
      return [{ input, problem, didYouMean: match.didYouMean }]
    }
    return []
  })
  const operators = matches.flatMap(({ match }) =>
    match.kind === 'operators' ? match.operators : [],
  )
  const notes = matches.flatMap(({ input, match }) =>
    match.kind === 'operators' ? operatorNote(input, match.operators, index) : [],
  )
  // 会社が 1 つも決まらなければ範囲は付けない（路線の理由を「会社と合わない」で隠さない）。
  return { scope: operators.length === 0 ? null : unique(operators), problems, notes }
}

// --- まとめ ----------------------------------------------------------------------

function failure(problems: readonly NameProblem[]): NameResolution {
  const inputs = problems.map((problem) => `「${problem.input}」`).join('・')
  return {
    ok: false,
    error: `会社・路線の名前を決められませんでした（${inputs}）。`,
    hint: NAME_HINT,
    problems,
  }
}

/** 同じ路線を 1 回にする（現れた順）。 */
function uniqueLines(lines: readonly CatalogLine[]): CatalogLine[] {
  return lines.filter((line, i) => lines.findIndex((other) => other.lineCd === line.lineCd) === i)
}

function lineRefOf(line: CatalogLine): LineRef {
  return { lineCd: line.lineCd, name: line.name }
}

/**
 * 路線の指定を条件へまとめる。路線が 1 本も無ければ会社（指定と「小田急」のような会社の全路線）。
 * 路線と会社の全路線が混ざれば、会社をその路線に開いて並べる（会社と路線を AND で掛けない）。
 */
function combine(
  outcomes: readonly RouteOutcome[],
  operators: OperatorOutcome,
  index: NameIndex,
): { readonly filters: NameFilters } | { readonly problem: NameProblem } {
  const chosen = outcomes.flatMap((outcome) => (outcome.kind === 'lines' ? outcome.lines : []))
  const companyWide = unique(
    outcomes.flatMap((outcome) => (outcome.kind === 'operators' ? outcome.operators : [])),
  )
  if (chosen.length === 0) {
    return {
      filters: { operators: unique([...(operators.scope ?? []), ...companyWide]), lines: [] },
    }
  }
  const opened = index.catalog.lines.filter(
    (line) => line.operator !== null && companyWide.includes(line.operator),
  )
  const lines = uniqueLines([...chosen, ...opened])
  if (lines.length > MAX_LINES_PER_QUERY) {
    return { problem: tooManyLines(outcomes, lines.length, index) }
  }
  return { filters: { operators: [], lines: lines.map(lineRefOf) } }
}

function tooManyLines(
  outcomes: readonly RouteOutcome[],
  count: number,
  index: NameIndex,
): NameProblem {
  const companies = outcomes.flatMap((o) => (o.kind === 'operators' ? o.operators : []))
  const problem =
    companies.length > 0
      ? `会社の全路線（${operatorsLabel(unique(companies), index)}）と路線を一度に指定すると、路線が ${count} 本になります（${MAX_LINES_PER_QUERY} 本まで）。会社は operators だけで、路線は routes だけで、分けて呼んでください。`
      : `路線が ${count} 本あります（${MAX_LINES_PER_QUERY} 本まで）。分けて呼んでください。`
  return { input: 'routes', problem }
}

/** 名前ごとの結果をまとめる（決まらない名前が 1 つでもあれば、図を作らずに理由をまとめて返す）。 */
function summarize(
  outcomes: readonly RouteOutcome[],
  operators: OperatorOutcome,
  index: NameIndex,
): NameResolution {
  const problems = [
    ...operators.problems,
    ...outcomes.flatMap((o) => (o.kind === 'problem' ? [o.problem] : [])),
  ]
  if (problems.length > 0) return failure(problems)
  const combined = combine(outcomes, operators, index)
  if ('problem' in combined) return failure([combined.problem])
  const routeNotes = outcomes.flatMap((o) => (o.kind === 'problem' ? [] : o.notes))
  return { ok: true, filters: combined.filters, notes: [...operators.notes, ...routeNotes] }
}

/** 会社・路線の指定を、データの会社と路線へ解決する。どちらも無ければ一覧も読まない。 */
export async function resolveNameFilters(
  request: NameRequest,
  deps: NameResolveDeps,
): Promise<NameResolution> {
  const operatorInputs = trimmed(request.operators)
  const routeInputs = trimmed(request.routes)
  if (operatorInputs.length === 0 && routeInputs.length === 0) {
    return { ok: true, filters: { operators: [], lines: [] }, notes: [] }
  }
  const index = await deps.index()
  const operators = resolveOperators(operatorInputs, index)
  const area = { prefectures: request.prefectures, viewport: request.viewport ?? null }
  const outcomes = await Promise.all(
    routeInputs.map((input) => resolveRoute(input, index, operators, area, deps)),
  )
  return summarize(outcomes, operators, index)
}
