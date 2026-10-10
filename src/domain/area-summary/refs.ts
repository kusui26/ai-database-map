/**
 * ドメイン：エリアの文字列の**並び**を読み、エリアを駅の絞り込みへ写す（純関数・2026-10-10 B5b）。
 *
 * - 1〜4 つ（2 つ以上は比較）。同じエリアを 2 度は書かない
 * - 区域の値を持つエリア（行政区域・沿線）は DB の鍵（`muni:14100`・`line:26001@1000`）で引く。駅から N m・範囲は DB に無い
 * - 駅の絞り込みは一覧・ランキングと同じ（`stations_matching_filters`・B2/L2）：政令市は名前の前方一致（「横浜市」で全区）、
 *   市区町村・区は JIS の 5 桁、東京 23 区は区のコードの頭 3 桁（131）、沿線は路線コード、駅から N m は起点と半径
 */

import { type StationFilter } from '@/db/queries'
import { formatAreaRef, MAX_AREAS, parseAreaRef, type AreaRef } from '@/shared/area-ref'

export type AreaRefsParse =
  | { readonly ok: true; readonly refs: readonly AreaRef[] }
  | { readonly ok: false; readonly messageJa: string }

/** 文字列の並び → エリア（形の誤り・数・重なりは理由つき）。 */
export function parseAreaRefs(texts: readonly string[]): AreaRefsParse {
  if (texts.length === 0)
    return { ok: false, messageJa: 'エリア（area）を 1 つ以上指定してください。' }
  if (texts.length > MAX_AREAS) {
    return { ok: false, messageJa: `エリアは ${MAX_AREAS} つまでです（${texts.length} 個）。` }
  }
  const parsed = texts.map(parseAreaRef)
  const failed = parsed.find((each) => !each.ok)
  if (failed !== undefined && !failed.ok) return failed
  const refs = parsed.flatMap((each) => (each.ok ? [each.ref] : []))
  const canonical = refs.map(formatAreaRef)
  const repeated = canonical.find((ref, index) => canonical.indexOf(ref) !== index)
  return repeated === undefined
    ? { ok: true, refs }
    : { ok: false, messageJa: `同じエリアが 2 度あります: ${repeated}` }
}

/** 区域の値を DB に持つエリアの鍵（行政区域・沿線）。駅から N m・範囲は null。 */
export function areaKeyOf(ref: AreaRef): string | null {
  switch (ref.type) {
    case 'country':
    case 'prefecture':
    case 'municipality':
    case 'line':
      return formatAreaRef(ref)
    case 'near':
    case 'bbox':
      return null
  }
}

/** 東京 23 区（特別区部 13100）の駅は、区のコードの頭 3 桁で束ねる（13101〜13123・DB の黄金テストで駅の数を照合）。 */
export const SPECIAL_WARDS_CODE_PREFIX_LENGTH = 3

/** 行政区域 → 駅の絞り込み。 */
export function adminStationFilter(row: {
  readonly kind: string
  readonly code: string | null
  readonly nameJa: string
  readonly prefecture: string | null
}): StationFilter {
  switch (row.kind) {
    case 'country':
      return {}
    case 'prefecture':
      return { prefectures: [row.prefecture ?? row.nameJa] }
    case 'city':
      return { municipality: row.nameJa }
    case 'special_wards':
      return { municipality: (row.code ?? '').slice(0, SPECIAL_WARDS_CODE_PREFIX_LENGTH) }
    default:
      return { municipality: row.code ?? row.nameJa }
  }
}
