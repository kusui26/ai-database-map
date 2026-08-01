/**
 * 都道府県 ⇄ 運営会社の連動（純関数）。
 *
 * 要は「自動で入った県」と「手で入れた県」を取り違えないこと。
 * docs/260730_scatter_plot_prefecture_to_operaters.md §3 の 4 規則を固定する。
 */

import { describe, expect, it } from 'vitest'
import { type Operator } from '@/shared/api'
import {
  applyManualPrefectures,
  EMPTY_LINK,
  type LinkState,
  operatorsInPrefectures,
  prefectureIndex,
  prefecturesOfOperators,
  pruneAutoPrefectures,
  selectOperatorPrefectures,
} from '@/components/metrics/operatorLink'

const OPERATORS: Operator[] = [
  {
    name: '東海旅客鉄道',
    stationCount: 412,
    prefectures: ['静岡県', '愛知県', '岐阜県', '東京都'],
  },
  { name: '東京地下鉄', stationCount: 144, prefectures: ['東京都', '千葉県', '埼玉県'] },
  { name: '静岡鉄道', stationCount: 15, prefectures: ['静岡県'] },
  { name: '札幌市', stationCount: 46, prefectures: ['北海道'] },
]
const index = prefectureIndex(OPERATORS)

describe('prefectureIndex / prefecturesOfOperators', () => {
  it('会社 → 都道府県を引ける（複数社は和集合・昇順・重複なし）', () => {
    expect(prefecturesOfOperators(['東海旅客鉄道'], index)).toEqual([
      '岐阜県',
      '愛知県',
      '東京都',
      '静岡県',
    ])
    expect(prefecturesOfOperators(['東海旅客鉄道', '東京地下鉄'], index)).toEqual([
      '千葉県',
      '埼玉県',
      '岐阜県',
      '愛知県',
      '東京都',
      '静岡県',
    ])
  })

  it('未知の会社・空選択は空', () => {
    expect(prefecturesOfOperators([], index)).toEqual([])
    expect(prefecturesOfOperators(['未知鉄道'], index)).toEqual([])
  })
})

describe('operatorsInPrefectures', () => {
  it('県 → その県を走る会社（元の並び順を保つ）', () => {
    expect(operatorsInPrefectures(['静岡県'], OPERATORS)).toEqual(['東海旅客鉄道', '静岡鉄道'])
    expect(operatorsInPrefectures(['北海道'], OPERATORS)).toEqual(['札幌市'])
  })

  it('複数県は OR、未選択は全社', () => {
    expect(operatorsInPrefectures(['千葉県', '北海道'], OPERATORS)).toEqual([
      '東京地下鉄',
      '札幌市',
    ])
    expect(operatorsInPrefectures([], OPERATORS)).toHaveLength(OPERATORS.length)
  })
})

describe('selectOperatorPrefectures（規則 1：会社の県をまとめて選ぶ）', () => {
  it('会社の県を追加し、追加分を auto に記録する', () => {
    const next = selectOperatorPrefectures(EMPTY_LINK, ['東京地下鉄'], index)
    expect(next.prefectures).toEqual(['千葉県', '埼玉県', '東京都'])
    expect(next.auto).toEqual(['千葉県', '埼玉県', '東京都'])
  })

  it('すでに手動で入っていた県は auto にしない（手動所有を維持）', () => {
    const manual: LinkState = { prefectures: ['東京都'], auto: [] }
    const next = selectOperatorPrefectures(manual, ['東京地下鉄'], index)
    expect(next.prefectures).toEqual(['東京都', '千葉県', '埼玉県'])
    expect(next.auto).toEqual(['千葉県', '埼玉県']) // 東京都は手動のまま
  })

  it('会社未選択や既に全部入っている場合は変化なし（同一参照）', () => {
    expect(selectOperatorPrefectures(EMPTY_LINK, [], index)).toBe(EMPTY_LINK)
    const full: LinkState = { prefectures: ['静岡県'], auto: ['静岡県'] }
    expect(selectOperatorPrefectures(full, ['静岡鉄道'], index)).toBe(full)
  })
})

describe('pruneAutoPrefectures（規則 2：会社を外したら自動分だけ消す）', () => {
  it('会社を外すと、その会社由来の自動分だけが消える', () => {
    const state = selectOperatorPrefectures(EMPTY_LINK, ['東京地下鉄'], index)
    const pruned = pruneAutoPrefectures(state, [], index)
    expect(pruned.prefectures).toEqual([])
    expect(pruned.auto).toEqual([])
  })

  it('手動で入れた県は会社を外しても残る', () => {
    const manual: LinkState = { prefectures: ['北海道'], auto: [] }
    const withAuto = selectOperatorPrefectures(manual, ['東京地下鉄'], index)
    const pruned = pruneAutoPrefectures(withAuto, [], index)
    expect(pruned.prefectures).toEqual(['北海道'])
    expect(pruned.auto).toEqual([])
  })

  it('会社を差し替えたときは、残った会社が走る県だけ自動分として残る', () => {
    const state = selectOperatorPrefectures(EMPTY_LINK, ['東海旅客鉄道', '東京地下鉄'], index)
    const pruned = pruneAutoPrefectures(state, ['東京地下鉄'], index)
    expect(pruned.prefectures).toEqual(['千葉県', '埼玉県', '東京都']) // 静岡・愛知・岐阜は落ちる
    expect(pruned.auto).toEqual(['千葉県', '埼玉県', '東京都'])
  })

  it('自動分が無ければ何もしない（同一参照）', () => {
    const manual: LinkState = { prefectures: ['東京都'], auto: [] }
    expect(pruneAutoPrefectures(manual, [], index)).toBe(manual)
  })
})

describe('applyManualPrefectures（規則 3・4：手で触れた県は手動所有に）', () => {
  it('自動で入った県を手で外すと、以後の会社操作の影響を受けない', () => {
    const auto = selectOperatorPrefectures(EMPTY_LINK, ['東京地下鉄'], index)
    const afterToggle = applyManualPrefectures(auto, ['千葉県', '埼玉県']) // 東京都を外した
    expect(afterToggle.prefectures).toEqual(['千葉県', '埼玉県'])
    expect(afterToggle.auto).toEqual(['千葉県', '埼玉県'])
  })

  it('自動で入った県を手で「入れ直す」と手動所有になり、会社を外しても残る', () => {
    const auto = selectOperatorPrefectures(EMPTY_LINK, ['東京地下鉄'], index)
    const removed = applyManualPrefectures(auto, ['千葉県', '埼玉県']) // 東京都を外す
    const readded = applyManualPrefectures(removed, ['千葉県', '埼玉県', '東京都']) // 手で戻す
    expect(readded.auto).toEqual(['千葉県', '埼玉県']) // 東京都は手動所有
    const pruned = pruneAutoPrefectures(readded, [], index)
    expect(pruned.prefectures).toEqual(['東京都'])
  })

  it('全解除（空配列）で auto も空になる', () => {
    const auto = selectOperatorPrefectures(EMPTY_LINK, ['東海旅客鉄道'], index)
    const cleared = applyManualPrefectures(auto, [])
    expect(cleared).toEqual({ prefectures: [], auto: [] })
  })

  it('auto は常に prefectures の部分集合である（不変条件）', () => {
    const states: LinkState[] = [
      selectOperatorPrefectures(EMPTY_LINK, ['東海旅客鉄道'], index),
      applyManualPrefectures(selectOperatorPrefectures(EMPTY_LINK, ['東海旅客鉄道'], index), [
        '静岡県',
        '北海道',
      ]),
      pruneAutoPrefectures(
        selectOperatorPrefectures(EMPTY_LINK, ['東海旅客鉄道', '札幌市'], index),
        ['札幌市'],
        index,
      ),
    ]
    for (const state of states) {
      for (const prefecture of state.auto) {
        expect(state.prefectures).toContain(prefecture)
      }
    }
  })
})
