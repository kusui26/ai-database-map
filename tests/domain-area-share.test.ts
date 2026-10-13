import { describe, expect, it } from 'vitest'
import { isWithin, nearestContainers, shareJa, type AdminPlace } from '@/domain/area-summary/share'

/**
 * **占める割合**の入れ物と書き方（2026-10-13 B5d″・`docs/261001_fix_user_feedback_ui.md` §6.19）。
 *
 * 見ること：含む・含まれるを行政区域の上下で決める（区 ⊂ 政令市・23 区の区 ⊂ 東京23区・県の中 ⊂ 都道府県・全国以外 ⊂ 全国）。
 * 含まない組み合わせ（隣の市・別の県）は入れ物にしない。入れ物が 2 つ以上なら、いちばん近い（小さい）ほう。
 * 割合は「神奈川県の 40.8%」（小数 1 桁）、0.1% 未満は丸めずに「0.1% 未満」。
 */

function place(
  ref: string,
  kind: AdminPlace['kind'],
  prefecture: string | null,
  parentRef: string | null,
  groupRef: string | null = null,
): AdminPlace {
  return { ref, kind, prefecture, parentRef, groupRef }
}

const JAPAN = place('jp', 'country', null, null)
const KANAGAWA = place('pref:14', 'prefecture', '神奈川県', 'jp')
const TOKYO = place('pref:13', 'prefecture', '東京都', 'jp')
const YOKOHAMA = place('muni:14100', 'city', '神奈川県', 'pref:14')
const KAWASAKI = place('muni:14130', 'city', '神奈川県', 'pref:14')
const NAKA_YOKOHAMA = place('muni:14104', 'ward', '神奈川県', 'muni:14100')
const NAKAHARA_KAWASAKI = place('muni:14133', 'ward', '神奈川県', 'muni:14130')
const OISO = place('muni:14341', 'municipality', '神奈川県', 'pref:14')
const TOKYO23 = place('muni:13100', 'special_wards', '東京都', 'pref:13')
const CHIYODA = place('muni:13101', 'municipality', '東京都', 'pref:13', 'muni:13100')
const FUCHU_TOKYO = place('muni:13206', 'municipality', '東京都', 'pref:13')

describe('isWithin（含む・含まれる）', () => {
  it.each([
    ['区は政令市に', NAKA_YOKOHAMA, YOKOHAMA],
    ['区は県に', NAKA_YOKOHAMA, KANAGAWA],
    ['区は全国に', NAKA_YOKOHAMA, JAPAN],
    ['政令市は県に', YOKOHAMA, KANAGAWA],
    ['町は県に', OISO, KANAGAWA],
    ['23 区の区は東京23区に', CHIYODA, TOKYO23],
    ['23 区の区は東京都に', CHIYODA, TOKYO],
    ['東京23区は東京都に', TOKYO23, TOKYO],
    ['県は全国に', KANAGAWA, JAPAN],
  ])('%s入る', (_label, part, whole) => {
    expect(isWithin(part, whole)).toBe(true)
  })

  it.each([
    ['ほかの政令市の区は入らない', NAKAHARA_KAWASAKI, YOKOHAMA],
    ['隣の市は入らない', KAWASAKI, YOKOHAMA],
    ['別の県の市区町村は入らない', FUCHU_TOKYO, KANAGAWA],
    ['23 区の外の東京都の市は東京23区に入らない', FUCHU_TOKYO, TOKYO23],
    ['県は県に入らない', TOKYO, KANAGAWA],
    ['全国はどこにも入らない', JAPAN, KANAGAWA],
    ['区も市区町村も入れ物にならない', NAKA_YOKOHAMA, OISO],
    ['自分には入らない', YOKOHAMA, YOKOHAMA],
    ['大きいほうは小さいほうに入らない', KANAGAWA, YOKOHAMA],
  ])('%s', (_label, part, whole) => {
    expect(isWithin(part, whole)).toBe(false)
  })
})

describe('nearestContainers（いちばん近い入れ物）', () => {
  it('中区・横浜市・神奈川県：中区は横浜市に、横浜市は神奈川県に（神奈川県は入れ物だけ）', () => {
    expect(nearestContainers([NAKA_YOKOHAMA, YOKOHAMA, KANAGAWA])).toEqual(
      new Map([
        ['muni:14104', 'muni:14100'],
        ['muni:14100', 'pref:14'],
      ]),
    )
  })

  it('千代田区・東京23区・東京都・全国：1 つずつ外へ（並びの順によらない）', () => {
    expect(nearestContainers([JAPAN, TOKYO, CHIYODA, TOKYO23])).toEqual(
      new Map([
        ['pref:13', 'jp'],
        ['muni:13101', 'muni:13100'],
        ['muni:13100', 'pref:13'],
      ]),
    )
  })

  it('中区と神奈川県だけなら、中区は神奈川県に（間の横浜市は比べるエリアに無い）', () => {
    expect(nearestContainers([NAKA_YOKOHAMA, KANAGAWA])).toEqual(
      new Map([['muni:14104', 'pref:14']]),
    )
  })

  it('含む・含まれるが無ければ空（横浜市と川崎市・神奈川県と東京都）', () => {
    expect(nearestContainers([YOKOHAMA, KAWASAKI])).toEqual(new Map())
    expect(nearestContainers([KANAGAWA, TOKYO])).toEqual(new Map())
  })
})

describe('shareJa（割合の書き方）', () => {
  it('小数 1 桁で、入れ物の名前を頭に付ける', () => {
    expect(shareJa(3_750_952, 9_193_922, '神奈川県')).toBe('神奈川県の 40.8%')
    expect(shareJa(154_681, 3_750_952, '横浜市')).toBe('横浜市の 4.1%')
  })

  it('0.1% 未満は丸めずに「0.1% 未満」（大島町は東京都の 0.04%）。0.1% ちょうどは 0.1%', () => {
    expect(shareJa(6_297, 14_236_627, '東京都')).toBe('東京都の 0.1% 未満')
    expect(shareJa(1, 1_000, '東京都')).toBe('東京都の 0.1%')
    expect(shareJa(0, 1_000, '東京都')).toBe('東京都の 0.1% 未満')
  })

  it('全体が 0 以下なら割合にならない（null）', () => {
    expect(shareJa(10, 0, '神奈川県')).toBeNull()
  })
})
