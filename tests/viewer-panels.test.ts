import { describe, expect, it } from 'vitest'
import { panelToVNode, panelsToVNodes } from '@/shared/viewer/panels'
import { VIEWER_CSS } from '@/shared/viewer/styles'
import { classNamesOf, vnodeToHtml, type VNode } from '@/shared/viewer/vnode'
import {
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
  PROJECTED_OPACITY,
  clusterColor,
} from '@/shared/constants'
import { panelSchema, type Panel } from '@/shared/protocol'
import { buildStationDetail } from '@/domain/stations/presenter'
import { ageStructurePanel } from '@/domain/stations/age-structure'
import { PANEL_FIXTURES, PANEL_TYPES, panelFixture, stackedTrendFixture } from './fixtures/panels'
import { KOSUGI_1KM, KOSUGI_STATION, KOSUGI_VALUES_1KM, ageRowsOf } from './fixtures/age-structure'

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

const htmlOf = (panel: Panel): string => vnodeToHtml(panelToVNode(panel))

describe('パネルの見本（protocol との対応）', () => {
  it('全パネル型に見本があり、すべて protocol の Zod を通る', () => {
    expect(PANEL_TYPES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(PANEL_FIXTURES.map((panel) => panel.type))).toEqual(new Set(PANEL_TYPES))
    for (const panel of PANEL_FIXTURES) {
      expect(() => panelSchema.parse(panel), panel.type).not.toThrow()
    }
  })

  it('全パネル型が `.panel` の箱と中身を返す（空を描かない）', () => {
    for (const type of PANEL_TYPES) {
      const node = panelToVNode(panelFixture(type))
      expect(node.cls, type).toBe('panel')
      expect(node.children.length, type).toBeGreaterThan(0)
    }
    expect(panelsToVNodes(PANEL_FIXTURES).length).toBe(PANEL_FIXTURES.length)
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
    for (const panel of PANEL_FIXTURES) {
      expect(htmlOf(panel).includes('<script'), panel.type).toBe(false)
    }
  })
})

describe('スタイルとの対応', () => {
  it('描画に現れる CSS クラスは、すべて VIEWER_CSS にある', () => {
    const used = [...new Set(panelsToVNodes(PANEL_FIXTURES).flatMap(classNamesOf))]
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
    const node = panelToVNode(panelFixture('trendChart'))
    const lines = findAll(node, 'polyline')
    expect(lines.length).toBe(2)
  })

  it('積み上げの合計は、内訳の丸め和ではなく `totals` の値を出す', () => {
    const panel = stackedTrendFixture()
    // 内訳の和は 1,732.5 だが、正しい合計は 1,902.3（docs/sales.md §4.5 と同じ問題）。
    const labels = findAll(panelToVNode(panel), 'text').map((node) => node.text)
    expect(labels).toContain('1,902')
    expect(labels).not.toContain('1,733')
  })

  it('推計のある積み上げ（年齢別の人口）：推計の年の棒は淡く、境に破線と「推計」、合計は 2020 と 2050 年だけ', () => {
    const panel = ageStructurePanel(
      buildStationDetail(
        KOSUGI_STATION,
        new Map(Object.entries(KOSUGI_VALUES_1KM)),
        ageRowsOf(1000, KOSUGI_1KM),
      ),
      1000,
    )
    if (panel === null) throw new Error('年齢の図がありません')
    const node = panelToVNode(panel)
    const rects = findAll(node, 'rect')
    expect(rects).toHaveLength(8 * 4)
    const faint = rects.filter((rect) => rect.attrs['fill-opacity'] === PROJECTED_OPACITY)
    expect(faint).toHaveLength(6 * 4) // 2025〜2050 の 6 年 × 4 区分
    expect(findAll(node, 'line').some((line) => line.attrs['stroke-dasharray'] === '4 3')).toBe(
      true,
    )
    const texts = findAll(node, 'text').map((text) => text.text)
    expect(texts).toContain('推計')
    expect(texts).toContain('7.5万') // 2020 年の合計 75,418
    expect(texts).toContain('8.2万') // 2050 年の合計 81,565
    expect(texts).not.toContain('6.8万') // 2015 年の合計は書かない（ツールチップの代わりに省く）
  })

  it('「推計」の文字は上の段にあり、最初の推計の年が山の駅でも棒に届かない（推計のある積み上げだけ段を足す）', () => {
    const peak: Panel = {
      type: 'trendChart',
      title: '2025 年が山',
      unit: '人',
      format: 'int',
      stacked: true,
      projectedFrom: 2025,
      totals: [2015, 2020, 2025, 2030].map((x, index) => ({ x, y: [60, 80, 100, 90][index] ?? 0 })),
      flags: [],
      series: [
        {
          label: 'A',
          points: [2015, 2020, 2025, 2030].map((x, i) => ({ x, y: [40, 50, 60, 55][i] ?? 0 })),
        },
        {
          label: 'B',
          points: [2015, 2020, 2025, 2030].map((x, i) => ({ x, y: [20, 30, 40, 35][i] ?? 0 })),
        },
      ],
    }
    const node = panelToVNode(peak)
    const label = findAll(node, 'text').find((text) => text.text === '推計')
    const barTop = Math.min(...findAll(node, 'rect').map((rect) => Number(rect.attrs.y)))
    // 字のベースラインの下に 2px（漢字の下端）を見ても、いちばん高い棒（2025 年）の上端より上。
    expect(Number(label?.attrs.y) + 2).toBeLessThanOrEqual(barTop)
    // 縦軸のいちばん上の目盛：推計の無い積み上げ（売上）は以前と同じ位置（上の余白 16＋3）、推計のある図は段（13）だけ下。
    const topTickY = (panel: Panel): number =>
      Math.min(
        ...findAll(panelToVNode(panel), 'text')
          .filter((text) => text.attrs['text-anchor'] === 'end')
          .map((text) => Number(text.attrs.y)),
      )
    expect(topTickY(stackedTrendFixture())).toBe(19)
    expect(topTickY(peak)).toBe(19 + 13)
  })

  it('推計の無い積み上げ（売上）は以前のまま：淡い棒も破線も無く、合計は全部の年', () => {
    const node = panelToVNode(stackedTrendFixture())
    expect(findAll(node, 'rect').some((rect) => 'fill-opacity' in rect.attrs)).toBe(false)
    expect(findAll(node, 'text').map((text) => text.text)).not.toContain('推計')
    expect(findAll(node, 'text').map((text) => text.text)).toEqual(
      expect.arrayContaining(['1,902', '2,010']),
    )
  })

  it('畳んだ表（folded）は「題（行の数）」の summary に入れ、行は消さない', () => {
    const html = htmlOf({
      type: 'statTable',
      title: '人口増減率',
      rows: [
        { label: '2015→2020', value: '+11.6%', flagged: false },
        { label: '2010→2015', value: '+8.0%', flagged: false },
      ],
      note: null,
      folded: true,
    })
    expect(html).toContain('<details><summary class="title">人口増減率（2）</summary>')
    expect(html).toContain('+11.6%')
    expect(htmlOf(panelFixture('statTable'))).not.toContain('<details>')
  })

  it('行の無い表は folded でも畳まない（「題（0）」を開いても何も無いので、題だけ）', () => {
    const html = htmlOf({
      type: 'statTable',
      title: '人口増減率',
      rows: [],
      note: null,
      folded: true,
    })
    expect(html).not.toContain('<details>')
    expect(html).not.toContain('人口増減率（0）')
    expect(html).toContain('人口増減率')
  })

  it('散布の色はクラスタ色（共有定数）で、凡例は出さない', () => {
    const html = htmlOf(panelFixture('scatter'))
    expect(html).toContain(clusterColor(0))
    expect(html).toContain(clusterColor(2))
    expect(html).toContain('色＝クラスタ（4）')
  })

  it('棒は最大値で正規化し、欠損は 0% にする', () => {
    const html = htmlOf(panelFixture('barChart'))
    expect(html).toContain('width: 100%') // 1km（最大）
    expect(html).toContain('width: 0%') // 2km（欠損）
  })
})

describe('危険度の伝え方（色だけで伝えない）', () => {
  it('バッジは色・記号・テキストの 3 要素で、免責と出典を落とさない', () => {
    const html = htmlOf(panelFixture('hazardCard'))
    expect(html).toContain(HAZARD_LEVEL_COLORS.danger)
    expect(html).toContain(HAZARD_LEVEL_ICONS.danger)
    expect(html).toContain('危険')
    expect(html).toContain('想定であり、実際の被害を保証するものではありません')
    expect(html).toContain('出典: 国土地理院')
  })

  it('避難の目安・限界・注記は共有の文言のまま出す', () => {
    expect(htmlOf(panelFixture('hazardCard'))).toContain('立退き避難が基本')
    expect(htmlOf(panelFixture('evacuationList'))).toContain('開設状況は分かりません')
    expect(htmlOf(panelFixture('escapeDirection'))).toContain('経路案内ではありません')
  })
})

describe('駅周辺のプロフィール（stationProfile・2026-10-09 B4）', () => {
  const html = htmlOf(panelFixture('stationProfile'))

  it('性格の目安・凡例・値・位置・注記を出す', () => {
    expect(html).toContain('業務地型：働きに来る人が、住む人より多いエリア')
    expect(html).toContain('市内＝横浜市')
    expect(html).toContain('43,471 人')
    expect(html).toContain('神奈川県内 上位 19%')
    expect(html).toContain('⚠ 1人当たり所得') // ⚠ の値は印つき
    expect(html).toContain('市全体の平均が主')
  })

  it('見ていないことを必ず出す', () => {
    expect(html).toContain('見ていないこと: 治安（犯罪の件数）・学校・学区・保育園の空き')
  })

  it('災害は時制・記号・色で示し、危険度の語は出さない（いまの危険度と読まれる）', () => {
    expect(html).toContain('災害（もし起きたら）')
    expect(html).toContain(HAZARD_LEVEL_ICONS.warning)
    expect(html).toContain(HAZARD_LEVEL_COLORS.warning)
    expect(html).not.toContain('警戒')
    expect(html).toContain('区域図が無い災害: 土砂災害（安全という意味ではありません）')
    expect(html).toContain('出典: 国土交通省')
  })
})

describe('エリアの要約（areaSummary・2026-10-10 B5b）', () => {
  const panel = panelFixture('areaSummary')
  const html = htmlOf(panel)

  it('区域の値は見出しの文・作り方・推計の山と当たり具合を出す', () => {
    expect(html).toContain('神奈川県横浜市の要約')
    expect(html).toContain('2050年 3,537,253 人（推計・2020年比 -6.4%）')
    expect(html).toContain('推計（市区町村ごとの合計）')
    expect(html).toContain('推計の山：2025年 3,786,702 人・2025年の実績は推計より 0.9% 少ない')
  })

  it('駅の周りは「駅の周り（1km圏・137 駅）」と名乗り、中央値・中ほどの半分・上位と下位・⚠ を出す', () => {
    expect(html).toContain('駅の周り（1km圏・137 駅）')
    expect(html).toContain('+0.2%〜+4.9%（136 駅）')
    expect(html).toContain(
      '上位 みなとみらい +24.3%／下位 産業振興センター -9.8%／⚠ 2 駅は参考値なので除いた',
    )
  })

  it('出せない値・見ていないことを必ず出す', () => {
    expect(html).toContain('出せない値：人口（1995〜2015年）')
    expect(html).toContain(
      '見ていないこと: 増えた・減った理由（再開発・転入・住宅の供給など）・年齢構成・世帯の形',
    )
  })

  it('色分けの凡例：見本の色・段・駅の数・⚠・値なし・色の意味', () => {
    expect(html).toContain('地図の色分け：人口増減率（2015→2020年・1km圏）')
    expect(html).toContain('background: #0571b0')
    expect(html).toContain('-5%未満（4 駅）')
    expect(html).toContain('参考値（⚠）（2 駅）')
    expect(html).toContain('値なし 1 駅（描かない）')
    expect(html).toContain('赤は増加、青は減少')
  })

  it('凡例の色も `#hex` だけを受け入れる（サーバの応答を別の部品が描くとき）', () => {
    if (panel.type !== 'areaSummary' || panel.legend === null) throw new Error('見本が違う')
    const hostile: Panel = {
      ...panel,
      legend: {
        ...panel.legend,
        classes: [
          {
            index: 0,
            color: 'red; background: url(x)',
            lower: null,
            upper: null,
            labelJa: '全部',
            count: 1,
          },
        ],
      },
    }
    const out = htmlOf(hostile)
    expect(out).not.toContain('url(x)')
    expect(out).toContain('全部（1 駅）')
  })

  it('色分けしなかったら理由だけ（段も色の意味も出さない）', () => {
    if (panel.type !== 'areaSummary' || panel.legend === null) throw new Error('見本が違う')
    const unstyled: Panel = {
      ...panel,
      legend: {
        ...panel.legend,
        classes: [],
        meaningJa: null,
        reasonJa: '値のある駅が 3 しかないので色分けしない（5 駅から）。',
      },
    }
    const out = htmlOf(unstyled)
    expect(out).toContain('値のある駅が 3 しかないので色分けしない')
    expect(out).not.toContain('赤は増加')
  })

  it('比較は比べる表（行＝項目・列＝エリア）とエリアごとの見出し', () => {
    if (panel.type !== 'areaSummary') throw new Error('見本が違う')
    const card = panel.areas[0]
    if (card === undefined) throw new Error('見本が違う')
    const compared: Panel = {
      ...panel,
      title: '横浜市・川崎市の比較',
      areas: [card, { ...card, ref: 'muni:14130', nameJa: '川崎市', labelJa: '神奈川県川崎市' }],
      comparison: {
        refs: ['muni:14100', 'muni:14130'],
        names: ['神奈川県横浜市', '神奈川県川崎市'],
        rows: [{ labelJa: '人口の増減（2020→2025年）', cells: ['-0.7%', '+1.4%'] }],
        baseYear: 2020,
        notesJa: ['推移は 2020年を 100 とした指数。'],
      },
    }
    const out = htmlOf(compared)
    expect(out).toContain('<th>神奈川県横浜市</th><th>神奈川県川崎市</th>')
    expect(out).toContain(
      '<td class="muted">人口の増減（2020→2025年）</td><td>-0.7%</td><td>+1.4%</td>',
    )
    expect(out).toContain('<div class="title">神奈川県川崎市</div>')
    expect(out).toContain('推移は 2020年を 100 とした指数。')
  })
})

describe('棒の負の値（人口の増減の内訳・B5b）', () => {
  const signed: Panel = {
    type: 'barChart',
    title: '横浜市の区ごとの人口の増減（2020→2025年）',
    unit: '%',
    format: 'percent1',
    category: 'population',
    bars: [
      { label: '西区', value: 3.1, formatted: '+3.1%', flagged: false },
      { label: '金沢区', value: -3.4, formatted: '-3.4%', flagged: false },
      { label: '不明区', value: null, formatted: '—', flagged: false },
    ],
    flags: [],
    note: null,
  }

  it('0 を真ん中に置き、正は右・負は左へ（絶対値の最大で半分の幅）', () => {
    const html = htmlOf(signed)
    expect(html).toContain('class="bar-zero"')
    expect(html).toContain('left: 50%; width: 45.59%') // 西区 3.1 / 3.4 × 50（小数 2 桁）
    expect(html).toContain('left: 0%; width: 50%') // 金沢区（最大）
    expect(html).toContain('left: 50%; width: 0%') // 欠損
  })

  it('負の無い棒は以前のまま（0 の線を引かず、左から伸ばす）', () => {
    const html = htmlOf(panelFixture('barChart'))
    expect(html).not.toContain('bar-zero')
    expect(html).not.toContain('signed')
  })
})
