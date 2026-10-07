/**
 * src/ai/routes：会社・路線の名前を、データの正式名へ解決する（2026-10-07・B1）。
 *
 * フィードバック #5 の根の 1 つ（`docs/261001_fix_user_feedback_ui.md` §6.2-2）：データの名前は国土数値情報の
 * 正式名で、利用者の言い方では 0 件になった（「東急東横線」は「東横線」、「中央線快速」は「中央線」）。
 * さらに「東西線」は札幌・仙台・京都に当たり、東京メトロ（「5号線東西線」）は入らなかった——0 件より気づきにくい。
 *
 * 一覧は本物のデータ（2026-10-07 の `/api/routes`・`/api/operators`）から、問いに要る行だけを写したもの。
 */

import { describe, expect, it } from 'vitest'
import {
  buildNameIndex,
  matchOperator,
  matchRoute,
  pairLabel,
  type RouteMatch,
} from '@/ai/routes/match'
import { type CatalogOperator, type CatalogRoute } from '@/ai/routes/names'
import { resolveNameFilters, type NameResolveDeps, type PairStations } from '@/ai/routes/resolve'
import { type RoutePair } from '@/ai/routes/aliases'

function route(name: string, operators: string[], stationCount = 10): CatalogRoute {
  return { route: name, operators, routeTypes: [4], stationCount }
}

const ROUTES: CatalogRoute[] = [
  route('東横線', ['東急電鉄'], 21),
  route('田園都市線', ['東急電鉄'], 27),
  route('東急多摩川線', ['東急電鉄'], 7),
  route('東急新横浜線', ['東急電鉄'], 3),
  route('4号線丸ノ内線', ['東京地下鉄'], 25),
  route('4号線丸ノ内線分岐線', ['東京地下鉄'], 4),
  route('5号線東西線', ['東京地下鉄'], 23),
  route('8号線有楽町線', ['東京地下鉄'], 24),
  route('7号線南北線', ['東京地下鉄'], 19),
  route('東西線', ['京都市', '仙台市', '札幌市'], 49),
  route('南北線', ['仙台市', '北大阪急行電鉄', '札幌市'], 40),
  route('JR東西線', ['西日本旅客鉄道'], 9),
  route('1号線浅草線', ['東京都'], 20),
  route('6号線三田線', ['東京都'], 27),
  route('10号線新宿線', ['東京都'], 21),
  route('荒川線', ['東京都'], 30),
  route('三田線', ['神戸電鉄'], 10),
  route('新宿線', ['西武鉄道'], 29),
  route('西武有楽町線', ['西武鉄道'], 3),
  route('多摩川線', ['西武鉄道'], 6),
  route('中央線', ['東日本旅客鉄道', '東海旅客鉄道'], 111),
  route('4号線(中央線)', ['大阪市高速電気軌道'], 15),
  route('1号線(御堂筋線)', ['大阪市高速電気軌道'], 20),
  route('東海道線', ['東日本旅客鉄道', '東海旅客鉄道', '西日本旅客鉄道'], 174),
  route('東北線', ['東日本旅客鉄道'], 145),
  route('根岸線', ['東日本旅客鉄道'], 12),
  route('山手線', ['東日本旅客鉄道', '神戸市'], 35),
  route('西神線', ['神戸市'], 6),
  route('東海道新幹線', ['東海旅客鉄道'], 17),
  route('宇都宮線', ['東武鉄道'], 11),
  route('東上本線', ['東武鉄道'], 39),
  route('伊勢崎線', ['東武鉄道'], 55),
  route('本線', ['京成電鉄', '京浜急行電鉄', '阪神電気鉄道'], 120),
  route('空港線', ['京浜急行電鉄', '南海電気鉄道'], 9),
  route('名古屋本線', ['名古屋鉄道'], 60),
  route('相鉄本線', ['相模鉄道'], 18),
  route('相鉄いずみ野線', ['相模鉄道'], 8),
  route('相鉄新横浜線', ['相模鉄道'], 3),
  route('1号線', ['横浜市'], 23),
  route('3号線', ['横浜市'], 16),
  route('常磐新線', ['首都圏新都市鉄道'], 20),
  route('小田原線', ['小田急電鉄'], 47),
  route('江ノ島線', ['小田急電鉄'], 17),
  route('多摩線', ['小田急電鉄'], 8),
  route('京王線', ['京王電鉄'], 34),
  route('井の頭線', ['京王電鉄'], 17),
]

function operator(name: string, prefectures: string[]): CatalogOperator {
  return { name, stationCount: 10, prefectures }
}

const OPERATORS: CatalogOperator[] = [
  operator('東急電鉄', ['東京都', '神奈川県']),
  operator('東京地下鉄', ['東京都', '千葉県', '埼玉県']),
  operator('京都市', ['京都府']),
  operator('仙台市', ['宮城県']),
  operator('札幌市', ['北海道']),
  operator('北大阪急行電鉄', ['大阪府']),
  operator('西日本旅客鉄道', ['大阪府', '京都府', '兵庫県']),
  operator('東京都', ['東京都', '千葉県']),
  operator('神戸電鉄', ['兵庫県']),
  operator('西武鉄道', ['東京都', '埼玉県']),
  operator('東日本旅客鉄道', ['東京都', '神奈川県', '埼玉県', '千葉県', '栃木県']),
  operator('東海旅客鉄道', ['東京都', '静岡県', '愛知県', '大阪府']),
  operator('大阪市高速電気軌道', ['大阪府']),
  operator('神戸市', ['兵庫県']),
  operator('東武鉄道', ['東京都', '埼玉県', '栃木県']),
  operator('京成電鉄', ['東京都', '千葉県']),
  operator('京浜急行電鉄', ['東京都', '神奈川県']),
  operator('阪神電気鉄道', ['大阪府', '兵庫県']),
  operator('南海電気鉄道', ['大阪府', '和歌山県']),
  operator('名古屋鉄道', ['愛知県', '岐阜県']),
  operator('相模鉄道', ['神奈川県']),
  operator('横浜市', ['神奈川県']),
  operator('首都圏新都市鉄道', ['東京都', '埼玉県', '千葉県', '茨城県']),
  operator('小田急電鉄', ['東京都', '神奈川県']),
  operator('京王電鉄', ['東京都']),
]

const INDEX = buildNameIndex({ routes: ROUTES, operators: OPERATORS })

/** 決まった・候補になった路線を「会社 路線」で読む（持ち主ごとに + でつなぐ）。 */
function identities(match: RouteMatch): string[] {
  if (match.kind !== 'routes') return []
  return match.identities.map((identity) => identity.pairs.map(pairLabel).join(' + '))
}

function resolved(input: string): string[] {
  const match = matchRoute(input, INDEX, null)
  expect(match.kind, input).toBe('routes')
  return identities(match)
}

describe('matchOperator（会社の言い方 → 正式名）', () => {
  it.each([
    ['東急', ['東急電鉄']],
    ['東京急行電鉄', ['東急電鉄']],
    ['東京メトロ', ['東京地下鉄']],
    ['都営', ['東京都']],
    ['JR東日本', ['東日本旅客鉄道']],
    ['東急線', ['東急電鉄']],
    ['ＪＲ東日本', ['東日本旅客鉄道']],
    ['東急電鉄', ['東急電鉄']],
  ])('「%s」→ %j', (input, expected) => {
    expect(matchOperator(input, INDEX)).toEqual({ kind: 'operators', operators: expected })
  })

  it('「JR」はデータにある JR 各社すべて（一覧に無い会社は含めない）', () => {
    expect(matchOperator('JR', INDEX)).toEqual({
      kind: 'operators',
      operators: ['東日本旅客鉄道', '東海旅客鉄道', '西日本旅客鉄道'],
    })
  })

  it('「新幹線」「地下鉄」は会社の名前ではない（正しい指定のしかたを返す）', () => {
    const shinkansen = matchOperator('新幹線', INDEX)
    expect(shinkansen.kind).toBe('category')
    expect(shinkansen.kind === 'category' && shinkansen.hint).toContain('routeTypes:[1]')
    expect(matchOperator('地下鉄', INDEX).kind).toBe('category')
  })

  it('知らない会社は、近い正式名を返す', () => {
    const match = matchOperator('東京急行鉄道', INDEX)
    expect(match.kind).toBe('unknown')
    expect(match.kind === 'unknown' && match.didYouMean).toContain('東急電鉄')
  })
})

describe('matchRoute：1 本に決まる言い方', () => {
  it.each([
    ['東急東横線', ['東急電鉄 東横線']],
    ['東横線', ['東急電鉄 東横線']],
    ['東横', ['東急電鉄 東横線']],
    ['東横線沿線', ['東急電鉄 東横線']],
    ['東京メトロ東西線', ['東京地下鉄 5号線東西線']],
    ['都営浅草線', ['東京都 1号線浅草線']],
    ['浅草線', ['東京都 1号線浅草線']],
    ['都営三田線', ['東京都 6号線三田線']],
    ['西武新宿線', ['西武鉄道 新宿線']],
    ['都営新宿線', ['東京都 10号線新宿線']],
    ['御堂筋線', ['大阪市高速電気軌道 1号線(御堂筋線)']],
    ['大阪メトロ中央線', ['大阪市高速電気軌道 4号線(中央線)']],
    ['JR山手線', ['東日本旅客鉄道 山手線']],
    ['東上線', ['東武鉄道 東上本線']],
    ['東武東上線', ['東武鉄道 東上本線']],
    ['京急本線', ['京浜急行電鉄 本線']],
    ['京急空港線', ['京浜急行電鉄 空港線']],
    ['名鉄本線', ['名古屋鉄道 名古屋本線']],
    ['いずみ野線', ['相模鉄道 相鉄いずみ野線']],
    ['京王井の頭線', ['京王電鉄 井の頭線']],
    ['つくばエクスプレス', ['首都圏新都市鉄道 常磐新線']],
    ['ブルーライン', ['横浜市 1号線 + 横浜市 3号線']],
    ['東海道新幹線', ['東海旅客鉄道 東海道新幹線']],
  ])('「%s」→ %j', (input, expected) => {
    expect(resolved(input)).toEqual(expected)
  })

  it('番号つきの地下鉄は番号を外して当てる。分岐線も同じ路線に含める（方南町支線）', () => {
    expect(resolved('丸ノ内線')).toEqual([
      '東京地下鉄 4号線丸ノ内線 + 東京地下鉄 4号線丸ノ内線分岐線',
    ])
    expect(resolved('丸の内線')).toEqual(resolved('丸ノ内線'))
  })

  it('JR 各社に分かれた 1 本の路線は 1 本（東海道線・中央本線）', () => {
    expect(resolved('東海道線')).toEqual([
      '東日本旅客鉄道 東海道線 + 東海旅客鉄道 東海道線 + 西日本旅客鉄道 東海道線',
    ])
    expect(resolved('東海道本線')).toEqual(resolved('東海道線'))
    // 「中央本線」は JR の言い方。大阪メトロの「4号線(中央線)」には当てない。
    expect(resolved('中央本線')).toEqual(['東日本旅客鉄道 中央線 + 東海旅客鉄道 中央線'])
  })

  it('「中央線快速」は路線全体（JR東日本の中央線）へ広げ、広げたことを残す', () => {
    const match = matchRoute('中央線快速', INDEX, null)
    expect(identities(match)).toEqual(['東日本旅客鉄道 中央線'])
    expect(match.kind === 'routes' && match.widenedPair).toEqual({
      operator: '東日本旅客鉄道',
      route: '中央線',
    })
  })

  it('強い形で決まったら、会社名を外した弱い形の路線は使わずに残す（有楽町線 ≠ 西武有楽町線）', () => {
    const match = matchRoute('有楽町線', INDEX, null)
    expect(identities(match)).toEqual(['東京地下鉄 8号線有楽町線'])
    expect(match.kind === 'routes' && match.others.map((o) => o.pairs.map(pairLabel))).toEqual([
      ['西武鉄道 西武有楽町線'],
    ])
  })

  it('会社の全路線（「小田急線」・会社名だけを路線に渡された）', () => {
    expect(matchRoute('小田急線', INDEX, null)).toEqual({
      kind: 'operators',
      operators: ['小田急電鉄'],
    })
    expect(matchRoute('小田急', INDEX, null)).toEqual({
      kind: 'operators',
      operators: ['小田急電鉄'],
    })
  })
})

describe('matchRoute：同じ名前の別路線は 1 つに決めない', () => {
  it('「東西線」は東京メトロ・札幌・仙台・京都（JR東西線は弱い候補）', () => {
    const match = matchRoute('東西線', INDEX, null)
    expect(identities(match).sort()).toEqual(
      ['京都市 東西線', '仙台市 東西線', '札幌市 東西線', '東京地下鉄 5号線東西線'].sort(),
    )
    expect(match.kind === 'routes' && match.others.map((o) => o.owner)).toEqual(['JR:JR東西線'])
  })

  it.each([
    ['中央線', ['東日本旅客鉄道 中央線 + 東海旅客鉄道 中央線', '大阪市高速電気軌道 4号線(中央線)']],
    ['山手線', ['東日本旅客鉄道 山手線', '神戸市 山手線']],
    ['三田線', ['東京都 6号線三田線', '神戸電鉄 三田線']],
    ['新宿線', ['西武鉄道 新宿線', '東京都 10号線新宿線']],
    ['新横浜線', ['東急電鉄 東急新横浜線', '相模鉄道 相鉄新横浜線']],
  ])('「%s」→ 候補 %j', (input, expected) => {
    expect(resolved(input).sort()).toEqual([...expected].sort())
  })

  it('「宇都宮線」は東武の宇都宮線と、JR の運行系統（東北線の一部）の 2 つ', () => {
    expect(resolved('宇都宮線')).toEqual(['東武鉄道 宇都宮線', '東日本旅客鉄道 東北線'])
  })

  it('会社の範囲があれば、その中で決まる（東西線 × 札幌市）', () => {
    expect(identities(matchRoute('東西線', INDEX, ['札幌市']))).toEqual(['札幌市 東西線'])
  })
})

describe('matchRoute：決めない言い方', () => {
  it('運行系統の名前（京浜東北線）は、正式な路線を候補として返す', () => {
    const match = matchRoute('京浜東北線', INDEX, null)
    expect(match.kind).toBe('span')
    expect(
      match.kind === 'span' && match.candidates.map((c) => c.pairs.map(pairLabel).join()),
    ).toEqual(['東日本旅客鉄道 東北線', '東日本旅客鉄道 東海道線', '東日本旅客鉄道 根岸線'])
  })

  it('別名の行き先がデータに無ければ当てない（データの名前が変わっても、無い路線を出さない）', () => {
    // この一覧には東京臨海高速鉄道（りんかい線の行き先）が無い。
    expect(matchRoute('りんかい線', INDEX, null).kind).toBe('unknown')
  })

  it('「新幹線」は路線の名前ではない', () => {
    expect(matchRoute('新幹線', INDEX, null).kind).toBe('category')
  })

  it('知らない路線は近い正式名を返す。会社名が分かればその会社の路線から（東武本線）', () => {
    const tobu = matchRoute('東武本線', INDEX, null)
    expect(tobu.kind === 'unknown' && tobu.didYouMean).toEqual(['東武鉄道 東上本線'])
    const unknown = matchRoute('存在しない線', INDEX, null)
    expect(unknown).toEqual({ kind: 'unknown', didYouMean: [] })
  })
})

/** 駅の一覧の代わり：組ごとの駅の数と都道府県（候補を見せる・都道府県で絞るのに使う）。 */
const STATIONS: Readonly<Record<string, PairStations>> = {
  '京都市 東西線': { count: 17, prefectures: ['京都府'] },
  '仙台市 東西線': { count: 13, prefectures: ['宮城県'] },
  '札幌市 東西線': { count: 19, prefectures: ['北海道'] },
  '東京地下鉄 5号線東西線': { count: 23, prefectures: ['東京都', '千葉県'] },
  '西日本旅客鉄道 JR東西線': { count: 9, prefectures: ['大阪府', '兵庫県'] },
  '東武鉄道 宇都宮線': { count: 11, prefectures: ['栃木県'] },
  '東日本旅客鉄道 東北線': { count: 145, prefectures: ['東京都', '埼玉県', '栃木県'] },
}

function fakeDeps(): NameResolveDeps & { readonly calls: { index: number; stations: number } } {
  const calls = { index: 0, stations: 0 }
  return {
    calls,
    index: async () => {
      calls.index += 1
      return INDEX
    },
    stationsOf: async (pairs: readonly RoutePair[], prefectures: readonly string[]) => {
      calls.stations += 1
      const found = STATIONS[pairs.map(pairLabel).join(' + ')] ?? {
        count: 5,
        prefectures: ['東京都'],
      }
      if (prefectures.length === 0) return found
      const inside = found.prefectures.filter((pref) => prefectures.includes(pref))
      return { count: inside.length > 0 ? found.count : 0, prefectures: inside }
    },
  }
}

describe('resolveNameFilters（ツール 1 回分）', () => {
  it('会社・路線の指定が無ければ、一覧も読まない', async () => {
    const deps = fakeDeps()
    const result = await resolveNameFilters({ prefectures: [] }, deps)
    expect(result).toEqual({ ok: true, filters: { operators: [], routes: [] }, notes: [] })
    expect(deps.calls.index).toBe(0)
  })

  it('「東急東横線」→ 東横線（東急電鉄にしか無いので会社は付けない＝図の題が短い）', async () => {
    const result = await resolveNameFilters({ routes: ['東急東横線'], prefectures: [] }, fakeDeps())
    expect(result.ok && result.filters).toEqual({ operators: [], routes: ['東横線'] })
    expect(result.ok && result.notes.join()).toContain('東急電鉄 東横線')
  })

  it('同じ名前の別路線から 1 つを選ぶときは、その会社を付ける（他社の同名を除く）', async () => {
    const result = await resolveNameFilters(
      { routes: ['東西線'], prefectures: ['北海道'] },
      fakeDeps(),
    )
    expect(result.ok && result.filters).toEqual({ operators: ['札幌市'], routes: ['東西線'] })
    expect(result.ok && result.notes.join()).toContain('北海道に駅のある 札幌市 東西線')
  })

  it('都道府県で 1 つに決まる（東西線 × 東京都 → 東京メトロ）', async () => {
    const result = await resolveNameFilters(
      { routes: ['東西線'], prefectures: ['東京都'] },
      fakeDeps(),
    )
    expect(result.ok && result.filters).toEqual({ operators: [], routes: ['5号線東西線'] })
  })

  it('決まらなければ図を作らずに候補（駅の数・都道府県・呼び直しの operators と routes）', async () => {
    const result = await resolveNameFilters({ routes: ['東西線'], prefectures: [] }, fakeDeps())
    expect(result.ok).toBe(false)
    if (result.ok) return
    const problem = result.problems[0]
    expect(problem?.problem).toContain('複数あります（4 本）')
    const rows = problem?.candidates?.map(
      (c) => `${c.operators.join()} ${c.routes.join()} ${c.stationCount}`,
    )
    expect(rows?.sort()).toEqual(
      [
        '京都市 東西線 17',
        '仙台市 東西線 13',
        '札幌市 東西線 19',
        '東京地下鉄 5号線東西線 23',
        '西日本旅客鉄道 JR東西線 9',
      ].sort(),
    )
    expect(result.hint).toContain('推測で選ばない')
  })

  it('都道府県に駅のある路線が無ければ、そう言って候補を返す', async () => {
    const result = await resolveNameFilters(
      { routes: ['東西線'], prefectures: ['沖縄県'] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.problem).toContain('沖縄県に駅がありません')
  })

  it('会社の指定と合わない路線は、持ち主を示す（東横線 × JR東日本）', async () => {
    const result = await resolveNameFilters(
      { operators: ['JR東日本'], routes: ['東横線'], prefectures: [] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.problem).toContain('東急電鉄 東横線 の路線で')
  })

  it('会社の指定と「会社の全路線」が食い違えば、持ち主を示す（東急 × 小田急線）', async () => {
    const result = await resolveNameFilters(
      { operators: ['東急'], routes: ['小田急線'], prefectures: [] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.problem).toContain('小田急電鉄 の路線で')
  })

  it('会社だけ（「東急」）→ 正式名の会社。読み替えを残す', async () => {
    const result = await resolveNameFilters({ operators: ['東急'], prefectures: [] }, fakeDeps())
    expect(result.ok && result.filters).toEqual({ operators: ['東急電鉄'], routes: [] })
    expect(result.ok && result.notes).toEqual(['会社「東急」は 東急電鉄 として扱いました。'])
  })

  it('路線に「小田急線」だけ → 会社の指定にする（題は「小田急電鉄」）', async () => {
    const result = await resolveNameFilters({ routes: ['小田急線'], prefectures: [] }, fakeDeps())
    expect(result.ok && result.filters).toEqual({ operators: ['小田急電鉄'], routes: [] })
  })

  it('「小田急線」と「東横線」→ 小田急の全路線と東横線を並べる', async () => {
    const result = await resolveNameFilters(
      { routes: ['小田急線', '東横線'], prefectures: [] },
      fakeDeps(),
    )
    expect(result.ok && result.filters).toEqual({
      operators: [],
      routes: ['東横線', '小田原線', '江ノ島線', '多摩線'],
    })
  })

  it('会社 × 路線の掛け合わせで意図しない路線が混ざるなら、分けて呼ぶよう返す', async () => {
    // JR山手線（神戸市にも山手線がある）＋ 神戸市の西神線 → 会社に神戸市が入り、神戸市の山手線まで混ざる
    const result = await resolveNameFilters(
      { routes: ['JR山手線', '西神線'], prefectures: [] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.problem).toContain('神戸市 山手線')
  })

  it('運行系統・種別語・知らない名前は、まとめて理由を返す', async () => {
    const result = await resolveNameFilters(
      { operators: ['新幹線'], routes: ['京浜東北線', '存在しない線'], prefectures: [] },
      fakeDeps(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.input)).toEqual(['新幹線', '京浜東北線', '存在しない線'])
    expect(result.problems[1]?.candidates?.map((c) => c.routes)).toEqual([
      ['東北線'],
      ['東海道線'],
      ['根岸線'],
    ])
  })

  it('都道府県で決めた先が広げた読み替えでも、広げたことを書く（宇都宮線 × 埼玉県 → JR 東北線）', async () => {
    const result = await resolveNameFilters(
      { routes: ['宇都宮線'], prefectures: ['埼玉県'] },
      fakeDeps(),
    )
    expect(result.ok && result.filters).toEqual({ operators: [], routes: ['東北線'] })
    expect(result.ok && result.notes.join()).toContain('埼玉県に駅のある 東日本旅客鉄道 東北線')
    expect(result.ok && result.notes.join()).toContain('停車駅・区間に限りません')
  })

  it('「中央線快速」は広げたことを note に書く（停車駅に限らない）', async () => {
    const result = await resolveNameFilters({ routes: ['中央線快速'], prefectures: [] }, fakeDeps())
    // JR東海にも「中央線」があるので、JR東日本を付けて他社の同名を除く
    expect(result.ok && result.filters).toEqual({
      operators: ['東日本旅客鉄道'],
      routes: ['中央線'],
    })
    expect(result.ok && result.notes.join()).toContain('停車駅・区間に限りません')
  })
})
