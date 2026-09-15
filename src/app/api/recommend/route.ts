/**
 * GET /api/recommend — **おすすめ駅**（`docs/260912_gui_chat_protocol.md` §13.7 W3）。
 *
 * 例：`/api/recommend?municipality=横浜市&routes=東海道線,根岸線&preset=budget&method=minmax`
 *
 * ここは**薄い**。プリセットを引く・重みを差し替える・災害の方針を組む・順位を出す・
 * 応答を組み立てる——どれも `src/domain/recommend/` の純関数で、ルートがするのは
 * 「レート制限 → 検証 → 呼ぶ → 返す」だけ（CLAUDE.md §2 の依存方向）。
 *
 * ## 3 つのガード
 *
 * 1. **レート制限**（IP・1 分）。スライダを動かすたびに叩かれる画面から呼ばれる
 * 2. **絞り込み必須**。無いと全国 9,273 駅が対象になる（`buildRecommendInput` が 400）
 * 3. **候補上限**。超えたら**切り詰めずに 400**——黙って頭を切ると、言っていない判断が混ざる
 *
 * ⚠ **MCP には出さない**（§13.3）。外部エージェント向けのおすすめツールは作らず、
 * スキルは従来どおり `build_dataset` からローカルで合成する。ここは画面のための面。
 */

import { recommendQuerySchema } from '@/shared/api'
import { presentRecommendation } from '@/domain/recommend/presenter'
import { buildRecommendInput } from '@/domain/recommend/request'
import { runRecommendation } from '@/domain/recommend/run'
import { checkRateLimit } from '@/ai/rate-limit'
import { BadRequestError, CACHE, clientIp, handle, json, rateLimited } from '@/lib/http'

export const runtime = 'nodejs'
/** 最大 1,000 駅 × 指標＋災害サマリ。通常は数秒だが、外枠を置く。 */
export const maxDuration = 30

/**
 * 生成レート（IP・1 分・固定窓）。重みスライダから呼ばれる前提で `/api/chat`（20）より緩く、
 * CSV 生成（10）より厳しい。**同じ条件なら CDN が返す**ので、ここを踏むのは条件を変えたときだけ。
 */
const RECOMMEND_LIMIT_PER_MINUTE = 30
const WINDOW_MS = 60_000

/** カンマ区切りのクエリを配列に（未指定は undefined＝スキーマ既定）。 */
function listParam(value: string | null): string[] | undefined {
  return value === null
    ? undefined
    : value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
}

/** 検索パラメータ → スキーマの入力（数値への変換は Zod 側に任せる）。 */
function queryFrom(params: URLSearchParams): Record<string, unknown> {
  return {
    prefectures: listParam(params.get('prefecture')),
    municipality: params.get('municipality') ?? undefined,
    operators: listParam(params.get('operators')),
    routes: listParam(params.get('routes')),
    routeTypes: listParam(params.get('routeTypes'))?.map(Number),
    bbox: params.get('bbox') ?? undefined,
    preset: params.get('preset') ?? undefined,
    weights: params.get('weights') ?? undefined,
    radiusM: params.get('radiusM') ?? undefined,
    method: params.get('method') ?? undefined,
    hazard: params.get('hazard') ?? undefined,
    hazardGroup: params.get('hazardGroup') ?? undefined,
    hazardAtOrAbove: params.get('hazardAtOrAbove') ?? undefined,
    hazardPenalty: params.get('hazardPenalty') ?? undefined,
    flagged: params.get('flagged') ?? undefined,
    topN: params.get('topN') ?? undefined,
    limit: params.get('limit') ?? undefined,
  }
}

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const limit = checkRateLimit(`recommend:${clientIp(request)}`, {
      limit: RECOMMEND_LIMIT_PER_MINUTE,
      windowMs: WINDOW_MS,
      now: Date.now(),
    })
    if (!limit.ok) return rateLimited(limit.retryAfterMs)

    const query = recommendQuerySchema.parse(queryFrom(new URL(request.url).searchParams))
    const built = buildRecommendInput(query)
    if (!built.ok) throw new BadRequestError(built.messageJa)

    const run = await runRecommendation(built.input)
    if (run.kind === 'too-many') {
      throw new BadRequestError(
        `対象が ${run.maxStations} 駅を超えました。エリアを絞ってください（切り詰めると「上位 ${run.maxStations} 駅の中での順位」になってしまうため、勝手には縮めません）。`,
      )
    }
    return json(
      presentRecommendation({
        query,
        input: built.input,
        customized: built.customized,
        run,
      }),
      CACHE.hour,
    )
  })
}
