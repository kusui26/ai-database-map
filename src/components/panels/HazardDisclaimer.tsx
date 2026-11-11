'use client'

/**
 * 災害のパネルの免責（`docs/260824_flood.md` §7.5-5）と、**それをどこで出すか**。
 *
 * 免責は必ず出す。ただし駅の災害タブは、いま・もし起きたら・逃げるの 3 段に最大 4 枚のパネルを並べ、
 * 4 枚とも同じ 1 文（`HAZARD_DISCLAIMER_JA`）を持つ——カードごとに出すと同じ文が 3〜4 回並んでいた
 * （`docs/261110_fix_PLAN.md` §1.4）。そういう入れ物は末尾で 1 回だけ出し、`HazardDisclaimerAtEndContext` を
 * true にする。中のパネルはそれを見て、自分では出さない。
 *
 * 入れ物の無いところ（現在地・会話・警戒バナーの引き出し）では、今までどおりパネルが自分で出す。
 */

import { createContext, useContext } from 'react'

/** 入れ物が免責を末尾で 1 回出すか（true のとき、中のパネルは出さない）。 */
export const HazardDisclaimerAtEndContext = createContext(false)

export function HazardDisclaimer({ textJa }: { textJa: string }) {
  const shownAtEnd = useContext(HazardDisclaimerAtEndContext)
  if (shownAtEnd) return null
  return <p className="mt-2 text-[11px] text-slate-500">ⓘ {textJa}</p>
}
