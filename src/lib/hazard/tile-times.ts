/**
 * キキクルの配信時刻（`targetTimes.json`）を取る（`docs/260824_flood.md` §7.4）。
 *
 * 取得だけを担い、どれを選ぶか・どう埋めるかは `domain/hazard/tile-time` が持つ。
 * 取得先はカタログの `tile.timesUrl`（**ここに URL を直書きしない**——
 * 配信先が変わったときに直す場所が 2 つになる）。
 *
 * ブラウザから直接叩く。気象庁の配信は `access-control-allow-origin: *`・`max-age=60`（実測）で、
 * タイル本体も同じ配信元から直接読むので、**時刻だけ自前サーバを経由させる意味が無い**。
 */

import { z } from 'zod'
import type { HazardTileTime } from '@/domain/hazard/tile-time'

/** 気象庁の配信が `max-age=60`。それより長く待つ理由も、短く叩く意味も無い。 */
const FETCH_TIMEOUT_MS = 6_000

/** 読むものだけを宣言する（未知のフィールドは Zod が落とす）。 */
const tileTimeSchema = z.object({
  basetime: z.string(),
  validtime: z.string(),
  member: z.string(),
  elements: z.array(z.string()).optional(),
})
const tileTimesSchema = z.array(tileTimeSchema)

/** 配信時刻の一覧（新しい順とは限らないので、選ぶのはドメインに任せる）。 */
export async function hazardTileTimes(url: string): Promise<readonly HazardTileTime[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`配信時刻を取得できません（${response.status}）: ${url}`)
    return tileTimesSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
  }
}
