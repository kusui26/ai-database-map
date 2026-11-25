/**
 * 駅詳細（2026-11-25・人口の年齢 PR-3）。共通 API `GET /api/stations/[grp]` と AI のツール `getStationDetail` が、
 * **同じ組み立て**（`loadStationDetail`：駅 → 値の束と年齢別の人口を並列に）を通ることを、DB を差し替えて本物のコードで確かめる。
 *
 * 見ること：
 * - 応答が共通 API の Zod（`stationDetailSchema`）を通り、年齢別の人口（`ageStructure`）が半径ごとにまとまって載る
 * - 知らない駅は 404・ツールは構造化エラー（値の束も年齢も引かない）。DB の失敗は 502
 * - ツールの LLM 向けの要約に年齢の図の数が入り、人口のタブを出したときだけ読み方（`reading`）を添える
 *
 * DB の関数そのもの（配列の並び・CSV との一致）は `pipeline/golden_station_age_profile_test.py`。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stationDetailSchema } from '@/shared/api'
import { DbError } from '@/db/client'
import { TOOL_SPECS } from '@/ai/tool-specs'
import { AGE_STRUCTURE_READING_JA } from '@/domain/stations/age-structure'
import {
  KOSUGI_1KM,
  KOSUGI_STATION,
  KOSUGI_VALUES_1KM,
  YABACHO_1KM,
  ageRowsOf,
  totalsOf,
} from './fixtures/age-structure'

const db = vi.hoisted(() => ({
  stationByGrp: vi.fn(),
  stationBundle: vi.fn(),
  stationAgeProfile: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET } = await import('@/app/api/stations/[grp]/route')

function call(grp: string): Promise<Response> {
  const url = `http://localhost/api/stations/${encodeURIComponent(grp)}`
  return GET(new Request(url), { params: Promise.resolve({ grp }) })
}

beforeEach(() => {
  vi.resetAllMocks()
  db.stationByGrp.mockResolvedValue(KOSUGI_STATION)
  db.stationBundle.mockResolvedValue(new Map(Object.entries(KOSUGI_VALUES_1KM)))
  db.stationAgeProfile.mockResolvedValue([
    ...ageRowsOf(1000, KOSUGI_1KM),
    ...ageRowsOf(500, YABACHO_1KM),
  ])
})

describe('GET /api/stations/[grp]', () => {
  it('共通 API の形で返し、年齢別の人口を半径の昇順にまとめて載せる', async () => {
    const response = await call('武蔵小杉#0')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=3600')
    const detail = stationDetailSchema.parse(await response.json())
    expect(detail.station.grp).toBe('武蔵小杉#0')
    expect(detail.ageStructure?.radii.map((radius) => radius.radiusM)).toEqual([500, 1000])
    const oneKm = detail.ageStructure?.radii[1]
    expect(oneKm?.years.map((year) => year.counts.reduce((sum, count) => sum + count, 0))).toEqual(
      totalsOf(KOSUGI_1KM),
    )
    expect(oneKm?.years.filter((year) => year.projected).map((year) => year.year)[0]).toBe(2025)
    expect(db.stationAgeProfile).toHaveBeenCalledWith('武蔵小杉#0')
  })

  it('年齢の表に無い駅は ageStructure が null（系列はそのまま）', async () => {
    db.stationAgeProfile.mockResolvedValue([])
    const detail = stationDetailSchema.parse(await (await call('武蔵小杉#0')).json())
    expect(detail.ageStructure).toBeNull()
    expect(detail.series.length).toBeGreaterThan(0)
  })

  it('知らない駅は 404（値の束も年齢も引かない）', async () => {
    db.stationByGrp.mockResolvedValue(null)
    const response = await call('無い駅#0')
    expect(response.status).toBe(404)
    expect(db.stationBundle).not.toHaveBeenCalled()
    expect(db.stationAgeProfile).not.toHaveBeenCalled()
  })

  it('年齢の関数が DB に無い（migration の前）など、DB の失敗は 502', async () => {
    db.stationAgeProfile.mockRejectedValue(
      new DbError('function public.station_age_profile(in_grp => text) does not exist'),
    )
    expect((await call('武蔵小杉#0')).status).toBe(502)
  })
})

/** ツールを 1 回走らせる。 */
async function runTool(input: { grp: string; category?: string; radiusM?: number }) {
  const spec = TOOL_SPECS.getStationDetail
  return spec.run(spec.inputSchema.parse(input), { origin: 'http://localhost:3000' })
}

/** LLM 向けの返却を、見たい項目だけに絞って読む（型ガード）。 */
function llmOf(result: Awaited<ReturnType<typeof runTool>>): Record<string, unknown> {
  const value: unknown = result.forLlm
  if (typeof value !== 'object' || value === null) throw new Error('LLM 向けの返却がありません')
  return Object.fromEntries(Object.entries(value))
}

describe('ツール getStationDetail（共通 API と同じ組み立て）', () => {
  it('人口のタブ：要約に年齢別の人口の数が入り、読み方（乗降の予測ではない）を添える', async () => {
    const llm = llmOf(await runTool({ grp: '武蔵小杉#0', category: 'population' }))
    expect(String(llm.summary)).toContain('年齢別の人口（1km圏）: 2020年 → 2050年')
    expect(String(llm.summary)).toContain('15〜64歳（2020年） 55,863 人・74.1%')
    expect(llm.reading).toBe(AGE_STRUCTURE_READING_JA)
  })

  it('人口以外のタブ（乗降）には読み方を添えない', async () => {
    const llm = llmOf(await runTool({ grp: '武蔵小杉#0' }))
    expect(llm.reading).toBeUndefined()
    expect(String(llm.summary)).not.toContain('年齢別の人口')
  })

  it('年齢の表に無い駅は、人口のタブでも読み方を添えない（年齢の図が無い）', async () => {
    db.stationAgeProfile.mockResolvedValue([])
    const llm = llmOf(await runTool({ grp: '武蔵小杉#0', category: 'population' }))
    expect(llm.reading).toBeUndefined()
  })

  it('知らない駅は構造化エラー（副産物なし・年齢を引かない）', async () => {
    db.stationByGrp.mockResolvedValue(null)
    const result = await runTool({ grp: '無い駅#0', category: 'population' })
    expect(result.effects).toEqual([])
    expect(llmOf(result).error).toBe('駅が見つかりません: 無い駅#0')
    expect(db.stationAgeProfile).not.toHaveBeenCalled()
  })
})
