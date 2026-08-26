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

const WARNING_MAP_URL = 'https://www.jma.go.jp/bosai/warning/data/warning/map.json'
const REVERSE_GEOCODER_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const USER_AGENT = 'Mozilla/5.0 (AI Database Map)'
/** 気象庁の配信が `max-age=60`。それ以上細かく取りに行っても新しくならない。 */
const WARNING_TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 6_000
/** 逆ジオの丸め（小数 4 桁 ≒ 11m）。市区町村の境界は動かないので、丸めても答えは変わらない。 */
const COORD_DECIMALS = 4
const MUNICIPALITY_CACHE_CAPACITY = 512

const warningRowSchema = z.object({ code: z.string().optional(), status: z.string().optional() })
const warningMapSchema = z.array(
  z.object({
    reportDatetime: z.string().optional(),
    areaTypes: z.array(
      z.object({
        areas: z.array(z.object({ code: z.string(), warnings: z.array(warningRowSchema) })),
      }),
    ),
  }),
)

/** 区域コード → その区域の発表（と、発表時刻）。 */
export type AreaWarnings = {
  readonly reportedAt: string | null
  readonly warnings: readonly RawWarning[]
}
export type WarningMap = ReadonlyMap<string, AreaWarnings>

const municipalities = createLru<string, Promise<string | null>>(MUNICIPALITY_CACHE_CAPACITY)
let warningCache: { at: number; pending: Promise<WarningMap> } | null = null

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

/** `map.json` → 区域コードで引ける形。 */
async function loadWarningMap(): Promise<WarningMap> {
  const offices = warningMapSchema.parse(await fetchJson(WARNING_MAP_URL))
  const byArea = new Map<string, AreaWarnings>()
  for (const office of offices) {
    for (const areaType of office.areaTypes) {
      for (const area of areaType.areas) {
        byArea.set(area.code, {
          reportedAt: office.reportDatetime ?? null,
          warnings: area.warnings,
        })
      }
    }
  }
  return byArea
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

/** テスト用：キャッシュを空にする。 */
export function resetJmaCache(): void {
  municipalities.clear()
  warningCache = null
}
