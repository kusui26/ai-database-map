import { describe, expect, it } from 'vitest'
import { type MapView, wardOfView } from '@/ai/area/map-view'
import { asksAboutWard, hidesMapViewOption } from '@/ai/area/ward-question'
import { mapViewPrompt } from '@/ai/system-prompt'

/**
 * 「この区」の問いか（2026-11-12・`docs/261110_fix_PLAN.md` §3.4.1）。
 *
 * 真の回は、モデルに見せる道具の型から `inMapView`（地図の範囲）を外す。言葉（プロンプト・道具の説明）では、
 * 関係の無い段落を書き換えるだけで「この区」を地図の範囲で絞る回が出たので、選択肢ごと外す。
 * 固定するのは、①どの言い方を「この区」と読むか（「この区間」「このあたり」は読まない）と、
 * ②**地図の節が「この区」の規則を出す条件と同じ**ときだけ外すこと（ずれると、規則の無い回に外したり、その逆になる）。
 */

/** 地図の中心に近い駅（評価の `map-context-ward` と同じ大倉山）。 */
const OKURAYAMA = {
  name: '大倉山',
  prefecture: '神奈川県',
  municipality: '横浜市港北区',
  distanceM: 420,
}

/** 横浜市港北区の大倉山の周り（約 9km 四方・評価の `map-context-ward` と同じ見え方）。 */
const WARD_VIEW: MapView = {
  widthKm: 9.1,
  heightKm: 8.4,
  tooWide: false,
  center: OKURAYAMA,
  centerSearched: true,
  wardScale: true,
}

const WARD_QUESTION = 'この区で人口が増えている駅は？'

describe('asksAboutWard：「この区」と読む言い方', () => {
  it.each([
    'この区で人口が増えている駅は？',
    'この市の駅を地価で並べて',
    'この町内で乗降客数が多い駅は？',
    'この区って人口増えてる？',
    'この区は？',
    'この区',
    'この市全体で地価が上がっている駅',
    'この区より北の駅',
    'この村の駅',
    'この区、人口はどう？',
  ])('「%s」は「この区」の問い', (question) => {
    expect(asksAboutWard(question)).toBe(true)
  })

  it.each([
    ['この区間の駅を一覧にして', '「区間」は市区町村ではない'],
    ['この市場の近くの駅は？', '「市場」は市ではない'],
    ['この町並みが残る駅', '「町並み」は町ではない'],
    ['このあたりで地価が上がっている駅は？', '地図の範囲の問い'],
    ['この辺の駅を人口で並べて', '地図の範囲の問い'],
    ['この区の、地図に出ている範囲で人口が増えている駅は？', '地図の範囲を名指ししている'],
    ['この区の表示中の駅を並べて', '地図の範囲を名指ししている'],
    ['この駅の人口は？', '1 つの駅の話'],
    ['横浜市港北区で人口が増えている駅は？', '名前で言っている（指す言い方ではない）'],
  ])('「%s」は「この区」の問いではない（%s）', (question) => {
    expect(asksAboutWard(question)).toBe(false)
  })
})

describe('hidesMapViewOption：地図が区を決められて、質問が「この区」を指す回だけ', () => {
  it('寄っていて中心の駅の市区町村が分かり、「この区」の問いなら外す', () => {
    expect(hidesMapViewOption(WARD_QUESTION, WARD_VIEW)).toBe(true)
  })

  it('「このあたり」の問いには効かない（そちらは inMapView が正しい）', () => {
    expect(hidesMapViewOption('このあたりで人口が増えている駅は？', WARD_VIEW)).toBe(false)
  })

  it.each([
    ['範囲が届いていない', null],
    ['区が主役になるほど寄っていない', { ...WARD_VIEW, wardScale: false }],
    ['中心の近くに駅が無い', { ...WARD_VIEW, center: null }],
    [
      '中心の駅の市区町村が分からない',
      { ...WARD_VIEW, center: { ...OKURAYAMA, municipality: null } },
    ],
  ])('%s回は外さない', (_label, view) => {
    expect(hidesMapViewOption(WARD_QUESTION, view)).toBe(false)
  })
})

describe('地図の節の「この区」の規則と、同じ条件で外す（ずれない）', () => {
  /** 地図の節の「この区」の規則の書き出し（`system-prompt.ts` の `mapWardRule`）。 */
  const WARD_RULE = '「この区」「この市」「この町」は**地図の範囲ではない**'

  it.each([
    ['区を決められる', WARD_VIEW],
    ['寄っていない', { ...WARD_VIEW, wardScale: false }],
    ['中心の駅が無い', { ...WARD_VIEW, center: null }],
    [
      '広すぎる',
      { ...WARD_VIEW, tooWide: true, center: null, centerSearched: false, wardScale: false },
    ],
  ])('%s：規則を出す ⇔ 道具から外す', (_label, view) => {
    const ruleShown = mapViewPrompt(view).includes(WARD_RULE)
    expect(hidesMapViewOption(WARD_QUESTION, view)).toBe(ruleShown)
    expect(wardOfView(view) !== null).toBe(ruleShown)
  })

  it('規則が指す市区町村は、判定と同じもの', () => {
    const ward = wardOfView(WARD_VIEW)
    expect(ward).toEqual({ municipality: '横浜市港北区', prefecture: '神奈川県' })
    expect(mapViewPrompt(WARD_VIEW)).toContain(
      'municipality:"横浜市港北区"・prefectures:["神奈川県"]',
    )
  })
})
