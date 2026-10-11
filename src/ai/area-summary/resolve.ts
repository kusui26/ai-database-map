/**
 * `getAreaSummary` のエリアの言い方 → エリアの文字列（`muni:14100`・`line:26001@1000` など・2026-10-11 B5d・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.9）。
 *
 * 1 つのエリアは、市区町村（municipality）・路線の沿線（line）・起点の駅から N m（near）・地図の範囲（inMapView）の
 * **どれか 1 つ**か、都道府県（prefecture）だけ。prefecture を市区町村・路線・起点に添えると、同じ名前を絞る範囲になる。
 * 名前は B2（市区町村・起点の駅）・L3（路線）・B3（地図の範囲）と同じ決め方で決め、決まらなければ候補を返す
 * （推測で選ばない）。市区町村は**全区域の索引**で引く（駅の無い町村も・`admin-index.ts`）。
 */

import { resolveMunicipality } from '@/ai/area/municipality'
import { isTooWideForArea } from '@/ai/area/map-view'
import { resolveOrigin } from '@/ai/area/origin'
import { prefectureNamed, placeKey } from '@/ai/area/keys'
import { type AreaIndex } from '@/ai/area/place-index'
import { type AreaProblem } from '@/ai/area/problems'
import { type NameProblem, type NameRequest, type NameResolution } from '@/ai/routes/resolve'
import { type LineRef } from '@/shared/api'
import {
  DEFAULT_LINE_WIDTH_M,
  formatAreaRef,
  LINE_WIDTHS_M,
  type LineWidthM,
} from '@/shared/area-ref'
import { distanceLabel, NEAR_MAX_RADIUS_M, NEAR_MIN_RADIUS_M } from '@/shared/constants'
import { type Viewport } from '@/shared/viewport'
import { COUNTRY_KEY, COUNTRY_NAMES, type AdminIndex } from './admin-index'

/** ツールのエリア 1 つ（言い方のまま）。 */
export type SummaryAreaInput = {
  readonly prefecture?: string
  readonly municipality?: string
  readonly line?: string
  readonly widthM?: number
  readonly near?: { readonly station: string; readonly withinM: number }
  readonly inMapView?: boolean
}

export type SummaryAreasDeps = {
  /** 全区域の索引（市区町村・都道府県）。 */
  readonly adminIndex: () => Promise<AdminIndex>
  /** 駅の索引（起点の駅・B2）。 */
  readonly stationIndex: () => Promise<AreaIndex>
  /** 路線の名前の解決（L3 の `resolveNameFilters`・同じ名前の路線は都道府県 → 地図の範囲で決める）。 */
  readonly resolveLines: (request: NameRequest) => Promise<NameResolution>
}

export type SummaryAreaProblem = AreaProblem | NameProblem

export type SummaryAreasResolution =
  | { readonly ok: true; readonly areas: readonly string[]; readonly notes: readonly string[] }
  | {
      readonly ok: false
      readonly error: string
      readonly hint: string
      readonly problems: readonly SummaryAreaProblem[]
    }

type Failure = { readonly ok: false; readonly problems: readonly SummaryAreaProblem[] }
type Step = { readonly ok: true; readonly ref: string; readonly notes: readonly string[] } | Failure

type Context = {
  readonly label: string
  readonly scope: readonly string[]
  readonly viewport: Viewport | null
  readonly deps: SummaryAreasDeps
}

export const AREAS_HINT_JA =
  'problems の各項目を見てください。candidates は呼び直しにそのまま使える値です（市区町村は municipality と prefecture、起点の駅は near.station に grp、' +
  '路線は line に routes の名前）。会話から地域が分かるときだけ選び、分からなければどれかを利用者に聞いてください（推測で選ばない。' +
  '地図の表示範囲はもう使ってあり、それでも決まらなかった候補です）。'

function fail(input: string, problem: string): Failure {
  return { ok: false, problems: [{ input, problem }] }
}

/** 1 つのエリアが指すもの（どれも無ければ都道府県だけ・2 つ以上は誤り）。 */
function targetsOf(input: SummaryAreaInput): string[] {
  return [
    ...(input.municipality?.trim() ? ['municipality'] : []),
    ...(input.line?.trim() ? ['line'] : []),
    ...(input.near === undefined ? [] : ['near']),
    ...(input.inMapView === true ? ['inMapView'] : []),
  ]
}

function isCountry(text: string): boolean {
  return COUNTRY_NAMES.some((name) => placeKey(name) === placeKey(text))
}

/** 都道府県だけのエリア（全国も）。 */
async function prefectureStep(text: string, context: Context): Promise<Step> {
  if (isCountry(text)) return { ok: true, ref: COUNTRY_KEY, notes: [] }
  const name = prefectureNamed(text)
  const key = name === null ? undefined : (await context.deps.adminIndex()).prefectureKeys.get(name)
  if (key === undefined) {
    return fail(
      text,
      `都道府県「${text}」が分かりません（「神奈川県」「神奈川」のように・全国は「全国」）。`,
    )
  }
  return { ok: true, ref: key, notes: [] }
}

async function municipalityStep(name: string, context: Context): Promise<Step> {
  const index = await context.deps.adminIndex()
  const result = resolveMunicipality(name, context.scope, context.viewport, index)
  return result.ok
    ? { ok: true, ref: result.place.key, notes: result.notes }
    : { ok: false, problems: [result.problem] }
}

/** 沿線の幅（500m・1km・2km のいちばん近いもの。違えば説明に書く）。 */
function lineWidth(widthM: number | undefined): {
  readonly width: LineWidthM
  readonly notes: string[]
} {
  if (widthM === undefined) return { width: DEFAULT_LINE_WIDTH_M, notes: [] }
  const width = LINE_WIDTHS_M.reduce((best, each) =>
    Math.abs(each - widthM) < Math.abs(best - widthM) ? each : best,
  )
  const notes =
    width === widthM
      ? []
      : [
          `沿線の幅は ${LINE_WIDTHS_M.map(distanceLabel).join('・')} なので、駅から ${distanceLabel(width)} にしました。`,
        ]
  return { width, notes }
}

/** 名前が決めた路線が 1 本か（会社の名前・区間で分かれる路線は、理由と名前を返す）。 */
function singleLine(
  name: string,
  lines: readonly LineRef[],
): { readonly ok: true; readonly lineCd: number } | Failure {
  const first = lines[0]
  if (first === undefined) {
    return fail(
      name,
      `「${name}」は会社の名前です。line には路線の名前（「東急東横線」など）を渡してください。`,
    )
  }
  if (lines.length === 1) return { ok: true, lineCd: first.lineCd }
  const names = lines.map((line) => line.name)
  const problem = `「${name}」は ${lines.length} 本の路線に分かれます（${names.join('・')}）。1 本の名前を line に渡してください（比べるなら areas を分ける）。`
  return { ok: false, problems: [{ input: name, problem, didYouMean: names }] }
}

async function lineStep(name: string, input: SummaryAreaInput, context: Context): Promise<Step> {
  const resolution = await context.deps.resolveLines({
    routes: [name],
    prefectures: context.scope,
    viewport: context.viewport,
  })
  if (!resolution.ok) return { ok: false, problems: resolution.problems }
  const line = singleLine(name, resolution.filters.lines)
  if (!line.ok) return line
  const { width, notes } = lineWidth(input.widthM)
  const ref = formatAreaRef({ type: 'line', lineCd: line.lineCd, widthM: width })
  return { ok: true, ref, notes: [...resolution.notes, ...notes] }
}

/** 起点から何 m か（範囲に収める・違えば説明に書く）。 */
function withinOf(withinM: number): { readonly within: number; readonly notes: string[] } {
  const within = Math.min(Math.max(Math.round(withinM), NEAR_MIN_RADIUS_M), NEAR_MAX_RADIUS_M)
  const notes =
    within === Math.round(withinM)
      ? []
      : [
          `起点からの距離は ${distanceLabel(NEAR_MIN_RADIUS_M)}〜${distanceLabel(NEAR_MAX_RADIUS_M)} なので、${distanceLabel(within)} にしました。`,
        ]
  return { within, notes }
}

async function nearStep(
  near: NonNullable<SummaryAreaInput['near']>,
  context: Context,
): Promise<Step> {
  const index = await context.deps.stationIndex()
  const origin = resolveOrigin(near.station, context.scope, context.viewport, index, 'prefecture')
  if (!origin.ok) return { ok: false, problems: [origin.problem] }
  const { within, notes } = withinOf(near.withinM)
  const ref = formatAreaRef({ type: 'near', grp: origin.station.grp, withinM: within })
  return { ok: true, ref, notes: [...origin.notes, ...notes] }
}

function mapViewStep(context: Context): Step {
  const { viewport } = context
  if (viewport === null) {
    return fail(
      'inMapView',
      '地図の表示範囲が届いていません（地図のある画面のチャットだけで使えます）。市区町村・路線・起点の駅でエリアを指定してください。',
    )
  }
  if (isTooWideForArea(viewport)) {
    return fail(
      'inMapView',
      '地図が日本全体に近い広さなので、「このあたり」がどこか決められません。どのあたりかを利用者に聞いてください（地名・駅名を聞くか、地図を拡大してもらう）。',
    )
  }
  return { ok: true, ref: formatAreaRef({ type: 'bbox', bbox: viewport }), notes: [] }
}

/** prefecture を、同じ名前を絞る範囲として読む（全国は絞らない）。 */
function scopeOf(prefecture: string | undefined): readonly string[] | null {
  const text = prefecture?.trim() ?? ''
  if (text === '' || isCountry(text)) return []
  const name = prefectureNamed(text)
  return name === null ? null : [name]
}

async function targetStep(
  target: string,
  input: SummaryAreaInput,
  context: Context,
): Promise<Step> {
  switch (target) {
    case 'municipality':
      return municipalityStep(input.municipality?.trim() ?? '', context)
    case 'line':
      return lineStep(input.line?.trim() ?? '', input, context)
    case 'near':
      return input.near === undefined
        ? fail(context.label, 'near が空です。')
        : nearStep(input.near, context)
    default:
      return mapViewStep(context)
  }
}

/**
 * 指すものが無いエリア（都道府県だけ・全国も。それも無ければ空）。空のときに挙げる書き方は、地図の範囲が届いているときだけ
 * inMapView を含める——MCP（地図が無い）では、SDK が広告した入力の型（inMapView が無い）で外すので `{ inMapView: true }` も空になる。
 * そこで inMapView を勧めると、同じ呼び直しを繰り返させる。
 */
async function prefectureOnlyStep(prefecture: string, context: Context): Promise<Step> {
  if (prefecture !== '') return prefectureStep(prefecture, context)
  const fields = ['prefecture', 'municipality', 'line', 'near']
  const usable = context.viewport === null ? fields : [...fields, 'inMapView']
  return fail(context.label, `エリアが空です（${usable.join('・')} のどれかを書く）。`)
}

/** エリア 1 つ → エリアの文字列。 */
async function areaStep(
  input: SummaryAreaInput,
  position: number,
  viewport: Viewport | null,
  deps: SummaryAreasDeps,
): Promise<Step> {
  const label = `areas[${position}]`
  const targets = targetsOf(input)
  const prefecture = input.prefecture?.trim() ?? ''
  const context: Context = { label, scope: [], viewport, deps }
  if (targets.length > 1) {
    const listed = targets.join('・')
    return fail(
      label,
      `1 つのエリアに ${listed} があります。1 つのエリアには 1 つだけ（比べるなら areas を分ける）。`,
    )
  }
  const target = targets[0]
  if (target === undefined) return prefectureOnlyStep(prefecture, context)
  const scope = scopeOf(prefecture)
  if (scope === null) return fail(prefecture, `都道府県「${prefecture}」が分かりません。`)
  return targetStep(target, input, { ...context, scope })
}

/** 同じエリアを 2 度は書かない（1 つにして説明に書く）。 */
function unique(steps: readonly Extract<Step, { ok: true }>[]): {
  readonly areas: string[]
  readonly notes: string[]
} {
  const areas = [...new Set(steps.map((step) => step.ref))]
  const notes = steps.flatMap((step) => step.notes)
  const merged =
    steps.length === areas.length ? [] : ['同じエリアが重なっていたので、1 つにまとめました。']
  return { areas, notes: [...notes, ...merged] }
}

/** エリアの言い方（1〜4）→ エリアの文字列（決まらなければ、すべての理由を候補つきで）。 */
export async function resolveSummaryAreas(
  inputs: readonly SummaryAreaInput[],
  viewport: Viewport | null,
  deps: SummaryAreasDeps,
): Promise<SummaryAreasResolution> {
  const steps = await Promise.all(
    inputs.map((input, position) => areaStep(input, position, viewport, deps)),
  )
  const problems = steps.flatMap((step) => (step.ok ? [] : step.problems))
  if (problems.length > 0) {
    return {
      ok: false,
      error: 'エリア（市区町村・都道府県・路線・起点の駅・地図の範囲）を決められませんでした',
      hint: AREAS_HINT_JA,
      problems,
    }
  }
  const resolved = steps.flatMap((step) => (step.ok ? [step] : []))
  return { ok: true, ...unique(resolved) }
}
