import { stationProfileQuerySchema } from '@/shared/api'
import { RADII_M, type RadiusM } from '@/shared/constants'
import { loadStationProfile } from '@/domain/profile/load'
import { BadRequestError, CACHE, handle, json, NotFoundError } from '@/lib/http'

export const runtime = 'nodejs'

/** 検証済みの半径を 6 段の型に戻す（`as` を使わずに）。 */
function radiusOf(radiusM: number): RadiusM {
  const radius = RADII_M.find((each) => each === radiusM)
  if (radius === undefined)
    throw new BadRequestError(`半径は ${RADII_M.join(' / ')} m のいずれかです`)
  return radius
}

/**
 * GET /api/stations/[grp]/profile?radiusM= — 駅周辺のプロフィール（2026-10-09 B4）。
 * 駅×半径の要点・県内／市内での位置・性格の目安・災害の要約・見ていないこと。組み立ては `src/domain/profile/`。
 */
export function GET(
  request: Request,
  context: { params: Promise<{ grp: string }> },
): Promise<Response> {
  return handle(async () => {
    const { grp } = await context.params
    const params = new URL(request.url).searchParams
    const query = stationProfileQuerySchema.parse({ radiusM: params.get('radiusM') ?? undefined })
    const profile = await loadStationProfile(grp, radiusOf(query.radiusM))
    if (profile === null) throw new NotFoundError(`駅が見つかりません: ${grp}`)
    return json(profile, CACHE.hour)
  })
}
