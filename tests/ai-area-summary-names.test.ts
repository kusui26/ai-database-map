/**
 * エリアの要約の名前の解決（`src/ai/area-summary/admin-index.ts`・`resolve.ts`・2026-10-11 B5d・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.9）。
 *
 * 見ること：
 * - 全区域の索引：市区町村・政令市の区（名前そのもの・区の名前だけ）・政令市の全体・東京 23 区の全体（言い方の数々）・
 *   **駅の無い町**も引ける。都道府県と全国。地図の範囲で決めるための座標（市の全体は区の駅、23 区は 23 の区の駅）
 * - 1 つのエリアは 1 つだけを指す（市区町村・路線・起点の駅・地図の範囲・都道府県だけ）。prefecture は添えると絞る範囲
 * - 同じ名前は B2 と同じく都道府県 → 地図の範囲で決め、決まらなければ候補を返す（推測で選ばない）
 * - 路線は 1 本に決まったときだけ沿線になる（区間に分かれる・会社の名前は理由を返す）。幅は 500m・1km・2km に寄せる
 * - 起点からの距離・地図の範囲・同じエリアの重なり・理由はエリアごとにまとめて返す
 */

import { describe, expect, it, vi } from 'vitest'
import { buildAdminIndex } from '@/ai/area-summary/admin-index'
import {
  resolveSummaryAreas,
  type SummaryAreaInput,
  type SummaryAreasDeps,
} from '@/ai/area-summary/resolve'
import { buildAreaIndex } from '@/ai/area/place-index'
import { type NameRequest, type NameResolution } from '@/ai/routes/resolve'
import { type Viewport } from '@/shared/viewport'
import {
  JAPAN_VIEW,
  NAGOYA_VIEW,
  NAME_ROWS,
  NAME_STATIONS,
  YOKOHAMA_VIEW,
} from './fixtures/area-names'

const ADMIN = buildAdminIndex(NAME_ROWS, NAME_STATIONS)
const STATIONS = buildAreaIndex(NAME_STATIONS)

/** 路線の名前の解決の差し替え（L3 の結果の形をそのまま返す）。 */
function lineResolution(request: NameRequest): NameResolution {
  const name = request.routes?.[0] ?? ''
  if (name === '東急東横線') {
    return {
      ok: true,
      filters: { operators: [], lines: [{ lineCd: 26001, name: '東急東横線' }] },
      notes: [],
    }
  }
  if (name === '東海道本線') {
    const lines = [
      { lineCd: 11301, name: 'JR東海道本線(東京～熱海)' },
      { lineCd: 11501, name: 'JR東海道本線(熱海～浜松)' },
    ]
    return { ok: true, filters: { operators: [], lines }, notes: [] }
  }
  if (name === '東急') {
    return { ok: true, filters: { operators: ['東急電鉄'], lines: [] }, notes: [] }
  }
  return {
    ok: false,
    error: '路線を決められませんでした',
    hint: 'h',
    problems: [{ input: name, problem: `路線「${name}」は 2 か所にあります` }],
  }
}

function depsOf() {
  const resolveLines = vi.fn(async (request: NameRequest) => lineResolution(request))
  const deps: SummaryAreasDeps = {
    adminIndex: async () => ADMIN,
    stationIndex: async () => STATIONS,
    resolveLines,
  }
  return { deps, resolveLines }
}

async function resolve(inputs: readonly SummaryAreaInput[], viewport: Viewport | null = null) {
  return resolveSummaryAreas(inputs, viewport, depsOf().deps)
}

async function areasOf(inputs: readonly SummaryAreaInput[], viewport: Viewport | null = null) {
  const result = await resolve(inputs, viewport)
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result
}

async function problemsOf(inputs: readonly SummaryAreaInput[], viewport: Viewport | null = null) {
  const result = await resolve(inputs, viewport)
  if (result.ok) throw new Error(`決まってしまった: ${result.areas.join(',')}`)
  return result
}

describe('全区域の索引', () => {
  it('市区町村・区・政令市の全体・23 区の全体・駅の無い町を収める（全国・都道府県・沿線は名前の表に入れない）', () => {
    expect(ADMIN.scope).toBe('areas')
    expect(ADMIN.places.map((place) => place.key)).toEqual([
      'muni:13100',
      'muni:13101',
      'muni:13103',
      'muni:13206',
      'muni:13361',
      'muni:14100',
      'muni:14104',
      'muni:14109',
      'muni:14130',
      'muni:23100',
      'muni:23106',
      'muni:23111',
      'muni:34208',
      'muni:34302',
    ])
    expect(ADMIN.prefectureKeys.get('神奈川県')).toBe('pref:14')
  })

  it('座標：区は区の駅・政令市の全体は区の駅・23 区の全体は 23 の区の駅・駅の無い町は空', () => {
    const pointsOf = (key: string) => ADMIN.places.find((place) => place.key === key)?.points ?? []
    expect(pointsOf('muni:14109')).toEqual([{ lon: 139.617, lat: 35.507 }])
    expect(pointsOf('muni:14100')).toHaveLength(2)
    expect(pointsOf('muni:13100')).toHaveLength(3)
    expect(pointsOf('muni:13361')).toEqual([])
  })
})

describe('都道府県と全国', () => {
  it.each([
    ['神奈川県', 'pref:14'],
    ['神奈川', 'pref:14'],
    ['全国', 'jp'],
    ['日本', 'jp'],
  ])('%s → %s', async (prefecture, expected) => {
    expect((await areasOf([{ prefecture }])).areas).toEqual([expected])
  })

  it('知らない都道府県は理由', async () => {
    const { problems } = await problemsOf([{ prefecture: 'ほげ県' }])
    expect(problems[0]?.problem).toContain('都道府県「ほげ県」が分かりません')
  })
})

describe('市区町村', () => {
  it.each([
    ['横浜市', 'muni:14100'],
    ['横浜市港北区', 'muni:14109'],
    ['東京都港区', 'muni:13103'],
    ['東京23区', 'muni:13100'],
    ['23区', 'muni:13100'],
    ['２３区', 'muni:13100'],
    ['東京都区部', 'muni:13100'],
    ['大島町', 'muni:13361'],
  ])('%s → %s', async (municipality, expected) => {
    expect((await areasOf([{ municipality }])).areas).toEqual([expected])
  })

  it('区の名前だけでも、ほかに無ければ決める（読み替えを説明に書く）', async () => {
    const { areas, notes } = await areasOf([{ municipality: '港北区' }])
    expect(areas).toEqual(['muni:14109'])
    expect(notes.join('')).toContain('横浜市港北区（神奈川県）')
  })

  it('名前そのものの「港区」は東京都港区（区の名前だけの名古屋市港区より強い）', async () => {
    const { areas, notes } = await areasOf([{ municipality: '港区' }])
    expect(areas).toEqual(['muni:13103'])
    expect(notes.join('')).toContain('名古屋市港区')
  })

  it('同じ名前（「中区」）は候補を返す——推測で選ばない', async () => {
    const { problems, hint } = await problemsOf([{ municipality: '中区' }])
    expect(problems[0]?.candidates).toEqual([
      { municipality: '名古屋市中区', prefecture: '愛知県', stationCount: 20 },
      { municipality: '横浜市中区', prefecture: '神奈川県', stationCount: 14 },
    ])
    expect(hint).toContain('推測で選ばない')
    // 呼び直し方は、この道具の引数の名前で言う（エリアごとの prefecture・ランキングの prefectures ではない）
    expect(problems[0]?.problem).toContain('candidates の municipality と prefecture で呼び直して')
  })

  it.each([
    ['横浜を見ている', YOKOHAMA_VIEW, 'muni:14104'],
    ['名古屋を見ている', NAGOYA_VIEW, 'muni:23106'],
  ])('「中区」は地図の範囲で決める（%s）', async (_label, viewport, expected) => {
    const { areas, notes } = await areasOf([{ municipality: '中区' }], viewport)
    expect(areas).toEqual([expected])
    expect(notes.join('')).toContain('地図の表示範囲')
  })

  it('prefecture を添えると、同じ名前をその都道府県で絞る（「府中」×広島県）', async () => {
    expect((await areasOf([{ prefecture: '東京都', municipality: '府中市' }])).areas).toEqual([
      'muni:13206',
    ])
    expect((await areasOf([{ prefecture: '広島県', municipality: '府中町' }])).areas).toEqual([
      'muni:34302',
    ])
    await problemsOf([{ municipality: '府中' }])
  })

  it('prefecture の外の市区町村は理由と候補', async () => {
    const { problems } = await problemsOf([{ prefecture: '東京都', municipality: '横浜市' }])
    expect(problems[0]?.problem).toContain('東京都 にありません')
  })

  it('言い方の頭の都道府県と prefecture が食い違えば理由（この道具の引数の名前 prefecture で言う）', async () => {
    const { problems } = await problemsOf([
      { prefecture: '東京都', municipality: '神奈川県横浜市' },
    ])
    expect(problems[0]?.problem).toBe(
      '市区町村「神奈川県横浜市」は 神奈川県 で、prefecture の指定（東京都）と合いません。',
    )
  })

  it('都道府県の名前を municipality に書いたら、prefecture へ促す', async () => {
    const { problems } = await problemsOf([{ municipality: '神奈川' }])
    expect(problems[0]?.problem).toContain(
      'municipality ではなく prefecture に「神奈川県」を渡して',
    )
  })

  it('知らない名前は、駅の無い町村も探したうえで理由を言う（駅の索引の断り方にしない）', async () => {
    const { problems } = await problemsOf([{ municipality: 'ほげ市' }])
    expect(problems[0]?.problem).toBe(
      '市区町村「ほげ市」が見つかりません。名前を確かめてください。',
    )
  })
})

describe('路線の沿線', () => {
  it('1 本に決まれば沿線（幅の既定は 1km・500m・2km はそのまま・そのほかは近い幅に寄せて言う）', async () => {
    expect((await areasOf([{ line: '東急東横線' }])).areas).toEqual(['line:26001@1000'])
    expect((await areasOf([{ line: '東急東横線', widthM: 500 }])).areas).toEqual(['line:26001@500'])
    const { areas, notes } = await areasOf([{ line: '東急東横線', widthM: 1800 }])
    expect(areas).toEqual(['line:26001@2000'])
    expect(notes).toContain('沿線の幅は 500m・1km・2km なので、駅から 2km にしました。')
  })

  it('同じ名前を絞る範囲と地図の範囲を、路線の解決にそのまま渡す', async () => {
    const { deps, resolveLines } = depsOf()
    await resolveSummaryAreas([{ prefecture: '東京都', line: '東急東横線' }], YOKOHAMA_VIEW, deps)
    expect(resolveLines).toHaveBeenCalledWith({
      routes: ['東急東横線'],
      prefectures: ['東京都'],
      viewport: YOKOHAMA_VIEW,
    })
  })

  it('区間に分かれる名前は、1 本を選び直してもらう（区間の名前を挙げる）', async () => {
    const { problems } = await problemsOf([{ line: '東海道本線' }])
    expect(problems[0]?.problem).toContain('2 本の路線に分かれます')
    expect(problems[0]?.didYouMean).toEqual([
      'JR東海道本線(東京～熱海)',
      'JR東海道本線(熱海～浜松)',
    ])
  })

  it('会社の名前は理由（路線の名前を渡す）・決まらない名前は路線の解決の理由のまま', async () => {
    expect((await problemsOf([{ line: '東急' }])).problems[0]?.problem).toContain('会社の名前です')
    expect((await problemsOf([{ line: '中央線' }])).problems[0]?.problem).toContain(
      '2 か所にあります',
    )
  })
})

describe('起点の駅から N m・地図の範囲', () => {
  it('起点の駅と距離（範囲の外は丸めて言う）', async () => {
    expect((await areasOf([{ near: { station: '竹橋', withinM: 5000 } }])).areas).toEqual([
      'near:竹橋#0@5000',
    ])
    const far = await areasOf([{ near: { station: '竹橋', withinM: 200000 } }])
    expect(far.areas).toEqual(['near:竹橋#0@100000'])
    expect(far.notes).toContain('起点からの距離は 100m〜100km なので、100km にしました。')
  })

  it('同じ名前の起点は候補・prefecture で絞れる', async () => {
    const { problems } = await problemsOf([{ near: { station: '府中', withinM: 3000 } }])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('prefecture を添えるか')
    const tokyo = await areasOf([
      { prefecture: '東京都', near: { station: '府中', withinM: 3000 } },
    ])
    expect(tokyo.areas).toEqual(['near:府中#0@3000'])
  })

  it('地図の範囲（このあたり）は送信時の範囲。届いていない・日本全体に近いときは理由', async () => {
    expect((await areasOf([{ inMapView: true }], YOKOHAMA_VIEW)).areas).toEqual([
      'bbox:139.55,35.4,139.72,35.55',
    ])
    expect((await problemsOf([{ inMapView: true }])).problems[0]?.problem).toContain(
      '地図の表示範囲が届いていません',
    )
    expect((await problemsOf([{ inMapView: true }], JAPAN_VIEW)).problems[0]?.problem).toContain(
      '日本全体に近い広さ',
    )
  })
})

describe('エリアの形', () => {
  it('1 つのエリアに 2 つ以上を書いたら理由（比べるなら分ける）・空のエリアも理由', async () => {
    const both = await problemsOf([{ municipality: '横浜市', line: '東急東横線' }])
    expect(both.problems[0]?.problem).toContain('municipality・line')
    const empty = await problemsOf([{}])
    expect(empty.problems[0]?.problem).toContain('エリアが空です')
    // 地図の範囲が届いていない（MCP など）ときは inMapView を勧めない。届いていれば勧める
    expect(empty.problems[0]?.problem).not.toContain('inMapView')
    const withMap = await problemsOf([{}], YOKOHAMA_VIEW)
    expect(withMap.problems[0]?.problem).toContain('near・inMapView のどれか')
  })

  it('同じエリアの重なりは 1 つにまとめて言う', async () => {
    const { areas, notes } = await areasOf([{ municipality: '横浜市' }, { municipality: '横浜市' }])
    expect(areas).toEqual(['muni:14100'])
    expect(notes).toContain('同じエリアが重なっていたので、1 つにまとめました。')
  })

  it('比べるエリアは指定の順。理由はエリアごとにまとめて返す', async () => {
    const both = await areasOf([{ municipality: '横浜市' }, { prefecture: '神奈川県' }])
    expect(both.areas).toEqual(['muni:14100', 'pref:14'])
    const failed = await problemsOf([{ municipality: '中区' }, { prefecture: 'ほげ' }])
    expect(failed.problems).toHaveLength(2)
    expect(failed.error).toContain('エリア')
  })
})
