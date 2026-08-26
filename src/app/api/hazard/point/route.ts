/**
 * GET /api/hazard/point?lon=&lat=&placeJa= — **地点のハザード**（`docs/260824_flood.md` §6.1）。
 *
 * 中身は `lib/hazard/point-source` が持つ。**AI ツール `getHazardAtPoint` も同じ関数を通る**ので、
 * 「画面では出るが AI は知らない」というズレが構造的に起きない（.claude/CLAUDE.md §2）。
 */

import { hazardPointQuerySchema } from '@/shared/api'
import { hazardPointAt } from '@/lib/hazard/point-source'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
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
