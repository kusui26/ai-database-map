/**
 * ドメイン：共通 API の絞り込みを、検証済みのクエリから解決する（ランキング・散布で同じ・2026-10-08 B2）。
 *
 * - 路線コードは名前を引く（知らないコードは理由を返す・L2）
 * - 会社は表示名を引く（題・応答の `operatorLabels`・L4）
 * - エリアは起点の駅を引く（形の誤り・知らない駅は理由を返す・B2）
 *
 * 返すのは、DB へ渡す絞り込み（`StationFilter`）と、応答に載せる名前（路線・会社の表示名・エリア）。
 */

import { type StationFilter } from '@/db/queries'
import { type LineRef } from '@/shared/api'
import { areaEcho, areaFilter, resolveArea, type AreaEcho, type AreaQuery } from './area'
import { resolveLineCodes } from './lines'
import { labelsOfOperators } from './operators'

/** 検証済みのクエリの絞り込み（`rankingQuerySchema`・`growthQuerySchema` の出力が構造的に満たす）。 */
export type FilterQuery = AreaQuery & {
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  readonly lines: readonly number[]
}

/** 解決した絞り込み。 */
export type ResolvedFilters = {
  /** DB へ渡す形。 */
  readonly filter: StationFilter
  /** 応答に載せる名前。 */
  readonly lines: readonly LineRef[]
  readonly operatorLabels: readonly string[]
  readonly area: AreaEcho
}

export type FiltersResolution =
  | { readonly ok: true; readonly filters: ResolvedFilters }
  | { readonly ok: false; readonly messageJa: string }

/** クエリ → 絞り込み（路線・会社・エリアの名前を引く。どれも無ければ DB に行かない）。 */
export async function resolveFilters(query: FilterQuery): Promise<FiltersResolution> {
  const [lines, operatorLabels, area] = await Promise.all([
    resolveLineCodes(query.lines),
    labelsOfOperators(query.operators),
    resolveArea(query),
  ])
  if (!lines.ok) return lines
  if (!area.ok) return area
  const filter: StationFilter = {
    prefectures: query.prefectures,
    operators: query.operators,
    routes: query.routes,
    routeTypes: query.routeTypes,
    lines: lines.lines.map((line) => line.lineCd),
    ...areaFilter(area.area),
  }
  return {
    ok: true,
    filters: { filter, lines: lines.lines, operatorLabels, area: areaEcho(area.area) },
  }
}
