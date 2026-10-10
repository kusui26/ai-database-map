/**
 * ドメイン：**駅周辺のプロフィール**を組み立てる（純関数・2026-10-09 B4・`docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 材料（駅・値の束・県内／市内の順位・災害の事前計算）は `load.ts` が DB から 1 回ずつ引く。ここは並べて意味をつけるだけで、
 * 画面（駅詳細の「概要」）・AI（`getStationProfile`）・MCP（`get_station_profile`）が同じ結果を読む。
 *
 * - 値・年・半径・⚠ はカタログが決める（`items.ts`）。半径を替えた項目・所得や売上の読み方は項目の注記に書く
 * - 位置は「県内」と「市内」（政令市は市全体・東京 23 区は区）。所得は政令市なら市の平均が主なので、市内では比べない
 * - 性格の目安は規則（`character.ts`）、災害は事前計算の要約（`hazard.ts`）
 * - **見ていないこと**を必ず並べる（治安・学校・生活施設・家賃…）。AI はそれを本文に書く（計画書 §9.2 原則 5）
 */

import { type StationProfile, type StationRow } from '@/shared/api'
import { type CatalogEntry } from '@/shared/catalog'
import { radiusLabel, type RadiusM } from '@/shared/constants'
import { formatWithUnit } from '@/shared/format'
import { type StationHazardSummary } from '@/shared/hazard-summary'
import { cityOfWard } from '@/shared/municipality'
import {
  type AreaCharacter,
  type ProfileItem,
  type ProfilePosition,
  type ProfileSection,
  type ProfileSource,
} from '@/shared/profile'
import type { ProfileRankRow } from '@/db/queries'
import { periodOf } from '@/domain/metrics'
import { familyCandidates } from '@/domain/metrics/family'
import { sourcesForKeys } from '@/domain/sources'
import { CHARACTER_RADIUS_M, CHARACTER_RULE_JA, classifyArea } from './character'
import { profileHazardOf } from './hazard'
import {
  incomeCityOnlyFlagKey,
  type ResolvedProfileItem,
  type ResolvedProfileSection,
} from './items'
import { MIN_COMPARED_STATIONS, positionOf, positionsLegendJa } from './position'

/** このプロフィールが**見ていないこと**（計画書 §7.5・§11）。画面と AI は必ず並べて出す。 */
export const PROFILE_NOT_COVERED_JA: readonly string[] = [
  '治安（犯罪の件数）',
  '学校・学区・保育園の空き',
  '買い物・病院などの生活施設',
  '家賃・物件の価格',
  '通勤・通学の時間',
  '騒音・街の雰囲気・景観',
]

/** 順位の読み方（全体の注記の先頭）。 */
export const PROFILE_RANK_NOTE_JA =
  '順位は値の大きい順です（同じ値は同じ順位・比べるのはその値がある駅だけ）。' +
  '「上位」は値が大きい側で、良し悪しではありません（地価の上位＝高い）。'

/** 円で集計していること（全体の注記）。 */
export const PROFILE_CIRCLE_NOTE_JA =
  '値は駅を中心にした半径の円で集計したもので、駅の利用圏や市区町村の境とは一致しません。'

/** ⚠ の意味（⚠ の値があるときだけ）。 */
export const PROFILE_FLAG_NOTE_JA = '⚠ の値は、母数が小さいなどの理由で参考値です。'

/** プロフィールの材料（`load.ts` が DB から集める）。 */
export type StationProfileInput = {
  readonly station: StationRow
  readonly radiusM: RadiusM
  readonly sections: readonly ResolvedProfileSection[]
  /** 駅の値の束（key → 値・フラグ列も含む）。 */
  readonly values: ReadonlyMap<string, number>
  /** key → 県内・市内の順位（値の無い指標は無い）。 */
  readonly ranks: ReadonlyMap<string, ProfileRankRow>
  /** 市内の比較に使った市区町村（`comparisonAreaOf`）。 */
  readonly area: string | null
  readonly hazard: StationHazardSummary | null
}

/** 市内の比較に使う市区町村：政令市の区なら市全体（「横浜市西区」→「横浜市」）、それ以外はそのまま。 */
export function comparisonAreaOf(municipality: string | null): string | null {
  if (municipality === null || municipality === '') return null
  return cityOfWard(municipality) ?? municipality
}

/** カタログのフラグ（バッジ用の notice を優先）が立っているか。 */
function isFlagged(entry: CatalogEntry, values: ReadonlyMap<string, number>): boolean {
  const flagKey = entry.noticeFlagKey ?? entry.reliabilityFlagKey
  return flagKey !== null && values.get(flagKey) === 1
}

/** 所得の値が、政令市の市全体の平均が主か（そのときは市内で比べない）。 */
function isCityAverageIncome(
  item: ResolvedProfileItem,
  values: ReadonlyMap<string, number>,
): boolean {
  if (item.spec.id !== 'income' || item.entry.radiusM === null) return false
  const flagKey = incomeCityOnlyFlagKey(item.entry.radiusM)
  return flagKey !== null && values.get(flagKey) === 1
}

/** 県内・市内の位置（比べる駅が少なければ出さない）。`withArea=false` は市内を出さない。 */
function positionsOf(
  row: ProfileRankRow | undefined,
  input: StationProfileInput,
  withArea: boolean,
): ProfilePosition[] {
  if (row === undefined) return []
  const prefecture = positionOf('prefecture', input.station.prefecture, row.prefRank, row.prefTotal)
  const area =
    withArea && input.area !== null && row.areaRank !== null && row.areaTotal !== null
      ? positionOf('area', input.area, row.areaRank, row.areaTotal)
      : null
  return [prefecture, area].filter((position): position is ProfilePosition => position !== null)
}

/** 半径を替えた項目の注記（「500m圏は算出対象外のため、1km圏の値です」）。 */
function substitutionNote(item: ResolvedProfileItem, requested: RadiusM): string | null {
  if (!item.substituted || item.entry.radiusM === null) return null
  return `${radiusLabel(requested)}圏は算出対象外のため、${radiusLabel(item.entry.radiusM)}圏の値です。`
}

/** 指標ごとの読み方の注記（推計・按分・調査の年）。 */
function readingNote(item: ResolvedProfileItem, cityAverage: boolean): string | null {
  const { entry } = item
  switch (item.spec.id) {
    case 'income':
      return cityAverage
        ? '政令市の所得は市の単位でしか公表されないため、市全体の平均が主です（市内では比べていません）。'
        : '市区町村の課税対象所得（給与収入ではない）を、半径内の15〜64歳人口で按分した値です。'
    case 'sales':
      return entry.year === null
        ? null
        : `${entry.year}年調査＝${entry.year - 1}年の売上の推計です（市区町村の売上を従業者数で按分）。`
    case 'populationFuture':
      return '国の推計で、実績ではありません。'
    case 'passengers':
      return '駅そのものの値で、半径によりません。'
    default:
      return null
  }
}

/** 1 項目を組み立てる。 */
function itemOf(item: ResolvedProfileItem, input: StationProfileInput): ProfileItem {
  const { entry } = item
  const value = input.values.get(entry.key) ?? null
  const cityAverage = isCityAverageIncome(item, input.values)
  const notes = [substitutionNote(item, input.radiusM), readingNote(item, cityAverage)]
  const noteJa = notes.filter((note): note is string => note !== null).join('')
  const signed = entry.kind === 'growth'
  return {
    id: item.spec.id,
    key: entry.key,
    labelJa: item.spec.labelJa,
    periodJa: periodOf(entry),
    radiusM: entry.radiusM,
    value,
    valueJa: formatWithUnit(value, entry.format, entry.unit, { signed }),
    flagged: value !== null && isFlagged(entry, input.values),
    positions: value === null ? [] : positionsOf(input.ranks.get(entry.key), input, !cityAverage),
    noteJa: noteJa === '' ? null : noteJa,
  }
}

function sectionOf(section: ResolvedProfileSection, input: StationProfileInput): ProfileSection {
  return {
    id: section.spec.id,
    titleJa: section.spec.titleJa,
    items: section.items.map((item) => itemOf(item, input)),
  }
}

/** 性格の目安に使う 1km 圏の人口・従業者（最新年）。 */
function characterEntries(): { population?: CatalogEntry; employees?: CatalogEntry } {
  return {
    population: familyCandidates('pop', CHARACTER_RADIUS_M)[0],
    employees: familyCandidates('emp_n', CHARACTER_RADIUS_M)[0],
  }
}

function characterOf(values: ReadonlyMap<string, number>): AreaCharacter {
  const { population, employees } = characterEntries()
  return classifyArea({
    population: population === undefined ? null : (values.get(population.key) ?? null),
    populationYear: population?.year ?? null,
    employees: employees === undefined ? null : (values.get(employees.key) ?? null),
    employeesYear: employees?.year ?? null,
  })
}

/** 市区町村があるのに、どの項目も市内で比べられなかった（駅が少ない）ときの注記。 */
function areaNote(input: StationProfileInput, sections: readonly ProfileSection[]): string[] {
  if (input.area === null) return []
  const items = sections.flatMap((section) => section.items)
  const compared = items.some((item) => item.positions.some((each) => each.scope === 'area'))
  if (compared) return []
  return [
    `${input.area}内は比べられる駅が少ない（${MIN_COMPARED_STATIONS} 駅未満）ため、市内の位置は出していません。`,
  ]
}

/** 全体の注記（順位の読み方・円で集計・性格の規則・⚠・市内）。 */
function notesOf(input: StationProfileInput, sections: readonly ProfileSection[]): string[] {
  const flagged = sections.some((section) => section.items.some((item) => item.flagged))
  return [
    PROFILE_RANK_NOTE_JA,
    PROFILE_CIRCLE_NOTE_JA,
    CHARACTER_RULE_JA,
    ...(flagged ? [PROFILE_FLAG_NOTE_JA] : []),
    ...areaNote(input, sections),
  ]
}

/** 使った指標の出典（(source, license) で束ねる・初出順）。災害の出典は災害の要約が持つ。 */
function sourcesOf(input: StationProfileInput): ProfileSource[] {
  const { population, employees } = characterEntries()
  const keys = [
    ...input.sections.flatMap((section) => section.items.map((item) => item.entry.key)),
    ...[population, employees].flatMap((entry) => (entry === undefined ? [] : [entry.key])),
  ]
  return [...sourcesForKeys(keys)]
}

/** 材料 → プロフィール。 */
export function buildStationProfile(input: StationProfileInput): StationProfile {
  const sections = input.sections.map((section) => sectionOf(section, input))
  return {
    station: input.station,
    radiusM: input.radiusM,
    area: input.area,
    positionsLegendJa: positionsLegendJa(input.station.prefecture, input.area),
    character: characterOf(input.values),
    sections,
    hazard: profileHazardOf(input.hazard),
    notCoveredJa: [...PROFILE_NOT_COVERED_JA],
    notesJa: notesOf(input, sections),
    sources: sourcesOf(input),
  }
}
