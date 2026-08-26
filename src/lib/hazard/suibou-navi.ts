/**
 * 浸水ナビ（地点別浸水シミュレーション検索システム）の API クライアント。
 * **サーバ専用**（`docs/260824_flood.md` §3.4・§6.3）。
 *
 * この 1 本で「**どの川が・何 m・何分後に・何日続く**」が言える。自前でデータを持たずに
 * 地点の意味づけができる、Phase 2 でいちばん効く情報源である。
 *
 * ## なぜ `fetch` ではなく `node:https` なのか
 *
 * `suiboumap.gsi.go.jp` は **TLS の安全な再ネゴシエーション（RFC 5746）に対応していない**。
 * Node の `fetch`（undici／OpenSSL 3）は既定でこれを拒否するので、
 * `unsafe legacy renegotiation disabled` で必ず失敗する（実測・2026-08-26）。
 * そのため**このホストに限って** `SSL_OP_LEGACY_SERVER_CONNECT` を有効にした Agent を使う。
 * 送るのは経緯度だけで**資格情報を一切送らない**ので、再ネゴシエーションの攻撃面は無い。
 * 相手が RFC 5746 に対応したら、この Agent ごと消して `fetch` に戻せる。
 *
 * ## レート制限
 *
 * 利用マニュアルに**分間 30 リクエスト以下**が明記されている。1 地点で 3 本叩くので、
 * ①**250m メッシュ単位でキャッシュ**し ②**分間 24 本**（余裕を持たせた上限）で頭打ちにする。
 * 上限に当たったら**黙って落とさず**、`rivers: []` と注記を返して②③の答えで組み立てる。
 */

import https from 'node:https'
import { constants } from 'node:crypto'
import { z } from 'zod'
import type { HazardRiver } from '@/shared/api'
import { meshCodeFromLonLat } from '@/shared/mesh'
import { createLru, remember } from '@/lib/lru'

const BASE_URL = 'https://suiboumap.gsi.go.jp/shinsuimap/Api/Public'
/** `CSVScale=0` ＝ 想定最大規模（`flood_l2` と同じ想定）。 */
const LARGEST_SCALE = 0
/**
 * 取得そのものの上限。**実測で 3 本並列が 3.5〜4.0 秒**、プロセス最初の 1 回だけ
 * TLS ハンドシェイクぶん 8 秒台まで伸びることがある（2026-08-26）。
 * プランの初期値 5 秒では冷えた 1 回目を落としてしまうので広げた。
 */
const TIMEOUT_MS = 9_000
/**
 * これを超えたら**待たずに返す**（取得は裏で続き、キャッシュに載る）。
 * 防災 UI は「9 秒沈黙」より「先にメッシュとタイルの答え、河川は次の呼び出しで」が正しい。
 */
const SOFT_DEADLINE_MS = 3_500
/** 分間の上限（明記は 30。3 本 × 8 地点ぶんの余裕を残す）。 */
const RATE_LIMIT_PER_MINUTE = 24
const RATE_WINDOW_MS = 60_000
/** 1 地点で叩く本数（深さ・到達・継続）。 */
const ENDPOINTS_PER_POINT = 3
/** 250m メッシュ単位のキャッシュ枚数。 */
const CACHE_CAPACITY = 256

/** 相手が RFC 5746 に非対応なので、このホストに限って旧来の再ネゴシエーションを許す。 */
const agent = new https.Agent({
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
  keepAlive: true,
})

const riverRowSchema = z.object({
  EntryRiverName: z.string(),
  CSVScale: z.number().optional(),
  Depth: z.number().optional(),
  ArriveTime: z.number().optional(),
  ContinueTime: z.number().optional(),
})
type RiverRow = z.infer<typeof riverRowSchema>
const riverRowsSchema = z.array(riverRowSchema)

const cache = createLru<string, Promise<readonly HazardRiver[]>>(CACHE_CAPACITY)
let rateWindow = { count: 0, resetAt: 0 }

/** 固定窓のレート判定。`now` を引数に取るのでテストできる。 */
export function takeSuibouNaviSlots(slots: number, now: number): boolean {
  if (now >= rateWindow.resetAt) rateWindow = { count: 0, resetAt: now + RATE_WINDOW_MS }
  if (rateWindow.count + slots > RATE_LIMIT_PER_MINUTE) return false
  rateWindow = { ...rateWindow, count: rateWindow.count + slots }
  return true
}

/** GET して本文を読む（タイムアウトつき）。失敗は throw。 */
function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { agent, headers: { accept: 'application/json' } },
      (response) => {
        const chunks: string[] = []
        response.setEncoding('utf-8')
        response.on('data', (chunk: string) => chunks.push(chunk))
        response.on('end', () =>
          response.statusCode === 200
            ? resolve(chunks.join(''))
            : reject(new Error(`浸水ナビが ${response.statusCode} を返しました`)),
        )
      },
    )
    request.on('error', (error) => reject(new Error(`浸水ナビに接続できません: ${error.message}`)))
    request.setTimeout(TIMEOUT_MS, () =>
      request.destroy(new Error('浸水ナビがタイムアウトしました')),
    )
  })
}

/** 1 エンドポイントぶん。壊れた応答は空として扱う（部分応答でも答えを返す）。 */
async function fetchRows(path: string, query: string): Promise<readonly RiverRow[]> {
  const parsed = riverRowsSchema.safeParse(
    JSON.parse(await getText(`${BASE_URL}/${path}?${query}`)),
  )
  return parsed.success ? parsed.data : []
}

/** 同じ川の行を選ぶ。**想定最大規模を優先**し、無ければ他の規模で代用する。 */
function pickForRiver(rows: readonly RiverRow[], nameJa: string): RiverRow | undefined {
  const mine = rows.filter((row) => row.EntryRiverName === nameJa)
  return mine.find((row) => row.CSVScale === LARGEST_SCALE) ?? mine[0]
}

/** 3 本の応答を川の名前で束ねる（深さは想定最大規模のみ）。 */
function mergeRivers(
  depths: readonly RiverRow[],
  arrives: readonly RiverRow[],
  continues: readonly RiverRow[],
): readonly HazardRiver[] {
  return depths
    .filter((row) => row.CSVScale === LARGEST_SCALE && row.Depth !== undefined)
    .map((row) => ({
      nameJa: row.EntryRiverName,
      maxDepthM: row.Depth ?? null,
      arriveMin: pickForRiver(arrives, row.EntryRiverName)?.ArriveTime ?? null,
      continueMin: pickForRiver(continues, row.EntryRiverName)?.ContinueTime ?? null,
    }))
    .sort((a, b) => (b.maxDepthM ?? 0) - (a.maxDepthM ?? 0))
}

async function loadRivers(lon: number, lat: number): Promise<readonly HazardRiver[]> {
  const point = `lon=${lon}&lat=${lat}`
  const [depths, arrives, continues] = await Promise.all([
    fetchRows('GetMaxDepthFromLatlon', `${point}&CSVScale=${LARGEST_SCALE}`),
    fetchRows('GetMaxArriveFromLatlon', point),
    fetchRows('GetMaxContinueFromLatlon', point),
  ])
  return mergeRivers(depths, arrives, continues)
}

/** 1 地点ぶんの結果（`rivers` と、取れなかった理由の注記）。 */
export type SuibouNaviResult = {
  readonly rivers: readonly HazardRiver[]
  readonly noteJa: string | null
}

/** 取れなかったときに添える 1 文（**黙って落とさない**・§6.3）。 */
const FALLBACK_NOTE_JA =
  '河川別の浸水深・到達時間は取得できませんでした（浸水深は公式タイルまたは 250m メッシュの区分値です）'

/** 締切までに返らなければ諦める。**取得自体は止めない**——次の呼び出しがキャッシュを拾う。 */
function withSoftDeadline(
  pending: Promise<readonly HazardRiver[]>,
): Promise<readonly HazardRiver[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), SOFT_DEADLINE_MS)
    void pending
      .then((rivers) => resolve(rivers))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timer))
  })
}

/**
 * その地点を含む **250m メッシュ**の河川情報。
 * 同じメッシュ内の問い合わせは 1 回に畳み、レート上限に当たったら空で返す。
 */
export async function suibouNaviRivers(
  lon: number,
  lat: number,
  now: number,
): Promise<SuibouNaviResult> {
  const key = meshCodeFromLonLat(lon, lat)
  if (cache.get(key) === undefined && !takeSuibouNaviSlots(ENDPOINTS_PER_POINT, now)) {
    return { rivers: [], noteJa: FALLBACK_NOTE_JA }
  }
  const rivers = await withSoftDeadline(
    remember(cache, key, () => loadRivers(lon, lat)).catch((error: unknown) => {
      console.error(`浸水ナビを取得できませんでした（${key}）`, error)
      throw error
    }),
  )
  return rivers === null ? { rivers: [], noteJa: FALLBACK_NOTE_JA } : { rivers, noteJa: null }
}

/** テスト用：キャッシュとレート窓を空にする。 */
export function resetSuibouNavi(): void {
  cache.clear()
  rateWindow = { count: 0, resetAt: 0 }
}
