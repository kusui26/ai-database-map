/**
 * GET /api/hazard/catalog?group= — ハザード・レイヤカタログ（自己記述・DB 不要）。
 *
 * 凡例・レイヤ制御・AI ツール記述が読む単一の入口。`/api/metrics` と同じく in-memory で、
 * 意味づけ（ラベル・階級・色・網羅性の注記・出典）を**すべて済ませた形**で返す
 * （生カラム／生タイルのパススルー禁止・architecture.md §6）。
 */

import { hazardCatalog, hazardLayers, hazardLayersForGroup } from '@/shared/hazard'
import { hazardCatalogQuerySchema } from '@/shared/api'
import { hazardGroupViews, hazardLevelViews } from '@/domain/hazard/catalog'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams
    const query = hazardCatalogQuerySchema.parse({ group: params.get('group') ?? undefined })
    const layers = query.group === undefined ? hazardLayers : hazardLayersForGroup(query.group)
    return json(
      {
        version: hazardCatalog.version,
        groups: hazardGroupViews(),
        levels: hazardLevelViews(),
        disclaimerJa: hazardCatalog.disclaimerJa,
        layers,
      },
      CACHE.day,
    )
  })
}
