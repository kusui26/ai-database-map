/**
 * 駅の色分けの**描く印と言葉**（`src/domain/style/coloring.ts`・`rows.ts`・2026-10-11 B5c・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.6）。Web 地図（MapLibre）と地図レポート（Leaflet）が同じ規則で描く。
 *
 * 見ること：
 * - 応答の駅の行：段・元の数・書いた値（増減は符号つき）。並びは入力のまま
 * - 印：段の色と名前／⚠ は灰色の「参考値（⚠）」／色分けしなかったら**色を付けず強調**（色分けしたように見せない）／
 *   凡例に無い段は参考値に倒す（黙って消さない）
 * - ホバーの文・凡例の「どこの何駅か」（値の無い駅も数える・2 つ以上は合わせて 1 つの物差し）・注意（エリア全体の値ではない）
 * - エリアの名前（沿線は幅を書かない）・同じ条件か（URL を書き直さない）
 */

import { describe, expect, it } from 'vitest'
import { type StationMetricValue } from '@/db/queries'
import { type ResolvedArea } from '@/domain/area-summary/resolve'
import { classifyStations, type StyleInput } from '@/domain/style/classify'
import {
  coloredStationDetailJa,
  coloredStations,
  coloringNotesJa,
  coloringScopeJa,
  coloringStationCount,
  isColored,
  sameColoring,
} from '@/domain/style/coloring'
import { DIVERGING_COLORS, FLAGGED_COLOR, SEQUENTIAL_COLORS } from '@/domain/style/palette'
import { classRows, coloringAreaLabelJa, stationValueJa } from '@/domain/style/rows'
import { stationClassesResponseSchema, type StationClassesResponse } from '@/shared/area-summary'
import { requireEntry, type CatalogEntry } from '@/shared/catalog'
import { ACCENT_COLOR } from '@/shared/constants'
import {
  KAWASAKI_POP_GR,
  TAKEBASHI,
  TOYOKO_ROWS,
  YOKOHAMA_LP_MED,
  YOKOHAMA_POP_GR,
  YOKOHAMA_ROWS,
} from './fixtures/area-summary'

const POP = requireEntry('pop_2020_1km')
const POP_GR = requireEntry('pop_gr_2020_2015_1km')
const LP_MED = requireEntry('lp_med_2026_1km')
const YOKOHAMA = 'muni:14100'
const YOKOHAMA_LABEL = '神奈川県横浜市'

function inputsOf(values: readonly StationMetricValue[]): StyleInput[] {
  return values.flatMap((each) =>
    each.value === null ? [] : [{ grp: each.grp, value: each.value, flagged: each.flagged }],
  )
}

/** 共通 API と同じ組み立て（`loadStationClasses`）で応答を作り、応答の Zod を通す。 */
function responseOf(
  values: readonly StationMetricValue[],
  entry: CatalogEntry,
  areas: readonly [string, string][] = [[YOKOHAMA, YOKOHAMA_LABEL]],
): StationClassesResponse {
  const inputs = inputsOf(values)
  const { legend, assignments } = classifyStations(inputs, entry, values.length)
  return stationClassesResponseSchema.parse({
    areas: areas.map(([ref]) => ref),
    areaLabelsJa: areas.map(([, label]) => label),
    legend,
    stations: classRows(inputs, assignments, entry),
  })
}

const POP_GR_RESPONSE = responseOf(YOKOHAMA_POP_GR, POP_GR)
const LP_RESPONSE = responseOf(YOKOHAMA_LP_MED, LP_MED)
/** 値のある駅が 3 つだけ（色分けしない）。 */
const FEW_RESPONSE = responseOf(YOKOHAMA_POP_GR.slice(0, 3), POP_GR)

function stationOf(response: StationClassesResponse, grp: string) {
  const found = coloredStations(response).find((station) => station.grp === grp)
  if (found === undefined) throw new Error(`${grp} がありません`)
  return found
}

describe('駅の値の書き方（指標のカタログの書式と単位）', () => {
  it('水準は 3 桁区切りと単位、増減は符号つき', () => {
    expect(stationValueJa(31640, POP)).toBe('31,640 人')
    expect(stationValueJa(7.2, POP_GR)).toBe('+7.2%')
    expect(stationValueJa(-1.6, POP_GR)).toBe('-1.6%')
    expect(stationValueJa(1735000, LP_MED)).toBe('1,735,000 円/㎡')
  })
})

describe('応答の駅の行（classRows）', () => {
  it('値のある駅だけ（横浜市の 137 駅のうち 136）・並びは入力のまま', () => {
    expect(POP_GR_RESPONSE.stations).toHaveLength(136)
    expect(POP_GR_RESPONSE.stations.map((each) => each.grp)).toEqual(
      inputsOf(YOKOHAMA_POP_GR).map((each) => each.grp),
    )
  })

  it('段は境目（−5・−1・+1・+5%）で決まり、元の数と書いた値を持つ', () => {
    const row = (grp: string) => POP_GR_RESPONSE.stations.find((each) => each.grp === grp)
    expect(row('横浜#0')).toEqual({ grp: '横浜#0', cls: 4, value: 5.3, valueJa: '+5.3%' })
    expect(row('新羽#0')).toEqual({ grp: '新羽#0', cls: 2, value: 0.1, valueJa: '+0.1%' })
    expect(row('産業振興センター#0')?.cls).toBe(0)
    expect(row('並木中央#0')?.cls).toBe(1)
  })

  it('⚠ の駅は段を持たない（null）', () => {
    const flagged = new Set(YOKOHAMA_LP_MED.filter((each) => each.flagged).map((each) => each.grp))
    const rows = LP_RESPONSE.stations.filter((each) => flagged.has(each.grp))
    expect(rows).toHaveLength(40)
    expect(rows.every((each) => each.cls === null)).toBe(true)
  })
})

describe('描く印（coloredStations）', () => {
  it('段のある駅は段の色と名前（増減は青〜赤・真ん中は灰色の「ほぼ横ばい」）', () => {
    expect(stationOf(POP_GR_RESPONSE, '横浜#0')).toEqual({
      grp: '横浜#0',
      kind: 'class',
      color: DIVERGING_COLORS[4],
      classLabelJa: '+5%以上',
      valueJa: '+5.3%',
    })
    expect(stationOf(POP_GR_RESPONSE, '新羽#0')).toMatchObject({
      color: DIVERGING_COLORS[2],
      classLabelJa: '-1〜+1%（ほぼ横ばい）',
    })
    expect(stationOf(POP_GR_RESPONSE, '産業振興センター#0').color).toBe(DIVERGING_COLORS[0])
  })

  it('水準は淡い→濃い（いちばん大きい段がいちばん濃い）', () => {
    expect(stationOf(LP_RESPONSE, '神奈川#0')).toMatchObject({
      kind: 'class',
      color: SEQUENTIAL_COLORS[4],
      valueJa: '2,020,000 円/㎡',
    })
  })

  it('⚠ は灰色の「参考値（⚠）」', () => {
    expect(stationOf(LP_RESPONSE, 'いずみ野#0')).toEqual({
      grp: 'いずみ野#0',
      kind: 'flagged',
      color: FLAGGED_COLOR,
      classLabelJa: '参考値（⚠）',
      valueJa: '282,000 円/㎡',
    })
  })

  it('色分けしなかった（値のある駅が 3）なら、色を付けずに強調（段の名前は無い）', () => {
    expect(FEW_RESPONSE.legend.reasonJa).not.toBeNull()
    const stations = coloredStations(FEW_RESPONSE)
    expect(stations).toHaveLength(3)
    expect(stations.every((each) => each.kind === 'plain')).toBe(true)
    expect(stations.every((each) => each.color === ACCENT_COLOR)).toBe(true)
    expect(stations.every((each) => each.classLabelJa === null)).toBe(true)
  })

  it('凡例に無い段（壊れた応答）は参考値の灰色に倒す（黙って消さない）', () => {
    const broken: StationClassesResponse = {
      ...POP_GR_RESPONSE,
      stations: [{ grp: '横浜#0', cls: 9, value: 5.3, valueJa: '+5.3%' }],
    }
    expect(coloredStations(broken)).toEqual([
      {
        grp: '横浜#0',
        kind: 'flagged',
        color: FLAGGED_COLOR,
        classLabelJa: '参考値（⚠）',
        valueJa: '+5.3%',
      },
    ])
  })

  it('並びは応答のまま・数も同じ', () => {
    expect(coloredStations(LP_RESPONSE).map((each) => each.grp)).toEqual(
      LP_RESPONSE.stations.map((each) => each.grp),
    )
  })
})

describe('ホバーの文', () => {
  it('「値・段」。色分けしなかった駅は値だけ', () => {
    expect(coloredStationDetailJa(stationOf(POP_GR_RESPONSE, '横浜#0'))).toBe('+5.3%・+5%以上')
    expect(coloredStationDetailJa(stationOf(LP_RESPONSE, 'いずみ野#0'))).toBe(
      '282,000 円/㎡・参考値（⚠）',
    )
    const plain = coloredStations(FEW_RESPONSE)[0]
    expect(plain === undefined ? '' : coloredStationDetailJa(plain)).toBe(plain?.valueJa)
  })
})

describe('凡例の言葉（どこの何駅か・注意）', () => {
  it('駅の数は値の無い駅も数える（横浜市は 136＋1＝137 駅）', () => {
    expect(coloringStationCount(POP_GR_RESPONSE)).toBe(137)
    expect(coloringStationCount(LP_RESPONSE)).toBe(137)
    expect(coloringScopeJa(POP_GR_RESPONSE)).toBe('神奈川県横浜市の 137 駅')
  })

  it('2 つ以上のエリアは「合わせて 1 つの物差し」', () => {
    const both = responseOf([...YOKOHAMA_POP_GR, ...KAWASAKI_POP_GR], POP_GR, [
      [YOKOHAMA, YOKOHAMA_LABEL],
      ['muni:14130', '神奈川県川崎市'],
    ])
    expect(coloringScopeJa(both)).toBe(
      '神奈川県横浜市・神奈川県川崎市の 190 駅（合わせて 1 つの物差し）',
    )
  })

  it('色分けしたら：駅ごとの値でエリア全体の値ではない・色の意味・値の無い駅', () => {
    expect(coloringNotesJa(POP_GR_RESPONSE)).toEqual([
      '色は駅ごとの値（人口増減率（2015→2020年・1km圏））を、このエリアの駅どうしで比べて分けたもの。エリア全体の値ではない。',
      POP_GR_RESPONSE.legend.meaningJa,
      '値の無い 1 駅は描いていない。',
    ])
  })

  it('色分けしなかったら：理由を先頭に、強調して出していること', () => {
    expect(isColored(FEW_RESPONSE.legend)).toBe(false)
    expect(coloringNotesJa(FEW_RESPONSE)).toEqual([
      FEW_RESPONSE.legend.reasonJa,
      '駅は色を付けずに強調して出している。',
    ])
  })

  it('色分けしたか（段があり、理由が無い）', () => {
    expect(isColored(POP_GR_RESPONSE.legend)).toBe(true)
    expect(isColored(LP_RESPONSE.legend)).toBe(true)
  })
})

describe('エリアの名前（凡例の「どこの駅か」）', () => {
  const yokohama = YOKOHAMA_ROWS[0]
  const toyoko = TOYOKO_ROWS[0]

  it.each<[string, ResolvedArea | null, string]>([
    [
      '行政区域は題の言い方',
      yokohama === undefined ? null : { type: 'admin', ref: YOKOHAMA, row: yokohama, children: [] },
      '神奈川県横浜市',
    ],
    [
      '沿線は路線の名前（駅の集合は幅によらないので幅を書かない）',
      toyoko === undefined ? null : { type: 'line', ref: 'line:26001', row: toyoko },
      '東急東横線の沿線',
    ],
    [
      '駅から N m は起点と距離',
      { type: 'near', ref: 'near:竹橋#0@5000', origin: TAKEBASHI, withinM: 5000 },
      '竹橋から 5km',
    ],
    [
      '1km 未満は m',
      { type: 'near', ref: 'near:竹橋#0@500', origin: TAKEBASHI, withinM: 500 },
      '竹橋から 500m',
    ],
    [
      '範囲',
      {
        type: 'bbox',
        ref: 'bbox:139.55,35.4,139.72,35.53',
        bbox: { west: 139.55, south: 35.4, east: 139.72, north: 35.53 },
      },
      '地図の範囲',
    ],
  ])('%s', (_label, area, expected) => {
    expect(area).not.toBeNull()
    if (area !== null) expect(coloringAreaLabelJa(area)).toBe(expected)
  })
})

describe('同じ条件か（同じ条件を URL に書き直さない）', () => {
  const pop = { metricKey: 'pop_2020_1km', areas: ['muni:14100', 'muni:14130'] }

  it.each([
    ['どちらも無し', null, null, true],
    ['片方だけ無し', pop, null, false],
    ['指標とエリアの並びが同じ', pop, { ...pop, areas: [...pop.areas] }, true],
    ['指標が違う', pop, { ...pop, metricKey: 'pop_2015_1km' }, false],
    ['エリアの並びが違う', pop, { ...pop, areas: ['muni:14130', 'muni:14100'] }, false],
    ['エリアの数が違う', pop, { ...pop, areas: ['muni:14100'] }, false],
  ])('%s', (_label, a, b, expected) => {
    expect(sameColoring(a, b)).toBe(expected)
    expect(sameColoring(b, a)).toBe(expected)
  })
})
