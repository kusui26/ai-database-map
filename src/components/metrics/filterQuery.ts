/**
 * 絞り込みの値 → 共通 API のクエリ（ランキング・散布・おすすめで同じ・2026-10-08 B2 でまとめた）。
 *
 * 以前は 3 つの取得がそれぞれ同じ項目を書いていた。場所の条件（市区町村・範囲・起点）を足すにあたり 1 か所にした。
 * 絞っていない軸は載せない（URL が短くなり、同じ条件の取得がキャッシュに当たる）。
 */

import { type Viewport } from '@/shared/viewport'
import { type NearFilter } from './filterLink'

/** クエリにする値（`StationFilterValues` が構造的に満たす。おすすめは範囲・起点を持たない）。 */
export type FilterQueryValues = {
  readonly prefectures: readonly string[]
  readonly municipality: string
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  readonly routeTypes: readonly number[]
  readonly lines: readonly number[]
  readonly bbox?: Viewport | null
  readonly near?: NearFilter | null
}

/** 範囲 → クエリの値（「西,南,東,北」）。 */
export function bboxParam(bbox: Viewport): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north].join(',')
}

/** 絞り込みの値をクエリに足す。 */
export function appendFilterParams(params: URLSearchParams, values: FilterQueryValues): void {
  const lists: readonly (readonly [string, readonly (string | number)[]])[] = [
    ['prefecture', values.prefectures],
    ['operators', values.operators],
    ['routes', values.routes],
    ['routeTypes', values.routeTypes],
    ['lines', values.lines],
  ]
  lists
    .filter(([, list]) => list.length > 0)
    .forEach(([name, list]) => params.set(name, list.join(',')))
  if (values.municipality.length > 0) params.set('municipality', values.municipality)
  if (values.bbox !== undefined && values.bbox !== null) params.set('bbox', bboxParam(values.bbox))
  if (values.near !== undefined && values.near !== null) {
    params.set('nearStation', values.near.grp)
    params.set('withinM', String(values.near.radiusM))
  }
}
