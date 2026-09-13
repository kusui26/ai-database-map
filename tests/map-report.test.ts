import { describe, expect, it } from 'vitest'
import { LEAFLET_CSS, LEAFLET_JS, LEAFLET_VERSION } from '@/ai/map-report/assets'
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_TILE_URL,
  buildMapReportHtml,
  mapReportTileOrigins,
  stationLabelsOmitted,
  type MapReportLayer,
} from '@/ai/map-report/html'
import { reportNotesJa, defaultTitleJa, grpsIn } from '@/ai/map-report/build'
import {
  MAP_MAX_ACTIONS,
  MAP_MAX_GRPS,
  MAP_MAX_POINTS,
  mapQuerySchema,
  signMapToken,
  verifyMapToken,
  MAP_URL_TTL_MS,
} from '@/ai/map-report/token'
import { signDatasetToken } from '@/ai/dataset/token'
import { mapScene, type StationPoint } from '@/domain/map/scene'
import { getHazardLayer } from '@/shared/hazard'
import { type MapAction } from '@/shared/protocol'

/**
 * **地図レポート**（PR-13・`docs/260912_gui_chat_protocol.md` §4.3(b)）。
 *
 * 母艦の `presentHtml` は `sandbox allow-scripts; connect-src 'none'` の iframe で開くので、
 * ここで固定するのは①**通信しないこと**（タイルは Leaflet が `<img>` で読む。fetch も XHR も
 * 外部スクリプトも無い）、②**出典・限界・免責が必ず本文に出ること**、③ラベルが
 * **HTML からも `</script>` からも脱出できないこと**、④ CSP に宣言する接続先が
 * **カタログから算出**されること、⑤トークンが**データセットの URL と取り違えられない**こと。
 */

const STATIONS: ReadonlyMap<string, StationPoint> = new Map([
  ['横浜#0', { lon: 139.622, lat: 35.466, nameJa: '横浜駅' }],
])

/** 静的なハザード 1 枚（カタログの実物から作る）。 */
function floodLayer(): MapReportLayer {
  const layer = getHazardLayer('flood_l2')
  if (layer?.tile == null) throw new Error('flood_l2 のタイル定義がありません')
  return {
    key: layer.key,
    labelJa: layer.labelJa,
    url: layer.tile.url,
    opacity: 0.6,
    minZoom: layer.tile.minZoom,
    maxNativeZoom: layer.tile.maxZoom,
    attribution: layer.attribution,
    timeLabelJa: null,
  }
}

const ACTIONS: readonly MapAction[] = [
  { type: 'flyTo', lon: 139.622, lat: 35.466, zoom: 14 },
  { type: 'selectStation', grp: '横浜#0', radiusM: 1000 },
  { type: 'setHazardLayers', layers: ['flood_l2'] },
]

function reportHtml(options: { title?: string; actions?: readonly MapAction[] } = {}): string {
  const scene = mapScene(options.actions ?? ACTIONS, { stations: STATIONS })
  const layers = scene.layers.length > 0 ? [floodLayer()] : []
  return buildMapReportHtml({
    title: options.title ?? defaultTitleJa(scene),
    scene,
    layers,
    notesJa: reportNotesJa({ scene, layers, dropped: [] }),
    generatedAtJa: '2026-09-14 00:00',
    assets: { js: LEAFLET_JS, css: LEAFLET_CSS, version: LEAFLET_VERSION },
  })
}

describe('母艦の CSP で動く形（通信しない・外から読まない）', () => {
  const html = reportHtml()

  it('fetch・XHR・WebSocket を 1 つも使わない（connect-src none で動く）', () => {
    for (const forbidden of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'fetch(']) {
      expect(html.includes(forbidden), forbidden).toBe(false)
    }
  })

  it('外部のスクリプト・スタイルシートを読まない（Leaflet はインライン同梱）', () => {
    expect(/<script[^>]+src=/i.test(html)).toBe(false)
    expect(/<link[^>]+stylesheet/i.test(html)).toBe(false)
    expect(html).toContain('leaflet') // 同梱されている
    expect(html.length).toBeGreaterThan(150_000)
  })

  it('タイルは Leaflet のタイルレイヤ（＝`<img>`）として読む', () => {
    expect(html).toContain('L.tileLayer(')
    expect(html).toContain(BASEMAP_TILE_URL)
  })

  it('同梱した Leaflet は package.json と同じ版（コピーの陳腐化を防ぐ）', () => {
    expect(LEAFLET_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(html).toContain(`Leaflet ${LEAFLET_VERSION}`)
  })
})

describe('本文（出典・限界・免責を落とさない）', () => {
  const html = reportHtml()

  it('凡例に背景地図とハザードの出典が出る', () => {
    expect(html).toContain(BASEMAP_ATTRIBUTION)
    expect(html).toContain(floodLayer().attribution)
    expect(html).toContain(floodLayer().labelJa)
  })

  it('半径円は「駅の代表点」だと書く（生活圏と読ませない）', () => {
    expect(html).toContain('駅の代表点')
  })

  it('ハザードを描いたら「もし起きたら」と免責を必ず出す', () => {
    expect(html).toContain('いまの状況ではありません')
    expect(html).toContain('避難情報に従ってください')
  })

  it('網羅性の注記（白＝安全ではない）がカタログから入る', () => {
    const note = getHazardLayer('flood_l2')?.coverageNoteJa
    expect(typeof note).toBe('string')
    if (typeof note === 'string') expect(html).toContain(note)
  })

  it('描けなかったものを黙って消さない', () => {
    const scene = mapScene(
      [
        { type: 'showPoint', lon: 139.7, lat: 35.6, labelJa: 'ここ' },
        { type: 'highlightStations', grps: ['無い駅#9'] },
        { type: 'setHazardLayers', layers: ['not_a_layer'] },
      ],
      { stations: STATIONS },
    )
    const notes = reportNotesJa({ scene, layers: [], dropped: ['キキクル（土砂）'] })
    expect(notes.join('\n')).toContain('1 駅は座標が分からず')
    expect(notes.join('\n')).toContain('not_a_layer')
    expect(notes.join('\n')).toContain('キキクル（土砂）')
  })
})

describe('ラベルは HTML からも script からも脱出できない', () => {
  it('見出しのタグはエスケープされる', () => {
    const html = reportHtml({ title: '<img src=x onerror=alert(1)>横浜' })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;横浜')
    expect(/<img[^>]*onerror/i.test(html)).toBe(false)
  })

  it('埋め込み JSON の `<` は退避され、`</script>` で抜けられない', () => {
    const html = reportHtml({
      actions: [{ type: 'showPoint', lon: 139.7, lat: 35.6, labelJa: '</script><script>x()' }],
    })
    expect(html).toContain('\\u003c/script')
    expect(html.includes('</script><script>x()')).toBe(false)
  })
})

describe('CSP に宣言する接続先（カタログから算出・手書きしない）', () => {
  it('背景地図と、実際に載せるレイヤのオリジンだけ', () => {
    expect(mapReportTileOrigins([])).toEqual(['https://cyberjapandata.gsi.go.jp'])
    expect([...mapReportTileOrigins([floodLayer()])].sort()).toEqual([
      'https://cyberjapandata.gsi.go.jp',
      'https://disaportaldata.gsi.go.jp',
    ])
  })
})

describe('入力の上限（枠と上流を守る）', () => {
  const point = { lon: 139.7, lat: 35.6, labelJa: 'x' }

  it('操作の数・行き先の点・駅の数に上限がある', () => {
    const many = Array.from({ length: MAP_MAX_ACTIONS + 1 }, () => ({
      type: 'showPoint' as const,
      ...point,
    }))
    expect(mapQuerySchema.safeParse({ actions: many }).success).toBe(false)

    const points = mapQuerySchema.safeParse({
      actions: [
        {
          type: 'highlightPoints',
          points: Array.from({ length: MAP_MAX_POINTS + 1 }, () => point),
        },
      ],
    })
    expect(points.success).toBe(false)
    if (!points.success) expect(points.error.issues[0]?.message).toContain('点が多すぎます')

    const grps = mapQuerySchema.safeParse({
      actions: [
        {
          type: 'highlightStations',
          grps: Array.from({ length: MAP_MAX_GRPS + 1 }, (_unused, index) => `x#${index}`),
        },
      ],
    })
    expect(grps.success).toBe(false)
    if (!grps.success) expect(grps.error.issues[0]?.message).toContain('駅が多すぎます')
  })

  it('地図操作に出てくる grp を集める（重複なし）', () => {
    expect(
      grpsIn([
        { type: 'selectStation', grp: '横浜#0' },
        { type: 'highlightStations', grps: ['横浜#0', '川崎#0'] },
      ]),
    ).toEqual(['横浜#0', '川崎#0'])
  })
})

describe('署名トークン（取り違えと改竄を弾く）', () => {
  const secret = 'test-secret'
  const query = { actions: [...ACTIONS] }

  it('往復できる', () => {
    const signed = signMapToken(query, { secret, now: 1_000 })
    const verified = verifyMapToken(signed.token, { secret, now: 2_000 })
    expect(verified).toEqual({ ok: true, query, expiresAtMs: 1_000 + MAP_URL_TTL_MS })
  })

  it('期限切れ・別の鍵・改竄をそれぞれ区別する', () => {
    const signed = signMapToken(query, { secret, now: 1_000 })
    expect(verifyMapToken(signed.token, { secret, now: 1_000 + MAP_URL_TTL_MS })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(verifyMapToken(signed.token, { secret: 'other', now: 2_000 })).toEqual({
      ok: false,
      reason: 'signature',
    })
    expect(verifyMapToken(`X${signed.token}`, { secret, now: 2_000 })).toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('データセットの URL を地図の入口に投げても通らない（payload の形が違う）', () => {
    const dataset = signDatasetToken(
      { grps: ['横浜#0'], keys: ['pax_2024'], shape: 'wide' },
      { secret, now: 1_000 },
    )
    expect(verifyMapToken(dataset.token, { secret, now: 2_000 })).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('既定の題（何の地図かが一覧で分かる）', () => {
  it('起点・駅・行き先の順に名乗る', () => {
    expect(defaultTitleJa(mapScene(ACTIONS, { stations: STATIONS }))).toBe('横浜駅 周辺の地図')
    expect(
      defaultTitleJa(mapScene([{ type: 'showPoint', lon: 139.7, lat: 35.6, labelJa: '横浜駅' }])),
    ).toBe('横浜駅 周辺の地図')
    expect(
      defaultTitleJa(
        mapScene([{ type: 'highlightStations', grps: ['横浜#0'] }], { stations: STATIONS }),
      ),
    ).toBe('駅 1 件の地図')
  })
})

describe('どの地図にも注意が 1 つは付く（切り出して眺められるので）', () => {
  it('印だけの地図でも「二次加工」と「位置を指すだけ」が出る', () => {
    const scene = mapScene([
      { type: 'showPoint', lon: 139.7, lat: 35.6, labelJa: 'ここ' },
      { type: 'highlightPoints', points: [{ lon: 139.71, lat: 35.61, labelJa: '〇〇小学校' }] },
    ])
    const notes = reportNotesJa({ scene, layers: [], dropped: [] })
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.join('\n')).toContain('二次加工')
    expect(notes.join('\n')).toContain('経路・所要時間')
  })

  it('駅を並べた地図では代表点であることを言う', () => {
    const scene = mapScene([{ type: 'highlightStations', grps: ['横浜#0'] }], {
      stations: STATIONS,
    })
    expect(reportNotesJa({ scene, layers: [], dropped: [] }).join('\n')).toContain('駅の代表点')
  })
})

describe('名前の置き場所（重なって読めなくなるのを避ける）', () => {
  const destinations: MapAction = {
    type: 'highlightPoints',
    points: [
      { lon: 139.61, lat: 35.47, labelJa: '横浜市立青木小学校 校舎棟' },
      { lon: 139.612, lat: 35.471, labelJa: '横浜市立幸ケ谷小学校 校舎２' },
    ],
  }

  it('行き先は地図に番号だけを置き、名前は本文の一覧で読ませる', () => {
    const html = reportHtml({ actions: [destinations] })
    // 一覧に名前が出る。
    expect(html).toContain('地図の番号')
    expect(html).toContain('横浜市立青木小学校 校舎棟')
    // マーカーはラベルを描かない（描画側の分岐）。
    expect(html).toContain("if (point.kind === 'destination') return false")
  })

  it('駅が多いと名前を出さず、そのことを本文で断る', () => {
    const many = Array.from({ length: 30 }, (_unused, index) => `s${index}#0`)
    const stations = new Map(
      many.map((grp, index) => [
        grp,
        { lon: 139.6 + index * 0.01, lat: 35.4 + index * 0.01, nameJa: `駅${index}` },
      ]),
    )
    const scene = mapScene([{ type: 'highlightStations', grps: many }], { stations })
    expect(stationLabelsOmitted(scene)).toBe(true)
    expect(reportNotesJa({ scene, layers: [], dropped: [] }).join('\n')).toContain(
      '名前は地図に出していません',
    )
    // 少数なら出す。
    expect(
      stationLabelsOmitted(
        mapScene([{ type: 'highlightStations', grps: ['横浜#0'] }], {
          stations: STATIONS,
        }),
      ),
    ).toBe(false)
  })
})
