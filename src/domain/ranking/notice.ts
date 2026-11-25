/**
 * ドメイン：順位の行に出す**注意の印**（純関数・2026-11-25・計画書 261122 §8.2）。
 *
 * 2026-07-31 の決め方（`docs/260731_reliability_flag_semantics.md`）は、除外（⚠・`reliabilityFlagKey`）と注意（駅詳細のバッジ・
 * `noticeFlagKey`）を分ける。順位の ⚠ と「信頼性の低い値を除外」は、除外のフラグのまま変えない。
 *
 * 注意のうち**年齢不詳**だけを、順位の行に別の印（※）で出す。都心の駅が上に来る年齢の順位では、年齢の構成の多くを補った値が
 * 並ぶ（本番の DB・2026-11-25：「愛知県で生産年齢人口の割合が高い駅」は上位 20 のうち 14 駅）。注意のフラグを持つほかの指標には
 * 出さない——所得の総額の「政令市」は駅の置かれた条件で、所得タブの注記にしてある（行ごとに出すと政令市の駅が全部に付く）。
 * コロナ前後比の被覆は同じ性質だが、出すとコロナの順位の答えが変わるので、広げるなら別に決める。
 */

import { type CatalogEntry, getEntry } from '@/shared/catalog'

/** 順位の行に出す注意（注意のフラグのファミリ → 印の意味）。ここに無い注意は行に出さない。 */
const RANKING_NOTICES_JA: Readonly<Record<string, string>> = {
  pop_ageunk: '※ 年齢不詳が多い駅（年齢の構成の多くを補った値）',
}

/** その指標の順位で行に出す注意：注意のフラグの key と、印の意味。 */
export type RankingNotice = { readonly flagKey: string; readonly noticeJa: string }

/**
 * 指標 → 順位の行に出す注意（無ければ null）。注意のフラグが除外のフラグと同じ指標（多くの指標）は、⚠ が言うので出さない。
 */
export function rankingNoticeOf(entry: CatalogEntry): RankingNotice | null {
  const flagKey = entry.noticeFlagKey
  if (flagKey === null || flagKey === entry.reliabilityFlagKey) return null
  const family = getEntry(flagKey)?.baseMetric
  const noticeJa = family === undefined ? undefined : RANKING_NOTICES_JA[family]
  return noticeJa === undefined ? null : { flagKey, noticeJa }
}
