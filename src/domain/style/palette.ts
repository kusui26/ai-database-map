/**
 * ドメイン：色分けの色（2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * 色はサーバが凡例と一緒に返す——Web 地図・地図レポート（Leaflet）・将来のビューアが同じ色で描き、AI が同じ言葉で説明する。
 * どれも ColorBrewer（色覚の多様性に配慮した配色）から取る。**良い・悪いの色にしない**（値の大小だけを表す）。
 *
 * - 水準：YlGnBu の濃い側 5 色（いちばん淡い黄は地図の地色に沈むので使わない）。段が少ないときは間を空けて選ぶ
 * - 増減：RdBu を反転（減少が青・増加が赤）。真ん中の「ほぼ横ばい」は白でなく薄い灰色（白は地図の地色に沈む）
 * - どの印にも濃い縁を付けて描く（描く側の約束・B5c）
 */

/** 水準の 5 段（淡い → 濃い＝小さい → 大きい）。 */
export const SEQUENTIAL_COLORS = ['#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8'] as const

/** 増減の 5 段（大きく減少 → 減少 → ほぼ横ばい → 増加 → 大きく増加）。 */
export const DIVERGING_COLORS = ['#0571b0', '#92c5de', '#d4d4d4', '#f4a582', '#ca0020'] as const

/** ⚠（母数が小さいなど）の参考値。 */
export const FLAGGED_COLOR = '#9ca3af'

/** いちばん濃い水準の色（段が 1 つのとき・範囲の外の添字の受け皿）。 */
const DARKEST: string = SEQUENTIAL_COLORS[SEQUENTIAL_COLORS.length - 1] ?? FLAGGED_COLOR

/** 段の数に合わせて水準の色を選ぶ（両端を必ず含み、間を等しく空ける）。 */
export function sequentialColors(count: number): readonly string[] {
  const last = SEQUENTIAL_COLORS.length - 1
  if (count <= 1) return [DARKEST]
  return Array.from({ length: count }, (_, index): string => {
    const at = Math.round((index * last) / (count - 1))
    return SEQUENTIAL_COLORS[at] ?? DARKEST
  })
}

/**
 * エリアを比べる推移の図の系列の色（Okabe–Ito の 4 色・色覚の多様性に配慮）。エリアの指定の順に 1 色ずつ
 * （実績は実線・推計は同じ色の破線）。地図の段の色（青〜赤）と同じ図に並ばないので、重なりは気にしなくてよい。
 */
export const AREA_SERIES_COLORS: readonly [string, ...string[]] = [
  '#0072b2',
  '#e69f00',
  '#009e73',
  '#cc79a7',
]

/** エリアの順番 → 系列の色（4 つを超えたら循環する）。 */
export function areaSeriesColor(index: number): string {
  return AREA_SERIES_COLORS[index % AREA_SERIES_COLORS.length] ?? AREA_SERIES_COLORS[0]
}
