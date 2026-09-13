import { describe, expect, it } from 'vitest'
import { panelToVNode, panelsToVNodes } from '@/shared/viewer/panels'
import { VIEWER_CSS } from '@/shared/viewer/styles'
import { classNamesOf, vnodeToHtml, type VNode } from '@/shared/viewer/vnode'
import { HAZARD_LEVEL_COLORS, HAZARD_LEVEL_ICONS, clusterColor } from '@/shared/constants'
import { panelSchema, type Panel } from '@/shared/protocol'
import { PANEL_FIXTURES, PANEL_TYPES, panelFixture, stackedTrendFixture } from './fixtures/panels'

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
