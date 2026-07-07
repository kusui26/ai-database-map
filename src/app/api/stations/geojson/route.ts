import { stationsGeojson } from '@/db/queries'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/stations/geojson — 全駅 FeatureCollection（1回配信＋CDNキャッシュ・plan §2.2-①）。 */
export function GET(): Promise<Response> {
  return handle(async () => json(await stationsGeojson(), CACHE.day))
}
