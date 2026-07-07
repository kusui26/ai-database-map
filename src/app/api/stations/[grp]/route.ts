import { stationBundle, stationByGrp } from '@/db/queries'
import { buildStationDetail } from '@/domain/stations/presenter'
import { CACHE, handle, json, NotFoundError } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/stations/[grp] — 駅詳細（全半径分の系列を組立済み＋フラグ）。 */
export function GET(
  _request: Request,
  context: { params: Promise<{ grp: string }> },
): Promise<Response> {
  return handle(async () => {
    const { grp } = await context.params
    const station = await stationByGrp(grp)
    if (station === null) throw new NotFoundError(`駅が見つかりません: ${grp}`)
    const values = await stationBundle(grp)
    return json(buildStationDetail(station, values), CACHE.hour)
  })
}
