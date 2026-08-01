import { describe, expect, it } from 'vitest'
import { type Route } from '@/shared/api'
import {
  intersectAllowed,
  narrowedByLabel,
  operatorsOfRouteFilter,
  routesOfOperators,
} from '@/components/metrics/routeLink'

/** 実データの縮図：重複路線名（本線＝10 社）・新幹線（種別 1）・単独会社の路線。 */
const ROUTES: readonly Route[] = [
  {
    route: '東海道線',
    stationCount: 235,
    operators: ['東海旅客鉄道', '東日本旅客鉄道'],
    routeTypes: [2],
  },
  { route: '東海道新幹線', stationCount: 17, operators: ['東海旅客鉄道'], routeTypes: [1] },
  { route: '東北新幹線', stationCount: 23, operators: ['東日本旅客鉄道'], routeTypes: [1] },
  {
    route: '本線',
    stationCount: 303,
    operators: ['京成電鉄', '広島電鉄', '函館市'],
    routeTypes: [3, 4],
  },
  { route: '銀座線', stationCount: 19, operators: ['東京地下鉄'], routeTypes: [4] },
]

describe('routesOfOperators（会社 → 路線候補）', () => {
  it('選択中の会社が運営する路線だけを返す', () => {
    expect(routesOfOperators(['東海旅客鉄道'], ROUTES)).toEqual(['東海道線', '東海道新幹線'])
  })

  it('複数社は OR（和集合・元の並び＝駅数降順を保つ）', () => {
    expect(routesOfOperators(['東京地下鉄', '東日本旅客鉄道'], ROUTES)).toEqual([
      '東海道線',
      '東北新幹線',
      '銀座線',
    ])
  })

  it('重複路線名は、その名前を持つ会社のいずれかを選べば候補に出る', () => {
    expect(routesOfOperators(['函館市'], ROUTES)).toEqual(['本線'])
  })

  it('未選択なら全件（絞らない）', () => {
    expect(routesOfOperators([], ROUTES)).toHaveLength(ROUTES.length)
  })
})

describe('operatorsOfRouteFilter（路線・種別 → 会社候補）', () => {
  it('種別だけでも会社を絞れる（新幹線＝種別 1）', () => {
    expect(operatorsOfRouteFilter([], [1], ROUTES)).toEqual(['東海旅客鉄道', '東日本旅客鉄道'])
  })

  it('路線名から会社を引く（重複路線名は全社が候補）', () => {
    expect(operatorsOfRouteFilter(['本線'], [], ROUTES)).toEqual(['京成電鉄', '広島電鉄', '函館市'])
  })

  it('路線と種別は OR＝両方の会社集合の和（重複は 1 度だけ）', () => {
    expect(operatorsOfRouteFilter(['銀座線'], [1], ROUTES)).toEqual([
      '東海旅客鉄道',
      '東日本旅客鉄道',
      '東京地下鉄',
    ])
  })

  it('未選択・未知の指定では絞られない／空になる', () => {
    expect(operatorsOfRouteFilter([], [], ROUTES)).toEqual([])
    expect(operatorsOfRouteFilter(['存在しない線'], [], ROUTES)).toEqual([])
  })
})

/**
 * 候補が減った理由の説明文。都道府県で絞っていないのに「都道府県で絞っています」と
 * 出すと誤解を招くため、実際に効いている条件だけを並べる。
 */
describe('narrowedByLabel（会社候補を絞っている条件）', () => {
  it('効いている条件だけを並べる', () => {
    expect(narrowedByLabel(['静岡県'], [], [])).toBe('都道府県')
    expect(narrowedByLabel([], [], [1])).toBe('路線')
    expect(narrowedByLabel([], ['東海道線'], [])).toBe('路線')
    expect(narrowedByLabel(['静岡県'], [], [1])).toBe('都道府県・路線')
    expect(narrowedByLabel([], [], [])).toBe('')
  })
})

describe('intersectAllowed（候補集合の重ね合わせ）', () => {
  it('undefined は「絞っていない」＝もう一方をそのまま返す', () => {
    expect(intersectAllowed(undefined, ['a', 'b'])).toEqual(['a', 'b'])
    expect(intersectAllowed(['a'], undefined)).toEqual(['a'])
    expect(intersectAllowed(undefined, undefined)).toBeUndefined()
  })

  it('両方あれば積（左の並びを保つ）・交わらなければ空', () => {
    expect(intersectAllowed(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c'])
    expect(intersectAllowed(['a'], ['b'])).toEqual([])
  })
})
