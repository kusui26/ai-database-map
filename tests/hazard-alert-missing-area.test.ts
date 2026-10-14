import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hazardAlertsAt } from '@/lib/hazard/alert-source'
import { resetJmaCache } from '@/lib/hazard/jma'

/**
 * 対応表の区域が気象庁の発表に見当たらないとき、**「発表なし」と言わない**（2026-10-15・`src/lib/hazard/alert-source.ts`）。
 *
 * 2026-10-15、横浜市・相模原市など 8 市の発表区域が r8 で分かれていて（`1410000` 横浜市 → `1410011` 横浜市北部・
 * `1410012` 横浜市南部）、対応表の区域が 1 件も引けないまま「いま発表されている警報・注意報はありません」と答えていた。
 * r8 は発表の無い区域も「発表警報・注意報はなし」で並べるので、見当たらないのは表が古いときである。
 * 表は作り直したが（`pipeline/build_jma_areas.py`）、気象庁が区域を変えればまた古くなる——そのとき黙って間違えない。
 */

/** 横浜市中区（対応表では横浜市北部・横浜市南部の 2 区域）。 */
const NAKA_YOKOHAMA = JSON.stringify({ results: { muniCd: '14104', lv01Nm: '日本大通' } })
const REPORTED_AT = '2026-10-15T07:50:00+09:00'
/** r8 の「発表なし」の行（コードが無い）。 */
const CALM = { status: '発表警報・注意報はなし' }
const HEAVY_RAIN = { code: '03', status: '発表' }

type AreaItem = { readonly areaCode: string; readonly kinds: readonly object[] }

/** `r8/map.json` の形（気象台 1 つ・区域ごとの発表）。 */
function warningMap(items: readonly AreaItem[]): string {
  return JSON.stringify([{ reportDatetime: REPORTED_AT, warning: { class20Items: items } }])
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

/** 逆ジオは横浜市中区、気象庁の警報は `items`、指定河川洪水予報は無し。 */
function stubUpstream(items: readonly AreaItem[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('reverse-geocoder')) return jsonResponse(NAKA_YOKOHAMA)
      if (url.includes('/warning/data/r8/map.json')) return jsonResponse(warningMap(items))
      if (url.includes('/flood/')) return jsonResponse('[]')
      throw new TypeError(`想定していない取得: ${url}`)
    }),
  )
}

async function alertsAtNakaYokohama() {
  return hazardAlertsAt({ lon: 139.638, lat: 35.4437, placeJa: '関内', now: Date.now() })
}

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetJmaCache()
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('対応表の区域が気象庁の発表に見当たらない', () => {
  it('どちらの区域も見当たらなければ「確かめられませんでした」（発表なしと言わない・時刻も空）', async () => {
    stubUpstream([{ areaCode: '1312200', kinds: [CALM] }])
    const response = await alertsAtNakaYokohama()
    expect(response.headlineJa).toBe(
      '横浜市北部・横浜市南部の気象庁の発表を確かめられませんでした。',
    )
    expect(response.headlineJa).not.toContain('ありません')
    expect(response.reportedAt).toBeNull()
    expect(response.warnings).toEqual([])
    expect(response.area?.municipalityJa).toBe('横浜市 中区')
    expect(response.notesJa.join()).toContain(
      '横浜市北部・横浜市南部の発表を気象庁の情報から見つけられず、確かめられていません',
    )
    // 直すのはデータなので、運用に知らせる（区域コードつき）
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('1410011,1410012')
  })

  it('片方だけ見つかり、そちらが発表なしでも、全体を「発表なし」と言わない', async () => {
    stubUpstream([{ areaCode: '1410011', kinds: [CALM] }])
    const response = await alertsAtNakaYokohama()
    expect(response.headlineJa).toContain('確かめられませんでした')
    expect(response.reportedAt).toBeNull()
    expect(response.notesJa.join()).toContain('横浜市南部の発表を気象庁の情報から見つけられず')
    expect(response.notesJa.join()).not.toContain('横浜市北部の発表を')
  })

  it('見つかった区域に警報があれば出し、見当たらない区域は注記に書く', async () => {
    stubUpstream([{ areaCode: '1410011', kinds: [HEAVY_RAIN] }])
    const response = await alertsAtNakaYokohama()
    expect(response.alertLevel).toBe(3)
    expect(response.headlineJa).toContain('大雨警報')
    expect(response.reportedAt).toBe(REPORTED_AT)
    expect(response.notesJa.join()).toContain('横浜市南部の発表を気象庁の情報から見つけられず')
  })

  it('どちらも見つかれば、いままでどおり（注記なし・発表時刻あり・運用に知らせない）', async () => {
    stubUpstream([
      { areaCode: '1410011', kinds: [CALM] },
      { areaCode: '1410012', kinds: [CALM] },
    ])
    const response = await alertsAtNakaYokohama()
    expect(response.headlineJa).toBe(
      '横浜市北部・横浜市南部に、いま発表されている警報・注意報はありません。',
    )
    expect(response.reportedAt).toBe(REPORTED_AT)
    expect(response.notesJa).toEqual([])
    expect(errorLog).not.toHaveBeenCalled()
  })
})
