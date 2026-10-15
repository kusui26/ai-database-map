/**
 * エリアの図で、行政区域を選ぶ選択肢（純関数・2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * 選択肢はエリアの一覧（`GET /api/areas`）から作る——名前・親・束ね方・駅の数はサーバが決めていて、ここは並べ方だけを決める。
 *
 * - 1 段目：全国と 47 都道府県
 * - 2 段目：その都道府県の全体 → 東京 23 区・政令市ごとのまとまり（全体と区）→ ほかの市区町村。並びは一覧の順（JIS のコード順）
 * - 駅の数を添える（選ぶ前に大きさが分かる）。駅の無い町村も選べる（区域の値はある・駅の周りの値と色分けは無い）
 */

import { type AreaCatalogEntry } from '@/shared/area-summary'

/** 選択肢 1 つ（値はエリアの文字列）。 */
export type AreaOption = { readonly ref: string; readonly labelJa: string }

/** 見出しつきの選択肢のまとまり（`<optgroup>`）。 */
export type AreaOptionGroup = { readonly labelJa: string; readonly options: readonly AreaOption[] }

const COUNTRY_REF = 'jp'
/** 区をまとめる区域（政令市の全体・東京 23 区の全体）。 */
const GROUPING_KINDS: ReadonlySet<AreaCatalogEntry['kind']> = new Set(['city', 'special_wards'])

/** 駅の数の添え書き（「・137 駅」「（駅なし）」）。 */
export function stationCountJa(stationCount: number): string {
  return stationCount === 0 ? '（駅なし）' : `・${stationCount.toLocaleString('ja-JP')} 駅`
}

function optionOf(entry: AreaCatalogEntry, labelJa = entry.nameJa): AreaOption {
  return { ref: entry.ref, labelJa: `${labelJa}${stationCountJa(entry.stationCount)}` }
}

/** 1 段目：全国と 47 都道府県（一覧の順）。 */
export function prefectureOptions(entries: readonly AreaCatalogEntry[]): readonly AreaOption[] {
  return entries
    .filter((entry) => entry.kind === 'country' || entry.kind === 'prefecture')
    .map((entry) => ({ ref: entry.ref, labelJa: entry.nameJa }))
}

/** 区をまとめる区域 1 つのまとまり（全体 → 区）。 */
function groupingOf(
  grouping: AreaCatalogEntry,
  entries: readonly AreaCatalogEntry[],
): AreaOptionGroup {
  const members = entries.filter(
    (entry) => entry.parentRef === grouping.ref || entry.groupRef === grouping.ref,
  )
  return {
    labelJa: grouping.nameJa,
    options: [optionOf(grouping, `${grouping.nameJa}の全体`), ...members.map((m) => optionOf(m))],
  }
}

/** 2 段目：都道府県の中のエリア（全国なら全国だけ）。 */
export function areaOptionGroups(
  entries: readonly AreaCatalogEntry[],
  prefectureRef: string,
): readonly AreaOptionGroup[] {
  const prefecture = entries.find((entry) => entry.ref === prefectureRef)
  if (prefecture === undefined) return []
  const wholeJa = prefecture.ref === COUNTRY_REF ? prefecture.nameJa : `${prefecture.nameJa}の全体`
  const whole = { labelJa: '全体', options: [optionOf(prefecture, wholeJa)] }
  if (prefectureRef === COUNTRY_REF) return [whole]
  const children = entries.filter((entry) => entry.parentRef === prefectureRef)
  const groupings = children.filter((entry) => GROUPING_KINDS.has(entry.kind))
  const plain = children.filter(
    (entry) => !GROUPING_KINDS.has(entry.kind) && entry.groupRef === null,
  )
  const others =
    plain.length === 0 ? [] : [{ labelJa: '市区町村', options: plain.map((e) => optionOf(e)) }]
  return [whole, ...groupings.map((grouping) => groupingOf(grouping, entries)), ...others]
}

/**
 * エリアが入っている都道府県（2 段目を開く先）。都道府県・全国はそれ自身、市区町村・区は親をたどる。
 * 一覧に無い（沿線・範囲・起点の駅から N m）なら null。
 */
export function prefectureRefOf(entries: readonly AreaCatalogEntry[], ref: string): string | null {
  const byRef = new Map(entries.map((entry) => [entry.ref, entry]))
  const climb = (current: AreaCatalogEntry | undefined, depth: number): string | null => {
    if (current === undefined || depth > byRef.size) return null
    if (current.kind === 'country' || current.kind === 'prefecture') return current.ref
    return climb(current.parentRef === null ? undefined : byRef.get(current.parentRef), depth + 1)
  }
  return climb(byRef.get(ref), 0)
}
