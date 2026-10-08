/**
 * src/components/chat/detailFocus：回答の ⤢ の条件から、駅詳細を**どのタブで開くか**を決める（純関数）。
 *
 * 「東京駅の人口推移を教えて」と聞くと、地図の操作（`selectStation`）がドロワーを自動で開く。
 * その操作は焦点を持たないので、以前は乗降客数タブで開き、人口のグラフはチップを押すまで出なかった
 * （2026-10-01 本番で再現・`docs/261001_fix_user_feedback_ui.md` §4）。焦点はサーバが data-promotions に
 * 載せているので、それを読む。
 */

import { describe, expect, it } from 'vitest'
import { CATEGORIES, DETAIL_TABS, type Category } from '@/shared/constants'
import { type PanelPromotion } from '@/shared/promotion'
import { detailFocusKey, detailFocusOf, focusToApply } from '@/components/chat/detailFocus'

function detail(grp: string, category: Category | null): PanelPromotion {
  return { kind: 'detail', grp, category }
}

const ranking: PanelPromotion = {
  kind: 'ranking',
  metricKey: 'pop_gr_2020_2015_1km',
  order: 'desc',
  prefectures: ['千葉県'],
  operators: [],
  routes: [],
  routeTypes: [],
  lines: [],
  municipality: '',
  bbox: null,
  near: null,
  excludeLowN: false,
}

const scatter: PanelPromotion = {
  kind: 'scatter',
  xKey: 'pop_gr_2020_2015_1km',
  yKey: 'rate_covid',
  prefectures: [],
  operators: [],
  routes: [],
  routeTypes: [],
  lines: [],
  municipality: '',
  bbox: null,
  near: null,
  excludeLowN: false,
}

describe('detailFocusOf（最後の駅詳細の焦点）', () => {
  it('図が無い・図だけの回答には焦点が無い', () => {
    expect(detailFocusOf([])).toBeNull()
    expect(detailFocusOf([ranking, scatter])).toBeNull()
  })

  it('焦点つきの駅詳細は、その駅とタブ', () => {
    expect(detailFocusOf([detail('東京#0', 'population'), null])).toEqual({
      grp: '東京#0',
      tab: 'population',
    })
  })

  it('焦点の無い駅詳細（駅の概要）は null＝タブを触らない', () => {
    expect(detailFocusOf([detail('品川#0', null), null])).toBeNull()
  })

  it('パネルと同じ並び（本文のグラフの null・図を挟む）でも読める', () => {
    const promotions = [detail('東京#0', 'land_price'), null, null, ranking]
    expect(detailFocusOf(promotions)).toEqual({ grp: '東京#0', tab: 'land_price' })
  })

  it('駅が 2 つなら、地図が最後に選ぶ駅（最後の駅詳細）に合わせる', () => {
    const promotions = [detail('東京#0', 'population'), null, detail('新宿#0', 'bus'), null]
    expect(detailFocusOf(promotions)).toEqual({ grp: '新宿#0', tab: 'bus' })
  })

  it('最後の駅詳細に焦点が無ければ、前の駅の焦点を持ち越さない', () => {
    expect(detailFocusOf([detail('東京#0', 'population'), detail('新宿#0', null)])).toBeNull()
  })

  it('将来推計人口は人口タブで開く（「データがありません」にしない）', () => {
    expect(detailFocusOf([detail('東京#0', 'population_forecast')])).toEqual({
      grp: '東京#0',
      tab: 'population',
    })
  })

  it('どのカテゴリでも、開くのは実在するタブ', () => {
    for (const category of CATEGORIES) {
      const focus = detailFocusOf([detail('東京#0', category)])
      expect(DETAIL_TABS.some((tab) => tab === focus?.tab)).toBe(true)
    }
  })
})

describe('detailFocusKey（同じ焦点かを見分ける鍵）', () => {
  it('駅とタブが同じなら同じ鍵、どちらかが違えば違う鍵', () => {
    const key = detailFocusKey({ grp: '東京#0', tab: 'population' })
    expect(detailFocusKey({ grp: '東京#0', tab: 'population' })).toBe(key)
    expect(detailFocusKey({ grp: '新宿#0', tab: 'population' })).not.toBe(key)
    expect(detailFocusKey({ grp: '東京#0', tab: 'income' })).not.toBe(key)
  })

  it('文字をつなげただけでは区別できない組み合わせも区別する', () => {
    expect(detailFocusKey({ grp: 'a', tab: 'bus' })).not.toBe(
      detailFocusKey({ grp: 'ab', tab: 'bus' }),
    )
  })
})

describe('focusToApply（1 回の回答で、同じ焦点は 1 度だけ当てる）', () => {
  const firstTool = [detail('東京#0', 'population'), null]
  const secondTool = [detail('東京#0', 'population'), null, ranking]

  it('最初に届いた焦点は当てる', () => {
    expect(focusToApply(firstTool, null)?.focus).toEqual({ grp: '東京#0', tab: 'population' })
  })

  it('ツールが成功するたびに条件が送り直されても、同じ焦点は当て直さない（途中で替えたタブを戻さない）', () => {
    const applied = focusToApply(firstTool, null)
    expect(applied).not.toBeNull()
    expect(focusToApply(secondTool, applied?.key ?? null)).toBeNull()
  })

  it('回答の途中で別の駅に移れば、その焦点を当てる', () => {
    const applied = focusToApply(firstTool, null)
    const moved = [...secondTool, detail('新宿#0', 'land_price'), null]
    expect(focusToApply(moved, applied?.key ?? null)?.focus).toEqual({
      grp: '新宿#0',
      tab: 'land_price',
    })
  })

  it('形の合わない中身は当てない（推し量った条件で開くより安全）', () => {
    for (const data of [undefined, null, 'x', [{ kind: 'detail', grp: 1 }], { kind: 'detail' }]) {
      expect(focusToApply(data, null)).toBeNull()
    }
  })

  it('焦点が無ければ当てない（覚えたタブのまま）', () => {
    expect(focusToApply([detail('品川#0', null), null], null)).toBeNull()
    expect(focusToApply([ranking], null)).toBeNull()
  })
})
