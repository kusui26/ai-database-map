/**
 * 共通 API `GET /api/stations/[grp]/profile?radiusM=`（駅周辺のプロフィール・2026-10-09 B4）を、DB を差し替えて本物のルートで確かめる。
 *
 * 見ること：
 * - 応答が共通 API の Zod（`stationProfileSchema`）を通り、CDN に 1 時間持たせる
 * - 順位の問い合わせに**市内の値**（政令市は市全体）と、その半径で決まった 11 指標の key が届く
 * - 半径の既定は 1km。6 段以外・数でない半径は 400 で、**集計を走らせない**
 * - 知らない駅は 404（値の束も順位も引かない）・DB の失敗は 502
 * - 往復は駅 1 回＋並列 3 回（値の束・順位・災害の事前計算）
 *
 * SQL（順位の数え方）は `pipeline/golden_profile_test.py`、組み立ての細部は `tests/domain-profile.test.ts`。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stationProfileSchema } from '@/shared/api'
import { DbError } from '@/db/client'
import { rankedKeys, resolveProfileSections } from '@/domain/profile/items'
import { HAZARD, rank, ranksFor, VALUES_1KM, VALUES_500M, YOKOHAMA } from './fixtures/profile'

const db = vi.hoisted(() => ({
  stationByGrp: vi.fn(),
  stationBundle: vi.fn(),
  stationProfileRanks: vi.fn(),
  stationHazardSummaries: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET } = await import('@/app/api/stations/[grp]/profile/route')

function call(grp: string, query = ''): Promise<Response> {
  const url = `http://localhost/api/stations/${encodeURIComponent(grp)}/profile${query}`
  return GET(new Request(url), { params: Promise.resolve({ grp }) })
}

beforeEach(() => {
  vi.resetAllMocks()
  db.stationByGrp.mockResolvedValue(YOKOHAMA)
  db.stationBundle.mockResolvedValue(new Map(Object.entries({ ...VALUES_1KM, ...VALUES_500M })))
  db.stationProfileRanks.mockImplementation(async (_grp: string, keys: readonly string[]) =>
    ranksFor(keys, rank(66, 348, [37, 137])),
  )
  db.stationHazardSummaries.mockResolvedValue([
    { grp: '横浜#0', version: 1, computedAt: '2026-09-03T00:00:00Z', summary: HAZARD },
  ])
})

describe('GET /api/stations/[grp]/profile', () => {
  it('既定は 1km 圏。共通 API の形で返し、CDN に 1 時間持たせる', async () => {
    const response = await call('横浜#0')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=3600')
    const profile = stationProfileSchema.parse(await response.json())
    expect(profile.radiusM).toBe(1000)
    expect(profile.area).toBe('横浜市')
    expect(profile.character.labelJa).toBe('業務地型')
    expect(profile.hazard?.headlineJa).toBe(HAZARD.headlineJa)
  })

  it('順位の問い合わせに、駅・その半径の 11 指標・市内（政令市は市全体）が届く', async () => {
    await call('横浜#0', '?radiusM=500')
    expect(db.stationProfileRanks).toHaveBeenCalledTimes(1)
    const [grp, keys, area] = db.stationProfileRanks.mock.calls[0] ?? []
    expect(grp).toBe('横浜#0')
    expect(keys).toEqual(rankedKeys(resolveProfileSections(500)))
    expect(keys).toContain('lp_gr_2026_2021_1km') // 500m は地価の増減率が無い＝1km
    expect(area).toBe('横浜市')
    expect(db.stationHazardSummaries).toHaveBeenCalledWith(['横浜#0'])
  })

  it('市区町村が無い駅は、市内を問い合わせない（null）', async () => {
    db.stationByGrp.mockResolvedValue({ ...YOKOHAMA, municipality: null })
    const profile = stationProfileSchema.parse(await (await call('横浜#0')).json())
    expect(db.stationProfileRanks.mock.calls[0]?.[2]).toBeNull()
    expect(profile.area).toBeNull()
  })

  it.each(['?radiusM=3000', '?radiusM=abc', '?radiusM=', '?radiusM=1000.5'])(
    '6 段以外の半径（%s）は 400 で、集計を走らせない',
    async (query) => {
      const response = await call('横浜#0', query)
      expect(response.status).toBe(400)
      const body: unknown = await response.json()
      expect(JSON.stringify(body)).toContain('BAD_REQUEST')
      expect(db.stationByGrp).not.toHaveBeenCalled()
      expect(db.stationProfileRanks).not.toHaveBeenCalled()
    },
  )

  it('知らない駅は 404（値の束も順位も引かない）', async () => {
    db.stationByGrp.mockResolvedValue(null)
    const response = await call('どこにもない#0')
    expect(response.status).toBe(404)
    expect(db.stationBundle).not.toHaveBeenCalled()
    expect(db.stationProfileRanks).not.toHaveBeenCalled()
  })

  it('災害の事前計算が無い駅は hazard: null（分からない＝安全ではない）', async () => {
    db.stationHazardSummaries.mockResolvedValue([])
    const profile = stationProfileSchema.parse(await (await call('横浜#0')).json())
    expect(profile.hazard).toBeNull()
  })

  it('DB の失敗は 502（文脈つきのエラー封筒）', async () => {
    db.stationProfileRanks.mockRejectedValue(
      new DbError('function station_profile_ranks does not exist'),
    )
    const response = await call('横浜#0')
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).toContain('station_profile_ranks')
  })
})
