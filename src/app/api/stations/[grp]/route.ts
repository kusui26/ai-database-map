import { loadStationDetail } from '@/domain/stations/load'
import { CACHE, handle, json, NotFoundError } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/stations/[grp] — 駅詳細（全半径分の系列を組立済み＋フラグ＋年齢別の人口）。 */
export function GET(
  _request: Request,
  context: { params: Promise<{ grp: string }> },
): Promise<Response> {
  return handle(async () => {
    const { grp } = await context.params
    const detail = await loadStationDetail(grp)
    if (detail === null) throw new NotFoundError(`駅が見つかりません: ${grp}`)
    return json(detail, CACHE.hour)
  })
}
