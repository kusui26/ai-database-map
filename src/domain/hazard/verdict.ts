/**
 * ドメイン：立退き／垂直避難の判定（純関数・`docs/260824_flood.md` §6.2・**決定 6 で確定**）。
 *
 * **人命に関わる判断なので、閾値と順序はプランの表が唯一の合意記録**である。
 * 変えたくなったら、コードより先に §12 の決定を書き換える。
 *
 * ## 「ランク」ではなく実単位で書く
 *
 * プランの表は「浸水深ランク ≥ 3」と書いてあるが、**ランクの刻みは情報源で違う**——
 * 自前メッシュは原典の 6 階級、公式タイルは詳細版の 8 階級。番号で書くと情報源が変わった
 * 瞬間に判定がずれるので、ここでは **3.0m 以上**・**72 時間以上**という実単位で判定する
 * （`HazardPointRank.min` が実単位を持っているのはこのため）。閾値そのものは表と同じ。
 *
 * ## 情報が足りないときは「留まってよい」と言わない
 *
 * 表の 6 番は「いずれにも該当しない → その場に留まる」だが、これは**その地点のハザードが
 * 分かっている**ことが前提である。オフラインでメッシュしか見られなかった場合は
 * 「該当しない」ではなく「**分からない**」なので、`evacuation` を null にする
 * （プロトコルの「判定できないときは null（断定しない）」・§6.4）。閾値の変更ではない。
 *
 * ## **区域のすぐ外**でも「留まってよい」と言わない（§6.2 の追記・PR-4d）
 *
 * 実測で、土石流警戒区域の**約 10m 外**が `evacuation: 'stay'`（その場に留まる）になっていた。
 * 公式タイルは 1 画素しか見ておらず、土砂はメッシュ化していないので隣接セルの手掛かりも無い
 * ——**手掛かりゼロのまま「留まってよい」と言っていた**。近くが区域なら 6 番を適用しない。
 * これも閾値の変更ではなく、「該当しない」と言い切れる状況の定義を狭めたものである。
 */

import { getHazardLayer, type HazardCertainty } from '@/shared/hazard'
import type { HazardNeighbour, HazardVerdict } from '@/shared/api'
import type { EvacuationAction, HazardLevel } from '@/shared/constants'
import { heaviestHazardLevel } from './catalog'
import { nearHazardHeadlineJa, noHazardHeadlineJa, partialHeadlineJa } from './wording'

/** 判定に必要な 1 件ぶん（`domain/hazard/point` が組み立てる）。 */
export type VerdictItem = {
  readonly layerKey: string
  /** レイヤ名（例「洪水浸水想定区域（想定最大規模）」）。 */
  readonly labelJa: string
  /** 表示用の値（情報源に応じた言い方つき。例「4.31m・3〜5m 未満」）。 */
  readonly valueJa: string
  /** 階級そのもののラベル（例「3〜5m 未満」）。見出しを組むのに使う。 */
  readonly rankLabelJa: string
  readonly level: HazardLevel
  /** 階級の下限（`m` か `hour`。単位はレイヤの `rankUnit`）。 */
  readonly min: number | null
  readonly meaningJa: string
  readonly certainty: HazardCertainty
  /** メッシュ由来のときの被覆率（0–1）。それ以外は null。 */
  readonly coverage: number | null
}

/** 家屋ごと倒れる区域。**上階に留まる意味がない**ので、深さに関係なく立退き。 */
const COLLAPSE_LAYER_KEYS: readonly string[] = ['flood_kaoku_hanran', 'flood_kaoku_kagan']
/** 2 階が浸水・水没する高さ（表の優先 3）。 */
const TAKEAWAY_DEPTH_M = 3
/** 孤立・ライフライン途絶（表の優先 4）。 */
const TAKEAWAY_DURATION_HOURS = 72

type Rule = {
  readonly matches: (item: VerdictItem) => boolean
  readonly action: EvacuationAction
  readonly reasonJa: (item: VerdictItem) => string
}

/** そのレイヤの階級の単位（浸水深 `m` か 継続時間 `hour`）。 */
function unitOf(item: VerdictItem): 'm' | 'hour' | null {
  return getHazardLayer(item.layerKey)?.rankUnit ?? null
}

function isLandslide(item: VerdictItem): boolean {
  return getHazardLayer(item.layerKey)?.group === 'landslide'
}

function isDepthAtLeast(item: VerdictItem, metres: number): boolean {
  return unitOf(item) === 'm' && item.min !== null && item.min >= metres
}

/**
 * 優先順に評価し、**最初に当たった条件を採る（安全側）**。プランの表と 1 対 1。
 */
const RULES: readonly Rule[] = [
  {
    matches: (item) => COLLAPSE_LAYER_KEYS.includes(item.layerKey),
    action: 'takeaway',
    reasonJa: (item) => `${item.labelJa}内のため、建物の上階に留まるのは危険です`,
  },
  {
    matches: isLandslide,
    action: 'takeaway',
    reasonJa: (item) => `${item.labelJa}（${item.valueJa}）のため、その場に留まるのは危険です`,
  },
  {
    matches: (item) => isDepthAtLeast(item, TAKEAWAY_DEPTH_M),
    action: 'takeaway',
    reasonJa: (item) =>
      `${item.labelJa}は ${item.valueJa}。${item.meaningJa}です。` +
      `3 階以上の堅牢な建物があれば垂直避難も選択肢になります`,
  },
  {
    matches: (item) =>
      unitOf(item) === 'hour' && item.min !== null && item.min >= TAKEAWAY_DURATION_HOURS,
    action: 'takeaway',
    reasonJa: (item) =>
      `${item.labelJa}が ${item.valueJa} で、孤立やライフライン途絶のおそれがあります`,
  },
  {
    matches: (item) => unitOf(item) === 'm' && item.min !== null && item.min < TAKEAWAY_DEPTH_M,
    action: 'vertical',
    reasonJa: (item) =>
      `${item.labelJa}は ${item.valueJa}。${item.meaningJa}です。` +
      `上階のある堅牢な建物であれば垂直避難も選択肢になります`,
  },
]

/**
 * 1 文の結論。守るのは 3 つ——**該当が無いときに「安全」と言わない**（§7.5）ことと、
 * **区間でしか言えないときに「入っています」と断定しない**（§5.9）ことと、
 * **近くが区域ならそれを言う**（§6.2 の追記）こと。
 */
function headlineJa(
  matched: VerdictItem | null,
  certainty: HazardCertainty,
  neighbours: readonly HazardNeighbour[],
): string {
  if (matched === null) {
    const nearest = neighbours[0]
    return nearest === undefined
      ? noHazardHeadlineJa(certainty)
      : nearHazardHeadlineJa(
          neighbours.filter((each) => each.source === nearest.source).map((each) => each.labelJa),
          nearest.proximityJa,
        )
  }
  if (matched.certainty === 'partial' && matched.coverage !== null) {
    return partialHeadlineJa(matched.labelJa, matched.rankLabelJa, matched.coverage)
  }
  if (COLLAPSE_LAYER_KEYS.includes(matched.layerKey)) {
    return `この場所は、${matched.labelJa}に入っています。`
  }
  return `この場所は、${matched.labelJa}に入っています（${matched.valueJa}）。`
}

/** 近くが区域であることの根拠（**当たっていないレイヤの話**なので、規則の理由とは分けて足す）。 */
function neighbourReasonsJa(neighbours: readonly HazardNeighbour[]): readonly string[] {
  return neighbours.map(
    (each) => `${each.labelJa}：この場所は区域外ですが、${each.proximityJa}が区域です`,
  )
}

/** 最初に当たった規則と、その原因になった項目。 */
function firstMatch(items: readonly VerdictItem[]): { rule: Rule; item: VerdictItem } | null {
  for (const rule of RULES) {
    const item = items.find((each) => rule.matches(each))
    if (item !== undefined) return { rule, item }
  }
  return null
}

/**
 * 総合判定。**該当が無く、かつ情報が足りない（`unknown`）ときは `evacuation` を null** にする。
 */
export function hazardVerdict(
  items: readonly VerdictItem[],
  certainty: HazardCertainty,
  neighbours: readonly HazardNeighbour[] = [],
): HazardVerdict {
  const hit = firstMatch(items)
  const level = heaviestHazardLevel(items.map((item) => item.level))
  // **規則ごとに 1 文**。同じ規則に複数のレイヤが当たっても（洪水・高潮・計画規模…）、
  // ほぼ同じ文が並ぶだけで読みにくくなる。`items` は危険度の重い順なので先頭を代表にする。
  const reasonsJa = RULES.flatMap((rule) => {
    const item = items.find((each) => rule.matches(each))
    return item === undefined ? [] : [rule.reasonJa(item)]
  })
  if (hit === null) {
    // **近くが区域なら 6 番を適用しない。** 「留まってよい」と言えるのは、
    // その地点のハザードが分かっていて、かつ近くにも無いときだけである（§6.2 の追記）。
    const undecided = certainty === 'unknown' || items.length > 0 || neighbours.length > 0
    return {
      level,
      headlineJa: headlineJa(null, certainty, neighbours),
      evacuation: undecided ? null : 'stay',
      reasonsJa: [...reasonsJa, ...neighbourReasonsJa(neighbours)],
    }
  }
  return {
    level,
    headlineJa: headlineJa(hit.item, certainty, neighbours),
    evacuation: hit.rule.action,
    reasonsJa: [...reasonsJa, ...neighbourReasonsJa(neighbours)],
  }
}
