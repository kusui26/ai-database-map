/**
 * ドメイン：色分けの指標（純関数・2026-10-10 B5b → 2026-10-15 B5e で `load.ts` から切り出し）。
 *
 * 共通 API（`/api/areas/summary`・`/api/stations/classes`）と、エリアの図の指標の選択（B5e）が同じ規則を使う——
 * 図が「既定の指標」を画面に出すとき、サーバの既定と別の規則で推し量らない。DB を読まないので画面からも読める。
 */

import { getEntry, type CatalogEntry } from '@/shared/catalog'
import { type RadiusM } from '@/shared/constants'
import { resolveFamilyAtRadius } from '@/domain/metrics/family'

/** 既定の色分けのファミリと期間（人口の増減・5 年）。 */
const DEFAULT_COLOR_FAMILY = 'pop_gr'
const DEFAULT_COLOR_SPAN_YEARS = 5

/** 色分けできる指標（ランキングと同じ：カタログにあり、並べられるもの。フラグ・文字の列は除く）。 */
export function colorableEntry(key: string): CatalogEntry | null {
  const entry = getEntry(key)
  return entry !== undefined && entry.rankable ? entry : null
}

/** 既定の色分け：人口の増減（5 年・その半径）。 */
export function defaultColorEntry(radiusM: RadiusM): CatalogEntry | null {
  return (
    resolveFamilyAtRadius(DEFAULT_COLOR_FAMILY, radiusM, DEFAULT_COLOR_SPAN_YEARS)?.entry ?? null
  )
}

/** 色分けできない指標の断り方。 */
export function notColorableJa(key: string): string {
  return `色分けできない指標です: ${key}（GET /api/metrics で rankable な key を選ぶ）`
}
