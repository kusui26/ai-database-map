/**
 * 会社の表示名（2026-10-08 L4・`src/domain/operators.ts`・docs/261001_fix_user_feedback_ui.md §6.8.7）。
 *
 * 会社の**鍵**は国土数値情報（S12）の会社名（「東日本旅客鉄道」「東京地下鉄」「東京都」）のまま、**人に見せる名前**を
 * 駅データ.jp の事業者名（「JR東日本」「東京メトロ」「東京都交通局」）にする。都営が「東京都」だと、図の題
 * 「（全国・東京都・上位）」が都道府県と紛れていた。
 *
 * 見ること：
 * - 対応は路線の一覧から作る（線路の持ち主＝会社の無い路線は数えない・路線の無い会社は S12 の名前のまま）
 * - `/api/operators` は `name`（鍵）と `label`（表示名）を返す
 * - ランキング・散布の応答は `operators`（鍵）と `operatorLabels`（表示名）を返し、題は表示名
 * - おすすめの対象の言い方も表示名
 * - 対応は 1 時間持ち、読めなかったときは持たない（次の呼び出しで読み直す）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type LineRow, type OperatorRow, type RankRow, type ScatterRow } from '@/db/queries'
import { growthResponseSchema, operatorsResponseSchema, rankingResponseSchema } from '@/shared/api'

const db = vi.hoisted(() => ({
  lineNames: vi.fn(),
  operatorNames: vi.fn(),
  rankByColumn: vi.fn(),
  scatterPoints: vi.fn(),
  linesByCodes: vi.fn(),
}))

vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const {
  clearOperatorLabelCache,
  labelsOfOperators,
  loadOperatorLabels,
  operatorLabelMap,
  operatorLabelOf,
  operatorsResponse,
} = await import('@/domain/operators')
const { displayOperators, scopeLabel } = await import('@/domain/scope')
const { buildRanking } = await import('@/domain/ranking/presenter')
const { buildGrowth } = await import('@/domain/growth/presenter')
const { rankingPanel } = await import('@/domain/ranking/panel')
const { scatterPanel } = await import('@/domain/growth/panel')
const { areaLabelJa } = await import('@/domain/recommend/labels')
const { GET: getOperators } = await import('@/app/api/operators/route')
const { GET: getRanking } = await import('@/app/api/ranking/route')
const { GET: getGrowth } = await import('@/app/api/growth/route')
const { resetRateLimitStore } = await import('@/ai/rate-limit')

type LabelSource = Pick<LineRow, 'operator' | 'companyName' | 'stationCount'>

function lineRow(
  source: LabelSource & { readonly lineCd: number; readonly name: string },
): LineRow {
  return {
    formalName: source.name,
    companyShort: source.companyName,
    color: null,
    colorName: null,
    lineType: 2,
    isLoop: false,
    prefectures: ['東京都'],
    source: '駅データ.jp 2024-04-26',
    ...source,
  }
}

/** 本物の一覧の縮図：JR東日本・東京メトロ・都営・神戸高速（会社なし）。 */
const LINE_ROWS: LineRow[] = [
  lineRow({
    lineCd: 11302,
    name: 'JR山手線',
    operator: '東日本旅客鉄道',
    companyName: 'JR東日本',
    stationCount: 30,
  }),
  lineRow({
    lineCd: 28010,
    name: '東京メトロ副都心線',
    operator: '東京地下鉄',
    companyName: '東京メトロ',
    stationCount: 16,
  }),
  lineRow({
    lineCd: 99304,
    name: '都営新宿線',
    operator: '東京都',
    companyName: '東京都交通局',
    stationCount: 21,
  }),
  lineRow({
    lineCd: 99630,
    name: '神戸高速東西線',
    operator: null,
    companyName: '神戸高速鉄道',
    stationCount: 9,
  }),
]

const OPERATOR_ROWS: OperatorRow[] = [
  { name: '東日本旅客鉄道', stationCount: 1600, prefectures: ['東京都', '埼玉県'] },
  { name: '東京地下鉄', stationCount: 180, prefectures: ['東京都'] },
  { name: '東京都', stationCount: 140, prefectures: ['東京都', '千葉県'] },
  { name: '箱根登山鉄道（ケーブル）', stationCount: 4, prefectures: ['神奈川県'] },
]

const RANK_ROWS: RankRow[] = [
  { grp: '新宿#0', stationName: '新宿', prefecture: '東京都', value: 1, flagValue: 0, rank: 1 },
]
const SCATTER_ROWS: ScatterRow[] = [
  { grp: '渋谷#0', stationName: '渋谷', x: 5, y: -3, xFlag: 0, yFlag: 0 },
  { grp: '池袋#0', stationName: '池袋', x: 8, y: -6, xFlag: 0, yFlag: 0 },
]

function request(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { 'x-real-ip': '10.0.0.7' } })
}

beforeEach(() => {
  clearOperatorLabelCache()
  resetRateLimitStore()
  db.lineNames.mockResolvedValue(LINE_ROWS)
  db.operatorNames.mockResolvedValue(OPERATOR_ROWS)
  db.rankByColumn.mockResolvedValue({ rows: RANK_ROWS, total: 1 })
  db.scatterPoints.mockResolvedValue(SCATTER_ROWS)
  db.linesByCodes.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('operatorLabelMap：路線の一覧 → 会社の表示名', () => {
  it('S12 の会社名 → 駅データ.jp の事業者名', () => {
    const labels = operatorLabelMap(LINE_ROWS)
    expect(labels.get('東日本旅客鉄道')).toBe('JR東日本')
    expect(labels.get('東京地下鉄')).toBe('東京メトロ')
    expect(labels.get('東京都')).toBe('東京都交通局')
  })

  it('会社の無い路線（線路の持ち主）は数えない', () => {
    expect([...operatorLabelMap(LINE_ROWS).values()]).not.toContain('神戸高速鉄道')
  })

  it('1 つの会社に事業者名が 2 つ以上なら、駅の多いほう（同じなら名前の順で決まる）', () => {
    const rows: LabelSource[] = [
      { operator: 'X鉄道', companyName: '旧名', stationCount: 3 },
      { operator: 'X鉄道', companyName: '新名', stationCount: 5 },
      { operator: 'Y鉄道', companyName: 'い', stationCount: 4 },
      { operator: 'Y鉄道', companyName: 'あ', stationCount: 4 },
    ]
    const labels = operatorLabelMap(rows)
    expect(labels.get('X鉄道')).toBe('新名')
    expect(labels.get('Y鉄道')).toBe('あ')
  })

  it('対応の無い会社（ケーブルカーなど・路線の無い会社）は S12 の名前のまま', () => {
    expect(operatorLabelOf('箱根登山鉄道（ケーブル）', operatorLabelMap(LINE_ROWS))).toBe(
      '箱根登山鉄道（ケーブル）',
    )
  })

  it('一覧が空でも落ちない（すべて S12 の名前）', () => {
    expect(operatorLabelOf('東京地下鉄', operatorLabelMap([]))).toBe('東京地下鉄')
  })
})

describe('GET /api/operators：鍵（name）と表示名（label）', () => {
  it('駅数の順のまま、name と label を返す（契約を満たす）', async () => {
    const response = await getOperators()
    expect(response.status).toBe(200)
    const parsed = operatorsResponseSchema.parse(await response.json())
    expect(parsed.operators.map((operator) => [operator.name, operator.label])).toEqual([
      ['東日本旅客鉄道', 'JR東日本'],
      ['東京地下鉄', '東京メトロ'],
      ['東京都', '東京都交通局'],
      ['箱根登山鉄道（ケーブル）', '箱根登山鉄道（ケーブル）'],
    ])
    expect(parsed.operators[0]?.prefectures).toEqual(['東京都', '埼玉県'])
  })

  it('operatorsResponse は一覧の行をそのまま写す（都道府県は複製）', () => {
    const rows: OperatorRow[] = [{ name: '東京地下鉄', stationCount: 1, prefectures: ['東京都'] }]
    const response = operatorsResponse(rows, operatorLabelMap(LINE_ROWS))
    expect(response.operators).toEqual([
      { name: '東京地下鉄', label: '東京メトロ', stationCount: 1, prefectures: ['東京都'] },
    ])
    expect(response.operators[0]?.prefectures).not.toBe(rows[0]?.prefectures)
  })

  it('label の無い古い応答（1 日キャッシュ）も読める', () => {
    const old = { operators: [{ name: '東京地下鉄', stationCount: 1, prefectures: [] }] }
    expect(operatorsResponseSchema.parse(old).operators[0]?.label).toBeUndefined()
  })
})

describe('図の題：会社は表示名', () => {
  it('都営は「東京都交通局」（都道府県の東京都と紛れない）', () => {
    const scope = {
      prefectures: [],
      operators: ['東京都'],
      operatorLabels: ['東京都交通局'],
      routes: [],
      routeTypes: [],
    }
    expect(scopeLabel(scope)).toBe('全国・東京都交通局')
  })

  it('表示名が無い・数が合わないときは S12 の名前のまま（古い応答で題が壊れない）', () => {
    expect(displayOperators(['東京地下鉄'], undefined)).toEqual(['東京地下鉄'])
    expect(displayOperators(['東京地下鉄', '東京都'], ['東京メトロ'])).toEqual([
      '東京地下鉄',
      '東京都',
    ])
    expect(displayOperators([], [])).toEqual([])
  })

  it('ランキングの応答：operators は鍵、operatorLabels は表示名、題は表示名', () => {
    const response = buildRanking('pop_2020_1km', [], 'desc', [], 0, 0, {
      operators: ['東京地下鉄', '東京都'],
      operatorLabels: ['東京メトロ', '東京都交通局'],
    })
    expect(rankingResponseSchema.parse(response).operators).toEqual(['東京地下鉄', '東京都'])
    expect(response.operatorLabels).toEqual(['東京メトロ', '東京都交通局'])
    expect(rankingPanel(response).title).toContain('（全国・東京メトロ・東京都交通局・上位）')
  })

  it('散布の応答も同じ（表示名を渡さなければ S12 の名前で埋める）', () => {
    const response = buildGrowth(SCATTER_ROWS, 'pop_2020_1km', 'pop_gr_2020_2015_1km', {
      operators: ['東京地下鉄'],
    })
    expect(growthResponseSchema.parse(response).operatorLabels).toEqual(['東京地下鉄'])
    const labelled = buildGrowth(SCATTER_ROWS, 'pop_2020_1km', 'pop_gr_2020_2015_1km', {
      operators: ['東京地下鉄'],
      operatorLabels: ['東京メトロ'],
    })
    expect(scatterPanel(labelled).title).toContain('東京メトロ')
  })

  it('おすすめの対象の言い方も表示名（「東京都（東京都交通局）」）', () => {
    expect(
      areaLabelJa({ prefectures: ['東京都'], operators: ['東京都'] }, [], ['東京都交通局']),
    ).toBe('東京都（東京都交通局）')
  })

  it('古い応答（operatorLabels 無し）は空配列として読め、題は S12 の名前で出る', () => {
    const response = buildRanking('pop_2020_1km', [], 'desc', [], 0, 0, {
      operators: ['東京地下鉄'],
    })
    const { operatorLabels: _dropped, ...old } = response
    const parsed = rankingResponseSchema.parse(old)
    expect(parsed.operatorLabels).toEqual([])
    expect(rankingPanel(parsed).title).toContain('東京地下鉄')
  })
})

describe('GET /api/ranking・/api/growth：応答に表示名', () => {
  it('ランキング：SQL には鍵、応答に表示名', async () => {
    const response = await getRanking(
      request('/api/ranking?metric=pop_2020_1km&operators=東京地下鉄,東京都'),
    )
    expect(response.status).toBe(200)
    expect(db.rankByColumn.mock.calls[0]?.[6]).toEqual(['東京地下鉄', '東京都'])
    const parsed = rankingResponseSchema.parse(await response.json())
    expect(parsed.operatorLabels).toEqual(['東京メトロ', '東京都交通局'])
  })

  it('散布：応答に表示名', async () => {
    const response = await getGrowth(
      request('/api/growth?x=pop_2020_1km&y=pop_gr_2020_2015_1km&operators=東日本旅客鉄道'),
    )
    expect(response.status).toBe(200)
    const parsed = growthResponseSchema.parse(await response.json())
    expect(parsed.operators).toEqual(['東日本旅客鉄道'])
    expect(parsed.operatorLabels).toEqual(['JR東日本'])
  })

  it('会社を指定しなければ、表示名のために一覧を読まない', async () => {
    const response = await getRanking(request('/api/ranking?metric=pop_2020_1km'))
    expect(response.status).toBe(200)
    expect(db.lineNames).not.toHaveBeenCalled()
  })
})

describe('対応の持ち方', () => {
  it('1 時間は読み直さない・過ぎたら読み直す', async () => {
    const start_ms = 1_000_000
    await loadOperatorLabels(start_ms)
    await loadOperatorLabels(start_ms + 59 * 60 * 1000)
    expect(db.lineNames).toHaveBeenCalledTimes(1)
    await loadOperatorLabels(start_ms + 60 * 60 * 1000)
    expect(db.lineNames).toHaveBeenCalledTimes(2)
  })

  it('読めなかったときは持たない（次の呼び出しで読み直す）', async () => {
    db.lineNames.mockRejectedValueOnce(new Error('DB に届かない'))
    await expect(loadOperatorLabels(5_000)).rejects.toThrow('DB に届かない')
    const labels = await loadOperatorLabels(5_001)
    expect(labels.get('東京地下鉄')).toBe('東京メトロ')
    expect(db.lineNames).toHaveBeenCalledTimes(2)
  })

  it('labelsOfOperators：同じ順で表示名を返し、空なら一覧を読まない', async () => {
    expect(await labelsOfOperators([])).toEqual([])
    expect(db.lineNames).not.toHaveBeenCalled()
    expect(await labelsOfOperators(['東京都', '東日本旅客鉄道', '未知の会社'])).toEqual([
      '東京都交通局',
      'JR東日本',
      '未知の会社',
    ])
  })
})
