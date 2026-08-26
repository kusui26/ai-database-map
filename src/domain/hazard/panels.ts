/**
 * ドメイン：地点のハザード → **GUI Chat Protocol のパネル**（`docs/260824_flood.md` §6.4）。
 *
 * UI もチャットも**同じ 1 枚のカード**を描く。ここで組み立てておけば、
 * Phase 4 の AI ツール（`getHazardAtPoint`）はこの関数を呼ぶだけで済み、
 * 「画面には出るが AI は説明できない」というズレが構造的に起きない（.claude/CLAUDE.md §2）。
 */

import type { HazardPointResponse } from '@/shared/api'
import type { HazardCardPanel, PanelSize } from '@/shared/protocol'

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
