/**
 * 地図レポート（`render_map`・`/api/map`）の**駅の色分け**（2026-10-11 B5c・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * DB だけを差し替え、共通 API（`GET /api/stations/classes`）と同じ組み立て（`loadStationClasses`）を通す——Web 地図と
 * 同じ段・同じ色・同じ凡例になることを確かめるため。
 *
 * 見ること：
 * - 条件 → 段・色・座標（全駅の索引から・座標の分からない駅は数を残す）。知らない指標・エリアは共通 API と同じ理由で断る。
 *   描ける駅は 3,000 まで（超えたら絞り方）
 * - 本文：色分けの凡例（指標・どこの何駅か・段の色と駅の数・出典）、注意（エリア全体の値ではない・色の意味・代表点）、既定の題
 * - 描画：canvas の丸に濃い縁、ホバーは textContent（名前を HTML として読まない）。埋め込み JSON から抜けられない
 * - ツール：色分けを頼まれたのに描けないなら URL を作らない。描けたら凡例と同じ言葉で要約を返す
 * - `/api/map`：署名した条件から、開くたびにサーバが色分けを引き直して描く
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type StationFilter, type StationMetricValue } from '@/db/queries'
import {
  clearStationIndexCache,
  coloringSummary,
  defaultTitleJa,
  placeColoredStations,
  reportNotesJa,
  resolveColoring,
  sceneFor,
  tooManyColoredJa,
} from '@/ai/map-report/build'
import { buildMapReportHtml } from '@/ai/map-report/html'
import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_VERSION } from '@/ai/map-report/assets'
import { MAP_MAX_COLORED_STATIONS, mapQuerySchema, signMapToken } from '@/ai/map-report/token'
import { resetRateLimitStore } from '@/ai/rate-limit'
import { signedUrlSecret } from '@/ai/signed-url'
import { TOOL_SPECS } from '@/ai/tool-specs'
import { type MapScene } from '@/domain/map/scene'
import { coloringNotesJa } from '@/domain/style/coloring'
import { DIVERGING_COLORS } from '@/domain/style/palette'
import { type MapAction } from '@/shared/protocol'
import { YOKOHAMA_POP_GR, YOKOHAMA_ROWS } from './fixtures/area-summary'

const db = vi.hoisted(() => ({
  areaRows: vi.fn(),
  stationMetricValues: vi.fn(),
  stationCatalog: vi.fn(),
  listStations: vi.fn(),
  stationByGrp: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const { GET: getMap } = await import('@/app/api/map/route')

const POP_GR = 'pop_gr_2020_2015_1km'
const YOKOHAMA = 'muni:14100'
/** 全国（駅の数の上限を超える）。 */
const COUNTRY_ROW = {
  ...YOKOHAMA_ROWS[0],
  key: 'jp',
  kind: 'country',
  code: null,
  nameJa: '全国',
  labelJa: '全国',
}
/** 座標の分からない駅（索引から外す）。 */
const UNPLACED = 'みなとみらい#0'
const XSS_NAME = '</script><script>alert(1)</script>'

/** 全駅の索引（横浜市の駅に座標を振る。1 駅は外し、1 駅は名前に悪意のある文字列）。 */
function catalog() {
  return YOKOHAMA_POP_GR.filter((each) => each.grp !== UNPLACED).map((each, index) => ({
    grp: each.grp,
    name: each.grp.split('#')[0] ?? each.grp,
    label: each.grp === '横浜#0' ? XSS_NAME : (each.grp.split('#')[0] ?? each.grp),
    prefecture: '神奈川県',
    municipality: '横浜市',
    municipalityCode: '14100',
    lon: 139.5 + index * 0.001,
    lat: 35.4 + index * 0.001,
    paxLatest: null,
  }))
}

/** 全国の駅（上限を 1 つ超える）。 */
function countryValues(): StationMetricValue[] {
  return Array.from({ length: MAP_MAX_COLORED_STATIONS + 1 }, (_, index) => ({
    grp: `駅${index}#0`,
    value: (index % 21) - 10,
    flagged: false,
  }))
}

beforeEach(() => {
  vi.resetAllMocks()
  clearStationIndexCache()
  db.areaRows.mockImplementation(async (keys: readonly string[]) => [
    ...YOKOHAMA_ROWS.filter((row) => keys.includes(row.key)),
    ...(keys.includes('jp') ? [COUNTRY_ROW] : []),
  ])
  db.stationMetricValues.mockImplementation(async (_key: string, filter: StationFilter) => {
    const values = filter.municipality === '横浜市' ? YOKOHAMA_POP_GR : countryValues()
    return { stationCount: values.length, values }
  })
  db.stationCatalog.mockResolvedValue(catalog())
  db.listStations.mockResolvedValue([])
})

afterEach(() => {
  resetRateLimitStore()
})

const COLOR_YOKOHAMA: MapAction = { type: 'colorStations', metricKey: POP_GR, areas: [YOKOHAMA] }

async function yokohamaScene(): Promise<MapScene> {
  return sceneFor([COLOR_YOKOHAMA])
}

function htmlOf(scene: MapScene): string {
  return buildMapReportHtml({
    title: defaultTitleJa(scene),
    scene,
    layers: [],
    notesJa: reportNotesJa({ scene, layers: [], dropped: [] }),
    generatedAtJa: '2026-10-11 01:00',
    assets: { js: LEAFLET_JS, css: LEAFLET_CSS, version: LEAFLET_VERSION },
  })
}

describe('条件 → 段・色・座標（共通 API と同じ分け方）', () => {
  it('横浜市の人口の増減：段は API と同じ 5 段（4・16・25・59・32 駅）・座標は全駅の索引から', async () => {
    const resolution = await resolveColoring({ metricKey: POP_GR, areas: [YOKOHAMA] })
    if (!resolution.ok) throw new Error(resolution.reasonJa)
    const { classes, points, unplacedCount } = resolution.coloring
    expect(classes.legend.classes.map((cls) => cls.count)).toEqual([4, 16, 25, 59, 32])
    expect(classes.areaLabelsJa).toEqual(['神奈川県横浜市'])
    expect(points).toHaveLength(135)
    expect(unplacedCount).toBe(1)
    expect(points.find((point) => point.nameJa === '戸塚')).toMatchObject({
      kind: 'class',
      color: DIVERGING_COLORS[4],
      detailJa: '+11.6%・+5%以上',
    })
  })

  it('全駅の索引は 1 回だけ引く（色分けのたびに DB を引かない）', async () => {
    await resolveColoring({ metricKey: POP_GR, areas: [YOKOHAMA] })
    await resolveColoring({ metricKey: POP_GR, areas: [YOKOHAMA] })
    expect(db.stationCatalog).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['知らない指標', { metricKey: 'nope', areas: [YOKOHAMA] }, '色分けできない指標です: nope'],
    [
      'エリアの書き方の誤り',
      { metricKey: POP_GR, areas: ['pref:99'] },
      'エリアの書き方が正しくない',
    ],
    ['知らないエリア', { metricKey: POP_GR, areas: ['muni:99999'] }, 'muni:99999'],
  ])('断る（共通 API と同じ理由）：%s', async (_label, request, message) => {
    const resolution = await resolveColoring(request)
    expect(resolution.ok).toBe(false)
    if (!resolution.ok) expect(resolution.reasonJa).toContain(message)
  })

  it(`描ける駅は ${MAP_MAX_COLORED_STATIONS.toLocaleString('en-US')} まで（全国は絞り方を返す）`, async () => {
    const resolution = await resolveColoring({ metricKey: POP_GR, areas: ['jp'] })
    expect(resolution).toEqual({
      ok: false,
      reasonJa: tooManyColoredJa(MAP_MAX_COLORED_STATIONS + 1),
    })
    expect(tooManyColoredJa(9273)).toBe(
      '色分けする駅が 9,273 駅あり、地図レポートに描ける 3,000 駅を超える。エリアを都道府県・市区町村・路線などに絞る。',
    )
    expect(db.stationCatalog).not.toHaveBeenCalled()
  })

  it('座標の分からない駅は描かず、数を残す', () => {
    const response = {
      areas: [YOKOHAMA],
      areaLabelsJa: ['神奈川県横浜市'],
      legend: {
        metricKey: POP_GR,
        titleJa: 't',
        unit: '%',
        scheme: 'diverging' as const,
        classes: [],
        flagged: { color: '#9ca3af', labelJa: '参考値（⚠）', count: 0 },
        missingCount: 0,
        meaningJa: null,
        sourceJa: 's',
        reasonJa: '値が 1 種類しかないので色分けしない。',
      },
      stations: [
        { grp: 'a#0', cls: null, value: 1, valueJa: '+1.0%' },
        { grp: 'b#0', cls: null, value: 1, valueJa: '+1.0%' },
      ],
    }
    const placed = placeColoredStations(
      response,
      new Map([['a#0', { lon: 1, lat: 2, nameJa: 'A' }]]),
    )
    expect(placed.points).toEqual([
      { lon: 1, lat: 2, nameJa: 'A', kind: 'plain', color: '#4f46e5', detailJa: '+1.0%' },
    ])
    expect(placed.unplacedCount).toBe(1)
  })
})

describe('本文（凡例・注意・題）', () => {
  it('既定の題は「どこの駅か：指標」', async () => {
    expect(defaultTitleJa(await yokohamaScene())).toBe(
      '神奈川県横浜市の駅：人口増減率（2015→2020年・1km圏）',
    )
  })

  it('注意：凡例と同じ注意（エリア全体の値ではない・色の意味・値の無い駅）・代表点・座標の分からない駅', async () => {
    const scene = await yokohamaScene()
    const classes = scene.coloring?.resolved?.classes
    if (classes === undefined) throw new Error('色分けが解決されていません')
    const notes = reportNotesJa({ scene, layers: [], dropped: [] })
    for (const note of coloringNotesJa(classes)) expect(notes).toContain(note)
    expect(notes).toContain('駅の位置は駅の代表点（代表的な 1 点）です。')
    expect(notes).toContain('1 駅は座標が分からず、色分けに描いていません。')
  })

  it('描けなかった色分けは、理由を注意に出す（黙らない）', async () => {
    const scene = await sceneFor([
      { type: 'colorStations', metricKey: 'nope', areas: [YOKOHAMA] },
      { type: 'flyTo', lon: 139.6, lat: 35.4, zoom: 12 },
    ])
    expect(reportNotesJa({ scene, layers: [], dropped: [] })).toContain(
      '駅の色分けは描いていません：色分けできない指標です: nope（GET /api/metrics で rankable な key を選ぶ）',
    )
  })

  it('凡例：指標・どこの何駅か・段の色と駅の数・出典', async () => {
    const html = htmlOf(await yokohamaScene())
    expect(html).toContain('色分け：人口増減率（2015→2020年・1km圏）')
    expect(html).toContain('神奈川県横浜市の 137 駅')
    for (const color of DIVERGING_COLORS) expect(html).toContain(`style="background: ${color}"`)
    expect(html).toContain('59 駅')
    expect(html).toContain('出典：総務省 国勢調査 地域メッシュ統計（e-Stat）')
  })
})

describe('描画（canvas・抜けられない）', () => {
  it('canvas の丸に濃い縁・ホバーは textContent（innerHTML を使わない）・通信しない', async () => {
    const html = htmlOf(await yokohamaScene())
    // 描画スクリプト（最後の <script>）だけを見る——同梱の Leaflet 自体は innerHTML を使う。
    const draw = html.slice(html.lastIndexOf('<script>'))
    expect(draw).toContain('L.canvas(')
    expect(draw).toContain('L.circleMarker(')
    expect(draw).toContain("color: '#0f172a'")
    expect(draw).toContain('bindTooltip(tip')
    expect(draw).toContain('name.textContent = p.nameJa')
    expect(draw.includes('innerHTML')).toBe(false)
    for (const forbidden of ['XMLHttpRequest', 'WebSocket', 'fetch(']) {
      expect(html.includes(forbidden), forbidden).toBe(false)
    }
  })

  it('駅名に `</script>` があっても埋め込み JSON から抜けられない（データとしては残る）', async () => {
    const html = htmlOf(await yokohamaScene())
    expect(html).not.toContain(XSS_NAME)
    const embedded = /window\.MAP_DATA = (.*);<\/script>/.exec(html)?.[1] ?? ''
    const data: unknown = JSON.parse(embedded)
    expect(JSON.stringify(data)).toContain(XSS_NAME)
  })
})

describe('render_map ツール', () => {
  const run = (mapActions: readonly MapAction[]) =>
    TOOL_SPECS.renderMap.run(TOOL_SPECS.renderMap.inputSchema.parse({ mapActions }), {
      origin: 'http://localhost:3000',
    })

  it('色分けを頼まれたのに描けないなら URL を作らず、直し方を返す', async () => {
    const { forLlm } = await run([
      { type: 'colorStations', metricKey: POP_GR, areas: ['jp'] },
      { type: 'flyTo', lon: 139.6, lat: 35.4 },
    ])
    expect(forLlm).toMatchObject({ error: expect.stringContaining('駅の色分けを描けません') })
    expect(JSON.stringify(forLlm)).toContain('3,000')
    expect(JSON.stringify(forLlm)).not.toContain('/api/map?t=')
  })

  it('描けたら URL と、凡例と同じ言葉の要約を返す', async () => {
    const { forLlm } = await run([COLOR_YOKOHAMA])
    expect(forLlm).toMatchObject({
      url: expect.stringContaining('http://localhost:3000/api/map?t='),
      title: '神奈川県横浜市の駅：人口増減率（2015→2020年・1km圏）',
      coloring: {
        titleJa: '人口増減率（2015→2020年・1km圏）',
        scopeJa: '神奈川県横浜市の 137 駅',
        drawnStations: 135,
        classesJa: [
          '-5%未満（4 駅）',
          '-5〜-1%（16 駅）',
          '-1〜+1%（ほぼ横ばい）（25 駅）',
          '+1〜+5%（59 駅）',
          '+5%以上（32 駅）',
        ],
        reasonJa: null,
      },
    })
  })

  it('色分けの無い地図は従来どおり（要約の色分けは null）', async () => {
    const { forLlm } = await run([{ type: 'showPoint', lon: 139.6, lat: 35.4, labelJa: '横浜' }])
    expect(forLlm).toMatchObject({ coloring: null })
  })
})

describe('/api/map（開くたびに色分けを引き直して描く）', () => {
  it('署名した条件から、色分けの凡例と印の描画を含む 1 ページを返す', async () => {
    const query = mapQuerySchema.parse({ actions: [COLOR_YOKOHAMA] })
    const { token } = signMapToken(query, { secret: signedUrlSecret(), now: Date.now() })
    const response = await getMap(
      new Request(`http://localhost/api/map?t=${token}`, {
        headers: { 'x-forwarded-for': '203.0.113.5' },
      }),
    )
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('色分け：人口増減率（2015→2020年・1km圏）')
    expect(html).toContain('L.circleMarker(')
    expect(db.stationMetricValues).toHaveBeenCalledWith(POP_GR, { municipality: '横浜市' })
  })
})

describe('coloringSummary（描いていなければ null）', () => {
  it('色分けの条件が無い・描けなかったときは null', async () => {
    expect(coloringSummary(await sceneFor([{ type: 'flyTo', lon: 139.6, lat: 35.4 }]))).toBeNull()
    expect(
      coloringSummary(
        await sceneFor([{ type: 'colorStations', metricKey: 'nope', areas: [YOKOHAMA] }]),
      ),
    ).toBeNull()
  })
})
