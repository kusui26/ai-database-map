import { catalog, entries, entriesForCategory } from '@/shared/catalog'
import { metricsQuerySchema } from '@/shared/api'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/metrics?category= — 自己記述カタログ（DB 不要・in-memory）。 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = metricsQuerySchema.parse({ category: params.get('category') ?? undefined })
    const list = query.category === undefined ? entries : entriesForCategory(query.category)
    return json(
      {
        categories: catalog.categories,
        radii: catalog.radii,
        stationAttributes: catalog.stationAttributes,
        entries: list,
      },
      CACHE.day,
    )
  })
}
