/**
 * 共通 API `GET /api/areas`・`/api/areas/summary`・`/api/stations/classes`（2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md`
 * §6.12.7）を、DB を差し替えて本物のルートで確かめる。材料は本物の DB の応答を写した固定データ。
 *
 * 見ること：
 * - 応答が共通 API の Zod を通り、キャッシュは一覧が 1 日・要約と色分けが 1 時間
 * - 往復：区域の行は 1 回で（比較も・内訳の子も）、エリアごとに駅の分布と色分けの値。沿線は路線の駅と駅の円の値、
 *   駅から N m は起点の駅と、その円の値（`dataset_rows` で要る key だけ・6 つの半径のときだけ）
 * - 絞り込み：政令市は名前の前方一致・沿線は路線コード・駅から N m は起点の座標と半径・範囲はそのまま
 * - 400 で理由を返し、**集計を走らせない**：エリアが 0・5 つ、壊れた形、知らないエリア・路線・駅、幅の無い沿線（要約）、
 *   色分けできない指標、6 段以外の半径。DB の失敗は 502
 * - 色分け：2 つのエリアは合わせて 1 つの凡例。重なるエリア（神奈川県と横浜市）の駅は 1 回だけ数える
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type StationFilter, type StationMetricValue } from '@/db/queries'
import { DbError } from '@/db/client'
import {
  areaSummaryResponseSchema,
  areasResponseSchema,
  stationClassesResponseSchema,
} from '@/shared/area-summary'
import {
  KAWASAKI_POP_GR,
  KAWASAKI_ROWS,
  TAKEBASHI,
  TAKEBASHI_5KM,
  TOYOKO_ROWS,
  YOKOHAMA_POP_GR,
  YOKOHAMA_ROWS,
  YOKOHAMA_STATION_STATS,
} from './fixtures/area-summary'

const db = vi.hoisted(() => ({
  areaCatalogRows: vi.fn(),
  areaRows: vi.fn(),
  areaStationStats: vi.fn(),
  stationMetricValues: vi.fn(),
  lineStationsInOrder: vi.fn(),
  datasetRows: vi.fn(),
  stationByGrp: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET: getAreas } = await import('@/app/api/areas/route')
const { GET: getSummary } = await import('@/app/api/areas/summary/route')
const { GET: getClasses } = await import('@/app/api/stations/classes/route')

const ALL_ROWS = [...YOKOHAMA_ROWS, ...KAWASAKI_ROWS, ...TOYOKO_ROWS]

function summary(query: string): Promise<Response> {
  return getSummary(new Request(`http://localhost/api/areas/summary?${query}`))
}

function classes(query: string): Promise<Response> {
  return getClasses(new Request(`http://localhost/api/stations/classes?${query}`))
}

/** 知っている区域の行（内訳の子は鍵の子だけ・`area_rows` と同じ返し方）。 */
function rowsFor(keys: readonly string[], withChildren: boolean) {
  return ALL_ROWS.filter(
    (row) =>
      keys.includes(row.key) ||
      (withChildren && row.parentKey !== null && keys.includes(row.parentKey)),
  )
}

/** 絞り込み → その駅の値（横浜市・川崎市・神奈川県〔両方を含む〕）。 */
function valuesFor(filter: StationFilter): readonly StationMetricValue[] {
  if (filter.municipality === '横浜市') return YOKOHAMA_POP_GR
  if (filter.municipality === '川崎市') return KAWASAKI_POP_GR
  if (filter.prefectures?.includes('神奈川県')) return [...YOKOHAMA_POP_GR, ...KAWASAKI_POP_GR]
  return YOKOHAMA_POP_GR.slice(0, 21)
}

beforeEach(() => {
  vi.resetAllMocks()
  db.areaCatalogRows.mockResolvedValue(
    YOKOHAMA_ROWS.map(
      ({ values: _values, lineCd: _lineCd, widthM: _widthM, areaKm2: _areaKm2, ...rest }) => rest,
    ),
  )
  db.areaRows.mockImplementation(async (keys: readonly string[], withChildren: boolean) =>
    rowsFor(keys, withChildren),
  )
  db.areaStationStats.mockResolvedValue(YOKOHAMA_STATION_STATS)
  db.stationMetricValues.mockImplementation(async (_key: string, filter: StationFilter) => {
    const values = valuesFor(filter)
    return { stationCount: values.length, values }
  })
  db.lineStationsInOrder.mockResolvedValue([
    { seq: 1, grp: '渋谷#0', label: '渋谷' },
    { seq: 2, grp: '代官山#0', label: '代官山' },
  ])
  db.datasetRows.mockResolvedValue({
    '渋谷#0': { pop_2020_1km: 31640, pop_gr_2020_2015_1km: 7.2, pop_gr_pred_2024_2050_1km: -1.6 },
    '代官山#0': { pop_2020_1km: 52529, pop_gr_2020_2015_1km: 5.7, pop_gr_pred_2024_2050_1km: -0.3 },
  })
  db.stationByGrp.mockImplementation(async (grp: string) => (grp === '竹橋#0' ? TAKEBASHI : null))
})

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body: unknown = await response.json()
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
      return { code: String(error.code), message: String(error.message) }
    }
  }
  throw new Error('エラー封筒ではない')
}

/** 集計の問い合わせを 1 つも走らせていない。 */
function expectNoAggregation(): void {
  expect(db.areaStationStats).not.toHaveBeenCalled()
  expect(db.stationMetricValues).not.toHaveBeenCalled()
}

describe('GET /api/areas', () => {
  it('行政区域・沿線の幅・書き方・区域の指標を返し、CDN に 1 日持たせる', async () => {
    const response = await getAreas()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=86400')
    const body = areasResponseSchema.parse(await response.json())
    expect(body.areas).toHaveLength(19)
    expect(body.areas[0]).toMatchObject({ ref: 'muni:14100', nameJa: '横浜市', stationCount: 137 })
    expect(body.refFormatsJa[0]).toBe('jp（全国）')
  })

  it('DB の失敗は 502', async () => {
    db.areaCatalogRows.mockRejectedValue(new DbError('boom'))
    expect((await getAreas()).status).toBe(502)
  })
})

describe('GET /api/areas/summary', () => {
  it('横浜市：区域の値・駅の分布・区の内訳・色分け（既定は人口の増減）。CDN に 1 時間', async () => {
    const response = await summary('area=muni:14100')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=3600')
    const body = areaSummaryResponseSchema.parse(await response.json())
    const [yokohama] = body.areas
    expect(yokohama?.totals[0]?.headlineJa).toBe(
      '3,750,952 人（2025年）・2020→2025年で -0.7%（2015→2020年は +1.4%）',
    )
    expect(yokohama?.breakdown?.rows).toHaveLength(18)
    expect(body.coloring).toEqual({ metricKey: 'pop_gr_2020_2015_1km', areas: ['muni:14100'] })
    expect(body.legend?.classes.map((each) => each.count)).toEqual([4, 16, 25, 59, 32])
    expect(body.radiusM).toBe(1000)
    // 区域の行は内訳の子ごと 1 回・分布と色分けの値は政令市の名前の前方一致で
    expect(db.areaRows).toHaveBeenCalledTimes(1)
    expect(db.areaRows).toHaveBeenCalledWith(['muni:14100'], true)
    expect(db.areaStationStats).toHaveBeenCalledWith(
      [
        'pop_2020_1km',
        'pop_gr_2020_2015_1km',
        'pop_gr_pred_2024_2050_1km',
        'lp_med_2026_1km',
        'emp_n_2021_1km',
      ],
      { municipality: '横浜市' },
    )
    expect(db.stationMetricValues).toHaveBeenCalledWith('pop_gr_2020_2015_1km', {
      municipality: '横浜市',
    })
  })

  it('横浜市と川崎市：区域の行は 1 回・比べる表と合わせた凡例（5・17・28・82・57 駅）', async () => {
    const body = areaSummaryResponseSchema.parse(
      await (await summary('area=muni:14100&area=muni:14130')).json(),
    )
    expect(db.areaRows).toHaveBeenCalledTimes(1)
    expect(db.areaRows).toHaveBeenCalledWith(['muni:14100', 'muni:14130'], true)
    expect(db.areaStationStats).toHaveBeenCalledTimes(2)
    expect(body.comparison?.rows[1]).toEqual({
      labelJa: '人口の増減（2020→2025年）',
      cells: ['-0.7%', '+1.4%'],
    })
    expect(body.legend?.classes.map((each) => each.count)).toEqual([5, 17, 28, 82, 57])
    expect(body.coloring?.areas).toEqual(['muni:14100', 'muni:14130'])
  })

  it('沿線：路線コードで絞り、路線の駅と駅の円の値で内訳（路線の順）', async () => {
    const body = areaSummaryResponseSchema.parse(
      await (await summary('area=line:26001@1000')).json(),
    )
    expect(db.areaStationStats).toHaveBeenCalledWith(expect.any(Array), { lines: [26001] })
    expect(db.lineStationsInOrder).toHaveBeenCalledWith(26001)
    expect(db.datasetRows).toHaveBeenCalledWith(
      ['渋谷#0', '代官山#0'],
      ['pop_2020_1km', 'pop_gr_2020_2015_1km', 'pop_gr_pred_2024_2050_1km'],
    )
    const [toyoko] = body.areas
    expect(toyoko?.breakdown?.rows.map((row) => row.nameJa)).toEqual(['渋谷', '代官山'])
    expect(toyoko?.totals.find((total) => total.id === 'populationFuture')?.headlineJa).toBe(
      '2050年 787,122 人（推計・2020年比 +4.9%）',
    )
  })

  it('駅から 5km：起点の駅を引き、区域の値はその円の値（要る key だけ・1995〜2010 年は使わない・1,277,680 人）', async () => {
    db.datasetRows.mockResolvedValue({ '竹橋#0': TAKEBASHI_5KM })
    const body = areaSummaryResponseSchema.parse(
      await (await summary('area=near:竹橋%230@5000')).json(),
    )
    expect(db.stationByGrp).toHaveBeenCalledWith('竹橋#0')
    const [grps, keys] = db.datasetRows.mock.calls[0] ?? []
    expect(grps).toEqual(['竹橋#0'])
    expect(keys).toHaveLength(19)
    expect(keys).toEqual(
      expect.arrayContaining(['pop_2015_5km', 'pop_pred_2024_2050_5km', 'emp_n_2021_5km']),
    )
    expect(keys).not.toContain('pop_1995_5km')
    expect(db.areaStationStats).toHaveBeenCalledWith(expect.any(Array), {
      near: { lon: TAKEBASHI.lon, lat: TAKEBASHI.lat, radiusM: 5000 },
    })
    const [near] = body.areas
    expect(near?.ref).toBe('near:竹橋#0@5000')
    expect(near?.totals[0]?.headlineJa).toBe('1,277,680 人（2020年）・2015→2020年で +9.8%')
  })

  it('駅から 3km（6 つ以外の半径）：区域の値は引かない', async () => {
    const body = areaSummaryResponseSchema.parse(
      await (await summary('area=near:竹橋%230@3000')).json(),
    )
    expect(db.datasetRows).not.toHaveBeenCalled()
    expect(body.areas[0]?.totals).toEqual([])
  })

  it('地図の範囲：範囲で絞る（区域の行は引かない）', async () => {
    const body = areaSummaryResponseSchema.parse(
      await (await summary('area=bbox:139.55,35.40,139.72,35.53')).json(),
    )
    expect(db.areaStationStats).toHaveBeenCalledWith(expect.any(Array), {
      bbox: { west: 139.55, south: 35.4, east: 139.72, north: 35.53 },
    })
    expect(body.areas[0]?.ref).toBe('bbox:139.55,35.4,139.72,35.53')
  })

  it('半径を替えると、分布と色分けの指標もその半径', async () => {
    await summary('area=muni:14100&radiusM=2000')
    expect(db.areaStationStats.mock.calls[0]?.[0]).toContain('pop_2020_2km')
    expect(db.stationMetricValues).toHaveBeenCalledWith('pop_gr_2020_2015_2km', expect.anything())
  })

  it('colorBy=none は色分けの値を引かない・colorBy に指標を渡すとその指標で（分布にも足す）', async () => {
    const none = areaSummaryResponseSchema.parse(
      await (await summary('area=muni:14100&colorBy=none')).json(),
    )
    expect(none.coloring).toBeNull()
    expect(none.legend).toBeNull()
    expect(db.stationMetricValues).not.toHaveBeenCalled()
    await summary('area=muni:14100&colorBy=pax_2024')
    expect(db.stationMetricValues).toHaveBeenCalledWith('pax_2024', { municipality: '横浜市' })
    expect(db.areaStationStats.mock.calls.at(-1)?.[0]).toContain('pax_2024')
  })

  it.each([
    ['', 'エリア（area）は 1〜4 つ'],
    ['area=jp&area=pref:13&area=pref:14&area=pref:11&area=pref:12', 'エリア（area）は 1〜4 つ'],
    ['area=', 'エリアの文字列が空です'],
    ['area=muni:1410', 'エリアの書き方が正しくない: muni:1410'],
    ['area=jp&area=jp', '同じエリアが 2 度あります: jp'],
    [
      'area=muni:14100&radiusM=3000',
      '半径は 500 / 1000 / 2000 / 5000 / 10000 / 20000 m のいずれかです',
    ],
    ['area=muni:14100&colorBy=pop_2020_1km_flag', '色分けできない指標です: pop_2020_1km_flag'],
    ['area=muni:14100&colorBy=nope', '色分けできない指標です: nope'],
  ])('400（DB に触らない）：%s', async (query, message) => {
    const response = await summary(query)
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain(message)
    expect(db.areaRows).not.toHaveBeenCalled()
    expectNoAggregation()
  })

  it.each([
    ['area=muni:99999', '知らないエリアです: muni:99999'],
    ['area=line:999999@1000', '知らない路線です: line:999999@1000'],
    ['area=line:26001', '沿線は幅を付けてください: line:26001@1000'],
    ['area=near:無い%230@1000', '知らない駅です: 無い#0'],
    ['area=muni:14100&area=muni:99999', '知らないエリアです: muni:99999'],
  ])('400（引いたが集計は走らせない）：%s', async (query, message) => {
    const response = await summary(query)
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain(message)
    expectNoAggregation()
  })

  it('知らないものは調べ方を添える（GET /api/areas・/api/lines・/api/stations?q=）', async () => {
    const { message } = await errorOf(await summary('area=muni:99999'))
    expect(message).toContain('GET /api/areas')
    expect(message).toContain('GET /api/lines')
  })

  it('DB の失敗は 502', async () => {
    db.areaStationStats.mockRejectedValue(new DbError('boom'))
    expect((await summary('area=muni:14100')).status).toBe(502)
  })
})

describe('GET /api/stations/classes', () => {
  it('横浜市の人口の増減：凡例と駅ごとの段（値のある 136 駅）。内訳の子は引かない', async () => {
    const response = await classes('metric=pop_gr_2020_2015_1km&area=muni:14100')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=3600')
    const body = stationClassesResponseSchema.parse(await response.json())
    expect(body.areas).toEqual(['muni:14100'])
    expect(body.stations).toHaveLength(136)
    expect(body.legend.classes.map((each) => each.count)).toEqual([4, 16, 25, 59, 32])
    expect(db.areaRows).toHaveBeenCalledWith(['muni:14100'], false)
    expect(db.areaStationStats).not.toHaveBeenCalled()
  })

  it('沿線は幅が無くてよい（駅の集合は幅によらない・既定の幅の行で路線を確かめる）', async () => {
    const body = stationClassesResponseSchema.parse(
      await (await classes('metric=pop_gr_2020_2015_1km&area=line:26001')).json(),
    )
    expect(db.areaRows).toHaveBeenCalledWith(['line:26001@1000'], false)
    expect(db.stationMetricValues).toHaveBeenCalledWith('pop_gr_2020_2015_1km', { lines: [26001] })
    expect(body.areas).toEqual(['line:26001'])
  })

  it('重なるエリア（神奈川県と横浜市）の駅は 1 回だけ数える', async () => {
    const body = stationClassesResponseSchema.parse(
      await (await classes('metric=pop_gr_2020_2015_1km&area=muni:14100&area=muni:14130')).json(),
    )
    expect(body.stations).toHaveLength(189)
    db.areaRows.mockResolvedValue([
      ...YOKOHAMA_ROWS.slice(0, 1),
      {
        ...YOKOHAMA_ROWS[0],
        key: 'pref:14',
        kind: 'prefecture',
        code: '14',
        nameJa: '神奈川県',
        parentKey: 'jp',
      },
    ])
    const overlapping = stationClassesResponseSchema.parse(
      await (await classes('metric=pop_gr_2020_2015_1km&area=pref:14&area=muni:14100')).json(),
    )
    expect(overlapping.stations).toHaveLength(189)
    expect(overlapping.legend.missingCount).toBe(1)
  })

  it.each([
    ['area=muni:14100', 'metric'],
    ['metric=pop_gr_2020_2015_1km', 'エリア（area）は 1〜4 つ'],
    ['metric=pop_2020_1km_flag&area=muni:14100', '色分けできない指標です: pop_2020_1km_flag'],
    ['metric=pop_gr_2020_2015_1km&area=pref:99', 'エリアの書き方が正しくない: pref:99'],
  ])('400（DB に触らない）：%s', async (query, message) => {
    const response = await classes(query)
    expect(response.status).toBe(400)
    expect((await errorOf(response)).message).toContain(message)
    expect(db.areaRows).not.toHaveBeenCalled()
    expectNoAggregation()
  })

  it('知らないエリアは 400（値は引かない）', async () => {
    const response = await classes('metric=pop_gr_2020_2015_1km&area=muni:99999')
    expect(response.status).toBe(400)
    expectNoAggregation()
  })
})
