/**
 * ドメイン：**内訳**——区・市区町村・都道府県、沿線なら駅（純関数・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.5）。
 *
 * | エリア | 内訳 | 並び |
 * |---|---|---|
 * | 全国 | 都道府県 | 増減の大きい順 |
 * | 都道府県 | 市区町村（政令市は市全体で 1 つ・東京 23 区は区ごと） | 同上 |
 * | 政令市・東京 23 区 | 区 | 同上 |
 * | 沿線 | 駅 | **路線の駅の順**（沿線のどのあたりかを見るので） |
 *
 * 行政区域の行は区域の値（公表値）：人口（最新の年）・その前の 5 年からの増減・推計の 2020→2050 年。
 * 沿線の行は**駅ごとの円の値**（足せない）：人口・人口の増減・将来の人口の増減（駅の指標）。
 */

import { type AreaRow, type LineStation } from '@/db/queries'
import { type AreaBreakdown, type AreaBreakdownRow } from '@/shared/area-summary'
import { type CatalogEntry } from '@/shared/catalog'
import { radiusLabel, type RadiusM } from '@/shared/constants'
import { formatWithUnit, MISSING } from '@/shared/format'
import { wardOf } from '@/shared/municipality'
import { periodOf } from '@/domain/metrics'
import { resolveFamilyAtRadius } from '@/domain/metrics/family'
import { FUTURE_LEAD_YEAR } from './totals'
import { rateJa, rateOf, valueJa } from './wording'

const PEOPLE_UNIT = '人'
const PROJECTION_BASE_KEY = 'pop_pred_2024_2020'
const PROJECTION_LEAD_KEY = `pop_pred_2024_${FUTURE_LEAD_YEAR}`

/** 内訳の行になる子（東京 23 区の集まりは都道府県の内訳に入れない＝区と二重に数える）。 */
export function childrenOf(parent: AreaRow, rows: readonly AreaRow[]): AreaRow[] {
  switch (parent.kind) {
    case 'country':
      return rows.filter((row) => row.kind === 'prefecture')
    case 'prefecture':
      return rows.filter(
        (row) =>
          row.parentKey === parent.key && (row.kind === 'municipality' || row.kind === 'city'),
      )
    case 'city':
      return rows.filter((row) => row.parentKey === parent.key && row.kind === 'ward')
    case 'special_wards':
      return rows.filter((row) => row.groupKey === parent.key)
    default:
      return []
  }
}

const BY_JA: Readonly<Partial<Record<AreaRow['kind'], string>>> = {
  country: '都道府県',
  prefecture: '市区町村',
  city: '区',
  special_wards: '区',
}

/** 人口の最新の年と、その前の年（親の値の年で決め、子を同じ年でそろえる）。 */
function populationYears(
  parent: AreaRow,
): { readonly latest: number; readonly previous: number } | null {
  const years = [...parent.values.keys()]
    .map((key) => /^pop_(\d{4})$/.exec(key)?.[1])
    .filter((year): year is string => year !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
  const latest = years[years.length - 1]
  const previous = years[years.length - 2]
  return latest === undefined || previous === undefined ? null : { latest, previous }
}

function rateBetween(
  values: ReadonlyMap<string, number>,
  fromKey: string,
  toKey: string,
): number | null {
  const from = values.get(fromKey)
  const to = values.get(toKey)
  return from === undefined || to === undefined ? null : rateOf(from, to)
}

function rateText(rate: number | null): string {
  return rate === null ? MISSING : rateJa(rate)
}

function adminRow(child: AreaRow, latest: number, previous: number): AreaBreakdownRow {
  const value = child.values.get(`pop_${latest}`) ?? null
  const change = rateBetween(child.values, `pop_${previous}`, `pop_${latest}`)
  const future = rateBetween(child.values, PROJECTION_BASE_KEY, PROJECTION_LEAD_KEY)
  return {
    ref: child.key,
    grp: null,
    nameJa: child.kind === 'ward' ? (wardOf(child.nameJa) ?? child.nameJa) : child.nameJa,
    value,
    valueJa: value === null ? MISSING : valueJa(value, PEOPLE_UNIT),
    change,
    changeJa: rateText(change),
    future,
    futureJa: rateText(future),
    stationCount: child.stationCount,
  }
}

/** 増減の大きい順（増減の無い行は最後・同じなら名前の順）。 */
function byChange(a: AreaBreakdownRow, b: AreaBreakdownRow): number {
  if (a.change === b.change) return a.nameJa.localeCompare(b.nameJa, 'ja')
  if (a.change === null) return 1
  if (b.change === null) return -1
  return b.change - a.change
}

/** 行政区域の内訳（子が無い区域は null）。 */
export function adminBreakdown(parent: AreaRow, rows: readonly AreaRow[]): AreaBreakdown | null {
  const children = childrenOf(parent, rows)
  const years = populationYears(parent)
  const byJa = BY_JA[parent.kind]
  if (children.length === 0 || years === null || byJa === undefined) return null
  const breakdownRows = children
    .map((child) => adminRow(child, years.latest, years.previous))
    .sort(byChange)
  return {
    byJa,
    valueLabelJa: `人口（${years.latest}年）`,
    changeLabelJa: `増減（${years.previous}→${years.latest}年）`,
    futureLabelJa: `将来（2020→${FUTURE_LEAD_YEAR}年・推計）`,
    rows: breakdownRows,
    noteJa: adminNote(parent, breakdownRows),
  }
}

/** 内訳の注記（都道府県は政令市を 1 行に・将来の値が無い区域がある）。無ければ null。 */
function adminNote(parent: AreaRow, rows: readonly AreaBreakdownRow[]): string | null {
  const notes = [
    parent.kind === 'prefecture' ? '政令市は市全体で 1 行（区ごとは、その市を選ぶ）。' : null,
    rows.some((row) => row.future === null)
      ? '将来の値が無い区域がある（理由はその区域の「無い値」）。'
      : null,
  ].filter((note): note is string => note !== null)
  return notes.length === 0 ? null : notes.join('')
}

/** 沿線の内訳に使う駅の指標（幅＝駅の円の半径）。 */
export function lineBreakdownEntries(widthM: RadiusM): {
  readonly population: CatalogEntry | null
  readonly change: CatalogEntry | null
  readonly future: CatalogEntry | null
} {
  return {
    population: resolveFamilyAtRadius('pop', widthM)?.entry ?? null,
    change: resolveFamilyAtRadius('pop_gr', widthM, 5)?.entry ?? null,
    future: resolveFamilyAtRadius('pop_gr_pred', widthM, 30)?.entry ?? null,
  }
}

function stationText(value: number | null, entry: CatalogEntry | null): string {
  if (entry === null) return MISSING
  return formatWithUnit(value, entry.format, entry.unit, { signed: entry.kind === 'growth' })
}

/** 駅ごとの円の値（grp → 駅の指標の key → 値）。 */
type StationValues = Readonly<Record<string, Readonly<Record<string, number>>>>

/** 沿線の駅 1 つの行（駅の円の人口・増減・将来の増減）。 */
function lineRow(
  station: LineStation,
  entries: ReturnType<typeof lineBreakdownEntries>,
  values: StationValues,
): AreaBreakdownRow {
  const read = (entry: CatalogEntry | null): number | null =>
    entry === null ? null : (values[station.grp]?.[entry.key] ?? null)
  const value = read(entries.population)
  const change = read(entries.change)
  const future = read(entries.future)
  return {
    ref: null,
    grp: station.grp,
    nameJa: station.label,
    value,
    valueJa: stationText(value, entries.population),
    change,
    changeJa: stationText(change, entries.change),
    future,
    futureJa: stationText(future, entries.future),
    stationCount: null,
  }
}

/** 沿線の内訳（路線の駅の順・駅ごとの円の値）。 */
export function lineBreakdown(
  widthM: RadiusM,
  stations: readonly LineStation[],
  values: StationValues,
): AreaBreakdown {
  const entries = lineBreakdownEntries(widthM)
  const rows = [...stations]
    .sort((a, b) => a.seq - b.seq)
    .map((each) => lineRow(each, entries, values))
  const period = (entry: CatalogEntry | null): string =>
    entry === null ? '' : `（${periodOf(entry)}）`
  return {
    byJa: '駅（路線の順）',
    valueLabelJa: `駅から ${radiusLabel(widthM)} の人口${period(entries.population)}`,
    changeLabelJa: `増減${period(entries.change)}`,
    futureLabelJa: `将来${period(entries.future)}`,
    rows,
    noteJa:
      `駅ごとの円（駅から ${radiusLabel(widthM)}）の値。円が重なるので、足しても沿線の値にならない。` +
      '将来の増減は駅の指標（国勢調査の 2020 年が起点）。',
  }
}
