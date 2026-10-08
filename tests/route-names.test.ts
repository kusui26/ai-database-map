/**
 * src/ai/routes：会社・路線の名前を、データの会社と路線（運行系統）へ解決する（2026-10-07 B1 → 2026-10-08 L3）。
 *
 * 路線は駅データ.jp の路線（「JR山手線」＝環状 30 駅）。L3 で、名前の解決の行き先を法令上の路線（S12）から
 * 路線（運行系統）に替えた（`docs/261001_fix_user_feedback_ui.md` §6.8.5）。ここで固定するのは：
 *
 * - 名前の一致の強さ：正式名・会社名や括弧書きの省略・別名は強く、「本線／線」の言い換えは弱い。
 *   「中央線」は JR中央線(快速)（強い）に当て、JR中央本線（弱い）には当てない
 * - 会社名を含むのが正式名の路線（西武有楽町線・JR東西線）は、会社名を省いた呼び方では弱い
 * - 区間に分かれた路線（JR東海道本線の各区間・琵琶湖線・JR京都線）は 1 本として扱う
 * - 同じ名前の路線は、明示の都道府県 → 地図の表示範囲 の順に決め、決まらなければ聞き返す（§6.8.6）
 * - 路線を決めたら会社は条件に入れない（路線コードが駅の集合を決める）
 */

import { describe, expect, it } from 'vitest'
import { buildNameIndex, matchLine, matchOperator, type LineMatch } from '@/ai/routes/match'
import {
  groupKeys,
  lineForms,
  lineSuffixVariant,
  nameKey,
  operatorNameIndex,
  splitQualifier,
  type CatalogLine,
} from '@/ai/routes/names'
import { resolveNameFilters, type NameResolution } from '@/ai/routes/resolve'
import { MAX_LINES_PER_QUERY } from '@/shared/constants'
import { INDEX, LEGAL_ROUTES, LINES, OPERATORS, VIEW, fakeDeps } from './fixtures/line-catalog'

function lineNamed(name: string): CatalogLine {
  const found = LINES.find((row) => row.name === name)
  if (found === undefined) throw new Error(`一覧に無い路線: ${name}`)
  return found
}

/** 強い候補を「路線名+路線名」で読む（1 本の路線＝区間を + でつなぐ）。 */
function strongOf(match: LineMatch): string[] {
  if (match.kind !== 'lines') return []
  return match.strong.map((identity) => identity.lines.map((row) => row.name).join('+'))
}

function weakOf(match: LineMatch): string[] {
  if (match.kind !== 'lines') return []
  return match.weak.map((identity) => identity.lines.map((row) => row.name).join('+'))
}

function decided(input: string): string[] {
  const match = matchLine(input, INDEX, null)
  expect(match.kind, input).toBe('lines')
  expect(strongOf(match), input).toHaveLength(1)
  return strongOf(match)
}

/** 決まった路線の名前（決まらなければ失敗の理由をそのまま出す）。 */
function linesOf(result: NameResolution): string[] {
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.filters.lines.map((ref) => ref.name)
}

describe('nameKey・splitQualifier（照合の鍵）', () => {
  it('全角・空白・中黒・波ダッシュ・「の／ノ」「ヶ／ケ」・大文字小文字を吸収する', () => {
    expect(nameKey('ＪＲ中央・総武線')).toBe(nameKey('jr中央総武線'))
    expect(nameKey('丸の内線')).toBe(nameKey('丸ノ内線'))
    expect(nameKey('JR東海道本線(東京〜熱海)')).toBe(nameKey('JR東海道本線（東京～熱海）'))
  })

  it.each([
    ['jr中央線(快速)', 'jr中央線', '快速'],
    ['jr東海道本線(東京~熱海)', 'jr東海道本線', '東京~熱海'],
    ['富山地鉄富山都心線【3系統(環状線)】', '富山地鉄富山都心線', '3系統(環状線)'],
    ['jr山手線', 'jr山手線', null],
  ])('「%s」→ 本体「%s」・括弧書き %j', (key, base, qualifier) => {
    expect(splitQualifier(key)).toEqual({ base, qualifier })
  })

  it('本線と線の言い換え。会社名だけになる形（京急線）・新幹線は作らない', () => {
    expect(lineSuffixVariant('jr東海道本線(東京~熱海)', ['jr'])).toBe('jr東海道線(東京~熱海)')
    expect(lineSuffixVariant('東上線', ['東武'])).toBe('東上本線')
    expect(lineSuffixVariant('京急本線', ['京急'])).toBeNull()
    expect(lineSuffixVariant('東海道新幹線', ['jr東海'])).toBeNull()
  })
})

describe('lineForms（1 本の路線から作る照合の形）', () => {
  function forms(name: string, legal = false): Map<string, number> {
    return new Map(lineForms(lineNamed(name), legal).map((form) => [form.key, form.tier]))
  }

  it('会社名・括弧書きを省いた形は強い（「中央線」「中央線快速」「jr中央線」）', () => {
    const got = forms('JR中央線(快速)')
    expect(got.get(nameKey('中央線'))).toBe(1)
    expect(got.get(nameKey('中央線快速'))).toBe(1)
    expect(got.get(nameKey('JR中央線'))).toBe(1)
  })

  it('「本線」と「線」の言い換えは弱い（「東海道線」→ JR東海道本線の区間）', () => {
    expect(forms('JR東海道本線(東京～熱海)').get(nameKey('東海道線'))).toBe(2)
  })

  it('JR 東海の区間は「JR東海」でも「JR」でも始まる——「JR」を省いた「東海道本線」を作る', () => {
    expect(forms('JR東海道本線(熱海～浜松)').get(nameKey('東海道本線'))).toBe(1)
  })

  it('会社名の無い路線名に会社名を足した形（「JR宇都宮線」「神鉄三田線」）', () => {
    expect(forms('宇都宮線').get(nameKey('JR宇都宮線'))).toBe(1)
    expect(forms('三田線').get(nameKey('神戸電鉄三田線'))).toBe(1)
  })

  it('会社名を含むのが正式名なら、会社名を省いた形は弱い（西武有楽町線 → 「有楽町線」）', () => {
    expect(forms('西武有楽町線', true).get(nameKey('有楽町線'))).toBe(2)
    expect(forms('西武有楽町線', false).get(nameKey('有楽町線'))).toBe(1)
  })

  it('括弧の中の別名も名前（「都電荒川線」→ さらに会社名を省いた「荒川線」）', () => {
    const got = forms('東京さくらトラム（都電荒川線）')
    expect(got.get(nameKey('都電荒川線'))).toBe(1)
    expect(got.get(nameKey('荒川線'))).toBe(1)
  })
})

describe('groupKeys（区間に分かれた路線を 1 本に束ねる鍵）', () => {
  function shares(a: string, b: string): boolean {
    const keys = groupKeys(lineNamed(a))
    return groupKeys(lineNamed(b)).some((key) => keys.includes(key))
  }

  it('同じ路線の区間（会社が JR 6 社にまたがっても）・正式名がその区間の路線は束ねる', () => {
    expect(shares('JR東海道本線(東京～熱海)', 'JR東海道本線(熱海～浜松)')).toBe(true)
    expect(shares('JR東海道本線(東京～熱海)', 'JR京都線')).toBe(true)
    expect(shares('宇都宮線', 'JR東北本線(黒磯～利府・盛岡)')).toBe(true)
  })

  it('会社の違う同じ名前の路線は束ねない（東京メトロ東西線と札幌の東西線）', () => {
    expect(shares('東京メトロ東西線', '札幌市営地下鉄東西線')).toBe(false)
    expect(shares('JR山手線', '神戸市営地下鉄山手線')).toBe(false)
  })
})

describe('operatorNameIndex・matchOperator（会社の言い方 → S12 の会社名）', () => {
  it.each([
    ['東急', ['東急電鉄']],
    ['東京急行電鉄', ['東急電鉄']],
    ['東京メトロ', ['東京地下鉄']],
    ['都営', ['東京都']],
    ['JR東日本', ['東日本旅客鉄道']],
    ['ＪＲ東日本', ['東日本旅客鉄道']],
    ['大阪メトロ', ['大阪市高速電気軌道']],
    ['Osaka Metro', ['大阪市高速電気軌道']],
    ['京急', ['京浜急行電鉄']],
    ['東急線', ['東急電鉄']],
  ])('「%s」→ %j', (input, expected) => {
    expect(matchOperator(input, INDEX)).toEqual({ kind: 'operators', operators: expected })
  })

  it('事業者名・略称は路線の一覧から足す（別名表に書かなくてよい）', () => {
    const index = operatorNameIndex({ lines: LINES, operators: OPERATORS, legalRoutes: [] })
    expect(index.get(nameKey('名鉄'))).toEqual(['名古屋鉄道'])
    expect(index.get(nameKey('神鉄'))).toEqual(['神戸電鉄'])
  })

  it('線路の持ち主の路線（会社が無い神戸高速）の名前は、会社の言い方にしない', () => {
    expect(INDEX.operatorKeys.has(nameKey('神戸高速'))).toBe(false)
  })

  it('「JR」は一覧にある JR 各社だけ。「新幹線」は会社の名前ではない', () => {
    expect(matchOperator('JR', INDEX)).toEqual({
      kind: 'operators',
      operators: ['東日本旅客鉄道', '東海旅客鉄道', '西日本旅客鉄道'],
    })
    expect(matchOperator('新幹線', INDEX).kind).toBe('category')
  })
})

describe('matchLine：1 本に決まる言い方', () => {
  it.each([
    ['JR山手線', 'JR山手線'],
    ['中央線快速', 'JR中央線(快速)'],
    ['中央快速線', 'JR中央線(快速)'],
    ['JR中央線', 'JR中央線(快速)'],
    ['東京メトロ東西線', '東京メトロ東西線'],
    ['メトロ東西線', '東京メトロ東西線'],
    ['副都心線', '東京メトロ副都心線'],
    ['丸ノ内線', '東京メトロ丸ノ内線'],
    ['丸の内線', '東京メトロ丸ノ内線'],
    ['浅草線', '都営浅草線'],
    ['都営地下鉄三田線', '都営三田線'],
    ['東横線', '東急東横線'],
    ['東京急行電鉄東横線', '東急東横線'],
    ['東横', '東急東横線'],
    ['東横線沿線の駅', '東急東横線'],
    ['井の頭線', '京王井の頭線'],
    ['小田原線', '小田急線'],
    ['JR宇都宮線', '宇都宮線'],
    ['神鉄三田線', '三田線'],
    ['大阪環状線', '大阪環状線'],
    ['Osaka Metro中央線', '大阪メトロ中央線'],
    ['都電', '東京さくらトラム（都電荒川線）'],
    ['荒川線', '東京さくらトラム（都電荒川線）'],
    ['総武線各駅停車', 'JR中央・総武線'],
    ['中央・総武線', 'JR中央・総武線'],
    ['東海道新幹線', '東海道新幹線'],
    ['JR東海中央線', 'JR中央本線(名古屋～塩尻)'],
  ])('「%s」→ %s', (input, expected) => {
    expect(decided(input)).toEqual([expected])
  })

  it('区間に分かれた路線は 1 本（「東海道線」＝東京〜熱海・熱海〜浜松・琵琶湖線・JR京都線・JR神戸線(大阪～神戸)）', () => {
    expect(decided('東海道線')).toEqual([
      'JR東海道本線(東京～熱海)+JR東海道本線(熱海～浜松)+琵琶湖線+JR京都線+JR神戸線(大阪～神戸)',
    ])
    expect(decided('JR神戸線')).toEqual(['JR神戸線(大阪～神戸)+JR神戸線(神戸～姫路)'])
  })

  it('束ねるのは当たった路線の中だけ（「山陽本線」に東海道本線の区間は混ざらない）', () => {
    expect(decided('山陽本線')).toEqual(['JR神戸線(神戸～姫路)+JR山陽本線(姫路～岡山)'])
  })

  it('強い形で決まれば、弱い形の路線は使わずに残す（「中央本線」と大阪メトロ中央線）', () => {
    const match = matchLine('中央本線', INDEX, null)
    expect(strongOf(match)).toEqual(['JR中央本線(東京～塩尻)+JR中央本線(名古屋～塩尻)'])
    expect(weakOf(match)).toEqual(['JR中央線(快速)', '大阪メトロ中央線'])
  })

  it('会社名を含むのが正式名の路線は弱い（「有楽町線」は東京メトロ、西武有楽町線は残すだけ）', () => {
    const match = matchLine('有楽町線', INDEX, null)
    expect(strongOf(match)).toEqual(['東京メトロ有楽町線'])
    expect(weakOf(match)).toEqual(['西武有楽町線'])
  })

  it('会社の全路線（「京急線」・会社名だけを路線に渡された）', () => {
    expect(matchLine('京急線', INDEX, null)).toEqual({
      kind: 'operators',
      operators: ['京浜急行電鉄'],
    })
    expect(matchLine('小田急', INDEX, null)).toEqual({
      kind: 'operators',
      operators: ['小田急電鉄'],
    })
  })

  it('会社の名前の路線（「京王線」「小田急線」）は会社の全路線ではなく、その路線', () => {
    expect(decided('京王線')).toEqual(['京王線'])
    expect(decided('小田急線')).toEqual(['小田急線'])
  })

  it('ブランド名は路線全体へ（東武スカイツリーライン → 東武伊勢崎線・広げたことを残す）', () => {
    const match = matchLine('東武スカイツリーライン', INDEX, null)
    expect(strongOf(match)).toEqual(['東武伊勢崎線'])
    expect(match.kind === 'lines' && match.strong[0]?.widened).toBe(true)
    expect(matchLine('アーバンパークライン', INDEX, null)).toMatchObject({
      kind: 'lines',
      strong: [{ widened: false }],
    })
  })
})

describe('matchLine：同じ名前の別路線は 1 つに決めない', () => {
  it.each([
    ['山手線', ['JR山手線', '神戸市営地下鉄山手線']],
    ['中央線', ['JR中央線(快速)', '大阪メトロ中央線']],
    ['新宿線', ['都営新宿線', '西武新宿線']],
    ['三田線', ['都営三田線', '三田線']],
    ['宇都宮線', ['宇都宮線', '東武宇都宮線']],
    ['環状線', ['大阪環状線', '伊予鉄道環状線（１系統）+伊予鉄道環状線（２系統）']],
  ])('「%s」→ 候補 %j', (input, expected) => {
    expect(strongOf(matchLine(input, INDEX, null)).sort()).toEqual([...expected].sort())
  })

  it('「東西線」は東京メトロ・札幌・仙台・京都・神戸高速。JR東西線（正式名が会社名つき）は弱い候補', () => {
    const match = matchLine('東西線', INDEX, null)
    expect(strongOf(match).sort()).toEqual(
      [
        '東京メトロ東西線',
        '札幌市営地下鉄東西線',
        '仙台市営地下鉄東西線',
        '京都市営地下鉄東西線',
        '神戸高速東西線',
      ].sort(),
    )
    expect(weakOf(match)).toEqual(['JR東西線'])
  })

  it('「南北線」には北大阪急行（法令上の名前が南北線）も入る', () => {
    expect(strongOf(matchLine('南北線', INDEX, null))).toContain('北大阪急行電鉄')
  })

  it('会社の範囲があれば、その中で決まる（中央線 × 大阪メトロ）。会社の無い神戸高速は範囲の外', () => {
    expect(strongOf(matchLine('中央線', INDEX, ['大阪市高速電気軌道']))).toEqual([
      '大阪メトロ中央線',
    ])
    expect(strongOf(matchLine('東西線', INDEX, ['東京地下鉄', '京都市']))).toEqual([
      '東京メトロ東西線',
      '京都市営地下鉄東西線',
    ])
  })
})

describe('matchLine：決めない言い方', () => {
  it('「新幹線」は路線の名前ではない（指定のしかたを返す）', () => {
    expect(matchLine('新幹線', INDEX, null).kind).toBe('category')
  })

  it('別名の行き先がデータに無ければ当てない', () => {
    const index = buildNameIndex({
      lines: LINES.filter((row) => row.name !== '東武伊勢崎線'),
      operators: OPERATORS,
      legalRoutes: LEGAL_ROUTES,
    })
    expect(matchLine('東武スカイツリーライン', index, null).kind).toBe('unknown')
  })

  it('知らない路線は近い路線名を返す。会社が分かればその会社の駅の多い路線も（「東武本線」）', () => {
    const tobu = matchLine('東武本線', INDEX, null)
    expect(tobu).toEqual({
      kind: 'unknown',
      didYouMean: ['東武伊勢崎線', '東武野田線', '東武宇都宮線'],
    })
    expect(matchLine('存在しない線', INDEX, null)).toEqual({ kind: 'unknown', didYouMean: [] })
  })
})

describe('resolveNameFilters：同じ名前の路線を、都道府県 → 地図の表示範囲 → 聞き返し で決める', () => {
  it('会社・路線の指定が無ければ、一覧も読まない', async () => {
    const deps = fakeDeps()
    const result = await resolveNameFilters({ prefectures: [] }, deps)
    expect(result).toEqual({ ok: true, filters: { operators: [], lines: [] }, notes: [] })
    expect(deps.calls.index).toBe(0)
  })

  it('「山手線」× 首都圏の地図 → JR山手線（30 駅）。地図で決めたことを書く', async () => {
    const result = await resolveNameFilters(
      { routes: ['山手線'], prefectures: [], viewport: VIEW.tokyo },
      fakeDeps(),
    )
    expect(result.ok && result.filters).toEqual({
      operators: [],
      lines: [{ lineCd: 11302, name: 'JR山手線' }],
    })
    expect(result.ok && result.notes.join()).toContain(
      '地図の表示範囲に駅のある JR山手線 に決めました',
    )
    expect(result.ok && result.notes.join()).toContain('神戸市営地下鉄山手線')
  })

  it('「中央線」× 大阪の地図 → 大阪メトロ中央線（聞き返さない）', async () => {
    const result = await resolveNameFilters(
      { routes: ['中央線'], prefectures: [], viewport: VIEW.osaka },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['大阪メトロ中央線'])
  })

  it('「中央線」× 名古屋の地図 → 強い候補が範囲に無いので、弱い候補（JR中央本線）の範囲の区間', async () => {
    const result = await resolveNameFilters(
      { routes: ['中央線'], prefectures: [], viewport: VIEW.nagoya },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['JR中央本線(名古屋～塩尻)'])
    expect(result.ok && result.notes.join()).toContain('範囲の外の区間（JR中央本線(東京～塩尻)）')
  })

  it('「新宿線」× 首都圏の地図 → 範囲に 2 本（都営・西武）なので聞き返す', async () => {
    const result = await resolveNameFilters(
      { routes: ['新宿線'], prefectures: [], viewport: VIEW.tokyo },
      fakeDeps(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.problem).toContain('地図の表示範囲に複数あります（2 本）')
    expect(result.problems[0]?.candidates?.map((c) => c.routes)).toEqual([
      ['都営新宿線'],
      ['西武新宿線'],
    ])
    expect(result.hint).toContain('推測で選ばない')
  })

  it('範囲の中で聞き返すときは、弱い候補も範囲にあれば並べる（大阪の「東西線」に JR東西線）', async () => {
    const result = await resolveNameFilters(
      { routes: ['東西線'], prefectures: [], viewport: VIEW.osaka },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.candidates?.map((c) => c.routes[0])).toEqual([
      '京都市営地下鉄東西線',
      '神戸高速東西線',
      'JR東西線',
    ])
  })

  it('範囲の手がかりが無ければ聞き返す（候補は弱いものも含めてすべて・駅の数と都道府県つき）', async () => {
    const result = await resolveNameFilters({ routes: ['東西線'], prefectures: [] }, fakeDeps())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.problem).toContain('複数あります（6 本）')
    const rows = result.problems[0]?.candidates?.map(
      (c) => `${c.routes.join()} ${c.stationCount} ${c.prefectures.join()}`,
    )
    expect(rows).toContain('JR東西線 9 大阪府,兵庫県')
    expect(rows).toContain('東京メトロ東西線 23 東京都,千葉県')
  })

  it('候補は名前だけで 1 本に決まる言い方で返す（「三田線」→ 都営三田線・神鉄三田線、「宇都宮線」→ JR宇都宮線）', async () => {
    const mita = await resolveNameFilters({ routes: ['三田線'], prefectures: [] }, fakeDeps())
    expect(!mita.ok && mita.problems[0]?.candidates?.map((c) => c.routes)).toEqual([
      ['都営三田線'],
      ['神鉄三田線'],
    ])
    const utsunomiya = await resolveNameFilters(
      { routes: ['宇都宮線'], prefectures: [] },
      fakeDeps(),
    )
    expect(!utsunomiya.ok && utsunomiya.problems[0]?.candidates?.map((c) => c.routes)).toEqual([
      ['JR宇都宮線'],
      ['東武宇都宮線'],
    ])
  })

  it('明示の都道府県は地図より強い（中央線 × 大阪府、地図は首都圏）', async () => {
    const result = await resolveNameFilters(
      { routes: ['中央線'], prefectures: ['大阪府'], viewport: VIEW.tokyo },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['大阪メトロ中央線'])
    expect(result.ok && result.notes.join()).toContain('大阪府に駅のある 大阪メトロ中央線')
  })

  it('明示の会社も地図より強い（大阪メトロ × 中央線、地図は首都圏）', async () => {
    const result = await resolveNameFilters(
      { operators: ['大阪メトロ'], routes: ['中央線'], prefectures: [], viewport: VIEW.tokyo },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['大阪メトロ中央線'])
  })

  it('都道府県で強い候補が残らなければ、弱い候補から（東西線 × 大阪府 → JR東西線）', async () => {
    const result = await resolveNameFilters(
      { routes: ['東西線'], prefectures: ['大阪府'] },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['JR東西線'])
  })

  it('都道府県に駅のある路線が無ければ、そう言って候補を返す', async () => {
    const result = await resolveNameFilters(
      { routes: ['東西線'], prefectures: ['沖縄県'] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.problem).toContain('沖縄県に駅がありません')
  })

  it('強い形で 1 本だけ当たれば、地図で別の路線に寄せない（大阪の地図でも「中央本線」は JR）', async () => {
    const deps = fakeDeps()
    const result = await resolveNameFilters(
      { routes: ['中央本線'], prefectures: [], viewport: VIEW.osaka },
      deps,
    )
    expect(linesOf(result)).toEqual(['JR中央本線(東京～塩尻)', 'JR中央本線(名古屋～塩尻)'])
    expect(result.ok && result.notes.join()).toContain(
      '大阪メトロ中央線 も当たりますが含めていません',
    )
  })

  it('名前で 1 本に決まる路線は、地図を見に行かない（駅の一覧を引かない）', async () => {
    const deps = fakeDeps()
    await resolveNameFilters({ routes: ['副都心線'], prefectures: [], viewport: VIEW.osaka }, deps)
    expect(deps.calls.inView).toBe(0)
  })
})

describe('resolveNameFilters：区間に分かれた路線', () => {
  it('首都圏の地図の「東海道線」は東京〜熱海だけ。外した区間を書く', async () => {
    const result = await resolveNameFilters(
      { routes: ['東海道線'], prefectures: [], viewport: VIEW.tokyo },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['JR東海道本線(東京～熱海)'])
    expect(result.ok && result.notes.join()).toContain('地図の表示範囲の外の区間')
    expect(result.ok && result.notes.join()).toContain('JR京都線')
  })

  it('大阪の地図なら琵琶湖線・JR京都線・JR神戸線(大阪～神戸)', async () => {
    const result = await resolveNameFilters(
      { routes: ['東海道線'], prefectures: [], viewport: VIEW.osaka },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['琵琶湖線', 'JR京都線', 'JR神戸線(大阪～神戸)'])
  })

  it('地図が無ければ全区間（MCP から呼ばれたとき）', async () => {
    const result = await resolveNameFilters({ routes: ['東海道線'], prefectures: [] }, fakeDeps())
    expect(linesOf(result)).toHaveLength(5)
  })

  it('都道府県なら駅のある区間だけ（駅の集合は変わらないので、外した区間は書かない）', async () => {
    const result = await resolveNameFilters(
      { routes: ['東海道線'], prefectures: ['神奈川県'] },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['JR東海道本線(東京～熱海)'])
    expect(result.ok && result.notes.join()).not.toContain('範囲の外')
  })

  it('区間の名前を言えば、その区間だけ（地図で絞らない）', async () => {
    const result = await resolveNameFilters(
      { routes: ['東海道本線(熱海～浜松)'], prefectures: [], viewport: VIEW.tokyo },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['JR東海道本線(熱海～浜松)'])
  })

  it('束ねた路線の候補の駅の数は、重なる駅を 1 つに数える（駅の一覧で数える）', async () => {
    const result = await resolveNameFilters({ routes: ['中央線'], prefectures: [] }, fakeDeps())
    const candidate = !result.ok
      ? result.problems[0]?.candidates?.find((c) => c.routes.length === 2)
      : undefined
    expect(candidate).toMatchObject({
      routes: ['JR中央本線(東京～塩尻)', 'JR中央本線(名古屋～塩尻)'],
      stationCount: 53 + 40 - 1,
    })
  })
})

describe('resolveNameFilters：会社と路線のまとめ方', () => {
  it('路線を決めたら会社は条件に入れない（会社の指定は名前を当てる範囲だけ）', async () => {
    const result = await resolveNameFilters(
      { operators: ['東急'], routes: ['東横線'], prefectures: [] },
      fakeDeps(),
    )
    expect(result.ok && result.filters).toEqual({
      operators: [],
      lines: [{ lineCd: 26001, name: '東急東横線' }],
    })
    expect(result.ok && result.notes).toContain('会社「東急」は 東急電鉄 として扱いました。')
  })

  it('会社の指定と合わない路線は、その路線を示す（東横線 × JR東日本）', async () => {
    const result = await resolveNameFilters(
      { operators: ['JR東日本'], routes: ['東横線'], prefectures: [] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems[0]?.problem).toContain('東急東横線 の路線で')
  })

  it('会社だけ → 会社の条件（読み替えを残す）', async () => {
    const result = await resolveNameFilters({ operators: ['東急'], prefectures: [] }, fakeDeps())
    expect(result.ok && result.filters).toEqual({ operators: ['東急電鉄'], lines: [] })
  })

  it('路線に「京急線」だけ → 会社の条件。会社の全路線として扱ったと書く', async () => {
    const result = await resolveNameFilters({ routes: ['京急線'], prefectures: [] }, fakeDeps())
    expect(result.ok && result.filters).toEqual({ operators: ['京浜急行電鉄'], lines: [] })
    expect(result.ok && result.notes).toEqual([
      '「京急線」は 京浜急行電鉄 の全路線として扱いました。',
    ])
  })

  it('「京急線」と「東横線」→ 京急の全路線を路線に開いて並べる（会社と路線を掛け合わせない）', async () => {
    const result = await resolveNameFilters(
      { routes: ['京急線', '東横線'], prefectures: [] },
      fakeDeps(),
    )
    expect(result.ok && result.filters.operators).toEqual([])
    expect(linesOf(result)).toEqual(['東急東横線', '京急本線', '京急空港線'])
  })

  it(`路線が ${MAX_LINES_PER_QUERY} 本を超えるなら分けて呼ぶよう返す`, async () => {
    const many = Array.from({ length: MAX_LINES_PER_QUERY }, (_, i): CatalogLine => ({
      ...lineNamed('京急本線'),
      lineCd: 90000 + i,
      name: `京急テスト${i}線`,
      formalName: `京急テスト${i}線`,
    }))
    const index = buildNameIndex({
      lines: [...LINES, ...many],
      operators: OPERATORS,
      legalRoutes: LEGAL_ROUTES,
    })
    const result = await resolveNameFilters(
      { routes: ['京急線', '東横線'], prefectures: [] },
      { ...fakeDeps(), index: async () => index },
    )
    expect(!result.ok && result.problems[0]?.problem).toContain(`${MAX_LINES_PER_QUERY} 本まで`)
  })

  it('同じ路線を 2 回言っても 1 本（重ねない）', async () => {
    const result = await resolveNameFilters(
      { routes: ['副都心線', '東京メトロ副都心線'], prefectures: [] },
      fakeDeps(),
    )
    expect(linesOf(result)).toEqual(['東京メトロ副都心線'])
  })

  it('種別語・知らない名前は、まとめて理由を返す', async () => {
    const result = await resolveNameFilters(
      { operators: ['新幹線'], routes: ['存在しない線'], prefectures: [] },
      fakeDeps(),
    )
    expect(!result.ok && result.problems.map((p) => p.input)).toEqual(['新幹線', '存在しない線'])
  })
})

describe('resolveNameFilters：説明（nameNotes）', () => {
  async function notesOf(input: string): Promise<string> {
    const result = await resolveNameFilters({ routes: [input], prefectures: [] }, fakeDeps())
    if (!result.ok) throw new Error(JSON.stringify(result.problems))
    return result.notes.join('\n')
  }

  it('読み替えたら書く（「副都心線」→ 東京メトロ副都心線）。同じ名前なら書かない', async () => {
    expect(await notesOf('副都心線')).toBe('「副都心線」は 東京メトロ副都心線 として集計しました。')
    expect(await notesOf('東京メトロ副都心線')).toBe('')
  })

  it('ブランド名で路線全体に広げたら、その区間に限らないことを書く（読み替えの文とは重ねない）', async () => {
    expect(await notesOf('東武スカイツリーライン')).toBe(
      '「東武スカイツリーライン」は路線全体（東武伊勢崎線）で集計しました。その系統・区間の駅に限りません。',
    )
  })

  it('会社の名前の路線（「小田急線」）は、会社のほかの路線を含まないことと、全路線の指定のしかたを書く', async () => {
    const notes = await notesOf('小田急線')
    expect(notes).toContain('小田急線（正式名 小田急小田原線）だけで集計しました')
    expect(notes).toContain('小田急江ノ島線')
    expect(notes).toContain('operators に「小田急」')
  })

  it('会社の名前の路線の注記は「〇〇線」と言ったときだけ（「都電」には付けない）', async () => {
    expect(await notesOf('都電')).not.toContain('ほかの路線')
  })

  it('使わなかった弱い候補を書く（「有楽町線」に西武有楽町線）', async () => {
    expect(await notesOf('有楽町線')).toContain('西武有楽町線 も当たりますが含めていません')
  })
})
