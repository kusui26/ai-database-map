/**
 * エリアの文字列（共通 API・URL・⤢・地図の操作で同じ形・2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.3）。
 *
 * | 書き方 | 意味 |
 * |---|---|
 * | `jp` | 全国 |
 * | `pref:14` | 都道府県（JIS の 2 桁） |
 * | `muni:14100` | 市区町村・政令市の市全体・政令市の区・東京 23 区（`13100`）（JIS の 5 桁） |
 * | `line:26001@1000` | 沿線（路線コード＠駅からの幅 m：500・1000・2000） |
 * | `near:竹橋#0@5000` | 起点の駅（grp）から N m（100〜100,000） |
 * | `bbox:139.55,35.40,139.72,35.53` | 範囲（西,南,東,北） |
 *
 * 言い方（「横浜市」「東横線」「竹橋」）を決めるのは AI の入口・画面の選択肢で、ここは決まった値だけを読み書きする。
 * 初期バンドル（地図の URL）からも読むので zod は持ち込まない（範囲の検証は `viewport.ts`）。
 */

import { NEAR_MAX_RADIUS_M, NEAR_MIN_RADIUS_M } from './constants'
import { viewportFromTuple, viewportToTuple, type Viewport } from './viewport'

/** 沿線の幅（駅からの距離・m）。既定は 1km（§12-22）。 */
export const LINE_WIDTHS_M = [500, 1000, 2000] as const
export type LineWidthM = (typeof LINE_WIDTHS_M)[number]
export const DEFAULT_LINE_WIDTH_M: LineWidthM = 1000

/** 1 回の要約・色分けで指せるエリアの数（2 つ以上は比較）。 */
export const MAX_AREAS = 4

export type AreaRef =
  | { readonly type: 'country' }
  | { readonly type: 'prefecture'; readonly code: string }
  | { readonly type: 'municipality'; readonly code: string }
  | { readonly type: 'line'; readonly lineCd: number; readonly widthM: LineWidthM | null }
  | { readonly type: 'near'; readonly grp: string; readonly withinM: number }
  | { readonly type: 'bbox'; readonly bbox: Viewport }

export type AreaRefParse =
  { readonly ok: true; readonly ref: AreaRef } | { readonly ok: false; readonly messageJa: string }

/** 書き方の一覧（誤りの直し方と、自己記述のカタログに出す）。 */
export const AREA_REF_FORMATS_JA: readonly string[] = [
  'jp（全国）',
  'pref:14（都道府県・JIS の 2 桁）',
  'muni:14100（市区町村・政令市の市全体・区・東京 23 区は muni:13100・JIS の 5 桁）',
  'line:26001@1000（沿線・路線コード＠駅からの幅 500／1000／2000 m）',
  'near:竹橋#0@5000（起点の駅の grp＠m・100〜100,000）',
  'bbox:139.55,35.40,139.72,35.53（範囲・西,南,東,北）',
]

const PREF_CODE = /^(0[1-9]|[1-3]\d|4[0-7])$/
const MUNI_CODE = /^\d{5}$/
const POSITIVE_INT = /^[1-9]\d*$/

function failure(text: string, why: string): AreaRefParse {
  return {
    ok: false,
    messageJa: `エリアの書き方が正しくない: ${text}（${why}）。書き方は ${AREA_REF_FORMATS_JA.join('／')}`,
  }
}

function isLineWidth(value: number): value is LineWidthM {
  return LINE_WIDTHS_M.some((width) => width === value)
}

function parseLine(text: string, body: string): AreaRefParse {
  const [code, width, extra] = body.split('@')
  if (code === undefined || !POSITIVE_INT.test(code) || extra !== undefined) {
    return failure(text, '路線コードは正の整数')
  }
  if (width === undefined)
    return { ok: true, ref: { type: 'line', lineCd: Number(code), widthM: null } }
  const widthM = Number(width)
  if (!isLineWidth(widthM))
    return failure(text, `沿線の幅は ${LINE_WIDTHS_M.join('・')} m のどれか`)
  return { ok: true, ref: { type: 'line', lineCd: Number(code), widthM } }
}

function parseNear(text: string, body: string): AreaRefParse {
  const at = body.lastIndexOf('@')
  const grp = at > 0 ? body.slice(0, at) : ''
  const within = at > 0 ? body.slice(at + 1) : ''
  if (grp === '' || !POSITIVE_INT.test(within)) return failure(text, '起点の駅の grp＠m')
  const withinM = Number(within)
  if (withinM < NEAR_MIN_RADIUS_M || withinM > NEAR_MAX_RADIUS_M) {
    return failure(text, `距離は ${NEAR_MIN_RADIUS_M}〜${NEAR_MAX_RADIUS_M} m`)
  }
  return { ok: true, ref: { type: 'near', grp, withinM } }
}

function parseBox(text: string, body: string): AreaRefParse {
  const parts = body.split(',').map((part) => part.trim())
  const numbers = parts.map(Number)
  const bbox = parts.some((part) => part === '') ? null : viewportFromTuple(numbers)
  return bbox === null
    ? failure(text, '範囲は「西,南,東,北」の 4 つの数（西＜東・南＜北）')
    : { ok: true, ref: { type: 'bbox', bbox } }
}

function parsePref(text: string, body: string): AreaRefParse {
  return PREF_CODE.test(body)
    ? { ok: true, ref: { type: 'prefecture', code: body } }
    : failure(text, '都道府県は 01〜47 の 2 桁')
}

function parseMuni(text: string, body: string): AreaRefParse {
  return MUNI_CODE.test(body)
    ? { ok: true, ref: { type: 'municipality', code: body } }
    : failure(text, '市区町村は JIS の 5 桁')
}

/** 頭（「pref」など）→ 読み方。Map で引く（オブジェクトだと「constructor:」のような頭が既定のプロパティに当たる）。 */
const PARSERS: ReadonlyMap<string, (text: string, body: string) => AreaRefParse> = new Map([
  ['pref', parsePref],
  ['muni', parseMuni],
  ['line', parseLine],
  ['near', parseNear],
  ['bbox', parseBox],
])

/** エリアの文字列 → エリア（誤りは直し方つきの理由）。 */
export function parseAreaRef(raw: string): AreaRefParse {
  const text = raw.trim()
  if (text === 'jp') return { ok: true, ref: { type: 'country' } }
  const colon = text.indexOf(':')
  const parser = colon < 0 ? undefined : PARSERS.get(text.slice(0, colon))
  if (parser === undefined) return failure(text, '頭は jp・pref・muni・line・near・bbox のどれか')
  return parser(text, text.slice(colon + 1))
}

/** エリア → 文字列（`parseAreaRef` の逆）。 */
export function formatAreaRef(ref: AreaRef): string {
  switch (ref.type) {
    case 'country':
      return 'jp'
    case 'prefecture':
      return `pref:${ref.code}`
    case 'municipality':
      return `muni:${ref.code}`
    case 'line':
      return ref.widthM === null ? `line:${ref.lineCd}` : `line:${ref.lineCd}@${ref.widthM}`
    case 'near':
      return `near:${ref.grp}@${ref.withinM}`
    case 'bbox':
      return `bbox:${viewportToTuple(ref.bbox).join(',')}`
  }
}
