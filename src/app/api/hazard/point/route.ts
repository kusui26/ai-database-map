/**
 * GET /api/hazard/point?lon=&lat=&placeJa= — **地点のハザード**（`docs/260824_flood.md` §6.1）。
 *
 * 中身は `lib/hazard/point-source` が持つ。**AI ツール `getHazardAtPoint` も同じ関数を通る**ので、
 * 「画面では出るが AI は知らない」というズレが構造的に起きない（.claude/CLAUDE.md §2）。
 */

import { hazardPointQuerySchema } from '@/shared/api'
import { hazardPointAt } from '@/lib/hazard/point-source'
import { limitPerMinute } from '@/ai/rate-limit'
import { CACHE, clientIp, handle, json, rateLimited } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * 1 分あたりの上限（IP・固定窓・`docs/260916_ops_guard.md` G5）。
 *
 * **守っているのは自分のサーバではなく浸水ナビ・250m メッシュ・公式タイル**。CDN は効くが、
 * **座標が 1 つ違えば別のキャッシュキー**なので、地図の上を機械的になぞられるとそのまま
 * 上流への取得になる。同じ上流を叩く MCP ツール `get_hazard_at_point` は 15/分。
 * 画面は 1 つの問いで複数のルートを呼ぶ（地点 → いまの警報 → 避難先）ので、その 2 倍を置く。
 *
 * ⚠ **総量の蓋ではない。** IP ごと・インスタンスごとなので、分散した相手には効かない。
 * 閉じるのは「1 本のスクリプトがうっかり回す」場合である。
 */
const PER_MINUTE = 30

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const limited = limitPerMinute(`hazard-point:${clientIp(request)}`, PER_MINUTE)
    if (!limited.ok) return rateLimited(limited.retryAfterMs)
    const url = new URL(request.url)
    const query = hazardPointQuerySchema.parse({
      lon: url.searchParams.get('lon'),
      lat: url.searchParams.get('lat'),
      placeJa: url.searchParams.get('placeJa') ?? undefined,
    })
    const { point, complete } = await hazardPointAt({
      ...query,
      baseUrl: url.origin,
      now: Date.now(),
    })
    // 完全な答えは年 1 回しか変わらないので 1 日。**欠けた答えは長く配らない**——
    // 外部が一瞬落ちただけで、河川情報の無いカードを 1 日配り続けることになる。
    return json(point, complete ? CACHE.day : CACHE.short)
  })
}
