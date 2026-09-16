/**
 * 逆ジオ（`municipalityCodeAt`）が**「見つからなかった」を覚えない**こと（260916 G6）。
 *
 * ## なぜこれを検査するか
 *
 * **上流は、海上・国外でも、壊れているときでも、同じ `{}` を返す**（実測：太平洋・赤道沖・
 * ソウルはいずれも `{}`）。応答からこの 2 つを区別する手立ては無い。
 *
 * 2026-09-16、国土地理院の逆ジオが不調になった。その隙に `{}` を 1 度受け取ると、以前の実装は
 * それを「海上」として**期限なしで**覚え、**プロセスが生きている間ずっと**、葛飾区にいる人に
 * 「市区町村を特定できませんでした（海上・国外の可能性があります）」と答え続けた（本番で再現し、
 * プロセスを入れ替えると直った）。
 *
 * **この不具合は型でも lint でも止まらない**——`null` は正しい値だからである。
 * 止められるのはこの検査だけなので、ここで固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hazardAlertsAt } from '@/lib/hazard/alert-source'
import { municipalityCodeAt, resetJmaCache } from '@/lib/hazard/jma'

/** 逆ジオの応答を順に返す（呼ばれた回数も数える）。 */
function stubResponses(bodies: readonly (string | 'network-error')[]): { calls: () => number } {
  let index = 0
  const fetchMock = vi.fn(async () => {
    const body = bodies[Math.min(index, bodies.length - 1)]
    index += 1
    if (body === 'network-error') throw new TypeError('Failed to fetch')
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls: () => fetchMock.mock.calls.length }
}

const FOUND = JSON.stringify({ results: { muniCd: '13122', lv01Nm: '亀有三丁目' } })
/** 海上・国外のときの形（実測：`{}` が返る。**壊れているときも同じ**）。 */
const NOT_FOUND = '{}'

beforeEach(() => {
  resetJmaCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('読めたとき', () => {
  it('市区町村コードを返す', async () => {
    stubResponses([FOUND])
    await expect(municipalityCodeAt(139.847, 35.7645)).resolves.toBe('13122')
  })

  it('同じ地点は覚える（上流を何度も叩かない）', async () => {
    const stub = stubResponses([FOUND])
    await municipalityCodeAt(139.847, 35.7645)
    await municipalityCodeAt(139.847, 35.7645)
    expect(stub.calls()).toBe(1)
  })
})

describe('見つからなかったときは覚えない（これが G6 の本体）', () => {
  it('`{}` は null を返す（エラーではない）', async () => {
    stubResponses([NOT_FOUND])
    await expect(municipalityCodeAt(145.0, 35.0)).resolves.toBeNull()
  })

  it('**次に聞かれたら、もう一度上流に確かめる**', async () => {
    const stub = stubResponses([NOT_FOUND])
    await municipalityCodeAt(145.0, 35.0)
    await municipalityCodeAt(145.0, 35.0)
    expect(stub.calls()).toBe(2)
  })

  it('上流が不調から復旧したら、正しい答えに戻る（本番で起きた並び）', async () => {
    // 不調のあいだは `{}`、復旧後は本物——覚えていたら、ずっと `{}` のままになる。
    const stub = stubResponses([NOT_FOUND, FOUND])
    await expect(municipalityCodeAt(139.847, 35.7645)).resolves.toBeNull()
    await expect(municipalityCodeAt(139.847, 35.7645)).resolves.toBe('13122')
    expect(stub.calls()).toBe(2)
  })

  it('同時に来た問い合わせは 1 回にまとめる（`remember` 本来の目的は残す）', async () => {
    const stub = stubResponses([NOT_FOUND])
    const [a, b] = await Promise.all([
      municipalityCodeAt(145.0, 35.0),
      municipalityCodeAt(145.0, 35.0),
    ])
    expect([a, b]).toEqual([null, null])
    expect(stub.calls()).toBe(1)
  })
})

describe('読めなかったときは投げる（「海上」に化けさせない）', () => {
  it('形が違う応答は投げる', async () => {
    stubResponses([JSON.stringify({ results: [] })])
    await expect(municipalityCodeAt(139.847, 35.7645)).rejects.toThrow()
  })

  it('JSON ですらない応答も投げる', async () => {
    stubResponses(['<html>502 Bad Gateway</html>'])
    await expect(municipalityCodeAt(139.847, 35.7645)).rejects.toThrow()
  })

  it('投げたあと、次の呼び出しで取り直す', async () => {
    const stub = stubResponses([JSON.stringify({ results: [] }), FOUND])
    await expect(municipalityCodeAt(139.847, 35.7645)).rejects.toThrow()
    await expect(municipalityCodeAt(139.847, 35.7645)).resolves.toBe('13122')
    expect(stub.calls()).toBe(2)
  })

  it('通信そのものが失敗しても、覚えない', async () => {
    const stub = stubResponses(['network-error', FOUND])
    await expect(municipalityCodeAt(139.9, 35.7)).rejects.toThrow()
    await expect(municipalityCodeAt(139.9, 35.7)).resolves.toBe('13122')
    expect(stub.calls()).toBe(2)
  })
})

describe('地点の丸め', () => {
  it('11m 以内の違いは同じ地点として扱う（市区町村の境界は動かない）', async () => {
    const stub = stubResponses([FOUND])
    await municipalityCodeAt(139.84701, 35.76451)
    await municipalityCodeAt(139.847012, 35.764512)
    expect(stub.calls()).toBe(1)
  })
})

/**
 * 応答に載る注記（`hazardAlertsAt`）。**知らないことを知っているように書かない。**
 *
 * `{}` は「海上・国外」と「上流が壊れている」の両方でありうる（実測）。だから注記でも
 * どちらかを名指ししない。一方、**投げた**ときは取得に失敗したと分かっているので、そう書く。
 */
describe('注記は、分かっている範囲でだけ言う', () => {
  /** 逆ジオだけ応答を差し替え、気象庁側は落とす（呼び出し側が catch する経路）。 */
  function stubUpstream(geocoderBody: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('reverse-geocoder')) {
          return new Response(geocoderBody, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        throw new TypeError('気象庁には届かない想定')
      }),
    )
  }

  it('見つからないときは、海上とも障害とも決めつけない', async () => {
    stubUpstream(NOT_FOUND)
    const response = await hazardAlertsAt({ lon: 145, lat: 35, now: Date.now() })
    expect(response.notesJa.join()).toContain('海上・国外か、一時的に取得できなかった')
  })

  it('取得に失敗したと分かっているときは、そう書く', async () => {
    stubUpstream(JSON.stringify({ results: [] }))
    const response = await hazardAlertsAt({ lon: 139.847, lat: 35.7645, now: Date.now() })
    expect(response.notesJa.join()).toContain('一時的な不調の可能性があります')
    expect(response.notesJa.join()).not.toContain('海上')
  })

  it('どちらの場合も「安全です」とは言わない', async () => {
    for (const body of [NOT_FOUND, JSON.stringify({ results: [] })]) {
      resetJmaCache()
      stubUpstream(body)
      const response = await hazardAlertsAt({ lon: 139.847, lat: 35.7645, now: Date.now() })
      expect(`${response.headlineJa}${response.notesJa.join()}`).not.toContain('安全')
    }
  })
})
