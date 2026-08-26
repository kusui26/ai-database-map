/**
 * ドメイン：地点のハザード → **GUI Chat Protocol のパネル**（`docs/260824_flood.md` §6.4）。
 *
 * UI もチャットも**同じ 1 枚のカード**を描く。ここで組み立てておけば、
 * Phase 4 の AI ツール（`getHazardAtPoint`）はこの関数を呼ぶだけで済み、
 * 「画面には出るが AI は説明できない」というズレが構造的に起きない（.claude/CLAUDE.md §2）。
 */

import type { HazardPointResponse } from '@/shared/api'
import type { HazardCardPanel, PanelSize } from '@/shared/protocol'
import { HAZARD_GROUP_LABELS_JA } from '@/shared/constants'
import { getHazardLayer } from '@/shared/hazard'

/**
 * 地点の応答 → `hazardCard`。**意味づけは足さない**——応答が持っている文字列を並べ替えるだけ。
 * ここで新しい判断（危険度・行動・言い回し）を作ると、API と UI で答えが分かれる。
 */
export function hazardCardPanel(point: HazardPointResponse, size?: PanelSize): HazardCardPanel {
  return {
    type: 'hazardCard',
    placeJa: point.point.placeJa,
    level: point.verdict.level,
    headlineJa: point.verdict.headlineJa,
    evacuation: point.verdict.evacuation,
    certainty: point.certainty,
    items: point.hazards,
    reasonsJa: point.verdict.reasonsJa,
    // 取得できなかったものの説明も、網羅性の注記と同じ場所に出す——
    // 「河川情報が無い」ことを黙っていると、**無いのか、取れなかったのか**が分からない。
    coverageNotesJa: [...point.notesJa, ...point.coverageNotesJa],
    sources: point.sources,
    disclaimerJa: point.disclaimerJa,
    size,
  }
}

/**
 * 駅カードに 1 行で添える災害バッジの文言（`docs/260824_flood.md` §7.2）。
 *
 * **駅詳細のタブは増やさない**（8 タブ 516px で既にパネル幅を超えている）ので、
 * 1 行に収まる長さにする。レイヤ名は長いので**グループ名**で言う
 * （「洪水浸水想定区域（想定最大規模）」→「洪水」）。
 *
 * 該当が無いときも**「安全」とは言わない**（§7.5）。言えるのは「該当なし」までである。
 */
export function hazardBadgeJa(point: HazardPointResponse): string {
  const worst = point.hazards[0]
  if (worst === undefined) return '指定区域の該当なし'
  const group = getHazardLayer(worst.layerKey)?.group
  const groupJa = group === undefined ? '' : `${HAZARD_GROUP_LABELS_JA[group]} `
  const others = new Set(
    point.hazards.slice(1).map((item) => getHazardLayer(item.layerKey)?.group ?? item.layerKey),
  )
  others.delete(group ?? '')
  const more = others.size === 0 ? '' : `・ほか ${others.size} 種`
  return `${groupJa}${worst.valueJa}${more}`
}

/**
 * 駅バッジに必ず添える限界（§7.2）。
 * **駅の代表点 1 点の話**であって、駅前広場の反対側は違うことがある。
 */
export const STATION_HAZARD_CAVEAT_JA =
  '駅の代表点 1 点の値です。駅前の反対側では異なることがあります。'
