/**
 * src/ai/area：市区町村・起点の駅の言い方を、データの市区町村と駅へ解決する（2026-10-08 B2・
 * `docs/261001_fix_user_feedback_ui.md` §6.4）。
 *
 * 以前は「横浜市で」を神奈川県で代用し、「竹橋から 5km」を集計半径（radiusM）に入れて全国の順位で答えていた
 * （計画書 §6.1）。ここで固定するのは：
 *
 * - 照合の鍵：全角・空白・「ヶ」を揃える。駅名の末尾の「駅」は除いて先に引く。頭の都道府県は条件として切り分ける
 * - 市区町村：名前そのもの・政令市の市全体は強い。末尾を補う言い方（「横浜」）は駅の数で抜きん出た 1 つだけが強い。
 *   区の名前だけ（「港北区」「港北」）は弱い。都道府県の言い方（「東京」「神奈川」）は prefectures へ促す
 * - 同じ名前は、都道府県 → 地図の表示範囲 の順に決め、決まらなければ候補を返して聞き返す（推測で選ばない）
 * - 半径は 100m〜100km に丸めて説明に書く。言い方が無ければ索引を読まない
 *
 * 駅は本物の `station_catalog()` から写した 34 駅（`fixtures/area-catalog.ts`）。
 */

import { describe, expect, it, vi } from 'vitest'
import { type CatalogStation } from '@/db/queries'
import { decidePlace, type PlaceCandidate } from '@/ai/area/decide'
import { placeKey, prefectureNamed, splitPrefecture, stationKeys } from '@/ai/area/keys'
import { buildAreaIndex } from '@/ai/area/place-index'
import { listNames } from '@/ai/area/problems'
import {
  resolveAreaInput,
  type AreaInput,
  type AreaInputResolution,
  type AreaResolveContext,
} from '@/ai/area/resolve'
import { type Viewport } from '@/shared/viewport'
import { AREA_STATIONS, OSAKA_VIEW, TOKYO_VIEW } from './fixtures/area-catalog'

const INDEX = buildAreaIndex(AREA_STATIONS)

const NO_CONTEXT: AreaResolveContext = { prefectures: [], viewport: null }

function depsOf(stations: readonly CatalogStation[] = AREA_STATIONS) {
  const index = buildAreaIndex(stations)
  return { index: vi.fn(async () => index) }
}

async function resolve(
  input: AreaInput,
  context: Partial<AreaResolveContext> = {},
): Promise<AreaInputResolution> {
  return resolveAreaInput(input, { ...NO_CONTEXT, ...context }, { index: async () => INDEX })
}

type Resolved = Extract<AreaInputResolution, { ok: true }>
type Failed = Extract<AreaInputResolution, { ok: false }>

function resolved(result: AreaInputResolution): Resolved {
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result
}

function failed(result: AreaInputResolution): Failed {
  if (result.ok) throw new Error(`決まってしまった: ${JSON.stringify(result.area)}`)
  return result
}

/** 市区町村の言い方 → 決まった値・都道府県・説明。 */
async function municipalityOf(
  municipality: string,
  context: Partial<AreaResolveContext> = {},
): Promise<{ value: string | null; prefectures: readonly string[]; notes: readonly string[] }> {
  const result = resolved(await resolve({ municipality }, context))
  return {
    value: result.area.municipality,
    prefectures: result.prefectures,
    notes: result.notes,
  }
}

/** 起点の言い方 → 決まった駅の grp と説明（半径は 5km）。 */
async function originOf(
  station: string,
  context: Partial<AreaResolveContext> = {},
): Promise<{ grp: string | undefined; notes: readonly string[] }> {
  const result = resolved(await resolve({ near: { station, withinM: 5000 } }, context))
  return { grp: result.area.near?.grp, notes: result.notes }
}

describe('照合の鍵（keys.ts）', () => {
  it('全角・空白を揃え、「ヶ・ヵ」を「ケ」に揃える（市ヶ谷＝市ケ谷・鎌ヶ谷市＝鎌ケ谷市）', () => {
    expect(placeKey('市ヶ谷')).toBe(placeKey('市ケ谷'))
    expect(placeKey('市ヵ谷')).toBe(placeKey('市ケ谷'))
    expect(placeKey('鎌ヶ谷市')).toBe('鎌ケ谷市')
    expect(placeKey('　横浜市　港北区 ')).toBe('横浜市港北区')
    expect(placeKey('ＪＲ')).toBe('JR')
  })

  it.each([
    ['東京駅', ['東京', '東京駅']],
    ['東京', ['東京']],
    [' 新宿駅 ', ['新宿', '新宿駅']],
    // 「駅」だけは除かない（空の鍵で全駅に当てない）
    ['駅', ['駅']],
  ])('駅名「%s」の鍵は %j（末尾の「駅」を除いた形を先に引く）', (input, keys) => {
    expect(stationKeys(input)).toEqual(keys)
  })

  it.each([
    ['東京都港区', '東京都', '港区'],
    ['神奈川県 横浜市', '神奈川県', '横浜市'],
    ['北海道札幌市中央区', '北海道', '札幌市中央区'],
    ['京都府京都市', '京都府', '京都市'],
    // 「京都市」は京都府で始まらない。都道府県だけの言い方は切り分けない
    ['京都市', null, '京都市'],
    ['東京都', null, '東京都'],
    ['港区', null, '港区'],
  ])('「%s」→ 都道府県 %j・残り「%s」', (input, prefecture, rest) => {
    expect(splitPrefecture(input)).toEqual({ prefecture, rest })
  })

  it.each([
    ['東京', '東京都'],
    ['東京都', '東京都'],
    ['神奈川', '神奈川県'],
    ['北海道', '北海道'],
    ['大阪', '大阪府'],
    ['横浜', null],
    ['', null],
  ])('都道府県の言い方「%s」→ %j', (input, prefecture) => {
    expect(prefectureNamed(input)).toBe(prefecture)
  })
})

describe('buildAreaIndex（全駅から索引を作る）', () => {
  it('同じ名前の駅をまとめ、grp でも引ける', () => {
    expect(INDEX.stationsByKey.get('府中')?.map((s) => s.grp)).toEqual([
      '府中#0',
      '府中#1',
      '府中#2',
      '府中#3',
    ])
    expect(INDEX.stationsByKey.get(placeKey('市ケ谷'))?.map((s) => s.grp)).toEqual(['市ヶ谷#0'])
    expect(INDEX.stationsByGrp.get('日本橋#1')?.prefecture).toBe('東京都')
  })

  it('市区町村は都道府県と名前の組でまとめる（府中市は東京都と広島県の 2 つ）', () => {
    const fuchu = INDEX.placesByName.get('府中市') ?? []
    expect(fuchu.map((p) => [p.prefecture, p.value, p.stationCount])).toEqual([
      ['東京都', '府中市', 1],
      ['広島県', '府中市', 1],
    ])
    expect(INDEX.placesByName.get('千代田区')?.[0]?.points).toHaveLength(3)
  })

  it('政令市は区をまとめた市全体を持つ（横浜市＝5 区 7 駅・駅の座標もすべて）', () => {
    const [yokohama] = INDEX.citiesByName.get('横浜市') ?? []
    expect(yokohama).toMatchObject({ prefecture: '神奈川県', value: '横浜市', stationCount: 7 })
    expect(yokohama?.points).toHaveLength(7)
    expect(INDEX.places).toContain(yokohama)
  })

  it('区の名前だけでも引ける（「中区」→ 横浜市・名古屋市・広島市）', () => {
    expect(INDEX.placesByWard.get('中区')?.map((p) => p.value)).toEqual([
      '横浜市中区',
      '名古屋市中区',
      '広島市中区',
    ])
    // 「港区」（東京都）は政令市の区ではないので、区の名前の索引には入らない
    expect(INDEX.placesByWard.get('港区')?.map((p) => p.value)).toEqual([
      '名古屋市港区',
      '大阪市港区',
    ])
  })

  it('市区町村の無い駅は、市区町村の索引に入れない（駅としては引ける）', () => {
    const [base] = AREA_STATIONS
    if (base === undefined) throw new Error('駅が無い')
    const index = buildAreaIndex([{ ...base, grp: 'X#0', name: 'X', municipality: null }])
    expect(index.places).toEqual([])
    expect(index.stationsByGrp.has('X#0')).toBe(true)
  })
})

describe('decidePlace（同じ名前の場所の決め方）', () => {
  /** 範囲の中・外の点。 */
  const IN = { lon: 139.7, lat: 35.7 }
  const OUT = { lon: 135.5, lat: 34.7 }
  const VIEW: Viewport = TOKYO_VIEW

  function c(item: string, strong: boolean, ...points: { lon: number; lat: number }[]) {
    return { item, strong, points } satisfies PlaceCandidate<string>
  }

  it('候補が無ければ none、1 つならそれ（弱くても、範囲の外でも）', () => {
    expect(decidePlace([], VIEW)).toEqual({ kind: 'none' })
    expect(decidePlace([c('A', false, OUT)], VIEW)).toEqual({
      kind: 'one',
      item: 'A',
      how: 'only',
      others: [],
    })
  })

  it('強い候補が 1 つなら、地図が無くてもそれ（ほかの候補は説明に残す）', () => {
    expect(decidePlace([c('強', true, OUT), c('弱', false, IN)], null)).toEqual({
      kind: 'one',
      item: '強',
      how: 'strong',
      others: ['弱'],
    })
  })

  it('強い候補が範囲の外でも、範囲の中に候補が無ければそれ', () => {
    expect(decidePlace([c('強', true, OUT), c('弱', false, OUT)], VIEW)).toMatchObject({
      item: '強',
      how: 'strong',
    })
  })

  it('強い候補が範囲の外で、範囲の中に弱い候補が 1 つならそちら（大阪の地図の「港区」）', () => {
    expect(decidePlace([c('強', true, OUT), c('弱', false, IN)], VIEW)).toMatchObject({
      item: '弱',
      how: 'viewport',
      others: ['強'],
    })
  })

  it('強い候補が 2 つなら、範囲の中の 1 つ。範囲で決まらなければ聞き返す', () => {
    expect(decidePlace([c('A', true, IN), c('B', true, OUT)], VIEW)).toMatchObject({
      item: 'A',
      how: 'viewport',
    })
    expect(decidePlace([c('A', true, IN), c('B', true, OUT)], null)).toEqual({
      kind: 'ambiguous',
      items: ['A', 'B'],
    })
  })

  it('範囲の中に 2 つ以上あれば、範囲の中の強い 1 つ。無ければ範囲の中の候補だけを挙げて聞き返す', () => {
    const strongInside = [c('強', true, IN), c('強2', true, OUT), c('弱', false, IN)]
    expect(decidePlace(strongInside, VIEW)).toMatchObject({ item: '強', how: 'viewport' })
    const weakInside = [c('弱1', false, IN), c('弱2', false, IN), c('弱3', false, OUT)]
    expect(decidePlace(weakInside, VIEW)).toEqual({ kind: 'ambiguous', items: ['弱1', '弱2'] })
  })

  it('点の 1 つでも範囲に入れば中（範囲の縁も中）', () => {
    const edge = { lon: VIEW.west, lat: VIEW.north }
    expect(decidePlace([c('A', false, OUT, edge), c('B', false, OUT)], VIEW)).toMatchObject({
      item: 'A',
      how: 'viewport',
    })
  })
})

describe('市区町村：1 つに決まる言い方', () => {
  it('政令市の市全体（「横浜市」）はそのまま。都道府県を添える（説明は書かない）', async () => {
    expect(await municipalityOf('横浜市')).toEqual({
      value: '横浜市',
      prefectures: ['神奈川県'],
      notes: [],
    })
  })

  it('末尾を補う言い方は、駅の数で抜きん出た 1 つ（「横浜」→ 横浜市・青森県の横浜町は説明に）', async () => {
    expect(await municipalityOf('横浜')).toEqual({
      value: '横浜市',
      prefectures: ['神奈川県'],
      notes: [
        '市区町村「横浜」は 横浜市（神奈川県） として扱いました（ほかに 横浜町（青森県） があります）。',
      ],
    })
  })

  it('ちょうど 5 倍なら抜きん出る（「中央」→ 東京都中央区 5 駅・中央市 1 駅）。区の名前の大阪市中央区も説明に', async () => {
    expect(await municipalityOf('中央')).toEqual({
      value: '中央区',
      prefectures: ['東京都'],
      notes: [
        '市区町村「中央」は 中央区（東京都） として扱いました（ほかに 中央市（山梨県）・大阪市中央区（大阪府） があります）。',
      ],
    })
  })

  it('区の名前だけ（「港北区」「港北」）→ 横浜市港北区。読み替えを書く', async () => {
    expect(await municipalityOf('港北区')).toEqual({
      value: '横浜市港北区',
      prefectures: ['神奈川県'],
      notes: ['市区町村「港北区」は 横浜市港北区（神奈川県） として扱いました。'],
    })
    expect((await municipalityOf('港北')).value).toBe('横浜市港北区')
  })

  it('「港区」は東京都港区（名前そのもの）。名古屋・大阪の港区は区の名前だけで当たった候補', async () => {
    expect(await municipalityOf('港区')).toEqual({
      value: '港区',
      prefectures: ['東京都'],
      notes: [
        '市区町村「港区」は 港区（東京都） として扱いました（ほかに 名古屋市港区（愛知県）・大阪市港区（大阪府） があります）。',
      ],
    })
    expect((await municipalityOf('港区', { viewport: TOKYO_VIEW })).value).toBe('港区')
  })

  it('大阪の地図の「港区」は大阪市港区（その地域の人は市の名前を省いて呼ぶ）', async () => {
    expect(await municipalityOf('港区', { viewport: OSAKA_VIEW })).toEqual({
      value: '大阪市港区',
      prefectures: ['大阪府'],
      notes: [
        '市区町村「港区」は、地図の表示範囲にある 大阪市港区（大阪府） にしました（ほかの候補：港区（東京都）・名古屋市港区（愛知県））。',
      ],
    })
    expect((await municipalityOf('中央', { viewport: OSAKA_VIEW })).value).toBe('大阪市中央区')
  })

  it('首都圏の地図の「中区」は横浜市中区。神奈川県を指定すれば地図が無くても決まる', async () => {
    expect(await municipalityOf('中区', { viewport: TOKYO_VIEW })).toMatchObject({
      value: '横浜市中区',
      prefectures: ['神奈川県'],
    })
    expect(await municipalityOf('中区', { prefectures: ['神奈川県'] })).toEqual({
      value: '横浜市中区',
      prefectures: ['神奈川県'],
      notes: ['市区町村「中区」は 横浜市中区（神奈川県） として扱いました。'],
    })
  })

  it('頭の都道府県（「東京都港区」）は条件として使い、その中で決める', async () => {
    expect(await municipalityOf('東京都港区', { viewport: OSAKA_VIEW })).toEqual({
      value: '港区',
      prefectures: ['東京都'],
      notes: [],
    })
  })

  it('同じ名前の市（府中市）は値だけでは決まらない——都道府県を添えて返す', async () => {
    expect(await municipalityOf('府中市', { prefectures: ['広島県'] })).toEqual({
      value: '府中市',
      prefectures: ['広島県'],
      notes: [],
    })
    expect(await municipalityOf('府中', { viewport: TOKYO_VIEW })).toEqual({
      value: '府中市',
      prefectures: ['東京都'],
      notes: [
        '市区町村「府中」は、地図の表示範囲にある 府中市（東京都） にしました（ほかの候補：府中市（広島県））。',
      ],
    })
  })

  it('指定の都道府県が複数なら、そのまま残す（市区町村はその中から決めてある）', async () => {
    expect(await municipalityOf('港区', { prefectures: ['東京都', '神奈川県'] })).toEqual({
      value: '港区',
      prefectures: ['東京都', '神奈川県'],
      notes: [],
    })
  })
})

describe('市区町村：決めない言い方（候補を返して聞き返す）', () => {
  it('地図が無い「中区」は 3 か所を候補に（呼び直しにそのまま使える値・駅の数つき）', async () => {
    const result = failed(await resolve({ municipality: '中区' }))
    expect(result.error).toBe('場所（市区町村・起点の駅・範囲）を決められませんでした')
    expect(result.problems).toEqual([
      {
        input: '中区',
        problem:
          '市区町村「中区」は 3 か所にあります（横浜市中区（神奈川県）・名古屋市中区（愛知県）・広島市中区（広島県））。どこか利用者に聞くか、candidates の municipality と prefectures で呼び直してください。',
        candidates: [
          { municipality: '横浜市中区', prefecture: '神奈川県', stationCount: 2 },
          { municipality: '名古屋市中区', prefecture: '愛知県', stationCount: 1 },
          { municipality: '広島市中区', prefecture: '広島県', stationCount: 1 },
        ],
      },
    ])
  })

  it('駅の数が並ぶ同じ名前（府中市が東京都と広島県）は、地図が無ければ聞き返す', async () => {
    const [problem] = failed(await resolve({ municipality: '府中' })).problems
    expect(problem?.candidates).toEqual([
      { municipality: '府中市', prefecture: '東京都', stationCount: 1 },
      { municipality: '府中市', prefecture: '広島県', stationCount: 1 },
    ])
  })

  it('候補と説明は駅の多い順（索引の並びに左右されない・本物の「中区」は広島市中区 34 駅が先）', async () => {
    // 索引の並びでは名古屋市中区が先。駅を 1 つ足した広島市中区（2 駅）が先に出る
    const [hiroshima] = AREA_STATIONS.filter((s) => s.grp === '紙屋町東#0')
    if (hiroshima === undefined) throw new Error('駅が無い')
    const deps = depsOf([
      ...AREA_STATIONS.filter((s) => s.municipality !== '横浜市中区'),
      { ...hiroshima, grp: '紙屋町西#0', name: '紙屋町西', label: '紙屋町西' },
    ])
    const result = await resolveAreaInput({ municipality: '中区' }, NO_CONTEXT, deps)
    const [problem] = failed(result).problems
    expect(problem?.candidates).toEqual([
      { municipality: '広島市中区', prefecture: '広島県', stationCount: 2 },
      { municipality: '名古屋市中区', prefecture: '愛知県', stationCount: 1 },
    ])
    expect(problem?.problem).toContain('（広島市中区（広島県）・名古屋市中区（愛知県））')
  })

  it('決めたときの「ほかに」も駅の多い順', async () => {
    const [osaka] = AREA_STATIONS.filter((s) => s.grp === '朝潮橋#0')
    if (osaka === undefined) throw new Error('駅が無い')
    const deps = depsOf([...AREA_STATIONS, { ...osaka, grp: '弁天町#0', name: '弁天町' }])
    const result = await resolveAreaInput({ municipality: '港区' }, NO_CONTEXT, deps)
    expect(resolved(result).notes).toEqual([
      '市区町村「港区」は 港区（東京都） として扱いました（ほかに 大阪市港区（大阪府）・名古屋市港区（愛知県） があります）。',
    ])
  })

  it('抜きん出ていなければ（4 倍）、末尾を補った候補はどれも強い＝聞き返す', async () => {
    const four = AREA_STATIONS.filter((s) => s.grp !== '三越前#0')
    const deps = depsOf(four)
    const result = await resolveAreaInput({ municipality: '中央' }, NO_CONTEXT, deps)
    expect(failed(result).problems[0]?.candidates).toHaveLength(3)
  })

  it('都道府県の言い方は prefectures へ促す（「神奈川」を横浜市神奈川区に読み替えない）', async () => {
    for (const [input, prefecture] of [
      ['東京', '東京都'],
      ['神奈川', '神奈川県'],
      ['東京都', '東京都'],
    ]) {
      expect(failed(await resolve({ municipality: input })).problems).toEqual([
        {
          input,
          problem: `「${input}」は都道府県です。municipality ではなく prefectures に「${prefecture}」を渡してください。`,
        },
      ])
    }
    // 区まで言えば神奈川区
    expect((await municipalityOf('神奈川区')).value).toBe('横浜市神奈川区')
  })

  it('知らない名前は、名前に含む市区町村を近い名前として返す（無ければ返さない）', async () => {
    expect(failed(await resolve({ municipality: '立' })).problems).toEqual([
      {
        input: '立',
        problem:
          '市区町村「立」の駅が見つかりません（駅のある市区町村だけを扱えます）。名前を確かめてください。',
        didYouMean: ['立川市（東京都）'],
      },
    ])
    expect(failed(await resolve({ municipality: 'せたがや' })).problems[0]).not.toHaveProperty(
      'didYouMean',
    )
  })

  it('指定の都道府県の外にしか無い（「横浜市」× 東京都）', async () => {
    expect(
      failed(await resolve({ municipality: '横浜市' }, { prefectures: ['東京都'] })).problems,
    ).toEqual([
      {
        input: '横浜市',
        problem: '市区町村「横浜市」は 東京都 にありません（横浜市（神奈川県））。',
        candidates: [{ municipality: '横浜市', prefecture: '神奈川県', stationCount: 7 }],
      },
    ])
  })

  it('言い方の頭の都道府県と prefectures が食い違う（「神奈川県横浜市」× 東京都）', async () => {
    expect(
      failed(await resolve({ municipality: '神奈川県横浜市' }, { prefectures: ['東京都'] }))
        .problems,
    ).toEqual([
      {
        input: '神奈川県横浜市',
        problem:
          '市区町村「神奈川県横浜市」は 神奈川県 で、prefectures の指定（東京都）と合いません。',
      },
    ])
  })
})

describe('起点の駅（「竹橋から 5km」）', () => {
  it('駅名で引き、座標と表示名を持つ（題は「竹橋から 5km」になる）', async () => {
    const result = resolved(await resolve({ near: { station: '竹橋', withinM: 5000 } }))
    expect(result.area).toEqual({
      municipality: null,
      bbox: null,
      near: { grp: '竹橋#0', label: '竹橋', lon: 139.75852, lat: 35.69028, radiusM: 5000 },
    })
    expect(result.prefectures).toEqual([])
    expect(result.notes).toEqual([])
  })

  it('末尾の「駅」・「ヶ／ケ」・grp でも引ける', async () => {
    expect((await originOf('東京駅')).grp).toBe('東京#0')
    // 名前に「駅」を含む停留場（富山駅）より、「駅」を除いた富山駅（JR）を先に引く
    expect((await originOf('富山駅')).grp).toBe('富山#0')
    expect((await originOf('市ケ谷')).grp).toBe('市ヶ谷#0')
    expect(await originOf('府中#2')).toEqual({ grp: '府中#2', notes: [] })
  })

  it('同じ名前の駅は地図の範囲で決め、決めたことを書く（大阪の地図の「日本橋」）', async () => {
    expect(await originOf('日本橋', { viewport: OSAKA_VIEW })).toEqual({
      grp: '日本橋#0',
      notes: [
        '起点の「日本橋」は、地図の表示範囲にある 日本橋（大阪府大阪市中央区） にしました（ほかの候補：日本橋（東京都中央区））。',
      ],
    })
    expect((await originOf('日本橋', { viewport: TOKYO_VIEW })).grp).toBe('日本橋#1')
  })

  it('都道府県の指定でも決まる（地図より強い）', async () => {
    expect(await originOf('府中', { prefectures: ['東京都'], viewport: OSAKA_VIEW })).toEqual({
      grp: '府中#0',
      notes: [],
    })
  })

  it('決まらなければ、乗降の多い順の候補（near.station にそのまま渡せる grp）を返す', async () => {
    const result = failed(await resolve({ near: { station: '日本橋', withinM: 3000 } }))
    expect(result.problems).toEqual([
      {
        input: '日本橋',
        problem:
          '起点の「日本橋」という駅は 2 か所にあります（日本橋（東京都中央区）・日本橋（大阪府大阪市中央区））。どの駅か利用者に聞くか、prefectures を添えるか、candidates の station（grp）で呼び直してください。',
        candidates: [
          { station: '日本橋#1', name: '日本橋', prefecture: '東京都', municipality: '中央区' },
          {
            station: '日本橋#0',
            name: '日本橋',
            prefecture: '大阪府',
            municipality: '大阪市中央区',
          },
        ],
      },
    ])
    expect(
      failed(await resolve({ near: { station: '府中', withinM: 3000 } })).problems[0]?.problem,
    ).toContain(
      '4 か所にあります（府中（東京都府中市）・府中（広島県府中市）・府中（徳島県徳島市） など）',
    )
  })

  it('知らない駅は、名前に含む駅を近い名前として返す（読み仮名では引かない）', async () => {
    const [unknown] = failed(await resolve({ near: { station: '新宿', withinM: 3000 } })).problems
    expect(unknown).toEqual({
      input: '新宿',
      problem:
        '起点の駅「新宿」が見つかりません。駅名を確かめるか、searchStations で調べた grp を near.station に渡してください。',
      didYouMean: ['新宿三丁目（東京都新宿区）'],
    })
    const [kana] = failed(await resolve({ near: { station: 'たけばし', withinM: 3000 } })).problems
    expect(kana).not.toHaveProperty('didYouMean')
  })

  it('指定の都道府県に無い駅は、そう言って候補を返す', async () => {
    const [problem] = failed(
      await resolve({ near: { station: '竹橋', withinM: 3000 } }, { prefectures: ['大阪府'] }),
    ).problems
    expect(problem).toMatchObject({
      problem: '起点の「竹橋」は 大阪府 にありません（竹橋（東京都千代田区））。',
      candidates: [{ station: '竹橋#0' }],
    })
  })

  it('決めた市区町村の都道府県の中で起点を探す（「港区で、日本橋から 3km」は東京の日本橋）', async () => {
    const result = resolved(
      await resolve({ municipality: '港区', near: { station: '日本橋', withinM: 3000 } }),
    )
    expect(result.area.municipality).toBe('港区')
    expect(result.area.near?.grp).toBe('日本橋#1')
    expect(result.prefectures).toEqual(['東京都'])
  })
})

describe('半径・座標・範囲', () => {
  it.each([
    [200_000, 100_000, '半径は 100m〜100km なので、100km にしました。'],
    [50, 100, '半径は 100m〜100km なので、100m にしました。'],
  ])('半径 %d m は %d m に丸めて書く', async (withinM, radiusM, note) => {
    const result = resolved(await resolve({ near: { station: '竹橋', withinM } }))
    expect(result.area.near?.radiusM).toBe(radiusM)
    expect(result.notes).toEqual([note])
  })

  it.each([
    [100, 100],
    [100_000, 100_000],
    [2500.4, 2500],
  ])('範囲の中の半径 %d m は %d m（端は丸めない・小数は m に）', async (withinM, radiusM) => {
    const result = resolved(await resolve({ near: { station: '竹橋', withinM } }))
    expect(result.area.near?.radiusM).toBe(radiusM)
    expect(result.notes).toEqual([])
  })

  it('半径が無い・起点が無いときは、直し方を返す', async () => {
    expect(failed(await resolve({ near: { station: '竹橋' } })).problems).toEqual([
      { input: 'near', problem: 'near.withinM（起点から何 m 以内か・5km → 5000）が要ります。' },
    ])
    expect(failed(await resolve({ near: { withinM: 3000 } })).problems).toEqual([
      {
        input: 'near',
        problem: 'near は station（起点の駅名か grp）か、lon・lat で起点を指定してください。',
      },
    ])
  })

  it.each([
    ['経度と緯度の取り違え', 35.68, 139.7],
    ['経度の外', 181, 35.68],
    ['数でない', Number.NaN, 35.68],
  ])('地点の %s は、直し方を返す（DB に行かない）', async (_label, lon, lat) => {
    const result = failed(await resolve({ near: { lon, lat, withinM: 1000 } }))
    expect(result.problems).toEqual([
      {
        input: 'near',
        problem:
          'near の lon・lat は経度・緯度です（lon は -180〜180、lat は -90〜90。日本なら lon ≈ 123〜154・lat ≈ 20〜46）。',
      },
    ])
  })

  it('駅でない地点（lon・lat）は「指定した地点」から（索引は読まない）', async () => {
    const deps = depsOf()
    const result = await resolveAreaInput(
      { near: { lon: 139.7, lat: 35.68, withinM: 1000 } },
      NO_CONTEXT,
      deps,
    )
    expect(resolved(result).area.near).toEqual({
      grp: '',
      label: '指定した地点',
      lon: 139.7,
      lat: 35.68,
      radiusM: 1000,
    })
    expect(deps.index).not.toHaveBeenCalled()
  })

  it('範囲は [west, south, east, north]。逆さ・数の違いは直し方を返す', async () => {
    expect(resolved(await resolve({ bbox: [139.5, 35.4, 139.8, 35.6] })).area.bbox).toEqual({
      west: 139.5,
      south: 35.4,
      east: 139.8,
      north: 35.6,
    })
    for (const bbox of [
      [139.8, 35.4, 139.5, 35.6],
      [139.5, 35.4, 139.8],
    ]) {
      expect(failed(await resolve({ bbox })).problems).toEqual([
        {
          input: 'bbox',
          problem:
            'bbox は [west, south, east, north]（経度・緯度・west < east・south < north）の 4 つの数です。',
        },
      ])
    }
  })

  it('決められない言い方が複数あれば、まとめて返す（市区町村 → 起点 → 範囲の順）', async () => {
    const result = failed(
      await resolve({
        municipality: '中区',
        near: { station: 'たけばし', withinM: 1000 },
        bbox: [1, 2, 0, 3],
      }),
    )
    expect(result.problems.map((problem) => problem.input)).toEqual(['中区', 'たけばし', 'bbox'])
  })

  it('説明は市区町村 → 起点 → 半径の順に並ぶ', async () => {
    const result = resolved(
      await resolve(
        { municipality: '中央', near: { station: '日本橋', withinM: 500_000 } },
        { viewport: TOKYO_VIEW },
      ),
    )
    expect(result.notes).toEqual([
      expect.stringContaining('市区町村「中央」は'),
      '半径は 100m〜100km なので、100km にしました。',
    ])
    // 日本橋は東京都の中で 1 つ（決めた市区町村の都道府県で絞った）＝説明は書かない
    expect(result.area.near?.grp).toBe('日本橋#1')
  })
})

describe('地図に表示中の範囲（inMapView・「このあたり」・2026-10-09 B3）', () => {
  const SHIBUYA: Viewport = { west: 139.66, south: 35.63, east: 139.74, north: 35.69 }
  const JAPAN: Viewport = { west: 122.9, south: 24.0, east: 153.9, north: 45.6 }

  it('送られてきた地図の範囲で絞る（範囲はサーバが持っている・索引は読まない）', async () => {
    const deps = depsOf()
    const result = await resolveAreaInput(
      { inMapView: true },
      { prefectures: [], viewport: SHIBUYA },
      deps,
    )
    expect(resolved(result).area).toEqual({ municipality: null, bbox: SHIBUYA, near: null })
    expect(resolved(result).notes).toEqual([])
    expect(deps.index).not.toHaveBeenCalled()
  })

  it('市区町村・起点とも AND（「千代田区のこのあたり」）', async () => {
    const takebashi: Viewport = { west: 139.72, south: 35.66, east: 139.8, north: 35.72 }
    const result = resolved(
      await resolve(
        { inMapView: true, municipality: '千代田区', near: { station: '竹橋', withinM: 1000 } },
        { viewport: takebashi },
      ),
    )
    expect(result.area).toMatchObject({
      municipality: '千代田区',
      bbox: takebashi,
      near: { grp: '竹橋#0', radiusM: 1000 },
    })
  })

  it('false・無しなら地図で絞らない（地図の範囲は名前を決めるのにだけ使う）', async () => {
    for (const input of [{ inMapView: false }, {}]) {
      expect(resolved(await resolve(input, { viewport: SHIBUYA })).area.bbox).toBeNull()
    }
  })

  it.each<[string, AreaInput, Viewport | null, string]>([
    [
      '地図の範囲が届いていない（MCP など）',
      { inMapView: true },
      null,
      '地図の表示範囲が届いていません（地図のある画面のチャットだけで使えます）。地名・駅名で絞るか、範囲を bbox に [west, south, east, north] で渡してください。',
    ],
    [
      '日本全体に近い広さ',
      { inMapView: true },
      JAPAN,
      '地図が日本全体に近い広さなので、「このあたり」がどこか決められません。どのあたりかを利用者に聞いてください（地名・駅名を聞くか、地図を拡大してもらう）。',
    ],
    [
      '数の bbox と一緒',
      { inMapView: true, bbox: [139.6, 35.6, 139.8, 35.7] },
      SHIBUYA,
      'inMapView と bbox は一緒に使いません（地図に表示中の範囲なら inMapView だけ。範囲はサーバが持っています）。',
    ],
  ])('%s → 図を作らずに直し方を返す', async (_label, input, viewport, problem) => {
    expect(failed(await resolve(input, { viewport })).problems).toEqual([
      { input: 'inMapView', problem },
    ])
  })
})

describe('索引を読むのは名前があるときだけ', () => {
  it.each<[string, AreaInput]>([
    ['何も無い', {}],
    ['空白だけの市区町村', { municipality: '　 ' }],
    ['範囲だけ', { bbox: [139.5, 35.4, 139.8, 35.6] }],
    ['座標の起点', { near: { lon: 139.7, lat: 35.68, withinM: 1000 } }],
  ])('%s → 索引を読まない', async (_label, input) => {
    const deps = depsOf()
    const result = await resolveAreaInput(input, NO_CONTEXT, deps)
    expect(result.ok).toBe(true)
    expect(deps.index).not.toHaveBeenCalled()
  })

  it('何も無ければ、エリアは無く都道府県もそのまま', async () => {
    expect(await resolve({}, { prefectures: ['千葉県'] })).toEqual({
      ok: true,
      area: { municipality: null, bbox: null, near: null },
      prefectures: ['千葉県'],
      notes: [],
    })
  })
})

describe('listNames（説明に並べる名前）', () => {
  it('3 つまでは並べ、多ければ先頭 3 つと「など」', () => {
    expect(listNames(['A', 'B', 'C'])).toBe('A・B・C')
    expect(listNames(['A', 'B', 'C', 'D'])).toBe('A・B・C など')
    expect(listNames([])).toBe('')
  })
})
