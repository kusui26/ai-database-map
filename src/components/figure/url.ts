/**
 * 開いている図（ランキング・散布）の URL（`?fig` と条件）。キャンバス・モーダル・FAB・チャットの ⤢ が
 * **同じ 1 つの状態**を読み書きする（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §5.5）。
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
 * - 指標が無い図（FAB で開いた直後）は、中身の既定の指標で開く（ここはカタログを読まない）
 *
 * 初期バンドル（FAB）から読まれるので、`@/shared/*` からは**型だけ**を借りる（zod とカタログを連れてこない）。
 */

import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
} from 'nuqs'
import type { Order } from '@/shared/api'

/** 図の種類（URL の `?fig` の値）。 */
export const FIGURE_KINDS = ['ranking', 'scatter'] as const

const ORDERS = ['desc', 'asc'] as const satisfies readonly Order[]
const NO_NAMES: string[] = []
const NO_CODES: number[] = []

/** 絞り込み（空＝絞らない）。ランキングと散布で同じ意味（`shared/promotion.ts` と同じ形）。 */
export type FigureFilters = {
  readonly prefectures: readonly string[]
  readonly operators: readonly string[]
  readonly routes: readonly string[]
  /** 事業者種別のコード（表示名ではない）。 */
  readonly routeTypes: readonly number[]
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

export type Figure = RankingFigure | ScatterFigure

const NO_FILTERS: FigureFilters = {
  prefectures: [],
  operators: [],
  routes: [],
  routeTypes: [],
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

/** URL のパラメータ。接頭辞 `fig` は、地図（`grp` `r` `tab`）やおすすめ（`rec*`）と衝突させないため。 */
export const FIGURE_PARSERS = {
  fig: parseAsStringLiteral(FIGURE_KINDS),
  figM: parseAsString,
  figX: parseAsString,
  figY: parseAsString,
  figO: parseAsStringLiteral(ORDERS).withDefault('desc'),
  figPref: parseAsArrayOf(parseAsString).withDefault(NO_NAMES),
  figOps: parseAsArrayOf(parseAsString).withDefault(NO_NAMES),
  figRoutes: parseAsArrayOf(parseAsString).withDefault(NO_NAMES),
  figTypes: parseAsArrayOf(parseAsInteger).withDefault(NO_CODES),
  figLowN: parseAsBoolean.withDefault(true),
}

export type FigureUrlValues = inferParserType<typeof FIGURE_PARSERS>

/** URL → 開いている図（開いていなければ null）。 */
export function figureFromUrl(values: FigureUrlValues): Figure | null {
  const filters: FigureFilters = {
    prefectures: values.figPref,
    operators: values.figOps,
    routes: values.figRoutes,
    routeTypes: values.figTypes,
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

/** 絞り込みの URL の値（図の種類・指標・順を除いた残り）。 */
type FilterUrlValues = Omit<FigureUrlValues, 'fig' | 'figM' | 'figX' | 'figY' | 'figO'>

/** 絞り込み → URL の値（ランキングと散布で同じ）。 */
function filtersToUrl(filters: FigureFilters): FilterUrlValues {
  return {
    figPref: [...filters.prefectures],
    figOps: [...filters.operators],
    figRoutes: [...filters.routes],
    figTypes: [...filters.routeTypes],
    figLowN: filters.excludeLowN,
  }
}

/** 図 → URL の値。使わない値は null（または既定）にして、前に開いていた図の条件を残さない。 */
export function figureToUrl(figure: Figure): FigureUrlValues {
  const filters = filtersToUrl(figure)
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
