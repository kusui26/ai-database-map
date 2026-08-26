import { describe, expect, it } from 'vitest'
import { mapActionSchema, mapResponseSchema, panelSchema } from '@/shared/protocol'
import {
  errorEnvelopeSchema,
  growthQuerySchema,
  hazardCatalogQuerySchema,
  hazardPointQuerySchema,
  hazardCatalogResponseSchema,
  rankingQuerySchema,
} from '@/shared/api'
import { hazardCatalog, hazardLayers } from '@/shared/hazard'
import { hazardGroupViews, hazardLevelViews } from '@/domain/hazard/catalog'

describe('GUI Chat Protocol', () => {
  it('MapResponse をパース（flyTo / clearOverlays / markdown）', () => {
    const parsed = mapResponseSchema.parse({
      messages: [{ role: 'assistant', text: 'こんにちは' }],
      mapActions: [
        { type: 'flyTo', lon: 139.767, lat: 35.681, zoom: 12 },
        { type: 'clearOverlays' },
      ],
      panels: [{ type: 'markdown', body: '本文', placement: 'inline' }],
    })
    expect(parsed.mapActions[0]?.type).toBe('flyTo')
    expect(parsed.panels[0]?.type).toBe('markdown')
  })

  it('trendChart パネル（系列・フラグ・KPI スタッツ）をパース', () => {
    const panel = panelSchema.parse({
      type: 'trendChart',
      title: '人口',
      unit: '人',
      format: 'int',
      flags: [{ label: '低基準', level: 'warn' }],
      series: [
        {
          label: '実績',
          points: [
            { x: 2020, y: 6000 },
            { x: 2015, y: null },
          ],
        },
      ],
      stats: [{ label: '前年比', value: '+7.3%', flagged: false }],
    })
    expect(panel.type).toBe('trendChart')
    if (panel.type === 'trendChart') expect(panel.stats?.[0]?.value).toBe('+7.3%')
  })

  it('statTable パネル（増減率ミニ表）をパース', () => {
    const panel = panelSchema.parse({
      type: 'statTable',
      title: '人口増減率',
      rows: [
        { label: '2015→2020', value: '+20.0%', flagged: false },
        { label: '2010→2020', value: '-5.0%', flagged: true },
      ],
      note: null,
    })
    expect(panel.type).toBe('statTable')
    if (panel.type === 'statTable') expect(panel.rows[1]?.flagged).toBe(true)
  })

  it('barChart パネル（半径別・emphasis）をパース', () => {
    const panel = panelSchema.parse({
      type: 'barChart',
      title: '地価中央値（半径別）',
      unit: '円/㎡',
      format: 'yen',
      category: 'land_price',
      bars: [
        { label: '500m', value: 24400000, formatted: '24,400,000', flagged: false },
        { label: '1km', value: 19050000, formatted: '19,050,000', flagged: false, emphasis: true },
      ],
      flags: [],
    })
    expect(panel.type).toBe('barChart')
    if (panel.type === 'barChart') expect(panel.bars[1]?.emphasis).toBe(true)
  })

  it('未知の panel type を拒否', () => {
    expect(() => panelSchema.parse({ type: 'unknown' })).toThrow()
  })
})

describe('API クエリ入力', () => {
  it('ranking: limit を coerce・既定 order・上限50', () => {
    expect(rankingQuerySchema.parse({ metric: 'x', limit: '10' }).limit).toBe(10)
    expect(rankingQuerySchema.parse({ metric: 'x' }).order).toBe('desc')
    expect(() => rankingQuerySchema.parse({ metric: 'x', limit: '999' })).toThrow()
  })

  it('growth: excludeLowN 文字列→真偽', () => {
    expect(growthQuerySchema.parse({ x: 'a', y: 'b', excludeLowN: 'true' }).excludeLowN).toBe(true)
    expect(growthQuerySchema.parse({ x: 'a', y: 'b', excludeLowN: '1' }).excludeLowN).toBe(true)
    expect(growthQuerySchema.parse({ x: 'a', y: 'b' }).excludeLowN).toBe(false)
  })

  it('errorEnvelope', () => {
    expect(
      errorEnvelopeSchema.parse({ error: { code: 'BAD_METRIC', message: 'm' } }).error.code,
    ).toBe('BAD_METRIC')
  })
})

describe('GUI Chat Protocol: ハザード拡張（260824_flood §6.4）', () => {
  it('setHazardLayers / showPoint をパース（既存の mapAction は無改変）', () => {
    const parsed = mapResponseSchema.parse({
      messages: [],
      mapActions: [
        { type: 'setHazardLayers', layers: ['flood_l2', 'naisui'], opacity: 0.6 },
        { type: 'setHazardLayers', layers: [] }, // 空＝すべて消す
        { type: 'showPoint', lon: 139.847, lat: 35.7645, labelJa: '現在地' },
        { type: 'flyTo', lon: 139.767, lat: 35.681 },
      ],
      panels: [],
    })
    expect(parsed.mapActions).toHaveLength(4)
    expect(parsed.mapActions[0]?.type).toBe('setHazardLayers')
    expect(parsed.mapActions[2]?.type).toBe('showPoint')
  })

  it('showPoint の labelJa は省略可・未知の mapAction は拒否', () => {
    expect(mapActionSchema.parse({ type: 'showPoint', lon: 139, lat: 35 }).type).toBe('showPoint')
    expect(() => mapActionSchema.parse({ type: 'setHazardLayer', layers: [] })).toThrow()
  })

  it('hazardCard パネルをパース（レベル・行動・注記・免責）', () => {
    const panel = panelSchema.parse({
      type: 'hazardCard',
      placeJa: '亀有駅',
      level: 'critical',
      headlineJa: 'この場所は、家屋倒壊等氾濫想定区域（氾濫流）に入っています。',
      evacuation: 'takeaway',
      certainty: 'exact',
      items: [
        {
          layerKey: 'flood_l2',
          labelJa: '洪水浸水想定区域（想定最大規模）',
          valueJa: '3.66m・3〜5m 未満',
          meaningJa: '2 階部分が浸水する高さ',
          level: 'danger',
          color: '#FFB7B7',
          source: 'suibou-navi',
          coverage: null,
          certainty: 'exact',
        },
      ],
      reasonsJa: ['家屋倒壊等氾濫想定区域（氾濫流）内のため、建物の上階に留まるのは危険です'],
      coverageNotesJa: ['白い場所は「浸水しない」という意味ではありません。'],
      sources: [
        { labelJa: '国土数値情報 洪水浸水想定区域（2025年度）', url: null, license: 'CC BY 4.0' },
      ],
      disclaimerJa: '実際の避難は、市町村が発表する避難情報に従ってください。',
    })
    expect(panel.type).toBe('hazardCard')
    if (panel.type === 'hazardCard') {
      expect(panel.evacuation).toBe('takeaway')
      expect(panel.items[0]?.color).toBe('#FFB7B7')
      // どこから得た値かは応答から落とさない（UI も AI もこれで言い方を変える・§6.3）。
      expect(panel.items[0]?.source).toBe('suibou-navi')
      expect(panel.certainty).toBe('exact')
    }
  })

  it('hazardCard の evacuation は null 可（判定できないときは断定しない）', () => {
    const panel = panelSchema.parse({
      type: 'hazardCard',
      placeJa: '地点',
      level: 'none',
      headlineJa: '該当するハザードはありませんでした。',
      evacuation: null,
      certainty: 'unknown',
      items: [],
      reasonsJa: [],
      coverageNotesJa: [],
      sources: [],
      disclaimerJa: '実際の避難は、市町村が発表する避難情報に従ってください。',
    })
    expect(panel.type).toBe('hazardCard')
    if (panel.type === 'hazardCard') expect(panel.evacuation).toBeNull()
  })

  it('未知の危険度レベルを拒否（safe は語彙に無い）', () => {
    expect(() =>
      panelSchema.parse({
        type: 'hazardCard',
        placeJa: '地点',
        level: 'safe',
        headlineJa: '',
        evacuation: null,
        certainty: 'exact',
        items: [],
        reasonsJa: [],
        coverageNotesJa: [],
        sources: [],
        disclaimerJa: '',
      }),
    ).toThrow()
  })
})

describe('API: ハザード・カタログ', () => {
  it('group クエリは既知のグループのみ・省略可', () => {
    expect(hazardCatalogQuerySchema.parse({}).group).toBeUndefined()
    expect(hazardCatalogQuerySchema.parse({ group: 'flood' }).group).toBe('flood')
    expect(() => hazardCatalogQuerySchema.parse({ group: 'unknown' })).toThrow()
  })

  it('応答が自己記述的（グループ・レベルのラベルと色つき）でスキーマに適合する', () => {
    const response = hazardCatalogResponseSchema.parse({
      version: hazardCatalog.version,
      groups: hazardGroupViews(),
      levels: hazardLevelViews(),
      disclaimerJa: hazardCatalog.disclaimerJa,
      layers: hazardLayers,
    })
    expect(response.layers.length).toBe(hazardCatalog.layerCount)
    expect(response.groups.length).toBeGreaterThan(0)
    expect(response.levels.length).toBe(hazardCatalog.levels.length)
    expect(response.disclaimerJa.length).toBeGreaterThan(0)
  })
})

describe('hazardPointQuery: 座標の欠落を 0 度にしない（§7.5）', () => {
  it('文字列の座標を数値にする', () => {
    expect(hazardPointQuerySchema.parse({ lon: '139.847', lat: '35.7645' })).toEqual({
      lon: 139.847,
      lat: 35.7645,
    })
  })

  /**
   * `z.coerce.number()` は `Number(null)` も `Number('')` も **0** にする。
   * 素通しすると `?lat=35.7`（lon 欠落）が**経度 0 度**として通り、
   * **別の場所について「指定区域に入っていません」と自信満々に答える**——
   * 防災アプリでいちばん避けたい壊れ方なので、ここで弾く。
   */
  it('欠落・空文字は 0 にせず弾く', () => {
    for (const query of [
      { lon: null, lat: '35.7645' },
      { lon: '', lat: '35.7645' },
      { lon: '139.847', lat: null },
      { lon: '139.847', lat: '' },
      {},
    ]) {
      expect(() => hazardPointQuerySchema.parse(query), JSON.stringify(query)).toThrow()
    }
  })

  it('範囲外の座標も弾く', () => {
    expect(() => hazardPointQuerySchema.parse({ lon: '999', lat: '35' })).toThrow()
    expect(() => hazardPointQuerySchema.parse({ lon: '139', lat: '95' })).toThrow()
  })

  it('呼び名は任意（長すぎるものは弾く）', () => {
    expect(hazardPointQuerySchema.parse({ lon: '139', lat: '35', placeJa: '亀有駅' }).placeJa).toBe(
      '亀有駅',
    )
    expect(() =>
      hazardPointQuerySchema.parse({ lon: '139', lat: '35', placeJa: 'あ'.repeat(61) }),
    ).toThrow()
  })
})
