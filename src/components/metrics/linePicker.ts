/**
 * 路線（運行系統）の選択肢の並べ方（純関数・2026-10-08 L4）。
 *
 * 路線は 601 本・事業者は 163 あるので、**事業者の通称**（「JR東日本」「東京メトロ」「東京都交通局」）で
 * まとめ、検索と都道府県・会社の連動で絞る。並びと見出しの名前は `/api/lines` の値をそのまま使い、
 * ここは「どれを・どの順に出すか」だけを決める。
 *
 * - 選んだ路線は検索・連動に関わらず先頭に出す（いつでも外せる。行き止まりを作らない）
 * - 検索していないときは、選べる路線だけを出す（都道府県で絞った一覧に、選べない 500 本を並べない）
 * - 検索したときは、選べない路線も薄く出す（「御堂筋線が無い」ではなく「いまの条件では選べない」と分かる）
 * - 事業者は、出す路線の駅数の多い順。事業者の中は一覧の順（路線コード順＝駅データ.jp の並び。東京メトロなら銀座線から）
 */

import { type Line } from '@/shared/api'
import { lineLabel } from '@/shared/constants'
import { matchesTokens, searchTokens } from './search'

/** 一度に出す路線の上限（検索・都道府県で絞れる。全国の 601 本は描かない）。 */
export const MAX_VISIBLE_LINES = 120

/** 選択肢に要る路線の列。 */
export type PickerLine = Pick<
  Line,
  | 'lineCd'
  | 'name'
  | 'formalName'
  | 'companyName'
  | 'companyShort'
  | 'operator'
  | 'color'
  | 'stationCount'
  | 'prefectures'
>

/** 1 事業者ぶんの選択肢。`disabled` はいまの条件では選べない路線。 */
export type LineGroup<T extends PickerLine> = {
  readonly company: string
  readonly lines: readonly T[]
  readonly disabled: ReadonlySet<number>
}

export type LinePickerView<T extends PickerLine> = {
  /** 選んだ路線（選んだ順）。 */
  readonly selected: readonly T[]
  readonly groups: readonly LineGroup<T>[]
  /** 上限で出さなかった本数（0 なら全部出ている）。 */
  readonly hiddenCount: number
}

export type LinePickerInput<T extends PickerLine> = {
  readonly lines: readonly T[]
  readonly selected: readonly number[]
  readonly query: string
  /** 選べる路線（`null`＝絞っていない）。 */
  readonly allowed: ReadonlySet<number> | null
  readonly max?: number
}

/** 正式名を除いた検索の対象（路線名・事業者名・略称・S12 の会社名「東日本旅客鉄道」）。 */
function namesOf(line: PickerLine): (string | null)[] {
  return [line.name, line.companyName, line.companyShort, line.operator]
}

/** 検索の対象：路線名・正式名・事業者名・略称・S12 の会社名。 */
export function matchesSearch(line: PickerLine, tokens: readonly string[]): boolean {
  return matchesTokens([...namesOf(line), line.formalName], tokens)
}

/**
 * 検索が**正式名で**当たったときだけ添える正式名（「東海道本線」で出た「琵琶湖線」に「JR東海道本線(米原～京都)」）。
 * 当たった理由が見えないと、関係ない路線が出たように見えるため。ふだんは添えない——「高速電気軌道第4号線」
 * のような法令上の名前を選択肢に並べない（正式名はホバーで読める・計画書 §6.8.7）。
 */
export function formalNameHint(line: PickerLine, query: string): string | null {
  const tokens = searchTokens(query)
  if (tokens.length === 0 || line.formalName === line.name) return null
  return matchesTokens(namesOf(line), tokens) ? null : line.formalName
}

function isAllowed(line: PickerLine, allowed: ReadonlySet<number> | null): boolean {
  return allowed === null || allowed.has(line.lineCd)
}

/** 出す路線（選んだ路線を除く）。検索していなければ選べる路線だけ。 */
function candidates<T extends PickerLine>(input: LinePickerInput<T>): T[] {
  const tokens = searchTokens(input.query)
  const chosen = new Set(input.selected)
  return input.lines.filter(
    (line) =>
      !chosen.has(line.lineCd) &&
      matchesSearch(line, tokens) &&
      (tokens.length > 0 || isAllowed(line, input.allowed)),
  )
}

/** 事業者の重み：選べる路線の駅数の和（都道府県で絞ったら、その都道府県に駅のある路線だけを数える）。 */
function groupWeight<T extends PickerLine>(group: LineGroup<T>): number {
  return group.lines
    .filter((line) => !group.disabled.has(line.lineCd))
    .reduce((sum, line) => sum + line.stationCount, 0)
}

/** 選べる路線が 1 本でもある事業者は前（0）、無ければ後ろ（1）。 */
function enabledRank<T extends PickerLine>(group: LineGroup<T>): number {
  return group.lines.some((line) => !group.disabled.has(line.lineCd)) ? 0 : 1
}

/** 事業者の順：選べる路線のある事業者 → 駅数の多い順 → 名前（決まった順にする）。 */
function compareGroups<T extends PickerLine>(a: LineGroup<T>, b: LineGroup<T>): number {
  const total = (group: LineGroup<T>): number =>
    group.lines.reduce((sum, line) => sum + line.stationCount, 0)
  return (
    enabledRank(a) - enabledRank(b) ||
    groupWeight(b) - groupWeight(a) ||
    total(b) - total(a) ||
    a.company.localeCompare(b.company, 'ja')
  )
}

/** 事業者ごとにまとめる（事業者の中は、選べる路線 → 選べない路線。どちらも一覧の順）。 */
export function groupByCompany<T extends PickerLine>(
  lines: readonly T[],
  allowed: ReadonlySet<number> | null,
): LineGroup<T>[] {
  const byCompany = lines.reduce((acc, line) => {
    acc.set(line.companyName, [...(acc.get(line.companyName) ?? []), line])
    return acc
  }, new Map<string, T[]>())
  const groups = [...byCompany.entries()].map(([company, members]): LineGroup<T> => {
    const disabled = new Set(
      members.filter((line) => !isAllowed(line, allowed)).map((line) => line.lineCd),
    )
    const ordered = [
      ...members.filter((line) => !disabled.has(line.lineCd)),
      ...members.filter((line) => disabled.has(line.lineCd)),
    ]
    return { company, lines: ordered, disabled }
  })
  return groups.sort(compareGroups)
}

/** 上限までの路線だけを残す（事業者の順と、事業者の中の順は保つ）。 */
function capGroups<T extends PickerLine>(
  groups: readonly LineGroup<T>[],
  max: number,
): LineGroup<T>[] {
  const kept = new Set(
    groups
      .flatMap((group) => group.lines)
      .slice(0, max)
      .map((line) => line.lineCd),
  )
  return groups
    .map((group) => ({ ...group, lines: group.lines.filter((line) => kept.has(line.lineCd)) }))
    .filter((group) => group.lines.length > 0)
}

/** 選択肢の並び（選んだ路線・事業者ごとの路線・出さなかった本数）。 */
export function linePickerView<T extends PickerLine>(input: LinePickerInput<T>): LinePickerView<T> {
  const byCode = new Map(input.lines.map((line) => [line.lineCd, line]))
  const selected = input.selected.flatMap((code) => {
    const line = byCode.get(code)
    return line === undefined ? [] : [line]
  })
  const shown = candidates(input)
  const max = input.max ?? MAX_VISIBLE_LINES
  return {
    selected,
    groups: capGroups(groupByCompany(shown, input.allowed), max),
    hiddenCount: Math.max(0, shown.length - max),
  }
}

/**
 * ボタンに出す言い方（「JR山手線」「JR山手線・東京メトロ副都心線」「JR山手線 他2件」・空＝全路線）。
 * 一覧の読み込み前で名前が引けなければ、本数だけを言う（コードは見せない）。
 */
export function lineButtonLabel(selected: readonly number[], lines: readonly PickerLine[]): string {
  const byCode = new Map(lines.map((line) => [line.lineCd, line.name]))
  const names = selected.flatMap((code) => {
    const name = byCode.get(code)
    return name === undefined ? [] : [name]
  })
  return names.length === selected.length ? lineLabel(names) : `路線 ${selected.length} 本`
}

/** 選択肢のホバー（正式名・事業者・駅数・駅のある都道府県。鉄道に詳しい人は正式名で確かめる）。 */
export function lineTooltip(line: PickerLine): string {
  const parts: string[] = [line.name]
  if (line.formalName !== line.name) parts.push(`正式名：${line.formalName}`)
  parts.push(`${line.companyName}・${line.stationCount} 駅`)
  if (line.prefectures.length > 0) parts.push(line.prefectures.join('・'))
  return parts.join('\n')
}
