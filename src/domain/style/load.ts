/**
 * ドメイン：エリアの駅を色分けする（DB を読む・2026-10-10 B5b）。共通 API `GET /api/stations/classes` と、エリア要約の凡例が
 * ここを呼ぶ——分け方（`classify.ts`）は 1 つなので、地図の色と要約の凡例は必ず一致する。
 *
 * 2 つ以上のエリアは**合わせて 1 つの凡例**（横浜市と川崎市を同じ物差しで塗る）。駅は grp で 1 回だけ数える
 * （横浜市と神奈川県のように重なっても、二重に数えない）。
 */

import { stationMetricValues, type StationMetricValue } from '@/db/queries'
import { formatAreaRef } from '@/shared/area-ref'
import { type StationClassesResponse } from '@/shared/area-summary'
import { getEntry, type CatalogEntry } from '@/shared/catalog'
import { type RadiusM } from '@/shared/constants'
import { resolveFamilyAtRadius } from '@/domain/metrics/family'
import { parseAreaRefs } from '@/domain/area-summary/refs'
import { resolveAreas, stationFilterOf, type ResolvedArea } from '@/domain/area-summary/resolve'
import { classifyStations, type Classification } from './classify'

/** 色分けできる指標（ランキングと同じ：カタログにあり、並べられるもの。フラグ・文字の列は除く）。 */
export function colorableEntry(key: string): CatalogEntry | null {
  const entry = getEntry(key)
  return entry !== undefined && entry.rankable ? entry : null
}

/** 既定の色分け：人口の増減（5 年・その半径）。 */
export function defaultColorEntry(radiusM: RadiusM): CatalogEntry | null {
  return resolveFamilyAtRadius('pop_gr', radiusM, 5)?.entry ?? null
}

/** 色分けできない指標の断り方。 */
export function notColorableJa(key: string): string {
  return `色分けできない指標です: ${key}（GET /api/metrics で rankable な key を選ぶ）`
}

/** エリアの駅の値を集めて分ける（駅は grp で 1 回だけ）。 */
export async function classifyAreas(
  entry: CatalogEntry,
  areas: readonly ResolvedArea[],
): Promise<Classification> {
  const results = await Promise.all(
    areas.map((area) => stationMetricValues(entry.key, stationFilterOf(area))),
  )
  const stations = new Map<string, StationMetricValue>(
    results.flatMap((result) => result.values).map((value) => [value.grp, value]),
  )
  const inputs = [...stations.values()].flatMap((station) =>
    station.value === null
      ? []
      : [{ grp: station.grp, value: station.value, flagged: station.flagged }],
  )
  return classifyStations(inputs, entry, stations.size)
}

export type StationClassesResult =
  | { readonly ok: true; readonly response: StationClassesResponse }
  | { readonly ok: false; readonly messageJa: string }

/** 共通 API の色分け：指標とエリア → 凡例と駅ごとの段。 */
export async function loadStationClasses(
  metric: string,
  areaTexts: readonly string[],
): Promise<StationClassesResult> {
  const entry = colorableEntry(metric)
  if (entry === null) return { ok: false, messageJa: notColorableJa(metric) }
  const parsed = parseAreaRefs(areaTexts)
  if (!parsed.ok) return parsed
  const resolved = await resolveAreas(parsed.refs, { withChildren: false, requireLineWidth: false })
  if (!resolved.ok) return resolved
  const { legend, assignments } = await classifyAreas(entry, resolved.areas)
  return {
    ok: true,
    response: {
      areas: parsed.refs.map(formatAreaRef),
      legend,
      stations: [...assignments].map(([grp, cls]) => ({ grp, cls })),
    },
  }
}
