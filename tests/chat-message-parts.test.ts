/**
 * 吹き出しに出す本文（`src/components/chat/messageParts.ts` の `displayTextOf`）。
 *
 * サーバは本文が空で終わったターンに、状況を言う一文を data-map の `messages` に載せている
 * （fail-soft F2・`assemble.ts` の `textOrFallback`）。ところが画面は text パートしか描いておらず、
 * **打ち切りのターンは本文もエラーも出ない無言**になっていた（2026-09-25 に判明）。
 */

import { describe, expect, it } from 'vitest'
import { displayTextOf, panelPromotionsOf } from '@/components/chat/messageParts'
import { type ChatUIMessage } from '@/components/chat/types'
import { type RankingPromotion } from '@/shared/promotion'

type Part = ChatUIMessage['parts'][number]

function dataMap(text: string | null): Part {
  return {
    type: 'data-map',
    id: 'map',
    data: {
      messages: text === null ? [] : [{ role: 'assistant', text }],
      mapActions: [],
      panels: [],
    },
  }
}

const textPart = (text: string): Part => ({ type: 'text', text })

describe('吹き出しの本文', () => {
  it('モデルの本文があれば、それを出す（サーバの一文より優先）', () => {
    expect(displayTextOf([textPart('横浜駅は…'), dataMap('横浜駅は…')])).toBe('横浜駅は…')
  })

  it('本文が無ければ、サーバが用意した一文を出す（打ち切り・本文なしの終了）', () => {
    const fallback = '時間内に取得できませんでした。もう一度お試しください。'
    expect(displayTextOf([dataMap(fallback)])).toBe(fallback)
  })

  it('途中経過の data-map（一文がまだ無い）は、最後のものを見る', () => {
    const fallback = '地図とグラフを表示しました。'
    expect(displayTextOf([dataMap(null), dataMap(fallback)])).toBe(fallback)
  })

  it('どちらも無ければ空（吹き出しを出さない）', () => {
    expect(displayTextOf([])).toBe('')
    expect(displayTextOf([dataMap(null)])).toBe('')
  })
})

/**
 * ⤢ の条件（data-promotions）。サーバが図を生んだ副産物から作り、パネルと同じ並びで送る。
 * 画面は形を確かめてから使う——合わなければ使わない（推し量った条件で開くより安全）。
 */
describe('⤢ の条件（data-promotions）', () => {
  const ranking: RankingPromotion = {
    kind: 'ranking',
    metricKey: 'pax_2024',
    order: 'desc',
    prefectures: ['千葉県'],
    operators: [],
    routes: [],
    routeTypes: [],
    excludeLowN: false,
  }

  it('最後の data-promotions を読む（途中経過は段階的に上書きされる）', () => {
    const parts = [
      { type: 'data-promotions', data: [null] },
      { type: 'data-promotions', data: [ranking] },
    ]
    expect(panelPromotionsOf(parts)).toEqual([ranking])
  })

  it('届いていなければ空（⤢ を出さない）', () => {
    expect(panelPromotionsOf([textPart('こんにちは'), dataMap(null)])).toEqual([])
  })

  it('形が合わなければ空（壊れた条件で開かない）', () => {
    const broken = [{ type: 'data-promotions', data: [{ kind: 'ranking', metricKey: 1 }] }]
    expect(panelPromotionsOf(broken)).toEqual([])
  })
})
