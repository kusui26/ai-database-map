/**
 * `src/db/queries.ts` の年齢別の人口の問い合わせ（2026-11-25・人口の年齢 PR-3）：RPC の名前と引数、行の写し方。
 *
 * SQL の関数（`supabase/migrations/20261125090000_station_age_profiles.sql`）は引数を名前で受ける（PostgREST）。
 * 列（`age0_14` …）を **`AGE_BANDS` の順**に並べ直して `counts` にする——並びがずれると図の区分が入れ替わるので、ここで固定する。
 * 値そのもの（CSV との一致・区分の和＝総数）は `pipeline/golden_station_age_profile_test.py` が本物の DB で確かめる。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGE_BANDS } from '@/shared/api'
import { DbError } from '@/db/client'

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>()
  return { ...actual, db: () => client }
})

const { stationAgeProfile } = await import('@/db/queries')

afterEach(() => {
  vi.resetAllMocks()
})

const RAW = [
  {
    radius_m: 1000,
    year: 2020,
    projected: false,
    age0_14: 9965,
    age15_64: 55863,
    age65_74: 5055,
    age75plus: 4535,
    age_unknown: 2325,
  },
  {
    radius_m: 1000,
    year: 2050,
    projected: true,
    age0_14: 9175,
    age15_64: 51822,
    age65_74: 9329,
    age75plus: 11239,
    age_unknown: null,
  },
]

describe('stationAgeProfile', () => {
  it('RPC station_age_profile を名前つきの引数（in_grp）で呼ぶ', async () => {
    client.rpc.mockResolvedValue({ data: RAW, error: null })
    await stationAgeProfile('武蔵小杉#0')
    expect(client.rpc).toHaveBeenCalledWith('station_age_profile', { in_grp: '武蔵小杉#0' })
  })

  it('列を AGE_BANDS の順（0〜14・15〜64・65〜74・75 歳以上）に並べ、推計の年の不詳は null のまま', async () => {
    client.rpc.mockResolvedValue({ data: RAW, error: null })
    expect(AGE_BANDS).toEqual(['0_14', '15_64', '65_74', '75plus'])
    expect(await stationAgeProfile('武蔵小杉#0')).toEqual([
      {
        radiusM: 1000,
        year: 2020,
        projected: false,
        counts: [9965, 55863, 5055, 4535],
        unknown: 2325,
      },
      {
        radiusM: 1000,
        year: 2050,
        projected: true,
        counts: [9175, 51822, 9329, 11239],
        unknown: null,
      },
    ])
  })

  it('知らない駅は空（エラーにしない）', async () => {
    client.rpc.mockResolvedValue({ data: [], error: null })
    expect(await stationAgeProfile('無い駅#0')).toEqual([])
  })

  it('形の違う行（人数が小数）は Zod で弾く（DB の形のずれを黙って描かない）', async () => {
    client.rpc.mockResolvedValue({ data: [{ ...RAW[0], age15_64: 55863.5 }], error: null })
    await expect(stationAgeProfile('武蔵小杉#0')).rejects.toThrow()
  })

  it('DB の失敗は DbError（ルートが 502 にする）', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    await expect(stationAgeProfile('武蔵小杉#0')).rejects.toBeInstanceOf(DbError)
  })
})
