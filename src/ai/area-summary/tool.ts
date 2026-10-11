/**
 * AI の道具 `getAreaSummary`（MCP は `get_area_summary`・2026-10-11 B5d・`docs/261001_fix_user_feedback_ui.md` §6.12.9）。
 *
 * 市区町村・都道府県・路線の沿線・起点の駅から N m・地図の表示範囲の**全体**（区域の値・推移・将来・内訳・比較）と、
 * 地図の駅の色分けを 1 回で返す。共通 API（`/api/areas/summary`）と同じ `loadAreaSummary` を呼ぶ——画面と AI が同じ答えを出す。
 *
 * - 名前は B2・L3・B3 と同じ決め方で決め（`resolve.ts`）、決まらなければ図を作らずに候補を返す（推測で選ばない）
 * - 色分けの指標はほかの道具と同じくファミリ名かキーで受け、半径つきのキーに決める（`metric-resolver.ts`）
 * - 答え方は返却の `answerGuide` に載せる（`for-llm.ts`）
 * - 地図の範囲（`inMapView`）はアプリのチャットだけ。MCP には地図が無いので、その引数を見せない（`MCP_INPUT_SCHEMA`）。
 *   道具の説明にも書かない（`AREA_SUMMARY_DESCRIPTION_JA` の注）
 */

import { z } from 'zod'
import { loadAreaSummary, NO_COLORING } from '@/domain/area-summary/load'
import { DEFAULT_LINE_WIDTH_M, LINE_WIDTHS_M, MAX_AREAS } from '@/shared/area-ref'
import { isRadiusM, RADII_M, radiusLabel, type RadiusM } from '@/shared/constants'
import { resolveMetricKey } from '@/ai/metric-resolver'
// 型だけ（`tool-specs.ts` がこのファイルを読むので、実行時の循環を作らない）。
import type { ToolRunContext, ToolRunResult } from '@/ai/tool-specs'
import { summaryAreasDeps } from './deps'
import { areaSummaryForLlm } from './for-llm'
import { resolveSummaryAreas, type SummaryAreaProblem } from './resolve'

/** 駅の周りの値の既定の半径（B4 の性格の目安・沿線の既定と同じ 1km・§6.12.15）。 */
const DEFAULT_RADIUS_M: RadiusM = 1000

/** 「色分けしない」の言い方。 */
const NO_COLORING_WORDS: readonly string[] = [NO_COLORING, 'なし', '色分けしない']

/**
 * 道具の説明（アプリのチャットと MCP が読む）。本物の Gemini の評価で、ここに書いた言葉がほかの問の最初の一手を変えたので、
 * 3 つを書かない（§6.17.1）。足すより外すほうが安全で、言い換えて足すと別の問が崩れた：
 * - **駅の道具の名前**：「1 つの駅の値は駅の道具（getStationDetail・getStationProfile）」と書くと、「東京駅の人口推移を教えて」が
 *   5 回とも getStationProfile を呼んだ（main は getStationDetail だけ）
 * - **地図の表示範囲**：「…地図の表示範囲の全体」と書くと、「この区で人口が増えている駅は？」が地図の範囲で絞った（区で答えたのは
 *   10 回中 6 回・main は 10 回中 10 回。外して 9 回中 9 回）。地図の範囲は `areas[].inMapView` の説明だけに書く
 * - **起点の駅から N m**：冒頭に書くと、「東京駅と新宿駅の人口を比べて」を「駅から 1km」のエリア 2 つとして比べた（5 回中 5 回・
 *   main は駅詳細で 3 回中 3 回。外して 3 回中 3 回）。起点の駅は `areas[].near` の説明だけに書く（「竹橋から 5km 圏」はそれで当たる）
 */
export const AREA_SUMMARY_DESCRIPTION_JA =
  '市区町村・都道府県・路線の沿線の**全体**を 1 回で返す：区域の人口（市区町村・都道府県は 2025 年の国勢調査までの公表値）と増減、' +
  '将来推計人口（2050 年まで・推計の山・2025 年の実績との差）、事業所と従業者、区・市区町村・駅ごとの内訳、2〜4 つのエリアの比較、エリアの駅の周りの値の分布。' +
  '地図ではエリアの駅を指標の値で色分けする（colorBy・地図はその範囲へ寄る）。' +
  '「横浜市全体の人口は増えている？」「東横線の沿線の人口は 2050 年までにどうなる？」「横浜市のどのあたりで伸びている？」（区ごとの内訳）・' +
  '「横浜市と川崎市を比べて」（areas に 2 つ）・「横浜市の駅を地価で色分けして」（colorBy:"lp_med"）はこれを 1 回。' +
  '駅を並べる問い（「人口が増えている駅は？」）は rankStations。' +
  '名前はサーバが決める（決まらなければ図を作らずに候補を返す）。答え方は返却の answerGuide に従う。'

const PREFECTURE_DESCRIPTION =
  '都道府県（「神奈川県」「神奈川」・全国は「全国」）。これだけなら都道府県の全体。municipality・line・near に添えると、同じ名前を絞る範囲になる'
const MUNICIPALITY_DESCRIPTION =
  '市区町村（「横浜市」で市全体・「港北区」・「大磯町」・東京 23 区の全体は「東京23区」）。駅の無い町村も。同じ名前が複数あれば候補が返る'
const LINE_DESCRIPTION =
  '路線の沿線（ふだんの呼び方でよい「東急東横線」「山手線」）。沿線＝路線の駅から widthM の円を重ねた範囲'
const WIDTH_DESCRIPTION = `沿線の幅（駅から ${LINE_WIDTHS_M.join('/')} m・既定 ${DEFAULT_LINE_WIDTH_M}）。line のときだけ`
const NEAR_DESCRIPTION =
  '起点の駅から N m の円（「竹橋から 5km」→ station:"竹橋"・withinM:5000）。station は駅名か searchStations の grp'
const IN_MAP_VIEW_DESCRIPTION =
  'true で、利用者の地図に表示中の範囲（「このあたり」「この辺」）。範囲はサーバが持っているので数は書かない。頼まれていないのに使わない'

const nearSchema = z
  .object({
    station: z.string().describe('起点の駅名（例「竹橋」）か searchStations が返した grp'),
    withinM: z.number().describe('起点から何 m 以内か（5km → 5000）'),
  })
  .describe(NEAR_DESCRIPTION)

/** エリア 1 つ（地図の範囲を除く・MCP にも見せる形）。 */
const areaShape = {
  prefecture: z.string().optional().describe(PREFECTURE_DESCRIPTION),
  municipality: z.string().optional().describe(MUNICIPALITY_DESCRIPTION),
  line: z.string().optional().describe(LINE_DESCRIPTION),
  widthM: z.number().optional().describe(WIDTH_DESCRIPTION),
  near: nearSchema.optional(),
}
/** エリア 1 つの説明（アプリのチャットは地図の範囲を含む・MCP は含まない）。 */
const AREA_DESCRIPTION =
  'エリア 1 つ。prefecture・municipality・line・near・inMapView のどれか 1 つ（prefecture は municipality・line・near に添えてもよい）'
const MCP_AREA_DESCRIPTION =
  'エリア 1 つ。prefecture・municipality・line・near のどれか 1 つ（prefecture は municipality・line・near に添えてもよい）'
const AREAS_DESCRIPTION = `エリア 1〜${MAX_AREAS} つ（2 つ以上は比較・同じ年で比べる）`
const COLOR_BY_DESCRIPTION =
  '地図の色分けの指標（ファミリ名 pop_gr・pop・pop_gr_pred・lp_med・lp_gr・emp_n など、またはカタログキー）。省略で人口の増減（5 年）。"none" で色分けしない'
const RADIUS_DESCRIPTION = `駅の周りの値の半径(m)：${RADII_M.join('/')}。省略時 ${DEFAULT_RADIUS_M}（色分けの指標もこの半径）`

const commonShape = {
  colorBy: z.string().optional().describe(COLOR_BY_DESCRIPTION),
  radiusM: z.number().optional().describe(RADIUS_DESCRIPTION),
}

/** アプリのチャットの入力（エリアに地図の範囲を含む）。 */
export const AREA_SUMMARY_INPUT_SCHEMA = z.object({
  areas: z
    .array(
      z
        .object({
          ...areaShape,
          inMapView: z.boolean().optional().describe(IN_MAP_VIEW_DESCRIPTION),
        })
        .describe(AREA_DESCRIPTION),
    )
    .min(1)
    .max(MAX_AREAS)
    .describe(AREAS_DESCRIPTION),
  ...commonShape,
})
export type AreaSummaryToolInput = z.output<typeof AREA_SUMMARY_INPUT_SCHEMA>

/**
 * MCP に見せる入力（地図の範囲は無い）。MCP の SDK はこの型で入力を検めるので、`areas[].inMapView` が送られてきても
 * 外れて空のエリアになり、理由（書ける引数の一覧・inMapView を含めない）つきで断る。
 */
export const MCP_INPUT_SCHEMA = z.object({
  areas: z
    .array(z.object(areaShape).describe(MCP_AREA_DESCRIPTION))
    .min(1)
    .max(MAX_AREAS)
    .describe(AREAS_DESCRIPTION),
  ...commonShape,
})

type HintError = { readonly error: string; readonly hint: string }
type ProblemsError = HintError & { readonly problems: readonly SummaryAreaProblem[] }
type MetricError = HintError & { readonly didYouMean: readonly string[] }

/** 色分けの指標（undefined＝既定・NO_COLORING＝しない）と、決め方の説明。 */
type ColorChoice =
  | { readonly ok: true; readonly colorBy: string | undefined; readonly note: string | null }
  | { readonly ok: false; readonly error: MetricError }

function colorChoiceOf(colorBy: string | undefined, radiusM: RadiusM): ColorChoice {
  const text = colorBy?.trim() ?? ''
  if (text === '') return { ok: true, colorBy: undefined, note: null }
  if (NO_COLORING_WORDS.includes(text)) return { ok: true, colorBy: NO_COLORING, note: null }
  const resolved = resolveMetricKey({ metric: text, radiusM })
  if (!resolved.ok) {
    const { error, hint, didYouMean } = resolved
    return { ok: false, error: { error, hint, didYouMean } }
  }
  return { ok: true, colorBy: resolved.key, note: resolved.note }
}

/** 駅の周りの半径（6 つ以外は 1km に丸め、丸めたと言う）。 */
function radiusOf(radiusM: number | undefined): {
  readonly radius: RadiusM
  readonly note: string | null
} {
  if (radiusM === undefined) return { radius: DEFAULT_RADIUS_M, note: null }
  if (isRadiusM(radiusM)) return { radius: radiusM, note: null }
  return {
    radius: DEFAULT_RADIUS_M,
    note: `半径 ${radiusM}m は無いため、${radiusLabel(DEFAULT_RADIUS_M)}圏で集計しました。`,
  }
}

const AREA_SUMMARY_HINT_JA =
  'エリアの書き方を見直して呼び直してください（市区町村・都道府県・路線・起点の駅・地図の範囲のどれか）。'

export type AreaSummaryForLlm = ReturnType<typeof areaSummaryForLlm>
type AreaSummaryRun = ToolRunResult<AreaSummaryForLlm | ProblemsError | MetricError | HintError>

/** 決まったエリアを要約する（共通 API と同じ `loadAreaSummary`）。`notes` は名前と半径の決め方。 */
async function summarize(
  areas: readonly string[],
  radiusM: RadiusM,
  color: Extract<ColorChoice, { readonly ok: true }>,
  notes: readonly string[],
): Promise<AreaSummaryRun> {
  const result = await loadAreaSummary({ areas, radiusM, colorBy: color.colorBy })
  if (!result.ok) {
    return { effects: [], forLlm: { error: result.messageJa, hint: AREA_SUMMARY_HINT_JA } }
  }
  return {
    effects: [{ kind: 'areaSummary', response: result.response }],
    forLlm: areaSummaryForLlm(result.response, notes, color.note),
  }
}

/** 道具の実行（名前を決めてから、共通 API と同じ組み立てで要約する）。 */
export async function runAreaSummary(
  input: AreaSummaryToolInput,
  ctx: ToolRunContext,
): Promise<AreaSummaryRun> {
  const { radius, note: radiusNote } = radiusOf(input.radiusM)
  const color = colorChoiceOf(input.colorBy, radius)
  if (!color.ok) return { effects: [], forLlm: color.error }
  const areas = await resolveSummaryAreas(input.areas, ctx.viewport ?? null, summaryAreasDeps())
  if (!areas.ok) {
    const { error, hint, problems } = areas
    return { effects: [], forLlm: { error, hint, problems } }
  }
  const notes = [...areas.notes, ...(radiusNote === null ? [] : [radiusNote])]
  return summarize(areas.areas, radius, color, notes)
}
