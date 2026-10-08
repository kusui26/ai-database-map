/**
 * 路線（運行系統）の共通の条件 `lines` の、DB を使わない部分（261008 L2・docs/261001_fix_user_feedback_ui.md §6.8）。
 *
 * - 路線コードの解決：知らないコードは**黙って捨てずに**理由を返す（捨てると別の駅の集合で答えてしまう）
 * - 一覧の応答：表示名（路線区分）と出典をサーバが付ける（UI と AI が同じ言葉を使う）
 * - 題・おすすめの対象の言い方：路線は**名前で**出る（コードを人に見せない）
 * - 入口の検証：数でないコード・多すぎる指定は 400
 */

import { describe, expect, it } from 'vitest'
import { type LineRow } from '@/db/queries'
import {
  lineCdsQuerySchema,
  linesResponseSchema,
  rankingQuerySchema,
  recommendQuerySchema,
  type LineRef,
} from '@/shared/api'
import { LINE_SOURCE, MAX_LINES_PER_QUERY, lineTypeLabel } from '@/shared/constants'
import { linesResponse, matchLineCodes } from '@/domain/lines'
import { scopeLabel } from '@/domain/scope'
import { buildRanking } from '@/domain/ranking/presenter'
import { rankingPanel } from '@/domain/ranking/panel'
import { buildGrowth } from '@/domain/growth/presenter'
import { scatterPanel } from '@/domain/growth/panel'
import { buildRecommendInput } from '@/domain/recommend/request'
import { areaLabelJa } from '@/domain/recommend/labels'
import { datasetSelectorSchema } from '@/ai/dataset/token'

const YAMANOTE: LineRef = { lineCd: 11302, name: 'JR山手線' }
const FUKUTOSHIN: LineRef = { lineCd: 28010, name: '東京メトロ副都心線' }
const TOZAI: LineRef = { lineCd: 28004, name: '東京メトロ東西線' }

function lineRow(overrides: Partial<LineRow> = {}): LineRow {
  return {
    lineCd: 11302,
    name: 'JR山手線',
    formalName: 'JR山手線',
    companyName: 'JR東日本',
    companyShort: 'JR東日本',
    operator: '東日本旅客鉄道',
    color: '#80C241',
    colorName: '黄緑',
    lineType: 2,
    isLoop: true,
    stationCount: 30,
    prefectures: ['東京都'],
    source: '駅データ.jp 2024-04-26',
    ...overrides,
  }
}

describe('matchLineCodes：路線コード → 名前つきの参照', () => {
  it('指定の順で返し、重ねた指定は 1 回にする', () => {
    const result = matchLineCodes([28010, 11302, 28010], [YAMANOTE, FUKUTOSHIN])
    expect(result).toEqual({ ok: true, lines: [FUKUTOSHIN, YAMANOTE] })
  })

  it('知らないコードは黙って捨てずに理由を返す（どれが知らないかと、どこで調べるか）', () => {
    const result = matchLineCodes([11302, 99999, 88888], [YAMANOTE])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.messageJa).toContain('99999, 88888')
    expect(result.messageJa).toContain('/api/lines')
  })

  it('指定が無ければ空（＝絞らない）', () => {
    expect(matchLineCodes([], [])).toEqual({ ok: true, lines: [] })
  })
})

describe('linesResponse：一覧の応答（表示名と出典をサーバが付ける）', () => {
  it('路線区分の表示名・出典つき。契約（Zod）を満たす', () => {
    const response = linesResponse([
      lineRow(),
      lineRow({ lineCd: 99302, name: '都営浅草線', lineType: 3, isLoop: false }),
    ])
    expect(linesResponseSchema.parse(response)).toEqual(response)
    expect(response.source).toBe('駅データ.jp 2024-04-26')
    expect(response.sourceUrl).toBe(LINE_SOURCE.url)
    expect(response.lines.map((line) => line.lineTypeLabel)).toEqual(['一般', '地下鉄'])
  })

  it('線路の持ち主（S12 に自分の会社名が無い）は operator が null のまま', () => {
    const response = linesResponse([lineRow({ name: '神戸高速東西線', operator: null })])
    expect(response.lines[0]?.operator).toBeNull()
  })

  it('一覧が空でも出典の名前は返す', () => {
    expect(linesResponse([]).source).toBe(LINE_SOURCE.nameJa)
  })

  it('知らない路線区分は「その他」（落とさない）', () => {
    expect(lineTypeLabel(9)).toBe('その他')
    expect(lineTypeLabel(4)).toBe('路面電車')
  })
})

describe('題（scopeLabel）：路線は名前で、法令上の路線より先に出る', () => {
  const empty = { prefectures: [], operators: [], routes: [], routeTypes: [] }

  it('路線だけ → 「全国・JR山手線」', () => {
    expect(scopeLabel({ ...empty, lines: [YAMANOTE] })).toBe('全国・JR山手線')
  })

  it('都道府県 → 会社 → 路線（運行系統）→ 法令上の路線 → 種別 の順', () => {
    expect(
      scopeLabel({
        prefectures: ['東京都'],
        operators: ['東京地下鉄'],
        lines: [TOZAI],
        routes: ['東西線'],
        routeTypes: [3],
      }),
    ).toBe('東京都・東京地下鉄・東京メトロ東西線・東西線・公営鉄道')
  })

  it('3 本以上は「先頭 他N件」（ほかの条件と同じ畳み方）', () => {
    expect(scopeLabel({ ...empty, lines: [YAMANOTE, FUKUTOSHIN, TOZAI] })).toBe(
      '全国・JR山手線 他2件',
    )
  })

  it('ランキングの応答と題に路線が名前で載る', () => {
    const response = buildRanking('pop_2020_1km', [], 'desc', [], 0, 0, { lines: [YAMANOTE] })
    expect(response.lines).toEqual([YAMANOTE])
    expect(rankingPanel(response).title).toBe('人口（2020年・1km圏）（全国・JR山手線・上位）')
  })

  it('散布の応答と題にも同じく載る', () => {
    const response = buildGrowth([], 'pop_gr_2020_2015_1km', 'lp_gr_2026_2021_1km', {
      lines: [FUKUTOSHIN],
    })
    expect(response.lines).toEqual([FUKUTOSHIN])
    expect(scatterPanel(response).title).toContain('（全国・東京メトロ副都心線）')
  })

  it('路線を指定しなければ応答は空配列（以前の応答と同じ形）', () => {
    expect(buildRanking('pop_2020_1km', [], 'desc', [], 0, 0).lines).toEqual([])
  })
})

describe('おすすめ：路線だけでも「絞り込み」になり、対象の言い方に名前で出る', () => {
  it('路線だけの指定でも通り、候補の条件に路線コードが入る', () => {
    const built = buildRecommendInput(recommendQuerySchema.parse({ lines: [11302] }), [YAMANOTE])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.filter.lines).toEqual([11302])
    expect(built.input.lines).toEqual([YAMANOTE])
  })

  it('対象の言い方：「全国（JR山手線）」「横浜市（東京メトロ副都心線・東横線）」', () => {
    expect(areaLabelJa({ lines: [11302] }, [YAMANOTE])).toBe('全国（JR山手線）')
    expect(
      areaLabelJa({ municipality: '横浜市', routes: ['東横線'], lines: [28010] }, [FUKUTOSHIN]),
    ).toBe('横浜市（東京メトロ副都心線・東横線）')
  })

  it('路線を指定しなければ filter に lines は付かない（以前と同じ条件）', () => {
    const built = buildRecommendInput(recommendQuerySchema.parse({ municipality: '横浜市' }))
    expect(built.ok && 'lines' in built.input.filter).toBe(false)
  })
})

describe('入口の検証：数でない・多すぎる路線コードは 400', () => {
  it('数でないコードは通さない（黙って捨てない）', () => {
    const parsed = rankingQuerySchema.safeParse({
      metric: 'pop_2020_1km',
      lines: [Number('山手線')],
    })
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain('/api/lines')
  })

  it('0・負の数・小数は通さない', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(lineCdsQuerySchema.safeParse([bad]).success).toBe(false)
    }
  })

  it(`${MAX_LINES_PER_QUERY} 本までは通り、それを超えると通さない`, () => {
    const codes = Array.from({ length: MAX_LINES_PER_QUERY + 1 }, (_, i) => i + 1)
    expect(lineCdsQuerySchema.safeParse(codes.slice(0, MAX_LINES_PER_QUERY)).success).toBe(true)
    expect(lineCdsQuerySchema.safeParse(codes).success).toBe(false)
  })

  it('データセットの署名つき条件にも路線コードを入れられる（L3 で使う・古いトークンは lines 無しのまま）', () => {
    expect(datasetSelectorSchema.parse({ lines: [11302] }).lines).toEqual([11302])
    expect(datasetSelectorSchema.parse({ prefectures: ['東京都'] }).lines).toBeUndefined()
  })
})
