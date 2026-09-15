/**
 * 市区町村の選択肢を、**実データから**組み立てる（純関数）。
 *
 * 自由入力にすると、綴りが 1 文字違うだけで「0 件」になり、理由が画面から分からない。
 * 駅一覧（`/api/stations?prefecture=…`）に実在する市区町村だけを出せば、空振りが起きない。
 *
 * ## 政令市は「市全体」も出す
 *
 * データの市区町村は区まで入っている（「横浜市中区」）。API の一致は**前方一致**なので、
 * 「横浜市」と書けば全区をまとめられる（#116）。区しか選べないと、その機能に画面から
 * 辿り着けないので、区を持つ市には「市全体」の選択肢を足す。
 */

/** 政令市（区を持つ市）。前方一致で区をまとめるのに使う。 */
const CITY_WITH_WARDS = /^(.+市)(.+区)$/

export type MunicipalityOption = {
  /** API に渡す値（前方一致）。 */
  readonly value: string
  readonly labelJa: string
  readonly stationCount: number
  /** 区をまとめた「市全体」か、単独の市区町村か。 */
  readonly kind: 'city' | 'municipality'
}

type Counter = Map<string, number>

function bump(counter: Counter, name: string): void {
  counter.set(name, (counter.get(name) ?? 0) + 1)
}

/** 駅数の多い順。同数は名前順（並びを決定的にする）。 */
function byCountDesc(a: MunicipalityOption, b: MunicipalityOption): number {
  return b.stationCount - a.stationCount || a.value.localeCompare(b.value, 'ja')
}

function toOptions(counter: Counter, kind: MunicipalityOption['kind'], suffix: string) {
  return [...counter.entries()]
    .map(([value, stationCount]) => ({
      value,
      labelJa: `${value}${suffix}`,
      stationCount,
      kind,
    }))
    .sort(byCountDesc)
}

/**
 * 駅一覧 → 市区町村の選択肢（「市全体」が先、次に単独の市区町村）。
 * 駅数を持たせるのは、**選ぶ前に候補の大きさが分かる**ようにするため。
 */
export function municipalityOptions(
  stations: readonly { readonly municipality: string | null }[],
): readonly MunicipalityOption[] {
  const cities: Counter = new Map()
  const plain: Counter = new Map()
  for (const station of stations) {
    const name = station.municipality
    if (name === null || name.length === 0) continue
    const matched = CITY_WITH_WARDS.exec(name)
    bump(plain, name)
    if (matched?.[1] !== undefined) bump(cities, matched[1])
  }
  return [...toOptions(cities, 'city', '（全区）'), ...toOptions(plain, 'municipality', '')]
}
