/**
 * ドメイン：エリアの**性格の目安**（純関数・2026-10-09 B4）。
 *
 * 計画書 §6.4 B4「性格の目安（例：従業者／人口の比で『業務地型・住宅地型』）は**ドメインの規則**で決め、
 * LLM に決めさせない」。規則は 2 つの数だけで決め、根拠の数を必ず添える。
 *
 * 1. 人と職場の密度（1km 圏の人口＋従業者 ÷ 円の面積）が 1km² あたり 1,000 人未満 → **低密度**
 * 2. 従業者 ÷ 人口 が 1 以上 → **業務地型**（働きに来る人が住む人より多い）
 * 3. 0.5 以上 → **混在型**
 * 4. それ未満 → **住宅地型**
 *
 * 閾値は全国 9,273 駅の 1km 圏の分布で決めた（2026-10-09 実測）：従業者 ÷ 人口 の中央値 0.35・上位 25% が 0.55・
 * 1 以上は 9.8%。密度 1,000 人/km² 未満は 31.7%（人口集中地区の基準 4,000 人/km² の 4 分の 1）。
 * 判定は**選んだ半径によらず 1km 圏**で行う（半径を広げると、どの駅も周りの住宅地に薄まって住宅地型に寄る）。
 *
 * ⚠ 従業者は事業所で働く人の数で、業種を問わない（店・会社・工場・病院・学校を含む）。昼間人口そのものではない。
 */

import { formatNumber } from '@/shared/format'
import { radiusLabel } from '@/shared/constants'
import { type AreaCharacter, type AreaCharacterKind } from '@/shared/profile'

/** 判定に使う半径（m）。 */
export const CHARACTER_RADIUS_M = 1000
/** 人と職場の密度の下限（1km² あたりの人口＋従業者）。これ未満は低密度。 */
export const SPARSE_PEOPLE_PER_KM2 = 1000
/** 従業者 ÷ 人口 がこれ以上なら業務地型。 */
export const BUSINESS_MIN_RATIO = 1
/** 従業者 ÷ 人口 がこれ以上なら混在型（業務地型の下限未満）。これ未満は住宅地型。 */
export const MIXED_MIN_RATIO = 0.5

const M_PER_KM = 1000
/** 判定に使う円の面積（km²）。 */
const CIRCLE_AREA_KM2 = Math.PI * (CHARACTER_RADIUS_M / M_PER_KM) ** 2

/** 判定の材料（1km 圏の人口・従業者と、その年）。 */
export type CharacterInput = {
  readonly population: number | null
  readonly populationYear: number | null
  readonly employees: number | null
  readonly employeesYear: number | null
}

const LABELS: Readonly<Record<AreaCharacterKind, { labelJa: string; summaryJa: string }>> = {
  business: { labelJa: '業務地型', summaryJa: '働きに来る人が、住む人より多いエリア' },
  mixed: { labelJa: '混在型', summaryJa: '住む人と働く人が混ざるエリア' },
  residential: { labelJa: '住宅地型', summaryJa: '住む人が中心のエリア' },
  sparse: { labelJa: '低密度', summaryJa: '住む人も働く人も少ないエリア' },
  unknown: { labelJa: '判定できません', summaryJa: '人口か従業者の値が無く、目安を出せません' },
}

/** 判定の規則を 1 文で（画面と AI の注記に同じ文を出す）。 */
export const CHARACTER_RULE_JA =
  `性格の目安は、駅から${radiusLabel(CHARACTER_RADIUS_M)}圏の従業者と人口で決めています` +
  `（人口と従業者が合わせて 1km² あたり ${formatNumber(SPARSE_PEOPLE_PER_KM2, 'int')} 人未満＝低密度、` +
  `従業者が人口以上＝業務地型、人口の半分以上＝混在型、それ未満＝住宅地型）。` +
  '従業者は事業所で働く人（店・会社・工場・病院・学校を含む）で、昼間人口そのものではありません。'

/** 人数（「43,471 人」）。 */
function people(count: number): string {
  return `${formatNumber(count, 'int')} 人`
}

/** 年の添え書き（「（2020年）」・年が無ければ空）。 */
function yearOf(year: number | null): string {
  return year === null ? '' : `（${year}年）`
}

function characterOf(kind: AreaCharacterKind, basisJa: string): AreaCharacter {
  return { kind, ...LABELS[kind], basisJa, radiusM: CHARACTER_RADIUS_M }
}

/** 従業者 ÷ 人口 → 種類（人口 0 で従業者がいれば業務地型）。 */
function kindByRatio(population: number, employees: number): AreaCharacterKind {
  const ratio = population === 0 ? Number.POSITIVE_INFINITY : employees / population
  if (ratio >= BUSINESS_MIN_RATIO) return 'business'
  return ratio >= MIXED_MIN_RATIO ? 'mixed' : 'residential'
}

/** 比の表示の刻み（小数 1 桁）。 */
const RATIO_STEPS_PER_UNIT = 10

/**
 * 比の根拠（「1km圏の従業者 179,031 人（2021年）は、人口 43,471 人（2020年）の 4.1 倍」）。
 * 比は小数 1 桁に**切り捨て**て書く——四捨五入だと 0.49 倍が「0.5 倍」になり、「半分以上＝混在型」と食い違って見える
 * （閾値 0.5・1 は小数 1 桁で表せるので、切り捨てなら書いた数と型がいつも合う）。
 */
function ratioBasis(input: CharacterInput, population: number, employees: number): string {
  const radius = `${radiusLabel(CHARACTER_RADIUS_M)}圏`
  const head = `${radius}の従業者 ${people(employees)}${yearOf(input.employeesYear)}`
  if (population === 0) return `${head}に対し、人口は 0 人${yearOf(input.populationYear)}`
  const floored = Math.floor((employees / population) * RATIO_STEPS_PER_UNIT) / RATIO_STEPS_PER_UNIT
  const ratio = formatNumber(floored, 'decimal1')
  return `${head}は、人口 ${people(population)}${yearOf(input.populationYear)}の ${ratio} 倍`
}

/**
 * 密度の根拠（「1km圏の人口 1,200 人と従業者 450 人は、合わせて 1km² あたり 525 人」）。
 * 切り捨てで書く——四捨五入だと 999.8 人が「1,000 人」になり、「1,000 人未満＝低密度」と食い違って見える。
 */
function densityBasis(population: number, employees: number): string {
  const density = (population + employees) / CIRCLE_AREA_KM2
  return (
    `${radiusLabel(CHARACTER_RADIUS_M)}圏の人口 ${people(population)}と従業者 ${people(employees)}は、` +
    `合わせて 1km² あたり ${people(Math.floor(density))}`
  )
}

/** 1km 圏の人口・従業者 → 性格の目安（どちらかが無ければ「判定できません」）。 */
export function classifyArea(input: CharacterInput): AreaCharacter {
  const { population, employees } = input
  if (population === null || employees === null || population < 0 || employees < 0) {
    return characterOf('unknown', '')
  }
  if ((population + employees) / CIRCLE_AREA_KM2 < SPARSE_PEOPLE_PER_KM2) {
    return characterOf('sparse', densityBasis(population, employees))
  }
  return characterOf(kindByRatio(population, employees), ratioBasis(input, population, employees))
}
