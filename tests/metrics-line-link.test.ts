/**
 * 路線（運行系統）と都道府県・会社の連動（2026-10-08 L4・`src/components/metrics/lineLink.ts`・`filterLink.ts`）。
 *
 * 規則は都道府県⇄会社・会社⇄法令上の路線と同じ：**選べない組合せは最初から出さない**。
 * 見ること：
 * - 都道府県・会社 → 路線の候補（会社の無い神戸高速は、会社を選ぶと選べない）
 * - 路線 → 都道府県・会社の候補（一覧の読み込み前・会社の無い路線では絞らない＝全部選べなく見えるのを防ぐ）
 * - 2 つ以上の条件は重ねる（AND）・説明文の主語は効いている条件だけ
 */

import { describe, expect, it } from 'vitest'
import {
  linesInPrefectures,
  linesOfOperators,
  operatorsOfLines,
  prefecturesOfLines,
} from '@/components/metrics/lineLink'
import {
  allowedCandidates,
  type FilterLists,
  narrowingScopes,
  type StationFilterValues,
} from '@/components/metrics/filterLink'
import { prefectureIndex } from '@/components/metrics/operatorLink'
import { type Operator, type Route } from '@/shared/api'
import {
  ARAKAWA,
  FUKUTOSHIN,
  GINZA,
  HOKURIKU,
  KOBE_KOSOKU,
  OSAKA_CHUO,
  PICKER_LINES,
  SEIBU_SHINJUKU,
  TOEI_SHINJUKU,
  YAMANOTE,
} from './fixtures/picker-lines'

const codes = (lines: readonly { lineCd: number }[]): number[] => lines.map((line) => line.lineCd)

describe('都道府県・会社 → 路線の候補', () => {
  it('選んだ都道府県のどれかに駅のある路線', () => {
    expect(linesInPrefectures(['埼玉県'], PICKER_LINES)).toEqual(
      codes([HOKURIKU, SEIBU_SHINJUKU, FUKUTOSHIN]),
    )
    expect(linesInPrefectures(['大阪府', '兵庫県'], PICKER_LINES)).toEqual(
      codes([OSAKA_CHUO, KOBE_KOSOKU]),
    )
  })

  it('都道府県を選んでいなければ絞らない（undefined）', () => {
    expect(linesInPrefectures([], PICKER_LINES)).toBeUndefined()
  })

  it('選んだ会社（S12 の会社名）の路線', () => {
    expect(linesOfOperators(['東京地下鉄'], PICKER_LINES)).toEqual(codes([GINZA, FUKUTOSHIN]))
    expect(linesOfOperators(['東京都', '西武鉄道'], PICKER_LINES)).toEqual(
      codes([SEIBU_SHINJUKU, TOEI_SHINJUKU, ARAKAWA]),
    )
  })

  it('会社の無い路線（神戸高速＝線路の持ち主）は、会社を選ぶと選べない', () => {
    expect(linesOfOperators(['阪神電気鉄道'], PICKER_LINES)).toEqual([])
  })

  it('会社を選んでいなければ絞らない（undefined）', () => {
    expect(linesOfOperators([], PICKER_LINES)).toBeUndefined()
  })
})

describe('路線 → 都道府県・会社の候補', () => {
  it('選んだ路線の駅のある都道府県（重ねない）', () => {
    expect(prefecturesOfLines([YAMANOTE.lineCd, FUKUTOSHIN.lineCd], PICKER_LINES)).toEqual([
      '東京都',
      '埼玉県',
    ])
  })

  it('選んだ路線の会社（重ねない）', () => {
    expect(operatorsOfLines([GINZA.lineCd, FUKUTOSHIN.lineCd], PICKER_LINES)).toEqual([
      '東京地下鉄',
    ])
    expect(operatorsOfLines([YAMANOTE.lineCd, TOEI_SHINJUKU.lineCd], PICKER_LINES)).toEqual([
      '東日本旅客鉄道',
      '東京都',
    ])
  })

  it('路線を選んでいなければ絞らない（undefined）', () => {
    expect(prefecturesOfLines([], PICKER_LINES)).toBeUndefined()
    expect(operatorsOfLines([], PICKER_LINES)).toBeUndefined()
  })

  it('一覧の読み込み前は絞らない（全都道府県・全社が選べなく見えるのを防ぐ）', () => {
    expect(prefecturesOfLines([YAMANOTE.lineCd], [])).toBeUndefined()
    expect(operatorsOfLines([YAMANOTE.lineCd], [])).toBeUndefined()
  })

  it('会社の無い路線を選んでいるときは、会社を絞らない（どの会社の駅を通るか一覧では分からない）', () => {
    expect(operatorsOfLines([KOBE_KOSOKU.lineCd], PICKER_LINES)).toBeUndefined()
    expect(operatorsOfLines([KOBE_KOSOKU.lineCd, YAMANOTE.lineCd], PICKER_LINES)).toBeUndefined()
    // 都道府県は分かるので絞る。
    expect(prefecturesOfLines([KOBE_KOSOKU.lineCd], PICKER_LINES)).toEqual(['兵庫県'])
  })
})

/** 会社の一覧（`/api/operators` の縮図）。 */
const OPERATORS: readonly Operator[] = [
  {
    name: '東日本旅客鉄道',
    label: 'JR東日本',
    stationCount: 1600,
    prefectures: ['東京都', '埼玉県', '新潟県'],
  },
  {
    name: '東京地下鉄',
    label: '東京メトロ',
    stationCount: 180,
    prefectures: ['東京都', '埼玉県', '千葉県'],
  },
  { name: '東京都', label: '東京都交通局', stationCount: 140, prefectures: ['東京都', '千葉県'] },
  { name: '西武鉄道', label: '西武鉄道', stationCount: 92, prefectures: ['東京都', '埼玉県'] },
  { name: '大阪市高速電気軌道', label: 'Osaka Metro', stationCount: 133, prefectures: ['大阪府'] },
]
const ROUTES: readonly Route[] = [
  { route: '山手線', stationCount: 17, operators: ['東日本旅客鉄道'], routeTypes: [2] },
  { route: '4号線丸ノ内線', stationCount: 25, operators: ['東京地下鉄'], routeTypes: [4] },
]
const LISTS: FilterLists = {
  operators: OPERATORS,
  routes: ROUTES,
  lines: PICKER_LINES,
  prefecturesByOperator: prefectureIndex(OPERATORS),
}
const NONE: StationFilterValues = {
  prefectures: [],
  operators: [],
  routes: [],
  routeTypes: [],
  lines: [],
}

describe('allowedCandidates：連動をまとめて決める', () => {
  it('何も選んでいなければ、どの候補も絞らない', () => {
    expect(allowedCandidates(NONE, LISTS)).toEqual({
      prefectures: undefined,
      operators: undefined,
      routes: undefined,
      lines: undefined,
    })
  })

  it('路線を選ぶと、都道府県は駅のある県・会社は路線の会社に絞られる', () => {
    const allowed = allowedCandidates({ ...NONE, lines: [FUKUTOSHIN.lineCd] }, LISTS)
    expect(allowed.prefectures).toEqual(['東京都', '埼玉県'])
    expect(allowed.operators).toEqual(['東京地下鉄'])
    // 路線そのものの候補は、路線では絞らない（ほかの路線を足せる）。
    expect(allowed.lines).toBeUndefined()
  })

  it('都道府県と会社の両方で路線を絞ると重なる（東京都 × 東京地下鉄）', () => {
    const allowed = allowedCandidates(
      { ...NONE, prefectures: ['東京都'], operators: ['東京地下鉄'] },
      LISTS,
    )
    expect(allowed.lines).toEqual(codes([GINZA, FUKUTOSHIN]))
  })

  it('会社の都道府県と路線の都道府県は重なる（JR東日本 × 副都心線 → 東京都・埼玉県）', () => {
    const allowed = allowedCandidates(
      { ...NONE, operators: ['東日本旅客鉄道'], lines: [FUKUTOSHIN.lineCd] },
      LISTS,
    )
    // 並びは問わない（セレクタは集合として使う）。新潟県（JR東日本だけ）は落ちる。
    expect([...(allowed.prefectures ?? [])].sort()).toEqual(['埼玉県', '東京都'])
  })

  it('会社の候補は、都道府県・法令上の路線・路線をすべて満たすものだけ', () => {
    const allowed = allowedCandidates(
      { ...NONE, prefectures: ['東京都'], routes: ['山手線'], lines: [YAMANOTE.lineCd] },
      LISTS,
    )
    expect(allowed.operators).toEqual(['東日本旅客鉄道'])
  })

  it('大阪を選ぶと、東京の路線は候補から外れる', () => {
    const allowed = allowedCandidates({ ...NONE, prefectures: ['大阪府'] }, LISTS)
    expect(allowed.lines).toEqual(codes([OSAKA_CHUO]))
  })

  it('法令上の路線の候補は、会社だけが絞る（以前と同じ）', () => {
    const allowed = allowedCandidates({ ...NONE, operators: ['東京地下鉄'] }, LISTS)
    expect(allowed.routes).toEqual(['4号線丸ノ内線'])
  })
})

describe('narrowingScopes：説明文の主語は、効いている条件だけ', () => {
  it('何も選んでいなければ空', () => {
    expect(narrowingScopes(NONE)).toEqual({ prefectures: '', operators: '', lines: '' })
  })

  it('路線を選ぶと、都道府県は「路線」、会社は「路線」で絞られている', () => {
    const scopes = narrowingScopes({ ...NONE, lines: [YAMANOTE.lineCd] })
    expect(scopes.prefectures).toBe('路線')
    expect(scopes.operators).toBe('路線')
    expect(scopes.lines).toBe('')
  })

  it('都道府県と会社を選ぶと、路線は「都道府県・会社」で絞られている', () => {
    const scopes = narrowingScopes({ ...NONE, prefectures: ['東京都'], operators: ['東京都'] })
    expect(scopes.lines).toBe('都道府県・会社')
    expect(scopes.prefectures).toBe('会社')
    expect(scopes.operators).toBe('都道府県')
  })

  it('法令上の路線・種別も「路線」として数える（利用者には同じ「路線」の条件）', () => {
    expect(narrowingScopes({ ...NONE, routeTypes: [1] }).operators).toBe('路線')
    expect(
      narrowingScopes({ ...NONE, routes: ['山手線'], lines: [YAMANOTE.lineCd] }).operators,
    ).toBe('路線')
  })
})
