/**
 * ドメイン：エリアの文字列 → **DB の上のエリア**（2026-10-10 B5b）。要約（`/api/areas/summary`）と色分け
 * （`/api/stations/classes`）が同じ規則で引く——知らないエリアは理由つきで断る（黙って全国にしない・B2 と同じ）。
 *
 * - 行政区域・沿線：`areas` の行（要約なら内訳の子も一緒に 1 回で）
 * - 駅から N m：起点の駅（座標と表示名）
 * - 範囲：そのまま
 *
 * このファイルは非純粋（DB を読む）。駅の絞り込みへの写し方（純関数）は `refs.ts`。
 */

import { areaRows, stationByGrp, type AreaRow, type StationFilter } from '@/db/queries'
import { DEFAULT_LINE_WIDTH_M, formatAreaRef, type AreaRef } from '@/shared/area-ref'
import { type StationRow } from '@/shared/api'
import { type Viewport } from '@/shared/viewport'
import { adminStationFilter, areaKeyOf } from './refs'

/** DB の上で決まったエリア。 */
export type ResolvedArea =
  | {
      readonly type: 'admin'
      readonly ref: string
      readonly row: AreaRow
      /** 内訳の子（要約のときだけ・色分けでは空）。 */
      readonly children: readonly AreaRow[]
    }
  | { readonly type: 'line'; readonly ref: string; readonly row: AreaRow }
  | {
      readonly type: 'near'
      readonly ref: string
      readonly origin: StationRow
      readonly withinM: number
    }
  | { readonly type: 'bbox'; readonly ref: string; readonly bbox: Viewport }

export type AreasResolution =
  | { readonly ok: true; readonly areas: readonly ResolvedArea[] }
  | { readonly ok: false; readonly messageJa: string }

export type ResolveOptions = {
  /** 内訳の子も引く（要約）。 */
  readonly withChildren: boolean
  /** 沿線の幅が要る（要約は区域の値を幅ごとに持つ。色分けは路線の駅だけなので要らない）。 */
  readonly requireLineWidth: boolean
}

const UNKNOWN_HINT_JA =
  '（行政区域は GET /api/areas、沿線の路線コードは GET /api/lines、起点の駅は GET /api/stations?q= で調べる）'

/** DB で引く鍵（沿線の幅が無ければ、駅の集合は幅によらないので既定の幅の行で路線を確かめる）。 */
function lookupKey(ref: AreaRef): string | null {
  if (ref.type === 'line' && ref.widthM === null) {
    return formatAreaRef({ ...ref, widthM: DEFAULT_LINE_WIDTH_M })
  }
  return areaKeyOf(ref)
}

/** DB で引いたもの（区域の行〔内訳の子を含む〕と、起点の駅）。 */
type Lookups = {
  readonly rows: ReadonlyMap<string, AreaRow>
  readonly all: readonly AreaRow[]
  readonly origins: ReadonlyMap<string, StationRow | null>
}

function resolveLine(
  ref: Extract<AreaRef, { type: 'line' }>,
  lookups: Lookups,
  options: ResolveOptions,
): ResolvedArea | string {
  const text = formatAreaRef(ref)
  if (options.requireLineWidth && ref.widthM === null) {
    return `沿線は幅を付けてください: ${text}@1000（500・1000・2000 m）`
  }
  const row = lookups.rows.get(lookupKey(ref) ?? '')
  return row === undefined
    ? `知らない路線です: ${text}${UNKNOWN_HINT_JA}`
    : { type: 'line', ref: text, row }
}

function resolveAdmin(
  ref: AreaRef,
  lookups: Lookups,
  options: ResolveOptions,
): ResolvedArea | string {
  const text = formatAreaRef(ref)
  const row = lookups.rows.get(text)
  if (row === undefined) return `知らないエリアです: ${text}${UNKNOWN_HINT_JA}`
  const children = options.withChildren
    ? lookups.all.filter((each) => each.parentKey === row.key || each.groupKey === row.key)
    : []
  return { type: 'admin', ref: text, row, children }
}

/** エリア 1 つ（引いたものから決める・純関数）。知らなければ理由の文字列。 */
function resolveOne(
  ref: AreaRef,
  lookups: Lookups,
  options: ResolveOptions,
): ResolvedArea | string {
  switch (ref.type) {
    case 'near': {
      const origin = lookups.origins.get(ref.grp) ?? null
      if (origin === null) return `知らない駅です: ${ref.grp}${UNKNOWN_HINT_JA}`
      return { type: 'near', ref: formatAreaRef(ref), origin, withinM: ref.withinM }
    }
    case 'bbox':
      return { type: 'bbox', ref: formatAreaRef(ref), bbox: ref.bbox }
    case 'line':
      return resolveLine(ref, lookups, options)
    default:
      return resolveAdmin(ref, lookups, options)
  }
}

/** 駅から N m の起点の駅（grp → 駅・知らなければ null）。 */
async function originsOf(
  refs: readonly AreaRef[],
): Promise<ReadonlyMap<string, StationRow | null>> {
  const grps = [...new Set(refs.flatMap((ref) => (ref.type === 'near' ? [ref.grp] : [])))]
  const stations = await Promise.all(grps.map((grp) => stationByGrp(grp)))
  return new Map(grps.map((grp, index) => [grp, stations[index] ?? null]))
}

/** エリアの並び → DB の上のエリア（区域の行と起点の駅は並べて引く・どれか 1 つでも知らなければ理由を返す）。 */
export async function resolveAreas(
  refs: readonly AreaRef[],
  options: ResolveOptions,
): Promise<AreasResolution> {
  const keys = refs.map(lookupKey).filter((key): key is string => key !== null)
  const [all, origins] = await Promise.all([areaRows(keys, options.withChildren), originsOf(refs)])
  const lookups: Lookups = { rows: new Map(all.map((row) => [row.key, row])), all, origins }
  const resolved = refs.map((ref) => resolveOne(ref, lookups, options))
  const failure = resolved.find((each): each is string => typeof each === 'string')
  if (failure !== undefined) return { ok: false, messageJa: failure }
  return {
    ok: true,
    areas: resolved.filter((each): each is ResolvedArea => typeof each !== 'string'),
  }
}

/** エリア → 駅の絞り込み（一覧・ランキングと同じ述語）。 */
export function stationFilterOf(area: ResolvedArea): StationFilter {
  switch (area.type) {
    case 'admin':
      return adminStationFilter(area.row)
    case 'line':
      return { lines: [area.row.lineCd ?? 0] }
    case 'near':
      return { near: { lon: area.origin.lon, lat: area.origin.lat, radiusM: area.withinM } }
    case 'bbox':
      return { bbox: area.bbox }
  }
}
