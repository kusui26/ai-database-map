/**
 * チャット応答の Panel[] を「効果グループ」に束ね、各グループに ⤢ 昇格の条件を付ける（純関数）。
 *
 * assemble は効果（駅詳細／ランキング／散布／エリア）順にパネルを並べる：
 *   駅詳細 = stationCard ＋ 本文（trendChart/statTable/barChart・概要は stationProfile）／ランキング = rankingTable ／
 *   散布 = scatter ／エリア = areaSummary ＋ 推移（trendChart）＋ 内訳（barChart）（2026-10-15 B5e）。
 * ここではその境界を復元し、各グループの先頭パネルに**サーバが付けた条件**（data-promotions・
 * パネルと同じ並び）を渡す。条件は図を生んだ副産物からサーバが作る（`shared/promotion.ts`）。
 *
 * 続きに入れるのは、先頭の効果が作る型だけ（`CONTINUATIONS`）。以前は先頭でないパネルを何でも駅詳細の続きにしていたので、
 * 駅詳細のあとのハザードのカードが駅詳細のグループに入り、広い画面ではチップの裏に隠れていた（2026-10-15 に読んで見つけた）。
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
  areaSummary: 'area',
}

/** 先頭パネルの型ごとに、同じグループの続きになる型（その効果が先頭のあとに並べるパネル）。 */
const CONTINUATIONS: Readonly<Partial<Record<Panel['type'], ReadonlySet<Panel['type']>>>> = {
  stationCard: new Set(['trendChart', 'statTable', 'barChart', 'stationProfile']),
  areaSummary: new Set(['trendChart', 'barChart']),
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

/** 前のグループの続きか（先頭の効果が作る型だけ。先頭になる型は続きにしない）。 */
function continues(last: PanelGroup | undefined, panel: Panel): boolean {
  const lead = last?.panels[0]?.type
  return lead !== undefined && CONTINUATIONS[lead]?.has(panel.type) === true
}

/**
 * Panel[]（＋パネルと同じ並びの昇格の条件）を効果グループへ束ねる。
 * 駅カードのあとに続く本文のパネルは、そのカードのグループに入る（駅詳細＝カード＋本文。エリアも要約＋推移＋内訳）。
 * 条件の数がパネルと合わなければ使わない——添字がずれて別の図の条件で開くより、⤢ を出さない方が安全。
 */
export function buildPanelGroups(
  panels: readonly Panel[],
  promotions: PanelPromotions,
): PanelGroup[] {
  const aligned = promotions.length === panels.length ? promotions : []
  return panels.reduce<PanelGroup[]>((groups, panel, index) => {
    const last = groups.at(-1)
    if (last !== undefined && continues(last, panel)) {
      return [...groups.slice(0, -1), { ...last, panels: [...last.panels, panel] }]
    }
    return [...groups, { panels: [panel], promotion: promotionAt(panels, aligned, index) }]
  }, [])
}
