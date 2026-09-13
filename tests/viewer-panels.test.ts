import { describe, expect, it } from 'vitest'
import { panelToVNode, panelsToVNodes } from '@/shared/viewer/panels'
import { VIEWER_CSS } from '@/shared/viewer/styles'
import { classNamesOf, vnodeToHtml, type VNode } from '@/shared/viewer/vnode'
import { HAZARD_LEVEL_COLORS, HAZARD_LEVEL_ICONS, clusterColor } from '@/shared/constants'
import { panelSchema, type Panel } from '@/shared/protocol'

/**
 * **ビューアのパネル描画**（PR-11・`docs/260912_gui_chat_protocol.md` 決定 11）。
 *
 * MCP Apps（iframe）は撤収したが、パネルの描き方は T1（サーバ生成の地図レポート）と
 * T2（ビューア・プラグイン）の共通部品として残る。ここで固定するのは、
 * ①**全パネル型に見本があり描ける**こと（protocol に型を足すと見本不足で落ちる。
 * 描き分けそのものの網羅は `panelToVNode` の switch が型で保証する）、
 * ②直列化が **XSS 安全**（本文・属性を必ずエスケープ／script も on* も出さない）、
 * ③描画に現れる **CSS クラスがすべて `VIEWER_CSS` にある**（片方だけ直して置き去りにしない）、
 * ④チャートの読み違えを生む規則（欠損で線を切る・積み上げの合計は丸め前の値・クラスタ色）、
 * ⑤危険度は**色だけで伝えない**（色＋記号＋テキスト・`docs/260824_flood.md` §7.6）。
 */

/** protocol の判別ユニオンから全パネル型リテラルを導出（手書きリストにしない）。 */
const PANEL_TYPES: readonly string[] = panelSchema.options.map((option) => option.shape.type.value)

const source = { labelJa: '国土地理院', url: null, license: 'CC BY 4.0', forJa: null }

/** 全パネル型の見本（**Zod で検証**するので、形がずれたらこのテストが落ちる）。 */
const FIXTURES: readonly Panel[] = [
  {
    type: 'stationCard',
    grp: '横浜#0',
    stationName: '横浜',
    label: '横浜駅',
    prefecture: '神奈川県',
    operators: 'JR東日本 / 東急',
    paxLatest: 393_622,
    badges: [{ label: '低分母', level: 'warn' }],
  },
  {
    type: 'trendChart',
    title: '乗降客数の推移',
    unit: '人/日',
    format: 'int',
    category: 'passenger',
    flags: [],
    series: [
      {
        label: '乗降客数',
        points: [
          { x: 2018, y: 450_000 },
          { x: 2019, y: 420_000 },
          { x: 2020, y: null },
          { x: 2021, y: 300_000 },
          { x: 2022, y: 330_000 },
        ],
      },
    ],
    stats: [{ label: 'コロナ前後比', value: '-21.4%', flagged: false }],
  },
  {
    type: 'trendChart',
    title: '売上の推移',
    unit: '百万円',
    format: 'int',
    stacked: true,
    totals: [
      { x: 2016, y: 1_902.3 },
      { x: 2021, y: 2_010.0 },
    ],
    flags: [],
    series: [
      {
        label: '小売',
        color: '#ea580c',
        points: [
          { x: 2016, y: 1_469.2 },
          { x: 2021, y: 1_500 },
        ],
      },
      {
        label: '飲食宿泊',
        points: [
          { x: 2016, y: 263.3 },
          { x: 2021, y: 310 },
        ],
      },
    ],
  },
  {
    type: 'statTable',
    title: '増減率',
    rows: [{ label: '2015→2020', value: '+3.2%', flagged: true }],
    note: '低分母の行には ⚠ を付けています',
  },
  {
    type: 'barChart',
    title: '半径別の人口',
    unit: '人',
    format: 'int',
    bars: [
      { label: '500m', value: 12_000, formatted: '12,000', flagged: false },
      { label: '1km', value: 34_000, formatted: '34,000', flagged: false, emphasis: true },
      { label: '2km', value: null, formatted: '—', flagged: true },
    ],
    flags: [{ label: '低分母', level: 'info' }],
    note: null,
  },
  {
    type: 'rankingTable',
    title: '人口増減率ランキング',
    metricKey: 'pop_gr_2020_2015_1km',
    unit: '%',
    rows: [
      {
        rank: 1,
        grp: '武蔵小杉#0',
        name: '武蔵小杉',
        prefecture: '神奈川県',
        value: 12.3,
        formatted: '+12.3%',
        flagged: false,
      },
    ],
  },
  {
    type: 'scatter',
    title: '人口増減率 × 地価増減率',
    xLabel: '人口増減率',
    yLabel: '地価増減率',
    xUnit: '%',
    yUnit: '%',
    points: [
      { grp: 'a#0', name: 'A', x: 1, y: 2, cluster: 0 },
      { grp: 'b#0', name: 'B', x: 3, y: 1, cluster: 2 },
    ],
    clusterCount: 4,
  },
  {
    type: 'hazardCard',
    placeJa: '横浜駅',
    level: 'danger',
    headlineJa: 'この場所は洪水浸水想定区域に入っています',
    evacuation: 'takeaway',
    certainty: 'exact',
    items: [
      {
        layerKey: 'flood_l2',
        labelJa: '洪水浸水想定区域（想定最大規模）',
        valueJa: '3.0〜5.0m 未満',
        meaningJa: '2 階部分が浸水する高さ',
        level: 'danger',
        color: '#ff9f15',
        source: 'tile',
        coverage: null,
        certainty: 'exact',
      },
    ],
    reasonsJa: ['浸水深の階級が 3.0m 以上です'],
    coverageNotesJa: ['白い場所が安全という意味ではありません'],
    sources: [source],
    disclaimerJa: '想定であり、実際の被害を保証するものではありません',
  },
  {
    type: 'evacuationList',
    forDisasterJa: '洪水',
    siteKindJa: '指定緊急避難場所',
    placeJa: '横浜駅',
    headlineJa: '近くの指定緊急避難場所は 1 件です',
    items: [
      {
        nameJa: '〇〇小学校',
        addressJa: '神奈川県横浜市…',
        lon: 139.62,
        lat: 35.466,
        distanceM: 1_200,
        distanceJa: '約1.2km',
        bearingJa: '北東',
        disastersJa: ['洪水', '土砂災害'],
        hazardAreaCertainty: 'outside',
        hazardAreaSource: 'tile',
        hazardAreaJa: '想定区域にかからない',
        hazardAreaDetailJa: null,
        elevationM: 12.3,
        remarksJa: '洪水での避難は〇〇川を対象とする',
      },
    ],
    limitationsJa: ['開設状況は分かりません'],
    notesJa: ['直線距離です'],
    sources: [source],
    disclaimerJa: '実際の避難は市町村の避難情報に従ってください',
  },
  {
    type: 'escapeDirection',
    placeJa: '横浜駅',
    forDisasterJa: '洪水の想定区域',
    headlineJa: '北東へ約 600m で想定区域の外に出ます',
    direction: {
      bearingJa: '北東',
      distanceM: 600,
      distanceJa: '約600m',
      lon: 139.63,
      lat: 35.47,
    },
    limitationsJa: ['250m の目安です'],
    notesJa: ['移動が安全とは限りません'],
    sources: [source],
    disclaimerJa: '経路案内ではありません',
  },
  { type: 'markdown', body: '第 1 段落です。\n\n第 2 段落です。' },
]

/** 型ごとの最初の見本。 */
function fixtureOf(type: string): Panel {
  const panel = FIXTURES.find((each) => each.type === type)
  if (panel === undefined) throw new Error(`見本の無いパネル型: ${type}`)
  return panel
}

const htmlOf = (panel: Panel): string => vnodeToHtml(panelToVNode(panel))

describe('パネルの見本（protocol との対応）', () => {
  it('全パネル型に見本があり、すべて protocol の Zod を通る', () => {
    expect(PANEL_TYPES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(FIXTURES.map((panel) => panel.type))).toEqual(new Set(PANEL_TYPES))
    for (const panel of FIXTURES) {
      expect(() => panelSchema.parse(panel), panel.type).not.toThrow()
    }
  })

  it('全パネル型が `.panel` の箱と中身を返す（空を描かない）', () => {
    for (const type of PANEL_TYPES) {
      const node = panelToVNode(fixtureOf(type))
      expect(node.cls, type).toBe('panel')
      expect(node.children.length, type).toBeGreaterThan(0)
    }
    expect(panelsToVNodes(FIXTURES).length).toBe(FIXTURES.length)
  })

  it('未対応の型でも落ちず、そのことを 1 行で出す（新しいサーバの応答を古い部品が読む場合）', () => {
    // 型としては never（switch の網羅は型が保証する）。実行時には来うるので、その振る舞いを固定する。
    const fromNewerServer: Panel = JSON.parse('{"type":"futurePanel"}')
    expect(vnodeToHtml(panelToVNode(fromNewerServer))).toContain('未対応のパネル型: futurePanel')
  })
})

describe('HTML への直列化（XSS 安全）', () => {
  it('本文の記号はエスケープされ、script も on* 属性も出ない', () => {
    const html = htmlOf({ type: 'markdown', body: '<script>alert("x")</script> & <b>' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script')
    expect(html).toContain('&amp;')
    expect(/\son[a-z]+=/.test(html)).toBe(false)
  })

  it('引用符を含む本文でも属性から脱出できない（本文は属性に行かない）', () => {
    const html = htmlOf({
      type: 'stationCard',
      grp: 'x#0',
      stationName: 'x',
      label: '" onclick="alert(1)',
      prefecture: '東京都',
      operators: null,
      paxLatest: null,
      badges: [],
    })
    // 本文はテキストノードに入るので、属性の外に出ない（`on*=` が属性として出ない）。
    expect(/<[a-z]+[^>]*\sonclick=/.test(html)).toBe(false)
    expect(html).toContain('onclick="alert(1)（東京都）</div>')
  })

  it('サーバ由来の色は `#hex` だけを受け入れる（style への CSS 注入を断つ）', () => {
    const hostile: Panel = {
      type: 'trendChart',
      title: '推移',
      unit: null,
      format: null,
      flags: [],
      series: [
        {
          label: 'x',
          color: 'red; background: url(javascript:alert(1))',
          points: [
            { x: 2020, y: 1 },
            { x: 2021, y: 2 },
          ],
        },
      ],
    }
    const html = htmlOf(hostile)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('url(')
  })

  it('全見本の HTML に生の `<script` が出ない', () => {
    for (const panel of FIXTURES) {
      expect(htmlOf(panel).includes('<script'), panel.type).toBe(false)
    }
  })
})

describe('スタイルとの対応', () => {
  it('描画に現れる CSS クラスは、すべて VIEWER_CSS にある', () => {
    const used = [...new Set(panelsToVNodes(FIXTURES).flatMap(classNamesOf))]
    expect(used.length).toBeGreaterThan(5)
    for (const name of used) {
      expect(new RegExp(`\\.${name}\\b`).test(VIEWER_CSS), name).toBe(true)
    }
  })
})

describe('チャートの規則（読み違えを生む所）', () => {
  /** 木から指定タグのノードを集める。 */
  function findAll(node: VNode, tag: string): readonly VNode[] {
    return [
      ...(node.tag === tag ? [node] : []),
      ...node.children.flatMap((child) => findAll(child, tag)),
    ]
  }

  it('欠損（null）で線を切る——2019 と 2021 がつながらない', () => {
    const node = panelToVNode(fixtureOf('trendChart'))
    const lines = findAll(node, 'polyline')
    expect(lines.length).toBe(2)
  })

  it('積み上げの合計は、内訳の丸め和ではなく `totals` の値を出す', () => {
    const stacked = FIXTURES.filter(
      (panel) => panel.type === 'trendChart' && panel.stacked === true,
    )
    const panel = stacked[0]
    expect(panel).toBeDefined()
    if (panel === undefined) return
    // 内訳の和は 1,732.5 だが、正しい合計は 1,902.3（docs/sales.md §4.5 と同じ問題）。
    const labels = findAll(panelToVNode(panel), 'text').map((node) => node.text)
    expect(labels).toContain('1,902')
    expect(labels).not.toContain('1,733')
  })

  it('散布の色はクラスタ色（共有定数）で、凡例は出さない', () => {
    const html = htmlOf(fixtureOf('scatter'))
    expect(html).toContain(clusterColor(0))
    expect(html).toContain(clusterColor(2))
    expect(html).toContain('色＝クラスタ（4）')
  })

  it('棒は最大値で正規化し、欠損は 0% にする', () => {
    const html = htmlOf(fixtureOf('barChart'))
    expect(html).toContain('width: 100%') // 1km（最大）
    expect(html).toContain('width: 0%') // 2km（欠損）
  })
})

describe('危険度の伝え方（色だけで伝えない）', () => {
  it('バッジは色・記号・テキストの 3 要素で、免責と出典を落とさない', () => {
    const html = htmlOf(fixtureOf('hazardCard'))
    expect(html).toContain(HAZARD_LEVEL_COLORS.danger)
    expect(html).toContain(HAZARD_LEVEL_ICONS.danger)
    expect(html).toContain('危険')
    expect(html).toContain('想定であり、実際の被害を保証するものではありません')
    expect(html).toContain('出典: 国土地理院')
  })

  it('避難の目安・限界・注記は共有の文言のまま出す', () => {
    expect(htmlOf(fixtureOf('hazardCard'))).toContain('立退き避難が基本')
    expect(htmlOf(fixtureOf('evacuationList'))).toContain('開設状況は分かりません')
    expect(htmlOf(fixtureOf('escapeDirection'))).toContain('経路案内ではありません')
  })
})
