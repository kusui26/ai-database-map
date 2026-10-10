/**
 * ドメイン：エリアの一覧（共通 API `GET /api/areas`・2026-10-10 B5b）——AI・画面・MCP がエリアを選ぶ**自己記述のカタログ**。
 *
 * 行政区域（1,961：全国・都道府県・政令市・東京 23 区・市区町村・区）の鍵・名前・親・駅の数・無い値と、沿線の幅、区域の指標
 * （名前・単位・年・区域の種類ごとの作り方と出典）、エリアの文字列の書き方。沿線は `/api/lines` の路線コードと幅で書く
 * （601 路線 × 3 幅をここに並べると、行政区域の一覧の倍になる）。
 */

import { areaCatalogRows, type AreaCatalogRow } from '@/db/queries'
import { AREA_REF_FORMATS_JA, LINE_WIDTHS_M } from '@/shared/area-ref'
import { areaCatalog } from '@/shared/area-catalog'
import { type AreaCatalogEntry, type AreasResponse } from '@/shared/area-summary'

function entryOf(row: AreaCatalogRow): AreaCatalogEntry {
  return {
    ref: row.key,
    kind: row.kind,
    code: row.code,
    nameJa: row.nameJa,
    labelJa: row.labelJa,
    prefecture: row.prefecture,
    parentRef: row.parentKey,
    groupRef: row.groupKey,
    stationCount: row.stationCount,
    missing: [...row.missing],
  }
}

/** 行政区域の行 → 共通 API の応答（純関数）。 */
export function areasResponseOf(rows: readonly AreaCatalogRow[]): AreasResponse {
  return {
    kinds: areaCatalog.kinds,
    areas: rows.map(entryOf),
    lineWidthsM: [...LINE_WIDTHS_M],
    refFormatsJa: [...AREA_REF_FORMATS_JA],
    metrics: areaCatalog.metrics,
  }
}

export async function loadAreas(): Promise<AreasResponse> {
  return areasResponseOf(await areaCatalogRows())
}
