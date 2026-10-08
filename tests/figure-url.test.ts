/**
 * src/components/figure/url：開いている図（ランキング・散布）を URL（`?fig` と条件）に載せる（2026-10-02）。
 *
 * 図を開いたら、ブラウザの「戻る」で閉じ、「進む」で同じ条件のまま開き直したい（フィードバック #4・
 * `docs/261001_fix_user_feedback_ui.md` §5.5）。以前は図の状態が Zustand と FAB の `useState` にしか
 * 無く、戻る・進む・リロード・共有リンクのどれでも開き直せなかった。
 *
 * ここでは nuqs の**実際の**シリアライザとローダで「図 → URL の文字列 → 図」と往復させて確かめる。
 */

import { createLoader, createSerializer } from 'nuqs'
import { describe, expect, it } from 'vitest'
import { type RankingPromotion, type ScatterPromotion } from '@/shared/promotion'
import {
  DEFAULT_RANKING_FIGURE,
  DEFAULT_SCATTER_FIGURE,
  FIGURE_PARSERS,
  figureFromUrl,
  figureKey,
  figureToUrl,
  type Figure,
} from '@/components/figure/url'

const serialize = createSerializer(FIGURE_PARSERS)
const load = createLoader(FIGURE_PARSERS)

/** 図 → URL の文字列 → 図。 */
function roundTrip(figure: Figure): Figure | null {
  return figureFromUrl(load(serialize(figureToUrl(figure))))
}

/** AI の ⤢ の条件（サーバが作る形）。図としてそのまま開ける。 */
const rankingPromotion: RankingPromotion = {
  kind: 'ranking',
  metricKey: 'pop_gr_2020_2015_1km',
  order: 'asc',
  prefectures: ['千葉県', '東京都'],
  operators: ['東日本旅客鉄道'],
  routes: ['総武線'],
  routeTypes: [2, 4],
  lines: [11302],
  excludeLowN: false,
}
const scatterPromotion: ScatterPromotion = {
  kind: 'scatter',
  xKey: 'pop_gr_2020_2015_2km',
  yKey: 'rate_covid',
  prefectures: [],
  operators: [],
  routes: [],
  routeTypes: [1],
  lines: [],
  excludeLowN: true,
}

describe('figureFromUrl（URL → 開いている図）', () => {
  it('?fig が無ければ、図は開いていない', () => {
    expect(figureFromUrl(load(''))).toBeNull()
    expect(figureFromUrl(load('?grp=%E6%9D%B1%E4%BA%AC%230&tab=income'))).toBeNull()
  })

  it('知らない種類は開いていないのと同じ', () => {
    expect(figureFromUrl(load('?fig=recommend'))).toBeNull()
  })

  it('?fig=ranking だけなら、FAB で開いた直後と同じ（既定の指標・上位から・⚠ を除外）', () => {
    expect(figureFromUrl(load('?fig=ranking'))).toEqual(DEFAULT_RANKING_FIGURE)
  })

  it('?fig=scatter だけなら、FAB で開いた直後の散布', () => {
    expect(figureFromUrl(load('?fig=scatter'))).toEqual(DEFAULT_SCATTER_FIGURE)
  })
})

describe('図 → URL → 図（往復）', () => {
  it('AI の条件のランキング（絞り込み・下位から・⚠ を含める）', () => {
    expect(roundTrip(rankingPromotion)).toEqual(rankingPromotion)
  })

  it('AI の条件の散布', () => {
    expect(roundTrip(scatterPromotion)).toEqual(scatterPromotion)
  })

  it('FAB の既定の図', () => {
    expect(roundTrip(DEFAULT_RANKING_FIGURE)).toEqual(DEFAULT_RANKING_FIGURE)
    expect(roundTrip(DEFAULT_SCATTER_FIGURE)).toEqual(DEFAULT_SCATTER_FIGURE)
  })

  it('路線（運行系統）の路線コードも往復する（チャットの図を ⤢ で開いたとき・2026-10-08 L3）', () => {
    const figure: Figure = { ...scatterPromotion, lines: [11302, 28010] }
    expect(roundTrip(figure)).toEqual(figure)
    expect(serialize(figureToUrl(figure))).toContain('figLines=11302,28010')
  })

  it('名前にカンマ（区切りと同じ文字）を含んでも崩れない', () => {
    const figure: Figure = { ...rankingPromotion, routes: ['本線,支線', '東横線'] }
    expect(roundTrip(figure)).toEqual(figure)
  })
})

describe('figureToUrl（既定は書かない・前の図の条件を残さない）', () => {
  it('既定の値は URL に出ない（FAB の図は ?fig だけ）', () => {
    expect(serialize(figureToUrl(DEFAULT_RANKING_FIGURE))).toBe('?fig=ranking')
    expect(serialize(figureToUrl(DEFAULT_SCATTER_FIGURE))).toBe('?fig=scatter')
  })

  it('ランキングを開くと、散布の x/y を消す', () => {
    const values = figureToUrl(rankingPromotion)
    expect(values.figX).toBeNull()
    expect(values.figY).toBeNull()
  })

  it('散布を開くと、ランキングの指標と順を消す（順は既定に戻す）', () => {
    const values = figureToUrl(scatterPromotion)
    expect(values.figM).toBeNull()
    expect(values.figO).toBe('desc')
  })

  it('読みやすい URL になる（同じ流儀の rec* と並ぶ）', () => {
    expect(serialize(figureToUrl(scatterPromotion))).toBe(
      '?fig=scatter&figX=pop_gr_2020_2015_2km&figY=rate_covid&figTypes=1',
    )
  })
})

describe('figureKey（同じ図かを見分ける）', () => {
  it('同じ条件なら同じ鍵', () => {
    expect(figureKey({ ...rankingPromotion })).toBe(figureKey(rankingPromotion))
  })

  it('条件が 1 つでも違えば違う鍵（並び順も条件のうち）', () => {
    const key = figureKey(rankingPromotion)
    expect(figureKey({ ...rankingPromotion, order: 'desc' })).not.toBe(key)
    expect(figureKey({ ...rankingPromotion, excludeLowN: true })).not.toBe(key)
    expect(figureKey({ ...rankingPromotion, prefectures: ['東京都', '千葉県'] })).not.toBe(key)
  })

  it('FAB の図と、同じ既定の指標を書き戻した図は別の鍵（作り直しの判定は入れ物が持つ）', () => {
    expect(figureKey(DEFAULT_RANKING_FIGURE)).not.toBe(
      figureKey({ ...DEFAULT_RANKING_FIGURE, metricKey: 'pop_gr_2020_2015_1km' }),
    )
  })
})
