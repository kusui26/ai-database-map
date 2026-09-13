import { describe, expect, it } from 'vitest'
import { hazardTileOrigins, mapScene, sceneBounds } from '@/domain/map/scene'
import { HAZARD_OPACITY_DEFAULT, HAZARD_TERRAIN_OPACITY_SCALE } from '@/shared/constants'
import { mapActionSchema, type MapAction } from '@/shared/protocol'

/**
 * **地図操作の意味論**（PR-11・`docs/260912_gui_chat_protocol.md` 決定 11）。
 *
 * MCP Apps の地図ビューアは撤収したが、「mapActions をどう描くか」は
 * T1（サーバ生成の地図レポート）・T2（ビューア・プラグイン）・Web UI が**同じ規則**で
 * 描くための資産なので、純関数として残す。ここで固定するのは
 * ①**7 型すべてを扱う**こと（protocol に型を足すと扱い忘れで落ちる）、
 * ②座標を持たない操作（`highlightStations`・`selectStation` 単独）を**描かない**こと、
 * ③半径円の中心は直前の `flyTo` で、中心の印を必ず置くこと、
 * ④ハザードの**描画順・不透明度・出典**が既存 domain（カタログ）由来であること、
 * ⑤**描けなかったレイヤを黙って消さない**こと（白い地図＝安全を作らない・
 * `docs/260824_flood.md` §7.5-1）。
 */

/** protocol の判別ユニオンから全 mapAction 型リテラルを導出（手書きリストにしない）。 */
const ACTION_TYPES: readonly string[] = mapActionSchema.options.map(
  (option) => option.shape.type.value,
)

const YOKOHAMA = { lon: 139.622, lat: 35.466 }

/** 全 mapAction 型の見本（Zod で検証する）。 */
const FIXTURES: readonly MapAction[] = [
  { type: 'flyTo', lon: YOKOHAMA.lon, lat: YOKOHAMA.lat, zoom: 14 },
  { type: 'selectStation', grp: '横浜#0', radiusM: 1000 },
  { type: 'highlightStations', grps: ['横浜#0', '川崎#0'] },
  { type: 'clearOverlays' },
  { type: 'setHazardLayers', layers: ['flood_l2'], opacity: 0.6 },
  { type: 'showPoint', lon: 139.7, lat: 35.68, labelJa: '現在地' },
  {
    type: 'highlightPoints',
    points: [
      { lon: 139.63, lat: 35.47, labelJa: '〇〇小学校' },
      { lon: 139.64, lat: 35.48, labelJa: '△△中学校' },
    ],
  },
]

describe('mapAction の網羅', () => {
  it('全型に見本があり、すべて protocol の Zod を通る', () => {
    expect(ACTION_TYPES.length).toBeGreaterThanOrEqual(7)
    expect(new Set(FIXTURES.map((action) => action.type))).toEqual(new Set(ACTION_TYPES))
    for (const action of FIXTURES) {
      expect(() => mapActionSchema.parse(action), action.type).not.toThrow()
    }
  })

  it('どの型も単独で落ちない', () => {
    for (const action of FIXTURES) {
      expect(() => mapScene([action]), action.type).not.toThrow()
    }
  })
})

describe('駅の選択（flyTo ＋ selectStation）', () => {
  it('半径円の中心は直前の flyTo で、中心の印を必ず置く', () => {
    const scene = mapScene([
      { type: 'flyTo', lon: YOKOHAMA.lon, lat: YOKOHAMA.lat, zoom: 14 },
      { type: 'selectStation', grp: '横浜#0', radiusM: 1000 },
    ])
    expect(scene.circle).toEqual({ lon: YOKOHAMA.lon, lat: YOKOHAMA.lat, radiusM: 1000 })
    expect(scene.points).toEqual([
      { lon: YOKOHAMA.lon, lat: YOKOHAMA.lat, labelJa: null, kind: 'origin', index: null },
    ])
    expect(scene.drawable).toBe(true)
  })

  it('flyTo が無ければ円は描かない（中心が分からないものを置かない）', () => {
    const scene = mapScene([{ type: 'selectStation', grp: '横浜#0', radiusM: 1000 }])
    expect(scene.circle).toBeNull()
    expect(scene.points).toEqual([])
    expect(scene.drawable).toBe(false)
  })

  it('座標を持たない highlightStations は描かない（一覧パネルで読む）', () => {
    const scene = mapScene([{ type: 'highlightStations', grps: ['横浜#0', '川崎#0'] }])
    expect(scene.points).toEqual([])
    expect(scene.drawable).toBe(false)
  })
})

describe('地点と行き先', () => {
  it('起点は印だけ・行き先は 1 始まりの通し番号（一覧の並びと同じ）', () => {
    const scene = mapScene([
      { type: 'showPoint', lon: 139.7, lat: 35.68, labelJa: '現在地' },
      {
        type: 'highlightPoints',
        points: [
          { lon: 139.63, lat: 35.47, labelJa: '〇〇小学校' },
          { lon: 139.64, lat: 35.48, labelJa: '△△中学校' },
        ],
      },
    ])
    expect(scene.points.map((point) => [point.kind, point.index])).toEqual([
      ['origin', null],
      ['destination', 1],
      ['destination', 2],
    ])
  })

  it('番号は複数の highlightPoints をまたいでも連番になる', () => {
    const scene = mapScene([
      { type: 'highlightPoints', points: [{ lon: 1, lat: 1, labelJa: 'a' }] },
      { type: 'highlightPoints', points: [{ lon: 2, lat: 2, labelJa: 'b' }] },
    ])
    expect(scene.points.map((point) => point.index)).toEqual([1, 2])
  })

  it('clearOverlays は、それまでに積んだ点・円・面を畳む', () => {
    const scene = mapScene([
      { type: 'showPoint', lon: 139.7, lat: 35.68, labelJa: '現在地' },
      { type: 'setHazardLayers', layers: ['flood_l2'] },
      { type: 'clearOverlays' },
    ])
    expect(scene.points).toEqual([])
    expect(scene.layers).toEqual([])
  })
})

describe('ハザードの面（カタログが単一の真実）', () => {
  const scene = mapScene([
    {
      type: 'setHazardLayers',
      layers: ['flood_kaoku_hanran', 'flood_l2', 'chisui_chikei', 'kikikuru_land', 'not_a_layer'],
    },
  ])

  it('描画順は base 先・overlay 後（細い区域がベタ塗りに隠れない）', () => {
    expect(scene.layers.map((layer) => layer.key)).toEqual([
      'flood_l2',
      'kikikuru_land',
      'chisui_chikei',
      'flood_kaoku_hanran',
    ])
  })

  it('「参考：地形」は一段薄く、ハザードと見分けがつくようにする', () => {
    const terrain = scene.layers.find((layer) => layer.key === 'chisui_chikei')
    const flood = scene.layers.find((layer) => layer.key === 'flood_l2')
    expect(flood?.opacity).toBeCloseTo(HAZARD_OPACITY_DEFAULT)
    expect(terrain?.opacity).toBeCloseTo(HAZARD_OPACITY_DEFAULT * HAZARD_TERRAIN_OPACITY_SCALE)
  })

  it('キキクルは時刻の差し込みが要ると分かる形で渡す（差し込みは消費側）', () => {
    const kikikuru = scene.layers.find((layer) => layer.key === 'kikikuru_land')
    expect(kikikuru?.needsTime).toBe(true)
    expect(kikikuru?.timesUrl).not.toBeNull()
    expect(kikikuru?.urlTemplate).toContain('{basetime}')
    expect(scene.hasTimedLayer).toBe(true)
    const staticOnly = mapScene([{ type: 'setHazardLayers', layers: ['flood_l2'] }])
    expect(staticOnly.hasTimedLayer).toBe(false)
  })

  it('描けなかったレイヤを黙って消さない（白い地図＝安全を作らない）', () => {
    expect(scene.undrawableLayerKeys).toEqual(['not_a_layer'])
  })

  it('出典は重複を畳んで描画順に並ぶ', () => {
    expect(scene.attributions.length).toBeGreaterThan(0)
    expect(new Set(scene.attributions).size).toBe(scene.attributions.length)
  })

  it('不透明度は指定があればそれを使う（範囲外はカタログ側で丸める）', () => {
    const dim = mapScene([{ type: 'setHazardLayers', layers: ['flood_l2'], opacity: 0.3 }])
    expect(dim.layers[0]?.opacity).toBeCloseTo(0.3)
  })
})

describe('カメラと接続先', () => {
  it('全部が入る矩形を返す（点が無ければ null）', () => {
    expect(sceneBounds(mapScene([]))).toBeNull()
    const bounds = sceneBounds(
      mapScene([
        { type: 'flyTo', lon: YOKOHAMA.lon, lat: YOKOHAMA.lat },
        { type: 'selectStation', grp: '横浜#0', radiusM: 1000 },
        { type: 'highlightPoints', points: [{ lon: 139.7, lat: 35.5, labelJa: 'a' }] },
      ]),
    )
    expect(bounds).not.toBeNull()
    if (bounds === null) return
    expect(bounds.west).toBeLessThan(YOKOHAMA.lon)
    expect(bounds.east).toBeGreaterThanOrEqual(139.7)
    expect(bounds.north).toBeGreaterThan(YOKOHAMA.lat)
  })

  it('タイルの接続先はカタログから算出する（手書きしない＝レイヤ追加に追随）', () => {
    expect([...hazardTileOrigins()].sort()).toEqual(
      [
        'https://cyberjapandata.gsi.go.jp', // 参考：地形
        'https://disaportaldata.gsi.go.jp', // 重ねるハザードマップ
        'https://www.jma.go.jp', // キキクル（タイル＋targetTimes.json）
      ].sort(),
    )
  })
})
