import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAdminIndex } from '@/ai/area-summary/admin-index'
import { type SummaryAreasDeps } from '@/ai/area-summary/resolve'
import { buildAreaIndex } from '@/ai/area/place-index'
import { resolveAlertPlace, type AlertPlace } from '@/ai/hazard/alert-place'
import { assemble, mapActionsForEffect, promotionsFor, shownEffects } from '@/ai/assemble'
import { TOOL_SPECS, type ToolRunContext } from '@/ai/tool-specs'
import { type HazardAlertsEffect, type ToolEffect } from '@/ai/types'
import { hazardAlertsInMunicipality, unlocatedAlerts } from '@/lib/hazard/alert-source'
import { resetJmaCache } from '@/lib/hazard/jma'
import { mapResponseSchema } from '@/shared/protocol'
import { type Viewport } from '@/shared/viewport'
import { NAME_ROWS, NAME_STATIONS } from './fixtures/area-names'

/**
 * 警報（`getHazardAlerts`）を**名前で**引く（2026-10-15・`docs/261001_fix_user_feedback_ui.md` §6.23）。
 *
 * 以前は駅（grp）か緯度経度が無いと「地点を特定できません」を返し、「札幌市はいま避難した方がいいですか？」で
 * モデルが警報を 1 つも見ないまま答え、市町村の避難情報に従う旨も落とした。いまは名前をサーバが決め、
 * 決まらなくても**注意書きのカードを画面に必ず出す**。
 */

const db = vi.hoisted(() => ({ stationByGrp: vi.fn() }))
vi.mock('@/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries')>()
  return { ...actual, ...db }
})

const names = vi.hoisted(() => ({ summaryAreasDeps: vi.fn() }))
vi.mock('@/ai/area-summary/deps', () => names)

const INDEXES = {
  admin: buildAdminIndex(NAME_ROWS, NAME_STATIONS),
  stations: buildAreaIndex(NAME_STATIONS),
}

const NAME_DEPS: SummaryAreasDeps = {
  adminIndex: async () => INDEXES.admin,
  stationIndex: async () => INDEXES.stations,
  resolveLines: async () => ({ ok: true, filters: { operators: [], lines: [] }, notes: [] }),
}

/** 東京の多摩（東京都の府中市が入る）。 */
const TAMA_VIEW: Viewport = { west: 139.3, south: 35.5, east: 139.9, north: 35.8 }
const CTX: ToolRunContext = { origin: 'http://localhost:3000' }
const REPORTED_AT = '2026-10-15T07:50:00+09:00'
const CALM = { status: '発表警報・注意報はなし' }
/** 対応表の発表区域（横浜市は北部・南部、府中市（東京都）・府中町（広島県）・関内の中区は横浜市）。 */
const AREA_CODES = ['1410011', '1410012', '1320600', '3430200']

/** 気象庁（発表なし）と逆ジオ（関内＝横浜市中区）を差し替え、取りに行った URL を記録する。 */
function stubUpstream(): string[] {
  const urls: string[] = []
  const map = [
    {
      reportDatetime: REPORTED_AT,
      warning: { class20Items: AREA_CODES.map((areaCode) => ({ areaCode, kinds: [CALM] })) },
    },
  ]
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('reverse-geocoder')) return json({ results: { muniCd: '14104' } })
      if (url.includes('/warning/data/r8/map.json')) return json(map)
      if (url.includes('/flood/')) return json([])
      throw new TypeError(`想定していない取得: ${url}`)
    }),
  )
  return urls
}

type Input = Parameters<typeof TOOL_SPECS.getHazardAlerts.run>[0]

async function runAlerts(input: Input, viewport: Viewport | null = null) {
  return TOOL_SPECS.getHazardAlerts.run(input, { ...CTX, viewport })
}

function alertsEffectOf(effects: readonly ToolEffect[]): HazardAlertsEffect {
  const effect = effects.find((each): each is HazardAlertsEffect => each.kind === 'hazardAlerts')
  if (effect === undefined) throw new Error('警報の副産物がありません')
  return effect
}

function placeOf(name: string, viewport: Viewport | null = null): AlertPlace {
  return resolveAlertPlace(name, viewport, INDEXES)
}

beforeEach(() => {
  vi.resetAllMocks()
  resetJmaCache()
  names.summaryAreasDeps.mockReturnValue(NAME_DEPS)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveAlertPlace（名前 → 警報を引く場所）', () => {
  it('市区町村の名前で決める（政令市の市全体・駅の無い町は地図を寄せる先が無い）', () => {
    const yokohama = placeOf('横浜市')
    expect(yokohama).toMatchObject({ kind: 'municipality', code: '14100', placeJa: '横浜市' })
    // 区域の駅（関内・新横浜）の範囲の真ん中
    expect(yokohama.kind === 'municipality' ? yokohama.center : null).toEqual({
      lon: (139.617 + 139.635) / 2,
      lat: (35.444 + 35.507) / 2,
    })
    expect(placeOf('府中町')).toMatchObject({ kind: 'municipality', code: '34302', center: null })
  })

  it('言い方を読み替えたら、都道府県まで書いて取り違えを見えるようにする（「港北」→ 横浜市港北区）', () => {
    const place = placeOf('港北')
    expect(place).toMatchObject({ kind: 'municipality', code: '14109' })
    expect(place.kind === 'municipality' ? place.placeJa : '').toBe('横浜市港北区（神奈川県）')
    expect(place.kind === 'municipality' ? place.notes.join() : '').toContain('として扱いました')
  })

  it('同じ名前は候補を返して聞き返させる（府中市＝東京都・広島県）。地図の範囲で決まればそれ', () => {
    const ambiguous = placeOf('府中市')
    expect(ambiguous.kind).toBe('none')
    if (ambiguous.kind !== 'none') return
    expect(ambiguous.problem.candidates).toHaveLength(2)
    expect(ambiguous.problem.problem).toContain('都道府県を添えた名前')
    expect(ambiguous.screenNoteJa).toContain('府中市（東京都）')
    expect(placeOf('府中市', TAMA_VIEW)).toMatchObject({ kind: 'municipality', code: '13206' })
    expect(placeOf('東京都府中市')).toMatchObject({ kind: 'municipality', code: '13206' })
  })

  it('「◯◯駅」は駅から引き、駅名だけでも市区町村に無ければ駅（駅の位置で引く）', () => {
    expect(placeOf('関内駅')).toMatchObject({ kind: 'station', lon: 139.635, placeJa: '関内駅' })
    expect(placeOf('関内')).toMatchObject({ kind: 'station', placeJa: '関内駅' })
  })

  it('同じ名前の駅は候補（grp）を返す', () => {
    const place = placeOf('府中駅')
    expect(place.kind).toBe('none')
    if (place.kind !== 'none') return
    expect(place.problem.problem).toContain('candidates の station（grp）')
    expect(place.problem.candidates?.length).toBe(2)
  })

  it('都道府県・全国・東京23区の全体・現在地はまとめて引けない（画面に出す一言つき）', () => {
    for (const [name, words] of [
      ['神奈川県', '市区町村ごと'],
      ['神奈川', '市区町村ごと'],
      ['日本', '市区町村ごと'],
      ['東京23区', '区ごと'],
      ['現在地', '現在地が届きません'],
      // 「東京」は都道府県（駅なら「東京駅」と言う）
      ['東京', '市区町村ごと'],
    ] as const) {
      const place = placeOf(name)
      expect(place.kind, name).toBe('none')
      if (place.kind === 'none') expect(place.screenNoteJa, name).toContain(words)
    }
    expect(placeOf('東京駅')).toMatchObject({ kind: 'station', placeJa: '東京駅' })
  })

  it('見つからない名前は、名前を確かめるよう返す', () => {
    const place = placeOf('あいうえお市')
    expect(place.kind).toBe('none')
    if (place.kind === 'none') expect(place.screenNoteJa).toContain('見つかりませんでした')
  })
})

describe('getHazardAlerts（名前だけで呼ばれたとき）', () => {
  it('市区町村の名前なら発表区域で直接引く（逆ジオを使わない・地点を作らない・地図は区域へ寄せる）', async () => {
    const urls = stubUpstream()
    const result = await runAlerts({ placeJa: '横浜市' })
    const effect = alertsEffectOf(result.effects)
    expect(effect.alerts.point).toBeNull()
    expect(effect.alerts.placeJa).toBe('横浜市')
    expect(effect.alerts.headlineJa).toBe(
      '横浜市北部・横浜市南部に、いま発表されている警報・注意報はありません。',
    )
    expect(effect.alerts.sources.map((source) => source.labelJa).join()).not.toContain('国土地理院')
    expect(effect.mapCenter).not.toBeNull()
    expect(urls.some((url) => url.includes('reverse-geocoder'))).toBe(false)
    expect(result.forLlm).toMatchObject({ placeJa: '横浜市', disclaimerJa: expect.any(String) })
  })

  it('駅の名前なら駅の市区町村で引き、駅の位置に印（逆ジオを通らない）', async () => {
    const urls = stubUpstream()
    const effect = alertsEffectOf((await runAlerts({ placeJa: '関内駅' })).effects)
    expect(effect.alerts.point).toMatchObject({ lon: 139.635, lat: 35.444, placeJa: '関内駅' })
    expect(effect.alerts.area?.municipalityJa).toBe('横浜市 中区')
    expect(urls.some((url) => url.includes('reverse-geocoder'))).toBe(false)
    expect(mapActionsForEffect(effect)[0]).toMatchObject({ type: 'showPoint', labelJa: '関内駅' })
  })

  it('決められなければ、モデルには候補・画面には注意書きのカード', async () => {
    stubUpstream()
    const result = await runAlerts({ placeJa: '府中市' })
    expect(result.forLlm).toMatchObject({ error: '場所を決められません' })
    const effect = alertsEffectOf(result.effects)
    expect(effect.alerts.point).toBeNull()
    expect(effect.alerts.area).toBeNull()
    expect(effect.alerts.headlineJa).toBe(
      '「府中市」は場所を決められず、いまの発表を調べていません。',
    )
    expect(effect.alerts.disclaimerJa).toContain('市町村が発表する避難情報')
    // 地図の範囲で決まれば引ける
    const tama = alertsEffectOf((await runAlerts({ placeJa: '府中市' }, TAMA_VIEW)).effects)
    expect(tama.alerts.area?.municipalityJa).toBe('府中市')
  })

  it('名前の索引が読めなくても、注意書きのカードは出す', async () => {
    stubUpstream()
    names.summaryAreasDeps.mockReturnValue({
      ...NAME_DEPS,
      adminIndex: async () => {
        throw new Error('DB に届かない')
      },
    })
    const result = await runAlerts({ placeJa: '横浜市' })
    expect(result.forLlm).toMatchObject({ error: '場所を決められません' })
    expect(alertsEffectOf(result.effects).alerts.notesJa.join()).toContain('場所の一覧を読めず')
  })

  it('駅（grp）で呼ばれたら、いままでどおり地点で引く（名前は呼び名）', async () => {
    stubUpstream()
    db.stationByGrp.mockResolvedValue({ lon: 139.635, lat: 35.444, label: '関内' })
    const effect = alertsEffectOf((await runAlerts({ grp: '関内#0', placeJa: '横浜市' })).effects)
    expect(effect.alerts.point).toMatchObject({ lon: 139.635, placeJa: '横浜市' })
    expect(names.summaryAreasDeps).not.toHaveBeenCalled()
  })
})

describe('画面に出すもの（assemble）', () => {
  const unlocated: HazardAlertsEffect = {
    kind: 'hazardAlerts',
    alerts: unlocatedAlerts(
      '府中市',
      '「府中市」は 府中市（東京都）・府中市（広島県） にあります。',
    ),
  }

  async function namedEffect(): Promise<HazardAlertsEffect> {
    stubUpstream()
    const alerts = await hazardAlertsInMunicipality({ code: '14100', placeJa: '横浜市', now: 0 })
    return { kind: 'hazardAlerts', alerts, mapCenter: { lon: 139.626, lat: 35.4755 } }
  }

  it('決められなかったカードは、同じ回答で引けた警報があれば出さない（⤢ の並びもずれない）', async () => {
    const named = await namedEffect()
    const effects: ToolEffect[] = [unlocated, named]
    expect(shownEffects(effects)).toEqual([named])
    const response = assemble(effects, '横浜市は発表なしです。')
    expect(response.panels).toHaveLength(1)
    expect(response.panels[0]).toMatchObject({ type: 'hazardCard', placeJa: '横浜市' })
    expect(promotionsFor(effects)).toHaveLength(response.panels.length)
  })

  it('決められないままなら、注意書きのカードは最後の 1 枚だけ', () => {
    const second: HazardAlertsEffect = {
      kind: 'hazardAlerts',
      alerts: unlocatedAlerts('神奈川県', '警報は市区町村ごとに出ます。'),
    }
    expect(shownEffects([unlocated, second])).toEqual([second])
  })

  it('名前で引いた警報は印を置かず区域へ寄せる。決められなかったら地図は動かさない', async () => {
    const actions = mapActionsForEffect(await namedEffect())
    expect(actions).toEqual([{ type: 'flyTo', lon: 139.626, lat: 35.4755, zoom: 11 }])
    expect(mapActionsForEffect(unlocated)).toEqual([])
  })

  it('注意書き（市町村の避難情報に従う）と限界は、どのカードにも入る。バッジは「未確認」「発表なし」', async () => {
    const response = mapResponseSchema.parse(assemble([unlocated], ''))
    const card = response.panels[0]
    expect(card?.type).toBe('hazardCard')
    if (card?.type !== 'hazardCard') return
    expect(card.disclaimerJa).toContain('市町村が発表する避難情報に従ってください')
    expect(card.coverageNotesJa.join()).toContain(
      '避難情報（警戒レベル4「避難指示」など）を出すのは市町村',
    )
    expect(card.levelLabelJa).toBe('未確認')
    const named = mapResponseSchema.parse(assemble([await namedEffect()], '')).panels[0]
    expect(named?.type === 'hazardCard' ? named.levelLabelJa : null).toBe('発表なし')
  })
})
