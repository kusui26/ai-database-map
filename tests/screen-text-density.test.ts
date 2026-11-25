/**
 * 画面の文字を減らす（2026-11-11・`docs/261110_fix_PLAN.md` §2.2・§4・§7）——駅周辺のプロフィールとエリアの要約の描き方。
 *
 * 利用者から「テキストが多すぎ」と言われた。本番で測ると、概要の本文の 45%・エリアの 42% が、見ていないこと・全体の注記・
 * 凡例の写し・出典だった。画面には値と、その値の読み方を変える注記だけを先に出し、どこでも同じ一般論は出さない。
 * **応答（共通 API）と AI に渡す要約は変えない**——それは `domain-profile`・`domain-area-summary`・`ai-*` の単体が見ている。
 *
 * 部品は React で、このリポジトリの単体（node）では描けない。振る舞いは実ブラウザ（`ui.station-profile`・`ui.area-summary`
 * ・`ui.area-figure`）が見て、ここは**描かないと決めたものを描き直していないこと**をソースで固定する
 * （`panel-layout.test.ts` のヘッダの不変条件と同じ作法）。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildStationDetail } from '@/domain/stations/presenter'
import { populationPanels } from '@/domain/stations/panels'
import { AGE_STRUCTURE_READING_JA } from '@/domain/stations/age-structure'
import { KOSUGI_1KM, KOSUGI_STATION, KOSUGI_VALUES_1KM, ageRowsOf } from './fixtures/age-structure'

/** 画面に出る側だけ（コメントと import を落とす。コメントの「見ていないこと」を拾わないため・`hazard-tense.test.ts` と同じ）。 */
function rendered(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^import[\s\S]*?from '[^']+'$/gm, '')
}

const PROFILE = rendered('src/components/panels/StationProfile.tsx')
const AREA = rendered('src/components/panels/AreaSummary.tsx')
const TABLE = rendered('src/components/panels/StatTable.tsx')
const TREND = rendered('src/components/panels/TrendChart.tsx')

describe('駅周辺のプロフィール（概要タブ・会話の中のプロフィール）', () => {
  it('見ていないことと全体の注記を描かない（応答と AI の本文には残る）', () => {
    expect(PROFILE).not.toContain('notCoveredJa')
    expect(PROFILE).not.toContain('panel.notesJa')
    expect(PROFILE).not.toContain('見ていないこと')
  })

  it('値のすぐ下の注記（その値の読み方を変えるもの）は描く', () => {
    expect(PROFILE).toContain('item.noteJa')
  })

  it('出典は「出典（N）」の 1 行に畳む（消さない）', () => {
    expect(PROFILE).toMatch(/<SourceList sources=\{panel\.sources\} folded \/>/)
  })
})

describe('エリアの要約（エリアの図・会話の中の要約）', () => {
  it('見ていないこと・全体の注記・区域の値の補足（推計の山・当たり具合）を描かない', () => {
    expect(AREA).not.toContain('notIncludedJa')
    expect(AREA).not.toContain('panel.notesJa')
    expect(AREA).not.toContain('.peak')
    expect(AREA).not.toContain('.accuracy')
    expect(AREA).not.toContain('見ていないこと')
  })

  it('出せない値の理由と、比べるときの注記（図の読み方）は描く', () => {
    expect(AREA).toContain('card.unavailableJa')
    expect(AREA).toContain('panel.comparison?.notesJa')
  })

  it('駅の周りの分布はいつも畳む（比べるときだけではない）', () => {
    expect(AREA).not.toContain('collapsed')
    expect(AREA).toMatch(/<details[^>]*>\s*<summary[^>]*>\s*\{stationsHeading\(stations\)\}/)
  })

  it('凡例は、地図の凡例が列に場所を取られて出ていないときだけ（色だけを残さない）', () => {
    expect(AREA).toContain('useContext(MapLegendHiddenContext)')
    expect(AREA).toContain('if (!mapLegendHidden) return null')
  })

  it('出典は「出典（N）」の 1 行に畳む（消さない）', () => {
    expect(AREA).toMatch(/<SourceList sources=\{panel\.sources\} folded \/>/)
  })
})

describe('災害の出典は畳まない（1〜2 行と短く、年度と出典を常に見せる・260824 §7.5）', () => {
  it.each([
    'src/components/panels/HazardCard.tsx',
    'src/components/panels/EvacuationList.tsx',
    'src/components/panels/EscapeDirection.tsx',
  ])('%s', (path) => {
    const source = rendered(path)
    expect(source).toContain('<SourceList')
    expect(source).not.toContain('folded')
  })
})

/**
 * 人口タブ（2026-11-25・人口の年齢 PR-3・計画書 261122 §6.1）。年齢の図を足しても、文字を増やさない：
 * 値と結論はチップ 3 つ、注意はその駅に固有のときだけ。どこでも同じ一般論（乗降の予測ではない・推計は前提の 1 つ・
 * 年齢不詳の補い方）は AI の文と出典に置き、画面には出さない。人口増減率の表（9 行）は畳む（D-5）。
 */
describe('人口タブ（年齢別の人口）', () => {
  const kosugi = buildStationDetail(
    KOSUGI_STATION,
    new Map(Object.entries(KOSUGI_VALUES_1KM)),
    ageRowsOf(1000, KOSUGI_1KM),
  )
  const panels = populationPanels(kosugi, 1000)

  it('どこでも同じ一般論をパネルに入れない（AI の読み方・不詳の補い方・推計の前提）', () => {
    const text = JSON.stringify(panels)
    expect(text).not.toContain(AGE_STRUCTURE_READING_JA)
    expect(text).not.toContain('乗降客数の予測')
    expect(text).not.toContain('不詳補完値')
    expect(text).not.toContain('前提')
  })

  it('年齢の図はチップ 3 つ・注意はその駅に固有のときだけ（武蔵小杉は 0）', () => {
    const age = panels.find(
      (panel) => panel.type === 'trendChart' && panel.title.startsWith('年齢別'),
    )
    expect(age?.type === 'trendChart' ? age.stats?.length : 0).toBe(3)
    expect(age?.type === 'trendChart' ? age.flags : null).toEqual([])
  })

  it('人口増減率の表は畳む（行は残す）', () => {
    const table = panels.find((panel) => panel.type === 'statTable')
    expect(table?.type === 'statTable' ? table.folded : undefined).toBe(true)
  })

  it('畳んだ表は「題（行の数）」の 1 行だけを見せる', () => {
    expect(TABLE).toMatch(
      /<details>\s*<summary[^>]*>\s*\{panel\.title\}（\{panel\.rows\.length\}）\s*<\/summary>/,
    )
  })

  it('推計の説明は図の中の「推計」の 2 文字と破線だけ（図の外に文を足さない）', () => {
    expect(TREND).toContain("fillText('推計'")
    expect(TREND).not.toContain('年からは推計')
  })
})
