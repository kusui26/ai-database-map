/**
 * ドメイン：駅周辺のプロフィールに**何を載せるか**と、選んだ半径での key の決め方（純関数・2026-10-09 B4）。
 *
 * 計画書（`docs/261001_fix_user_feedback_ui.md` §6.4 B4）の「全カテゴリの要点」＝人口と増減・将来、所得、
 * 地価の水準と増減、事業所・従業者、売上、バス（＋駅そのものの乗降客数）。災害は指標ではないので別に持つ（`hazard.ts`）。
 *
 * ## 年はカタログから決める
 *
 * 指標はファミリ名（`pop_gr`）と期間（5 年・20 年）で書き、key は `familyCandidates`（おすすめと同じ規則）で決める。
 * データの年が進んでも、ここを直さずに最新の年を指す。
 *
 * ## 半径が無い指標は、近い半径に替えて言う
 *
 * 地価の中央値は 20km、地価の増減率は 500m・20km を持たない（公示地点が少なすぎる・広すぎる）。黙って落とすと
 * 「地価が無い駅」に見えるので、近い半径（500m → 1km、20km → 10km）に替え、項目にそう書く（`build.ts`）。
 */

import { type CatalogEntry, entries } from '@/shared/catalog'
import { RADII_M, type RadiusM } from '@/shared/constants'
import { type ProfileItemId, type ProfileSectionId } from '@/shared/profile'
import { familyCandidates } from '@/domain/metrics/family'

/** 載せる指標 1 つ（ファミリ名・短い名前・増減率の期間）。 */
export type ProfileItemSpec = {
  readonly id: ProfileItemId
  /** 指標ファミリ（カタログの `baseMetric`）。 */
  readonly family: string
  /** 短い名前（年と半径は別の欄に出すので含めない）。 */
  readonly labelJa: string
  /** 増減率を何年ぶんの変化で見るか（`recommend/presets.ts` の住まい探しの軸と同じ・5 年／20 年先）。 */
  readonly spanYears?: number
}

export type ProfileSectionSpec = {
  readonly id: ProfileSectionId
  readonly titleJa: string
  readonly items: readonly ProfileItemSpec[]
}

/** プロフィールの並び（画面・AI・MCP で同じ）。 */
export const PROFILE_SECTIONS: readonly ProfileSectionSpec[] = [
  {
    id: 'people',
    titleJa: '住む人',
    items: [
      { id: 'population', family: 'pop', labelJa: '人口' },
      { id: 'populationChange', family: 'pop_gr', labelJa: '人口の増減', spanYears: 5 },
      {
        id: 'populationFuture',
        family: 'pop_gr_pred',
        labelJa: '将来の人口（推計）',
        spanYears: 20,
      },
      { id: 'income', family: 'inc_pc', labelJa: '1人当たり所得' },
    ],
  },
  {
    id: 'landPrice',
    titleJa: '地価',
    items: [
      { id: 'landPrice', family: 'lp_med', labelJa: '地価（中央値）' },
      { id: 'landPriceChange', family: 'lp_gr', labelJa: '地価の増減', spanYears: 5 },
    ],
  },
  {
    id: 'work',
    titleJa: '働く場所・商業',
    items: [
      { id: 'employees', family: 'emp_n', labelJa: '従業者' },
      { id: 'establishments', family: 'estab_n', labelJa: '事業所' },
      { id: 'sales', family: 'sales_dest', labelJa: '売上（小売・飲食・娯楽）' },
    ],
  },
  {
    id: 'transport',
    titleJa: '交通',
    items: [
      { id: 'passengers', family: 'pax', labelJa: '乗降客数（この駅）' },
      { id: 'busStops', family: 'bus_n', labelJa: 'バス停' },
    ],
  },
]

/** 選んだ半径で決まった 1 項目。 */
export type ResolvedProfileItem = {
  readonly spec: ProfileItemSpec
  readonly entry: CatalogEntry
  /** 選んだ半径に無く、近い半径に替えた（`entry.radiusM` が使った半径）。 */
  readonly substituted: boolean
}

export type ResolvedProfileSection = {
  readonly spec: ProfileSectionSpec
  readonly items: readonly ResolvedProfileItem[]
}

/** 選んだ半径に近い順の半径（段の数で近さを測る・同じ近さなら小さい方を先）。 */
export function radiiByCloseness(radiusM: RadiusM): readonly RadiusM[] {
  const at = RADII_M.indexOf(radiusM)
  return [...RADII_M].sort(
    (a, b) => Math.abs(RADII_M.indexOf(a) - at) - Math.abs(RADII_M.indexOf(b) - at) || a - b,
  )
}

/** 1 項目 → 使う key（選んだ半径に無ければ近い半径に替える。どの半径にも無ければ null）。 */
export function resolveProfileItem(
  spec: ProfileItemSpec,
  radiusM: RadiusM,
): ResolvedProfileItem | null {
  for (const candidate of radiiByCloseness(radiusM)) {
    const entry = familyCandidates(spec.family, candidate, spec.spanYears)[0]
    if (entry !== undefined) {
      const substituted = entry.radiusM !== null && entry.radiusM !== radiusM
      return { spec, entry, substituted }
    }
  }
  return null
}

/** プロフィール全体 → 選んだ半径で決まった項目（決まらない項目は落とす＝カタログに無い指標）。 */
export function resolveProfileSections(radiusM: RadiusM): readonly ResolvedProfileSection[] {
  return PROFILE_SECTIONS.map((spec) => ({
    spec,
    items: spec.items.flatMap((item) => {
      const resolved = resolveProfileItem(item, radiusM)
      return resolved === null ? [] : [resolved]
    }),
  }))
}

/** 順位を数える key（項目の key だけ・フラグは数えない）。 */
export function rankedKeys(sections: readonly ResolvedProfileSection[]): readonly string[] {
  return sections.flatMap((section) => section.items.map((item) => item.entry.key))
}

/**
 * 所得の政令市フラグの key（その半径の、最新年度のもの）。
 * 政令市の所得は市の単位でしか公表されないので、半径の内側の納税義務者の過半が政令市なら値は**市全体の平均**が主になる
 * （`docs/income.md` §11 の限界 #1）。市内で比べても差が出ないので、そのときは市内の位置を出さない（`build.ts`）。
 */
export function incomeCityOnlyFlagKey(radiusM: number): string | null {
  const flags = entries
    .filter((entry) => entry.baseMetric === 'inc_city_only' && entry.radiusM === radiusM)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  return flags[0]?.key ?? null
}
