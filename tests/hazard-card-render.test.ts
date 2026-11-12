import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EscapeDirection } from '@/components/panels/EscapeDirection'
import { EvacuationList } from '@/components/panels/EvacuationList'
import { HazardCard } from '@/components/panels/HazardCard'
import { HazardDisclaimerAtEndContext } from '@/components/panels/HazardDisclaimer'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { ALERT_LIMITATION_JA } from '@/domain/hazard/level'
import {
  hazardCardPanel,
  hazardDetailsSummaryJa,
  reasonsBesideHighlightsJa,
} from '@/domain/hazard/panels'
import { pointHazard, type PointHazardInput } from '@/domain/hazard/point'
import { getHazardLayer, HAZARD_DISCLAIMER_JA } from '@/shared/hazard'
import type { EscapeDirectionPanel, EvacuationListPanel, HazardCardPanel } from '@/shared/protocol'

/**
 * 災害のカードを**描いた HTML**で確かめる（2026-11-11・`docs/261110_fix_PLAN.md` §8.3・§10.2 PR-5）。
 *
 * 地点のカードは、その場所に固有の注意を見せて一般論を畳む。ここで固定するのは、畳んではいけないもの
 * （種類ごとの状態・「安全という意味ではありません」・川の到達と継続・出典）が `<details>` の**外**にあり、
 * 畳んだ中に根拠と注意が**1 行も欠けず**に入っていること。免責は、入れ物が末尾で出すときだけカードから消える。
 * 実ブラウザでの見え方は `tests/ui.hazard-tab.smoke.py` が見る。
 */

const ALL_LAYERS = hazardLayersWithPointAnswer()

/** そのレイヤの凡例の色（公式タイルの画素として渡す）。手で書くと凡例の改訂で黙って外れる。 */
function legendColor(layerKey: string): string {
  const color = getHazardLayer(layerKey)?.ranks.find((rank) => rank.color !== null)?.color
  if (color === undefined || color === null) throw new Error(`凡例に色がありません: ${layerKey}`)
  return color
}

function input(overrides: Partial<PointHazardInput> = {}): PointHazardInput {
  return {
    lon: 139.847,
    lat: 35.7645,
    placeJa: '亀有',
    mesh: [],
    tile: [],
    tileNearby: [],
    uncoveredLayerKeys: [],
    unreachedLayerKeys: [],
    rivers: [],
    elevationM: 0.2,
    onlineSourcesReached: true,
    notesJa: [],
    ...overrides,
  }
}

/** 亀有の形（2026-11-11 の実測）：洪水・高潮に該当／土砂の図なし／浸水ナビの川が 2 本。 */
const KAMEARI = hazardCardPanel(
  pointHazard(
    input({
      tile: ['flood_l2', 'flood_l1', 'flood_duration', 'hightide_l2'].map((layerKey) => ({
        layerKey,
        hex: legendColor(layerKey),
      })),
      uncoveredLayerKeys: ['dosekiryu', 'jisuberi'],
      rivers: [
        { nameJa: '中川', maxDepthM: 3.62, arriveMin: 50, continueMin: 5718 },
        { nameJa: '利根川', maxDepthM: 1.1, arriveMin: 1434, continueMin: 11520 },
      ],
    }),
    ALL_LAYERS,
  ),
)

function html(panel: HazardCardPanel): string {
  return renderToStaticMarkup(createElement(HazardCard, { panel }))
}

/** 入れ物（駅の災害タブ）が免責を末尾で出すときの描き方。 */
function insideTab(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(HazardDisclaimerAtEndContext.Provider, { value: true }, element),
  )
}

/** タグを外した文字（`**` の強調は <strong> になるので、見比べるときは印を外した文と比べる）。 */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, '')
}

/** 畳んだ中身（`<details>…</details>`）と、それ以外（何も押さずに見える部分）に分ける。 */
function split(markup: string): { readonly folded: string; readonly shown: string } {
  const start = markup.indexOf('<details')
  const end = markup.indexOf('</details>')
  if (start < 0 || end < 0) return { folded: '', shown: markup }
  const folded = markup.slice(start, end + '</details>'.length)
  return { folded, shown: markup.replace(folded, '') }
}

/** `aria-label` の付いたリストの行の数。 */
function itemsOf(markup: string, label: string): number {
  const list = markup.match(new RegExp(`<ul aria-label="${label}"[^>]*>([\\s\\S]*?)</ul>`))
  return list === null ? 0 : (list[1]?.match(/<li/g) ?? []).length
}

describe('地点のカード：畳まないもの（何も押さずに見える）', () => {
  const { shown } = split(html(KAMEARI))

  it('前提：応答に種類ごとの状態・1 文・川の事実がある', () => {
    expect(KAMEARI.groupStates).toHaveLength(5)
    expect(KAMEARI.keyNotesJa).toHaveLength(1)
    expect(KAMEARI.highlightsJa).toHaveLength(2)
  })

  it('該当しなかった種類を状態ごとに 1 行で出す（該当なし・想定区域図なし）', () => {
    expect(textOf(shown)).toContain('該当なし：内水（雨水出水）・津波')
    expect(textOf(shown)).toContain('想定区域図なし：土砂災害')
  })

  it('「安全という意味ではありません」の 1 文を畳まない（260824 §7.5-1）', () => {
    expect(textOf(shown)).toContain(
      '「該当なし」「想定区域図なし」は、安全という意味ではありません。',
    )
  })

  it('川の到達・継続を、該当の行のすぐ下に畳まずに出す', () => {
    for (const fact of KAMEARI.highlightsJa ?? []) expect(textOf(shown)).toContain(fact)
  })

  it('出典は畳まない（年度と出典を常時表示・260824 §7.5-3）', () => {
    for (const source of KAMEARI.sources) expect(textOf(shown)).toContain(source.labelJa)
  })

  it('出所の札は「地図と同じ」以外の行にだけ出す（浸水ナビの実測は札で見分ける）', () => {
    expect(textOf(shown)).toContain('浸水ナビの実測')
    expect(textOf(shown)).not.toContain('地図と同じ')
  })

  it('危険度の語は読み上げに残す（色・記号・文字の 3 重・260824 §7.6）', () => {
    expect(shown).toContain('<span class="sr-only">（危険）</span>')
  })

  it('「安全です」とは書かない', () => {
    expect(textOf(html(KAMEARI))).not.toMatch(/安全です|問題ありません/)
  })
})

describe('地点のカード：畳むもの（根拠と注意・1 行も捨てない）', () => {
  const { folded } = split(html(KAMEARI))
  const reasons = reasonsBesideHighlightsJa(KAMEARI.reasonsJa, KAMEARI.highlightsJa ?? [])

  it('畳んだ中の注意の数は、応答の注意（取れなかったもの＋網羅性の注記）の数と同じ', () => {
    expect(itemsOf(folded, '注意')).toBe(KAMEARI.coverageNotesJa.length)
    for (const note of KAMEARI.coverageNotesJa) {
      expect(textOf(folded)).toContain(note.replaceAll('**', ''))
    }
  })

  it('根拠も全部入る。ただし川の到達・継続は外に出したので、ここで 2 回目を言わない', () => {
    expect(itemsOf(folded, '根拠')).toBe(reasons.length)
    expect(reasons.length).toBe(KAMEARI.reasonsJa.length - 2)
    for (const fact of KAMEARI.highlightsJa ?? []) expect(textOf(folded)).not.toContain(fact)
  })

  it('見出しに数を出す（「根拠と注意（N）」）', () => {
    expect(textOf(folded)).toContain(
      hazardDetailsSummaryJa(reasons.length + KAMEARI.coverageNotesJa.length),
    )
  })
})

describe('免責（必ず出す・入れ物が末尾で出すときだけカードでは出さない）', () => {
  const escape: EscapeDirectionPanel = {
    type: 'escapeDirection',
    placeJa: '亀有',
    forDisasterJa: '洪水の想定区域',
    headlineJa:
      '亀有から洪水の想定区域の外へは、北へ約 1.2km がいちばん近い向きです（参考情報です）。',
    direction: null,
    limitationsJa: ['直線距離です。'],
    notesJa: [],
    sources: [],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
  const evacuation: EvacuationListPanel = {
    type: 'evacuationList',
    forDisasterJa: '洪水',
    siteKindJa: '指定緊急避難場所',
    placeJa: '亀有',
    headlineJa: '近い順に 0 件です。',
    items: [],
    limitationsJa: ['開設されているとは限りません。'],
    notesJa: [],
    sources: [],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }

  it('ふだん（現在地・会話・警戒バナー）は、カードごとに出す', () => {
    expect(textOf(html(KAMEARI))).toContain(HAZARD_DISCLAIMER_JA)
    expect(
      textOf(renderToStaticMarkup(createElement(EscapeDirection, { panel: escape }))),
    ).toContain(HAZARD_DISCLAIMER_JA)
    expect(
      textOf(renderToStaticMarkup(createElement(EvacuationList, { panel: evacuation }))),
    ).toContain(HAZARD_DISCLAIMER_JA)
  })

  it('入れ物が末尾で出すときは、どのパネルも出さない（同じ 1 文を 3〜4 回並べない）', () => {
    expect(insideTab(createElement(HazardCard, { panel: KAMEARI }))).not.toContain(
      HAZARD_DISCLAIMER_JA,
    )
    expect(insideTab(createElement(EscapeDirection, { panel: escape }))).not.toContain(
      HAZARD_DISCLAIMER_JA,
    )
    expect(insideTab(createElement(EvacuationList, { panel: evacuation }))).not.toContain(
      HAZARD_DISCLAIMER_JA,
    )
  })

  it('避難先と向きの限界は、入れ物の中でも畳まない（260824 §8.5・§8.6）', () => {
    expect(insideTab(createElement(EscapeDirection, { panel: escape }))).toContain('直線距離です。')
    expect(insideTab(createElement(EvacuationList, { panel: evacuation }))).toContain(
      '開設されているとは限りません。',
    )
  })
})

describe('すぐ近く・未確認・確からしさ', () => {
  it('立川の形：すぐ近くは距離感を添えて 1 行に', () => {
    const tachikawa = hazardCardPanel(
      pointHazard(
        input({
          placeJa: '立川',
          mesh: [{ layerKey: 'flood_l2', sourceCode: 0, coverage: 0, neighbourSourceCode: 3 }],
          uncoveredLayerKeys: ['hightide_l2', 'tsunami_shinsui'],
        }),
        ALL_LAYERS,
      ),
    )
    const text = textOf(split(html(tachikawa)).shown)
    expect(text).toContain('すぐ近くに区域：洪水（隣の 250m メッシュ）')
    expect(text).toContain('該当なし：内水（雨水出水）・土砂災害')
    expect(text).toContain('想定区域図なし：高潮・津波')
  })

  it('オフライン（メッシュだけ）：確かめられない種類は「未確認」と言い、理由は畳んだ中に残す', () => {
    const offline = hazardCardPanel(
      pointHazard(
        input({
          onlineSourcesReached: false,
          notesJa: ['オフラインのため、端末に保存した 250m メッシュだけで判断しています。'],
        }),
        ALL_LAYERS,
      ),
    )
    const { shown, folded } = split(html(offline))
    expect(textOf(shown)).toContain('未確認：洪水・内水（雨水出水）・高潮・津波・土砂災害')
    expect(textOf(shown)).toContain('「未確認」は、安全という意味ではありません。')
    // 確からしさの一言（照合できていない・時間をおいて）は見える所に。理由（オフライン）は畳む。
    expect(textOf(shown)).toContain('時間をおいて、もう一度ご確認ください')
    expect(textOf(folded)).toContain('オフラインのため')
  })

  it('区間でしか言えない結論のときは、確からしさの一言を重ねない（同じことを 2 回言わない）', () => {
    const partial = hazardCardPanel(
      pointHazard(
        input({
          mesh: [{ layerKey: 'flood_l2', sourceCode: 2, coverage: 0.4, neighbourSourceCode: 2 }],
        }),
        ALL_LAYERS,
      ),
    )
    expect(partial.certainty).toBe('partial')
    expect(partial.headlineJa).toContain('250m メッシュの')
    expect(textOf(html(partial))).not.toContain('250m メッシュの範囲での判断です')
  })

  it('結論は点で言えていて、ほかの行が区間のときは、但し書きを出す', () => {
    const mixed = hazardCardPanel(
      pointHazard(
        input({
          tile: [{ layerKey: 'flood_l2', hex: legendColor('flood_l2') }],
          mesh: [
            { layerKey: 'flood_duration', sourceCode: 2, coverage: 0.4, neighbourSourceCode: 2 },
          ],
        }),
        ALL_LAYERS,
      ),
    )
    expect(mixed.certainty).toBe('partial')
    expect(mixed.headlineJa).not.toContain('250m メッシュ')
    expect(textOf(html(mixed))).toContain('250m メッシュの範囲での判断です')
  })
})

describe('今までの描き方（種類ごとの状態が無いカード）', () => {
  it('警報のカード：何も畳まず、時刻と限界を見える所に出す（警戒中は今のまま）', () => {
    const alert: HazardCardPanel = {
      type: 'hazardCard',
      placeJa: 'この地点',
      level: 'warning',
      levelLabelJa: '警戒レベル3相当',
      headlineJa: '葛飾区に大雨警報（警戒レベル3相当）が発表されています。',
      evacuation: null,
      certainty: 'exact',
      items: [],
      reasonsJa: ['葛飾区：大雨警報（警戒レベル3相当・発表）'],
      coverageNotesJa: ['気象庁の発表時刻：11月11日 02:49', ALERT_LIMITATION_JA],
      sources: [],
      disclaimerJa: HAZARD_DISCLAIMER_JA,
    }
    const markup = html(alert)
    expect(markup).not.toContain('<details')
    expect(textOf(markup)).toContain('気象庁の発表時刻')
    expect(textOf(markup)).toContain(ALERT_LIMITATION_JA)
    expect(textOf(markup)).toContain(HAZARD_DISCLAIMER_JA)
  })

  it('配備の切り替わりの間の古い応答（3 項目が無い）も、今までどおり全部を見せる', () => {
    const legacy: HazardCardPanel = {
      ...KAMEARI,
      groupStates: undefined,
      keyNotesJa: undefined,
      highlightsJa: undefined,
    }
    const markup = html(legacy)
    expect(markup).not.toContain('<details')
    for (const note of KAMEARI.coverageNotesJa) {
      expect(textOf(markup)).toContain(note.replaceAll('**', ''))
    }
    expect(textOf(markup)).toContain('地図と同じ')
  })
})
