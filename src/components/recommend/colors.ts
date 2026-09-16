/**
 * 内訳の帯の色（指標の並び順に割り当てる）。
 *
 * ⚠ **色だけで意味を伝えない。** 凡例に必ず指標名と重みを出し、帯には `title` を付ける
 * （ハザードの配色規約と同じ考え方・`docs/260824_flood.md` §7.6）。
 * 隣り合う色は色相を離してあり、1 型・2 型色覚でも並びが潰れにくい。
 */
export const CONTRIBUTION_COLORS: readonly string[] = [
  '#4f46e5', // indigo-600
  '#0d9488', // teal-600
  '#d97706', // amber-600
  '#be123c', // rose-700
  '#0369a1', // sky-700
  '#4d7c0f', // lime-700
]

/** 指標の並び順 → 色（指標が増えても回して必ず色が付く）。 */
export function contributionColor(index: number): string {
  return CONTRIBUTION_COLORS[index % CONTRIBUTION_COLORS.length] ?? CONTRIBUTION_COLORS[0] ?? '#000'
}

/**
 * 重みの並び → 色の番号（`null`＝色を付けない）。
 *
 * **重み 0 の指標は合成に使われない**（domain の `activeMetrics`）。応答の `metrics` からも
 * 落ちるので、スライダ側も同じ規則で色を振らないと、凡例と帯と色がずれる。
 * 全部 0 のときは domain が「指定された全部を等しく扱う」ので、こちらも全部に色を振る。
 */
export function colorIndexes(weights: readonly number[]): readonly (number | null)[] {
  const used = weights.filter((weight) => weight > 0).length
  if (used === 0) return weights.map((_, index) => index)
  return weights.map((weight, index) =>
    weight > 0 ? weights.slice(0, index).filter((earlier) => earlier > 0).length : null,
  )
}
