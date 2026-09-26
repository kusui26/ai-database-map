/**
 * チャット応答の Panel[] を「効果グループ」に束ね、各グループに ⤢ 昇格の条件を付ける（純関数）。
 *
 * assemble は効果（駅詳細／ランキング／散布）順にパネルを並べる：
 *   駅詳細 = stationCard ＋ 本文（trendChart/statTable/barChart）／ランキング = rankingTable ／散布 = scatter。
 * ここではその境界を復元し、各グループの先頭パネルに**サーバが付けた条件**（data-promotions・
 * パネルと同じ並び）を渡す。条件は図を生んだ副産物からサーバが作る（`shared/promotion.ts`）。
 *
 * 以前はここで、パネルとツール呼び出しを照合して条件を推し量っていた。同じ指標で呼び出しが 2 つあると
 * どちらの図も最初の呼び出しに結びつき、失敗した呼び出しまで拾うことがあった（2026-09-26）。
 */

import { type PanelPromotion, type PanelPromotions } from '@/shared/promotion'
import { type Panel } from '@/shared/protocol'

export type PanelGroup = {
  readonly panels: readonly Panel[]
  readonly promotion: PanelPromotion | null
}

/** 先頭パネルの型ごとに、付いてよい昇格の種類（食い違えば昇格させない＝別の図の条件で開かない）。 */
const PROMOTION_KIND_OF_LEAD: Readonly<Partial<Record<Panel['type'], PanelPromotion['kind']>>> = {
  stationCard: 'detail',
  rankingTable: 'ranking',
  scatter: 'scatter',
}

/** パネルの添字の昇格。先頭パネルの型と種類が合うときだけ採る。 */
function promotionAt(
  panels: readonly Panel[],
  promotions: PanelPromotions,
  index: number,
): PanelPromotion | null {
  const promotion = promotions[index] ?? null
  const expected = PROMOTION_KIND_OF_LEAD[panels[index]?.type ?? 'markdown']
  return promotion !== null && promotion.kind === expected ? promotion : null
}

/** グループの先頭になるパネルか（駅カード・順位表・散布）。 */
function isLead(panel: Panel): boolean {
  return PROMOTION_KIND_OF_LEAD[panel.type] !== undefined
}

/**
 * Panel[]（＋パネルと同じ並びの昇格の条件）を効果グループへ束ねる。
 * 駅カードのあとに続く本文のパネルは、そのカードのグループに入る（駅詳細＝カード＋本文）。
 * 条件の数がパネルと合わなければ使わない——添字がずれて別の図の条件で開くより、⤢ を出さない方が安全。
 */
export function buildPanelGroups(
  panels: readonly Panel[],
  promotions: PanelPromotions,
): PanelGroup[] {
  const aligned = promotions.length === panels.length ? promotions : []
  return panels.reduce<PanelGroup[]>((groups, panel, index) => {
    const last = groups.at(-1)
    const continuesDetail =
      !isLead(panel) && last !== undefined && last.panels[0]?.type === 'stationCard'
    if (continuesDetail) {
      return [...groups.slice(0, -1), { ...last, panels: [...last.panels, panel] }]
    }
    return [...groups, { panels: [panel], promotion: promotionAt(panels, aligned, index) }]
  }, [])
}
