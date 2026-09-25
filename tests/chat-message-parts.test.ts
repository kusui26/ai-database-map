/**
 * 吹き出しに出す本文（`src/components/chat/messageParts.ts` の `displayTextOf`）。
 *
 * サーバは本文が空で終わったターンに、状況を言う一文を data-map の `messages` に載せている
 * （fail-soft F2・`assemble.ts` の `textOrFallback`）。ところが画面は text パートしか描いておらず、
 * **打ち切りのターンは本文もエラーも出ない無言**になっていた（2026-09-25 に判明）。
 */

import { describe, expect, it } from 'vitest'
import { displayTextOf } from '@/components/chat/messageParts'
import { type ChatUIMessage } from '@/components/chat/types'

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
