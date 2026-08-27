/**
 * 気象庁の警報・注意報と、地点 → 市区町村の解決（`docs/260824_flood.md` §3.3・§8.4）。
 *
 * 取得だけを担い、意味づけ（レベル判定・文言）は `domain/hazard/level` が持つ。
 *
 * ## 全国 1 ファイルで足りる
 *
 * `warning/map.json` は **128KB に全国 58 官署ぶん**が入っていて `max-age=60`（実測）。
 * 府県別に引く必要は無い。**60 秒だけプロセス内にも持つ**ので、
 * 同じインスタンスへの連続アクセスは 1 回の取得に畳まれる。
 *
 * ## 市区町村は逆ジオコーダで解く
 *
 * 警報は**気象庁の区域単位**、地点から分かるのは**緯度経度**。橋渡しは 2 段構え。
 * ①国土地理院の逆ジオコーダで **5 桁の市区町村コード**（実測 250ms・認証不要）
 * ②`shared/jma` の対応表で**二次細分区域**（`pipeline/build_jma_areas.py` が生成）。
 *
 * **メッシュに同梱しないのは、アラートがそもそもオンラインでしか成立しないから。**
 * オフラインで警報を読む道は無いので、オフライン用の 2〜3MB の成果物を配る意味が無い。
 */

import { z } from 'zod'
import { createLru, remember } from '@/lib/lru'
import type { RawWarning } from '@/domain/hazard/level'

/**
 * ⚠ **`warning/data/warning/map.json` ではなく r8 を見る。**
 * 前者は 3 か月前で更新が止まっているのに `max-age=60` を返し続ける（`shared/jma.ts` に実測を記録）。
 */
const WARNING_MAP_URL = 'https://www.jma.go.jp/bosai/warning/data/r8/map.json'
/** 指定河川洪水予報（氾濫注意〜氾濫発生）。`class20Codes` を持つので区域でそのまま繋がる。 */
const FLOOD_FORECAST_URL = 'https://www.jma.go.jp/bosai/flood/data/r8/flood_xml.json'
const REVERSE_GEOCODER_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const USER_AGENT = 'Mozilla/5.0 (AI Database Map)'
/** 気象庁の配信が `max-age=60`。それ以上細かく取りに行っても新しくならない。 */
const WARNING_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 6_000
/** 逆ジオの丸め（小数 4 桁 ≒ 11m）。市区町村の境界は動かないので、丸めても答えは変わらない。 */
const COORD_DECIMALS = 4
const MUNICIPALITY_CACHE_CAPACITY = 512

/**
 * r8 の 1 件。`kinds[].properties[]` に**キキクル相当の警戒レベル**が入っている。
 * 未知のフィールドは Zod が落とすので、**知らない形が来ても壊れない**。
 */
const warningKindSchema = z.object({
  code: z.string().optional(),
  status: z.string().optional(),
  properties: z
    .array(
      z.object({
        type: z.string().optional(),
        significancyPart: z.object({ locals: z.array(z.object({ code: z.string() })) }).optional(),
        criteriaPeriod: z
          .object({ locals: z.array(z.object({ sentence: z.string().optional() })) })
          .optional(),
      }),
    )
    .optional(),
})

const warningItemSchema = z.object({ areaCode: z.string(), kinds: z.array(warningKindSchema) })

const warningMapSchema = z.array(
  z.object({
    reportDatetime: z.string().optional(),
    warning: z
      .object({
        class10Items: z.array(warningItemSchema).optional(),
        class20Items: z.array(warningItemSchema).optional(),
      })
      .optional(),
  }),
)

/** 指定河川洪水予報の 1 件（`class20Codes` で区域に繋がる）。 */
const floodForecastSchema = z.object({
  reportDatetime: z.string().optional(),
  riverName: z.string().optional(),
  item: z
    .object({
      name: z.string().optional(),
      code: z.string().optional(),
      condition: z.string().optional(),
    })
    .optional(),
  class20Codes: z.array(z.string()).optional(),
})
const floodForecastListSchema = z.array(floodForecastSchema)

/** 区域コード → その区域の発表（と、発表時刻）。 */
export type AreaWarnings = {
  readonly reportedAt: string | null
  readonly warnings: readonly RawWarning[]
}
export type WarningMap = ReadonlyMap<string, AreaWarnings>

/** 指定河川洪水予報の 1 件（区域に繋がった形）。 */
export type FloodForecast = {
  readonly riverNameJa: string
  readonly nameJa: string
  readonly code: string | null
  readonly reportedAt: string | null
  readonly areaCodes: readonly string[]
}

const municipalities = createLru<string, Promise<string | null>>(MUNICIPALITY_CACHE_CAPACITY)
let warningCache: { at: number; pending: Promise<WarningMap> } | null = null
let floodCache: { at: number; pending: Promise<readonly FloodForecast[]> } | null = null

/** タイムアウト付きの取得（JSON）。失敗は文脈付きで throw。 */
async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`取得に失敗しました（${response.status}）: ${url}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `r8/map.json` → 区域コードで引ける形。
 *
 * **同じ区域が複数のレコードに現れる**（`dataTypeCode` ごとに 1 レコード＝大雨・土砂・風・波…）。
 * 上書きすると最後の 1 種しか残らないので、**足し合わせる**。
 * 発表時刻は**いちばん新しいもの**を採る（種別ごとに更新時刻が違う）。
 */
async function loadWarningMap(): Promise<WarningMap> {
  const offices = warningMapSchema.parse(await fetchJson(WARNING_MAP_URL))
  const byArea = new Map<string, AreaWarnings>()
  for (const office of offices) {
    const items = [...(office.warning?.class10Items ?? []), ...(office.warning?.class20Items ?? [])]
    for (const item of items) {
      const current = byArea.get(item.areaCode)
      byArea.set(item.areaCode, {
        reportedAt: newerOf(current?.reportedAt ?? null, office.reportDatetime ?? null),
        warnings: [...(current?.warnings ?? []), ...item.kinds],
      })
    }
  }
  return byArea
}

/** 新しい方の時刻（どちらか無ければある方）。 */
function newerOf(left: string | null, right: string | null): string | null {
  if (left === null) return right
  if (right === null) return left
  return left >= right ? left : right
}

/** 全国の警報・注意報（60 秒だけプロセス内に持つ）。 */
export function jmaWarningMap(now: number): Promise<WarningMap> {
  if (warningCache !== null && now - warningCache.at < WARNING_TTL_MS) return warningCache.pending
  const pending = loadWarningMap()
  warningCache = { at: now, pending }
  // 失敗は覚えない（一度の通信断で 60 秒ずっと失敗を返し続けない）。
  void pending.catch(() => {
    if (warningCache?.pending === pending) warningCache = null
  })
  return pending
}

const reverseGeocodeSchema = z.object({
  results: z.object({ muniCd: z.string() }).nullish(),
})

/**
 * 緯度経度 → 5 桁の市区町村コード。**海上や国外は `null`**（エラーではない）。
 * 逆ジオコーダは北海道も `01101` のようにゼロ埋めして返す（対応表と桁が揃う）。
 */
export function municipalityCodeAt(lon: number, lat: number): Promise<string | null> {
  const key = `${lon.toFixed(COORD_DECIMALS)},${lat.toFixed(COORD_DECIMALS)}`
  return remember(municipalities, key, async () => {
    const parsed = reverseGeocodeSchema.safeParse(
      await fetchJson(`${REVERSE_GEOCODER_URL}?lat=${lat}&lon=${lon}`),
    )
    return parsed.success ? (parsed.data.results?.muniCd ?? null) : null
  })
}

/** `flood_xml.json` → 区域に繋がる形（発表中のものだけが載っている）。 */
async function loadFloodForecasts(): Promise<readonly FloodForecast[]> {
  const rows = floodForecastListSchema.parse(await fetchJson(FLOOD_FORECAST_URL))
  return rows.flatMap((row) => {
    const areaCodes = row.class20Codes ?? []
    const nameJa = row.item?.name
    if (areaCodes.length === 0 || nameJa === undefined) return []
    return [
      {
        riverNameJa: row.riverName ?? '',
        nameJa,
        code: row.item?.code ?? null,
        reportedAt: row.reportDatetime ?? null,
        areaCodes,
      },
    ]
  })
}

/** いま出ている指定河川洪水予報（60 秒だけプロセス内に持つ）。 */
export function jmaFloodForecasts(now: number): Promise<readonly FloodForecast[]> {
  if (floodCache !== null && now - floodCache.at < WARNING_TTL_MS) return floodCache.pending
  const pending = loadFloodForecasts()
  floodCache = { at: now, pending }
  void pending.catch(() => {
    if (floodCache?.pending === pending) floodCache = null
  })
  return pending
}

/** テスト用：キャッシュを空にする。 */
export function resetJmaCache(): void {
  municipalities.clear()
  warningCache = null
  floodCache = null
}
