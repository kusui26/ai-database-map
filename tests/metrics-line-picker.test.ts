/**
 * 画面の路線（運行系統）の選択肢（2026-10-08 L4・`src/components/metrics/linePicker.ts`・`search.ts`・
 * `popoverPlacement.ts`）。
 *
 * 見ること：
 * - 事業者の通称でまとまり、事業者は駅数の多い順・事業者の中は一覧の順（東京メトロなら銀座線から）
 * - 選んだ路線は検索・連動に関わらず先頭（いつでも外せる）
 * - 検索していないときは選べる路線だけ、検索したら選べない路線も薄く出す
 * - 上限で切った本数を数える・ボタンの言い方・ホバー・正式名を添える条件
 * - 検索は全角半角・大小を揃え、空白区切りの語をどれも含む路線
 * - ポップオーバーは画面の中に収まる
 */

import { describe, expect, it } from 'vitest'
import {
  formalNameHint,
  groupByCompany,
  lineButtonLabel,
  type LinePickerInput,
  linePickerView,
  lineTooltip,
  matchesSearch,
} from '@/components/metrics/linePicker'
import { matchesTokens, searchTokens } from '@/components/metrics/search'
import { popoverPlacement } from '@/components/metrics/popoverPlacement'
import { type Line } from '@/shared/api'
import {
  BANETSU_WEST,
  BIWAKO,
  CHUO_RAPID,
  FUKUTOSHIN,
  GINZA,
  HOKURIKU,
  KOBE_KOSOKU,
  OSAKA_CHUO,
  PICKER_LINES,
  SEIBU_SHINJUKU,
  YAMANOTE,
} from './fixtures/picker-lines'

function names(lines: readonly Line[]): string[] {
  return lines.map((line) => line.name)
}

function view(overrides: Partial<LinePickerInput<Line>> = {}) {
  return linePickerView<Line>({
    lines: PICKER_LINES,
    selected: [],
    query: '',
    allowed: null,
    ...overrides,
  })
}

const TOKYO_LINES = new Set(
  PICKER_LINES.filter((line) => line.prefectures.includes('東京都')).map((line) => line.lineCd),
)

describe('事業者の通称でまとめる', () => {
  it('事業者は駅数の多い順・事業者の中は一覧の順（路線コード順）', () => {
    const groups = view().groups
    expect(groups.map((group) => group.company)).toEqual([
      'JR東日本', // 24+28+30+24
      '東京都交通局', // 21+30
      '東京メトロ', // 19+16
      '西武鉄道', // 29
      'JR西日本', // 20
      'Osaka Metro', // 15
      '神戸高速鉄道', // 9
    ])
    expect(names(groups[2]?.lines ?? [])).toEqual(['東京メトロ銀座線', '東京メトロ副都心線'])
    expect(names(groups[0]?.lines ?? [])).toEqual([
      '北陸新幹線',
      '森と水とロマンの鉄道',
      'JR山手線',
      'JR中央線(快速)',
    ])
  })

  it('事業者の重みは「選べる路線」の駅数（東京で絞ると、東京に駅の無い路線の駅数は数えない）', () => {
    const groups = groupByCompany(PICKER_LINES, TOKYO_LINES)
    // JR東日本は選べる 3 本で 78 駅（磐越西線の 28 駅は数えない）・東京都交通局 51・東京メトロ 35・西武 29。
    expect(groups.map((group) => group.company).slice(0, 4)).toEqual([
      'JR東日本',
      '東京都交通局',
      '東京メトロ',
      '西武鉄道',
    ])
    // 選べる路線の無い事業者は後ろ（全体の駅数の順：JR西日本 20・Osaka Metro 15・神戸高速 9）。
    expect(groups.map((group) => group.company).slice(4)).toEqual([
      'JR西日本',
      'Osaka Metro',
      '神戸高速鉄道',
    ])
  })

  it('重みは選べる路線だけで数える（埼玉県：西武 29 駅 > JR東日本の北陸新幹線 24 駅 > 東京メトロ副都心線 16 駅）', () => {
    const saitama = new Set(
      PICKER_LINES.filter((line) => line.prefectures.includes('埼玉県')).map((line) => line.lineCd),
    )
    // 全体の駅数（JR東日本 106・東京メトロ 35・西武 29）で並べると逆になる。
    const enabled = groupByCompany(PICKER_LINES, saitama).filter(
      (group) => group.disabled.size < group.lines.length,
    )
    expect(enabled.map((group) => group.company)).toEqual(['西武鉄道', 'JR東日本', '東京メトロ'])
  })

  it('境界：選べる路線の駅数が 0 でも、選べる路線の無い事業者より前', () => {
    const empty = { ...GINZA, lineCd: 1, companyName: 'Ｚ社', stationCount: 0 }
    const big = { ...GINZA, lineCd: 2, companyName: 'Ｙ社', stationCount: 50 }
    const groups = groupByCompany([big, empty], new Set([empty.lineCd]))
    expect(groups.map((group) => group.company)).toEqual(['Ｚ社', 'Ｙ社'])
  })

  it('選べる路線のある事業者が先（大阪だけ選べるなら、駅の多い JR東日本より Osaka Metro）', () => {
    const groups = groupByCompany(PICKER_LINES, new Set([OSAKA_CHUO.lineCd]))
    expect(groups[0]?.company).toBe('Osaka Metro')
    expect(groups.slice(1).every((group) => group.disabled.size === group.lines.length)).toBe(true)
  })

  it('事業者の中は、選べる路線 → 選べない路線（どちらも一覧の順）', () => {
    const groups = groupByCompany(PICKER_LINES, TOKYO_LINES)
    const jrEast = groups.find((group) => group.company === 'JR東日本')
    expect(names(jrEast?.lines ?? [])).toEqual([
      '北陸新幹線',
      'JR山手線',
      'JR中央線(快速)',
      '森と水とロマンの鉄道',
    ])
    expect([...(jrEast?.disabled ?? [])]).toEqual([BANETSU_WEST.lineCd])
  })

  it('同じ重みなら、全体の駅数 → 名前で決まった順になる（並びが揺れない）', () => {
    const a = { ...GINZA, lineCd: 1, companyName: 'Ａ社', stationCount: 10 }
    const b = { ...GINZA, lineCd: 2, companyName: 'Ｂ社', stationCount: 10 }
    expect(groupByCompany([b, a], null).map((group) => group.company)).toEqual(['Ａ社', 'Ｂ社'])
  })
})

describe('選んだ路線・選べる路線・検索', () => {
  it('選んだ路線は選んだ順で先頭に出し、事業者の一覧には重ねて出さない', () => {
    const result = view({ selected: [FUKUTOSHIN.lineCd, YAMANOTE.lineCd] })
    expect(names(result.selected)).toEqual(['東京メトロ副都心線', 'JR山手線'])
    const listed = result.groups.flatMap((group) => group.lines.map((line) => line.lineCd))
    expect(listed).not.toContain(FUKUTOSHIN.lineCd)
    expect(listed).not.toContain(YAMANOTE.lineCd)
  })

  it('選んだ路線は、検索にも連動にも当たらなくても先頭に残る（外せなくならない）', () => {
    const result = view({
      selected: [OSAKA_CHUO.lineCd],
      query: '山手',
      allowed: TOKYO_LINES,
    })
    expect(names(result.selected)).toEqual(['大阪メトロ中央線'])
  })

  it('一覧に無いコード（読み込み前・廃止）は選択中に出さない（落ちない）', () => {
    expect(view({ selected: [99999] }).selected).toEqual([])
  })

  it('検索していないときは、選べる路線だけ（東京で絞ると大阪・神戸の路線は出ない）', () => {
    const listed = view({ allowed: TOKYO_LINES }).groups.flatMap((group) => group.lines)
    expect(names(listed)).not.toContain('大阪メトロ中央線')
    expect(listed.every((line) => TOKYO_LINES.has(line.lineCd))).toBe(true)
  })

  it('検索したときは、選べない路線も出す（薄く出す印つき）', () => {
    const result = view({ allowed: TOKYO_LINES, query: '中央' })
    const groups = result.groups
    expect(groups.map((group) => group.company)).toEqual(['JR東日本', 'Osaka Metro'])
    expect(groups[1]?.disabled.has(OSAKA_CHUO.lineCd)).toBe(true)
    expect(groups[0]?.disabled.has(CHUO_RAPID.lineCd)).toBe(false)
  })

  it('当たる路線が無ければ、事業者も出さない', () => {
    expect(view({ query: 'ゆりかもめ' }).groups).toEqual([])
  })
})

describe('上限（全国の 601 本を一度に描かない）', () => {
  it('上限までを事業者の順のまま残し、出さなかった本数を数える', () => {
    const result = view({ max: 5 })
    const listed = result.groups.flatMap((group) => group.lines)
    expect(listed).toHaveLength(5)
    expect(result.hiddenCount).toBe(PICKER_LINES.length - 5)
    // JR東日本の 4 本 → 東京都交通局の 1 本目。
    expect(names(listed)).toEqual([
      '北陸新幹線',
      '森と水とロマンの鉄道',
      'JR山手線',
      'JR中央線(快速)',
      '都営新宿線',
    ])
  })

  it('上限ちょうどなら、出さなかった本数は 0', () => {
    expect(view({ max: PICKER_LINES.length }).hiddenCount).toBe(0)
  })

  it('選んだ路線は上限に数えない（選んだ路線が上限を食わない）', () => {
    const result = view({ max: 2, selected: [YAMANOTE.lineCd] })
    expect(result.selected).toHaveLength(1)
    expect(result.groups.flatMap((group) => group.lines)).toHaveLength(2)
  })
})

describe('検索の語', () => {
  it('全角・半角と大小を揃える（「ｊｒ」「OSAKA」でも当たる）', () => {
    expect(searchTokens('ｊｒ　山手')).toEqual(['jr', '山手'])
    expect(matchesSearch(OSAKA_CHUO, searchTokens('osaka'))).toBe(true)
    expect(matchesSearch(YAMANOTE, searchTokens('ＪＲ山手'))).toBe(true)
  })

  it('空白で区切った語は、どれも含む路線だけ（「JR 中央」→ JR の中央線だけ）', () => {
    const hits = PICKER_LINES.filter((line) => matchesSearch(line, searchTokens('JR 中央')))
    expect(names(hits)).toEqual(['JR中央線(快速)'])
  })

  it('事業者名・略称・S12 の会社名・正式名でも当たる', () => {
    expect(matchesSearch(SEIBU_SHINJUKU, searchTokens('西武鉄道'))).toBe(true)
    expect(matchesSearch(OSAKA_CHUO, searchTokens('大阪メトロ'))).toBe(true)
    expect(matchesSearch(GINZA, searchTokens('東京地下鉄'))).toBe(true)
    expect(matchesSearch(BIWAKO, searchTokens('東海道本線'))).toBe(true)
    expect(matchesSearch(BANETSU_WEST, searchTokens('磐越西線'))).toBe(true)
  })

  it('空・空白だけの検索は絞らない', () => {
    expect(searchTokens('   ')).toEqual([])
    expect(matchesTokens(['なんでも'], [])).toBe(true)
  })

  it('会社の無い路線（神戸高速）でも落ちない', () => {
    expect(matchesSearch(KOBE_KOSOKU, searchTokens('神戸高速'))).toBe(true)
  })
})

describe('正式名を添えるのは、検索が正式名で当たったときだけ', () => {
  it('「東海道本線」で出た「琵琶湖線」には正式名を添える', () => {
    expect(formalNameHint(BIWAKO, '東海道本線')).toBe('JR東海道本線(米原～京都)')
  })

  it('名前で当たったら添えない（「琵琶湖」）・検索していなければ添えない', () => {
    expect(formalNameHint(BIWAKO, '琵琶湖')).toBeNull()
    expect(formalNameHint(BIWAKO, '')).toBeNull()
  })

  it('法令上の名前（「高速電気軌道第4号線」）はふだん出さない', () => {
    expect(formalNameHint(OSAKA_CHUO, '中央')).toBeNull()
    expect(formalNameHint(OSAKA_CHUO, '')).toBeNull()
  })

  it('名前と正式名が同じ路線には添えない', () => {
    expect(formalNameHint(YAMANOTE, '山手線')).toBeNull()
  })
})

describe('ボタンの言い方とホバー', () => {
  it('選んだ路線の名前（空＝全路線・3 本以上は「先頭 他N件」）', () => {
    expect(lineButtonLabel([], PICKER_LINES)).toBe('全路線')
    expect(lineButtonLabel([YAMANOTE.lineCd], PICKER_LINES)).toBe('JR山手線')
    expect(lineButtonLabel([YAMANOTE.lineCd, FUKUTOSHIN.lineCd], PICKER_LINES)).toBe(
      'JR山手線・東京メトロ副都心線',
    )
    expect(lineButtonLabel([YAMANOTE.lineCd, FUKUTOSHIN.lineCd, GINZA.lineCd], PICKER_LINES)).toBe(
      'JR山手線 他2件',
    )
  })

  it('一覧の読み込み前は、コードを見せずに本数だけ言う', () => {
    expect(lineButtonLabel([YAMANOTE.lineCd, 28010], [])).toBe('路線 2 本')
  })

  it('ホバーは名前・正式名（違えば）・事業者と駅数・都道府県', () => {
    expect(lineTooltip(BIWAKO)).toBe(
      ['琵琶湖線', '正式名：JR東海道本線(米原～京都)', 'JR西日本・20 駅', '滋賀県・京都府'].join(
        '\n',
      ),
    )
    expect(lineTooltip(YAMANOTE)).toBe(['JR山手線', 'JR東日本・30 駅', '東京都'].join('\n'))
  })

  it('ホバーに出す都道府県は一覧の順（駅の多い順）のまま', () => {
    expect(lineTooltip(HOKURIKU).split('\n').at(-1)).toBe(HOKURIKU.prefectures.join('・'))
  })
})

describe('ポップオーバーは画面の中に収める', () => {
  it('はみ出さなければずらさない', () => {
    expect(popoverPlacement(16, 1280, 320)).toEqual({ offset_px: 0, width_px: 320 })
  })

  it('右にはみ出すぶんだけ左へずらす（携帯 390px・ボタンが x=200）', () => {
    // 右端の余白 8px：左端は 390 − 8 − 320 = 62。
    expect(popoverPlacement(200, 390, 320)).toEqual({ offset_px: -138, width_px: 320 })
  })

  it('画面より広ければ幅を縮め、左右の余白を残す（幅 300px の画面）', () => {
    expect(popoverPlacement(100, 300, 320)).toEqual({ offset_px: -92, width_px: 284 })
  })

  it('ボタンが画面の左の外にあっても、左の余白から始める', () => {
    expect(popoverPlacement(-20, 390, 320)).toEqual({ offset_px: 28, width_px: 320 })
  })

  it('境界：ちょうど右端に収まるときはずらさない', () => {
    expect(popoverPlacement(62, 390, 320)).toEqual({ offset_px: 0, width_px: 320 })
    expect(popoverPlacement(63, 390, 320)).toEqual({ offset_px: -1, width_px: 320 })
  })

  it('画面が余白より狭くても幅は負にならない', () => {
    expect(popoverPlacement(0, 10, 320).width_px).toBe(0)
  })
})
