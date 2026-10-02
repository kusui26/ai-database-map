/**
 * src/components/map/selection：駅を選ぶときに、変わるものだけを URL に書く（2026-10-02）。
 *
 * nuqs は値が変わらなくても push し、同じ URL の履歴を積む。選んでいる駅をチップ・地図・検索で
 * もう一度選ぶと、ブラウザの「戻る」が 1 回空振りしていた（A3 のあとに実測：チップで履歴 +1・戻っても URL が同じ）。
 */

import { describe, expect, it } from 'vitest'
import { selectionWrite, type Selection } from '@/components/map/selection'

const TOKYO = '東京#0'
const SHINJUKU = '新宿#0'

function selected(grp: string | null, sheetClosed = false): Selection {
  return { grp, sheetClosed }
}

describe('selectionWrite（何を書くか）', () => {
  it('選んでいる駅をもう一度選んだだけなら、何も書かない（同じ URL の履歴を積まない）', () => {
    expect(selectionWrite(selected(TOKYO), TOKYO)).toEqual({ grp: false, clearSheet: false })
  })

  it('何も選んでいないときに閉じても、何も書かない（地図をリセットを 2 回押すなど）', () => {
    expect(selectionWrite(selected(null), null)).toEqual({ grp: false, clearSheet: false })
  })

  it('違う駅を選ぶ・閉じるときは駅を書く', () => {
    expect(selectionWrite(selected(TOKYO), SHINJUKU)).toEqual({ grp: true, clearSheet: false })
    expect(selectionWrite(selected(TOKYO), null)).toEqual({ grp: true, clearSheet: false })
    expect(selectionWrite(selected(null), TOKYO)).toEqual({ grp: true, clearSheet: false })
  })

  it('携帯でシートを閉じたままの駅をもう一度選ぶ（⤢・地図・駅名）と、印だけを消す＝シートが開く', () => {
    expect(selectionWrite(selected(TOKYO, true), TOKYO)).toEqual({ grp: false, clearSheet: true })
  })

  it('シートを閉じたまま、違う駅を選ぶ・閉じるときは、駅を書いて印も消す', () => {
    expect(selectionWrite(selected(TOKYO, true), SHINJUKU)).toEqual({ grp: true, clearSheet: true })
    expect(selectionWrite(selected(TOKYO, true), null)).toEqual({ grp: true, clearSheet: true })
  })
})
