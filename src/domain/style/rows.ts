/**
 * ドメイン：色分けの応答の**駅の行**と**エリアの名前**（純関数・2026-10-11 B5c・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * 地図のホバー・地図レポート・凡例は、ここで書いた文をそのまま出す（値の書式と単位は指標のカタログから・画面で組み立てない）。
 */

import { type ResolvedArea } from '@/domain/area-summary/resolve'
import { type StationClassAssignment } from '@/shared/area-summary'
import { type CatalogEntry } from '@/shared/catalog'
import { nearLabel } from '@/shared/constants'
import { formatWithUnit } from '@/shared/format'
import { schemeOf, type StyleInput } from './classify'

/** 駅の値の書き方（増減・誤差は符号を付ける：「+7.2%」「-1.6%」）。 */
export function stationValueJa(value: number, entry: CatalogEntry): string {
  return formatWithUnit(value, entry.format, entry.unit, {
    signed: schemeOf(entry) === 'diverging',
  })
}

/** 値のある駅 → 応答の行（段・元の数・書いた値。並びは入力のまま）。 */
export function classRows(
  inputs: readonly StyleInput[],
  assignments: ReadonlyMap<string, number | null>,
  entry: CatalogEntry,
): StationClassAssignment[] {
  return inputs.map((input) => ({
    grp: input.grp,
    cls: assignments.get(input.grp) ?? null,
    value: input.value,
    valueJa: stationValueJa(input.value, entry),
  }))
}

/**
 * 色分けしたエリアの名前（凡例の「どこの駅か」）。沿線は路線の駅の集合なので幅を書かない（幅によらない）。
 */
export function coloringAreaLabelJa(area: ResolvedArea): string {
  switch (area.type) {
    case 'admin':
      return area.row.labelJa
    case 'line':
      return `${area.row.nameJa}の沿線`
    case 'near':
      return nearLabel(area.origin.label, area.withinM)
    case 'bbox':
      return '地図の範囲'
  }
}
