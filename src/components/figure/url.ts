/**
 * 開いている図（ランキング・散布・エリア）の URL（`?fig` と条件）。キャンバス・モーダル・FAB・チャットの ⤢ が
 * **同じ 1 つの状態**を読み書きする（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §5.5。エリアは 2026-10-15 B5e・§6.12.10）。
 *
 * ## なぜ URL に載せるか
 *
 * 図を開いたら、ブラウザの「戻る」で閉じたい（フィードバック #4）。以前は図の状態が Zustand と
 * FAB の `useState` にしか無く、戻る・進む・リロード・共有リンクのどれでも開き直せなかった。
 *
 * ## 読み書きの約束
 *
 * - 開く・閉じるは push（戻るで取り消せる）。図の中で条件を変えたら replace（戻るが調整を遡らない）
 * - 既定と同じ値は URL に書かない（`withDefault` と nuqs の clearOnDefault）
 * - 指標が無い図（FAB で開いた直後）は、中身の既定の指標で開く（ここはカタログを読まない）。
 *   エリアの無いエリアの図も同じく、中身が既定のエリアを決めて書き戻す
 *
 * 初期バンドル（FAB）から読まれるので、`@/shared/*` からは型と、zod を持たない値（範囲の読み方・半径・エリアの数の上限）だけを
 * 借りる（zod とカタログを連れてこない）。
 */

import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsNativeArrayOf,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
} from 'nuqs'
import type { Order } from '@/shared/api'
import { MAX_AREAS } from '@/shared/area-ref'
import { isRadiusM, type RadiusM } from '@/shared/constants'
import { viewportFromTuple, type Viewport } from '@/shared/viewport'

/** 図の種類（URL の `?fig` の値）。 */
export const FIGURE_KINDS = ['ranking', 'scatter', 'area'] as const

/** エリアの図の、駅の周りの既定の半径（共通 API と AI の道具の既定と同じ 1km・§6.12.15-5）。 */
export const DEFAULT_AREA_RADIUS_M: RadiusM = 1000

const ORDERS = ['desc', 'asc'] as const satisfies readonly Order[]
const NO_NAMES: string[] = []
const NO_CODES: number[] = []

/** 絞り込み（空＝絞らない）。ランキングと散布で同じ意味（`shared/promotion.ts` と同じ形）。 */
export type FigureFilters = {
  readonly prefectures: readonly string[]
  /** 市区町村（前方一致の値・空＝絞らない・2026-10-08 B2）。 */
  readonly municipality: string
  /** 範囲・起点の駅と半径（チャットの図の条件・null＝絞らない・B2）。 */
  readonly bbox: Viewport | null
  readonly near: { readonly grp: string; readonly radiusM: number } | null
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  /** 事業者種別のコード（表示名ではない）。 */
  readonly routeTypes: readonly number[]
  /** 路線（運行系統）の路線コード（チャットの図の条件・2026-10-08 L3）。 */
  readonly lines: readonly number[]
  /** 信頼性の低い値（⚠）を除外する。 */
  readonly excludeLowN: boolean
}

/** ランキングの図。指標が null なら、中身の既定の指標で開く。 */
export type RankingFigure = FigureFilters & {
  readonly kind: 'ranking'
  readonly metricKey: string | null
  readonly order: Order
}

/** 散布の図。x/y が null なら、中身の既定の指標で開く。 */
export type ScatterFigure = FigureFilters & {
  readonly kind: 'scatter'
  readonly xKey: string | null
  readonly yKey: string | null
}

/**
 * エリアの図（2026-10-15 B5e）。エリアが空なら FAB で開いた直後——中身が既定のエリア（選択中の駅の市区町村・
 * 地図の中心に近い駅）を決めて書き戻す。
 */
export type AreaFigure = {
  readonly kind: 'area'
  /** エリアの文字列（1〜4・`shared/area-ref.ts` の形）。空＝開いた直後。 */
  readonly areas: readonly string[]
  /** 駅の周りの半径（m・色分けの指標もこの半径）。 */
  readonly radiusM: number
  /** 色分けの指標（null＝既定の人口の増減・`none`＝色分けしない）。 */
  readonly colorBy: string | null
}

export type Figure = RankingFigure | ScatterFigure | AreaFigure

const NO_FILTERS: FigureFilters = {
  prefectures: [],
  municipality: '',
  bbox: null,
  near: null,
  operators: [],
  routes: [],
  routeTypes: [],
  lines: [],
  excludeLowN: true,
}

/** FAB で開いたときのランキング（中身の既定どおり：⚠ を除外・上位から）。 */
export const DEFAULT_RANKING_FIGURE: RankingFigure = {
  kind: 'ranking',
  metricKey: null,
  order: 'desc',
  ...NO_FILTERS,
}

/** FAB で開いたときの散布。 */
export const DEFAULT_SCATTER_FIGURE: ScatterFigure = {
  kind: 'scatter',
  xKey: null,
  yKey: null,
  ...NO_FILTERS,
}

/** FAB で開いたときのエリアの図（エリアは中身が決める・半径と色分けは既定）。 */
export const DEFAULT_AREA_FIGURE: AreaFigure = {
  kind: 'area',
  areas: [],
  radiusM: DEFAULT_AREA_RADIUS_M,
  colorBy: null,
}

/** URL のパラメータ。接頭辞 `fig` は、地図（`grp` `r` `tab`）やおすすめ（`rec*`）と衝突させないため。 */
export const FIGURE_PARSERS = {
  fig: parseAsStringLiteral(FIGURE_KINDS),
  figM: parseAsString,
  figX: parseAsString,
  figY: parseAsString,
  figO: parseAsStringLiteral(ORDERS).withDefault('desc'),
  figPref: parseAsArrayOf(parseAsString).withDefault(NO_NAMES),
  /** 市区町村・範囲（「西,南,東,北」）・起点の駅（grp）と半径（m）（2026-10-08 B2）。 */
  figMuni: parseAsString.withDefault(''),
  figBbox: parseAsString,
  figNear: parseAsString,
  figWithin: parseAsInteger,
  figOps: parseAsArrayOf(parseAsString).withDefault(NO_NAMES),
  figRoutes: parseAsArrayOf(parseAsString).withDefault(NO_NAMES),
  figTypes: parseAsArrayOf(parseAsInteger).withDefault(NO_CODES),
  figLines: parseAsArrayOf(parseAsInteger).withDefault(NO_CODES),
  figLowN: parseAsBoolean.withDefault(true),
  /**
   * エリアの図：エリア（繰り返す——範囲の `bbox:139.55,35.40,…` が `,` を含むので区切り文字でつながない・色分けの `colorIn` と
   * 同じ形）・駅の周りの半径（m）・色分けの指標（2026-10-15 B5e）。
   */
  figAreas: parseAsNativeArrayOf(parseAsString),
  figR: parseAsInteger.withDefault(DEFAULT_AREA_RADIUS_M),
  figColor: parseAsString,
}

export type FigureUrlValues = inferParserType<typeof FIGURE_PARSERS>

/** URL の範囲（「西,南,東,北」）→ 範囲（形が崩れていれば null＝絞らない）。 */
function bboxOfUrl(raw: string | null): Viewport | null {
  return raw === null ? null : viewportFromTuple(raw.split(',').map(Number))
}

/** URL の起点（grp と半径の組）。片方だけなら null（絞らない）。 */
function nearOfUrl(grp: string | null, radiusM: number | null): FigureFilters['near'] {
  return grp === null || grp === '' || radiusM === null ? null : { grp, radiusM }
}

/**
 * URL のエリア → 図のエリア（空の文字列と重なりを除き、4 つまで）。書き方の検証は共通 API がする——ここで黙って捨てると、
 * 壊れたリンクを開いた人に理由が届かない（図が API の理由を出し、エリアを外せる）。
 */
function areasOfUrl(raw: readonly string[]): string[] {
  const refs = raw.map((ref) => ref.trim()).filter((ref) => ref !== '')
  return [...new Set(refs)].slice(0, MAX_AREAS)
}

/** URL → エリアの図（6 段以外の半径は既定に戻す）。 */
function areaFigureOfUrl(values: FigureUrlValues): AreaFigure {
  return {
    kind: 'area',
    areas: areasOfUrl(values.figAreas),
    radiusM: isRadiusM(values.figR) ? values.figR : DEFAULT_AREA_RADIUS_M,
    colorBy: values.figColor,
  }
}

/** URL → 開いている図（開いていなければ null）。 */
export function figureFromUrl(values: FigureUrlValues): Figure | null {
  if (values.fig === 'area') return areaFigureOfUrl(values)
  const filters: FigureFilters = {
    prefectures: values.figPref,
    municipality: values.figMuni,
    bbox: bboxOfUrl(values.figBbox),
    near: nearOfUrl(values.figNear, values.figWithin),
    operators: values.figOps,
    routes: values.figRoutes,
    routeTypes: values.figTypes,
    lines: values.figLines,
    excludeLowN: values.figLowN,
  }
  if (values.fig === 'ranking') {
    return { kind: 'ranking', metricKey: values.figM, order: values.figO, ...filters }
  }
  if (values.fig === 'scatter') {
    return { kind: 'scatter', xKey: values.figX, yKey: values.figY, ...filters }
  }
  return null
}

/** エリアの図だけが使う URL の値。 */
type AreaUrlValues = Pick<FigureUrlValues, 'figAreas' | 'figR' | 'figColor'>

/** 絞り込みの URL の値（図の種類・指標・順・エリアの図の値を除いた残り）。 */
type FilterUrlValues = Omit<
  FigureUrlValues,
  'fig' | 'figM' | 'figX' | 'figY' | 'figO' | keyof AreaUrlValues
>

/** エリアの図の値を使わない図（ランキング・散布）で、前に開いていたエリアの図の条件を残さない。 */
const NO_AREA_URL: AreaUrlValues = { figAreas: [], figR: DEFAULT_AREA_RADIUS_M, figColor: null }

/** 絞り込み → URL の値（ランキングと散布で同じ）。 */
function filtersToUrl(filters: FigureFilters): FilterUrlValues {
  const { bbox, near } = filters
  return {
    figPref: [...filters.prefectures],
    figMuni: filters.municipality,
    figBbox: bbox === null ? null : [bbox.west, bbox.south, bbox.east, bbox.north].join(','),
    figNear: near?.grp ?? null,
    figWithin: near?.radiusM ?? null,
    figOps: [...filters.operators],
    figRoutes: [...filters.routes],
    figTypes: [...filters.routeTypes],
    figLines: [...filters.lines],
    figLowN: filters.excludeLowN,
  }
}

/** エリアの図 → URL の値（ランキング・散布の条件は既定に戻す）。 */
function areaFigureToUrl(figure: AreaFigure): FigureUrlValues {
  return {
    fig: 'area',
    figM: null,
    figX: null,
    figY: null,
    figO: 'desc',
    ...filtersToUrl(NO_FILTERS),
    figAreas: [...figure.areas],
    figR: figure.radiusM,
    figColor: figure.colorBy,
  }
}

/** 図 → URL の値。使わない値は null（または既定）にして、前に開いていた図の条件を残さない。 */
export function figureToUrl(figure: Figure): FigureUrlValues {
  if (figure.kind === 'area') return areaFigureToUrl(figure)
  const filters = { ...filtersToUrl(figure), ...NO_AREA_URL }
  if (figure.kind === 'ranking') {
    const { metricKey, order } = figure
    return { fig: 'ranking', figM: metricKey, figX: null, figY: null, figO: order, ...filters }
  }
  const { xKey, yKey } = figure
  return { fig: 'scatter', figM: null, figX: xKey, figY: yKey, figO: 'desc', ...filters }
}

/** 同じ図かを見分ける鍵（URL に書く値そのもの＝並びも含めて決定的）。 */
export function figureKey(figure: Figure): string {
  return JSON.stringify(figureToUrl(figure))
}
