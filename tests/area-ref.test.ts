/**
 * エリアの文字列（`src/shared/area-ref.ts`）と、その並びの読み方・駅の絞り込みへの写し方（`src/domain/area-summary/refs.ts`）
 * ——2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.3。
 *
 * 見ること：
 * - 6 つの書き方が往復する（読んで書くと正規の形・範囲の数は桁の 0 を落とす）
 * - 壊れた形は**直し方つき**の理由で断る（都道府県 00・48、5 桁でない市区町村、幅が 500/1000/2000 でない沿線、
 *   100 m 未満・100 km 超の距離、西＞東の範囲、知らない頭——「constructor:」のような既定のプロパティ名も）
 * - 並び：0 個・5 個・同じエリア 2 度（書き方が違っても正規の形で同じなら同じ）を断る
 * - 駅の絞り込み：政令市は名前の前方一致、東京 23 区は区のコードの頭 3 桁、区・市町村は 5 桁、都道府県は名前、全国は絞らない
 */

import { describe, expect, it } from 'vitest'
import {
  AREA_REF_FORMATS_JA,
  formatAreaRef,
  LINE_WIDTHS_M,
  MAX_AREAS,
  parseAreaRef,
  type AreaRef,
} from '@/shared/area-ref'
import { NEAR_MAX_RADIUS_M, NEAR_MIN_RADIUS_M } from '@/shared/constants'
import { adminStationFilter, areaKeyOf, parseAreaRefs } from '@/domain/area-summary/refs'

function refOf(text: string): AreaRef {
  const parsed = parseAreaRef(text)
  if (!parsed.ok) throw new Error(parsed.messageJa)
  return parsed.ref
}

function reasonOf(text: string): string {
  const parsed = parseAreaRef(text)
  if (parsed.ok) throw new Error(`読めてしまった: ${text}`)
  return parsed.messageJa
}

describe('エリアの文字列を読む・書く', () => {
  it.each([
    ['jp', { type: 'country' }],
    ['pref:14', { type: 'prefecture', code: '14' }],
    ['pref:01', { type: 'prefecture', code: '01' }],
    ['pref:47', { type: 'prefecture', code: '47' }],
    ['muni:14100', { type: 'municipality', code: '14100' }],
    ['muni:13100', { type: 'municipality', code: '13100' }],
    ['line:26001@1000', { type: 'line', lineCd: 26001, widthM: 1000 }],
    ['line:26001', { type: 'line', lineCd: 26001, widthM: null }],
    ['near:竹橋#0@5000', { type: 'near', grp: '竹橋#0', withinM: 5000 }],
    [
      'bbox:139.55,35.4,139.72,35.53',
      { type: 'bbox', bbox: { west: 139.55, south: 35.4, east: 139.72, north: 35.53 } },
    ],
  ])('%s', (text, expected) => {
    expect(refOf(text)).toEqual(expected)
    expect(formatAreaRef(refOf(text))).toBe(text)
  })

  it('前後の空白は落とし、範囲の数は正規の形（35.40 → 35.4）で書く', () => {
    expect(formatAreaRef(refOf('  muni:14100 '))).toBe('muni:14100')
    expect(formatAreaRef(refOf('bbox:139.55, 35.40 ,139.72,35.53'))).toBe(
      'bbox:139.55,35.4,139.72,35.53',
    )
  })

  it('沿線の幅は 3 つ（500・1000・2000 m）すべて読める', () => {
    expect(LINE_WIDTHS_M.map((width) => refOf(`line:11302@${width}`))).toEqual(
      LINE_WIDTHS_M.map((widthM) => ({ type: 'line', lineCd: 11302, widthM })),
    )
  })

  it('駅から N m は境目（100 m・100 km）を含み、grp に「#」があっても最後の「@」で分ける', () => {
    expect(refOf(`near:日吉#1@${NEAR_MIN_RADIUS_M}`)).toEqual({
      type: 'near',
      grp: '日吉#1',
      withinM: NEAR_MIN_RADIUS_M,
    })
    expect(refOf(`near:日吉#1@${NEAR_MAX_RADIUS_M}`)).toMatchObject({ withinM: NEAR_MAX_RADIUS_M })
  })

  it.each([
    ['pref:00', '都道府県は 01〜47 の 2 桁'],
    ['pref:48', '都道府県は 01〜47 の 2 桁'],
    ['pref:1', '都道府県は 01〜47 の 2 桁'],
    ['muni:1410', '市区町村は JIS の 5 桁'],
    ['muni:141000', '市区町村は JIS の 5 桁'],
    ['muni:yokoh', '市区町村は JIS の 5 桁'],
    ['line:abc@1000', '路線コードは正の整数'],
    ['line:026001@1000', '路線コードは正の整数'],
    ['line:26001@1000@2000', '路線コードは正の整数'],
    ['line:26001@1500', '沿線の幅は 500・1000・2000 m のどれか'],
    ['line:26001@', '沿線の幅は 500・1000・2000 m のどれか'],
    ['near:竹橋#0', '起点の駅の grp＠m'],
    ['near:@5000', '起点の駅の grp＠m'],
    ['near:竹橋#0@5km', '起点の駅の grp＠m'],
    [`near:竹橋#0@${NEAR_MIN_RADIUS_M - 1}`, '距離は 100〜100000 m'],
    [`near:竹橋#0@${NEAR_MAX_RADIUS_M + 1}`, '距離は 100〜100000 m'],
    ['bbox:139.72,35.40,139.55,35.53', '範囲は「西,南,東,北」の 4 つの数'],
    ['bbox:139.55,35.40,139.72', '範囲は「西,南,東,北」の 4 つの数'],
    ['bbox:139.55,,139.72,35.53', '範囲は「西,南,東,北」の 4 つの数'],
    ['bbox:200,35,201,36', '範囲は「西,南,東,北」の 4 つの数'],
    ['JP', '頭は jp・pref・muni・line・near・bbox のどれか'],
    ['city:14100', '頭は jp・pref・muni・line・near・bbox のどれか'],
    ['constructor:x', '頭は jp・pref・muni・line・near・bbox のどれか'],
    ['', '頭は jp・pref・muni・line・near・bbox のどれか'],
  ])('%s は読まない（%s）', (text, why) => {
    const reason = reasonOf(text)
    expect(reason).toContain(why)
    // 直し方（書き方の一覧）を必ず添える
    expect(reason).toContain(AREA_REF_FORMATS_JA.join('／'))
  })
})

describe('エリアの並び（1〜4・重なりなし）', () => {
  it('1〜4 つは読める（指定の順のまま）', () => {
    const parsed = parseAreaRefs(['muni:14100', 'muni:14130', 'line:26001@1000', 'jp'])
    expect(parsed.ok && parsed.refs.map(formatAreaRef)).toEqual([
      'muni:14100',
      'muni:14130',
      'line:26001@1000',
      'jp',
    ])
  })

  it('0 個・5 個は断る', () => {
    expect(parseAreaRefs([])).toEqual({
      ok: false,
      messageJa: 'エリア（area）を 1 つ以上指定してください。',
    })
    const five = ['jp', 'pref:13', 'pref:14', 'pref:11', 'pref:12']
    expect(five).toHaveLength(MAX_AREAS + 1)
    expect(parseAreaRefs(five)).toEqual({ ok: false, messageJa: 'エリアは 4 つまでです（5 個）。' })
  })

  it('同じエリアを 2 度書くと断る（書き方が違っても正規の形で同じなら同じ）', () => {
    expect(parseAreaRefs(['jp', 'jp'])).toEqual({
      ok: false,
      messageJa: '同じエリアが 2 度あります: jp',
    })
    expect(
      parseAreaRefs(['bbox:139.55,35.40,139.72,35.53', 'bbox:139.55,35.4,139.72,35.53']),
    ).toEqual({ ok: false, messageJa: '同じエリアが 2 度あります: bbox:139.55,35.4,139.72,35.53' })
  })

  it('幅の違う同じ路線の沿線は別のエリア', () => {
    expect(parseAreaRefs(['line:26001@500', 'line:26001@2000']).ok).toBe(true)
  })

  it('壊れた形が 1 つでもあれば、その理由を返す', () => {
    const parsed = parseAreaRefs(['muni:14100', 'pref:99'])
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.messageJa).toContain('pref:99')
  })
})

describe('区域の値を DB で引く鍵', () => {
  it('行政区域と沿線は正規の形、駅から N m と範囲は null（DB に区域の行が無い）', () => {
    expect(areaKeyOf(refOf('jp'))).toBe('jp')
    expect(areaKeyOf(refOf('pref:14'))).toBe('pref:14')
    expect(areaKeyOf(refOf('muni:14100'))).toBe('muni:14100')
    expect(areaKeyOf(refOf('line:26001@500'))).toBe('line:26001@500')
    expect(areaKeyOf(refOf('near:竹橋#0@5000'))).toBeNull()
    expect(areaKeyOf(refOf('bbox:139.55,35.4,139.72,35.53'))).toBeNull()
  })
})

describe('行政区域 → 駅の絞り込み（一覧・ランキングと同じ述語）', () => {
  const area = (kind: string, code: string | null, nameJa: string, prefecture: string | null) => ({
    kind,
    code,
    nameJa,
    prefecture,
  })

  it('全国は絞らない・都道府県は名前', () => {
    expect(adminStationFilter(area('country', null, '全国', null))).toEqual({})
    expect(adminStationFilter(area('prefecture', '14', '神奈川県', '神奈川県'))).toEqual({
      prefectures: ['神奈川県'],
    })
  })

  it('政令市は名前の前方一致（「横浜市」で 18 区の駅）', () => {
    expect(adminStationFilter(area('city', '14100', '横浜市', '神奈川県'))).toEqual({
      municipality: '横浜市',
    })
  })

  it('東京 23 区は区のコードの頭 3 桁（13101〜13123）', () => {
    expect(adminStationFilter(area('special_wards', '13100', '東京23区', '東京都'))).toEqual({
      municipality: '131',
    })
  })

  it('区・市町村は JIS の 5 桁（同じ名前の区〔中区〕を取り違えない）', () => {
    expect(adminStationFilter(area('ward', '14104', '横浜市中区', '神奈川県'))).toEqual({
      municipality: '14104',
    })
    expect(adminStationFilter(area('municipality', '13101', '千代田区', '東京都'))).toEqual({
      municipality: '13101',
    })
  })
})
