/**
 * ドメイン：決定的 k-means（純関数）。
 *
 * z-score 標準化 → シード付き k-means++ 初期化 → Lloyd 反復。
 * 同一入力＋同一シードで必ず同じクラスタ割当（散布図の再現性）。plan_fable P3a/P6b。
 */

export type Point2D = { readonly x: number; readonly y: number }
type Vec2 = readonly [number, number]

const DEFAULT_K = 4
const DEFAULT_SEED = 1
const MAX_ITER = 50

/** 決定的 PRNG（mulberry32）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mean = (arr: readonly number[]): number =>
  arr.length === 0 ? 0 : arr.reduce((sum, value) => sum + value, 0) / arr.length

/** 標準偏差（0 のときは 1 を返し 0 除算を避ける）。 */
function stdev(arr: readonly number[], m: number): number {
  const variance = mean(arr.map((value) => (value - m) ** 2))
  const sd = Math.sqrt(variance)
  return sd === 0 ? 1 : sd
}

const dist2 = (a: Vec2, b: Vec2): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

/**
 * クラスタ番号を昇順に 0..m-1 へ詰める（欠番を除去・既に連番なら恒等）。
 *
 * Lloyd 反復は空クラスタを作りうるため、生の割当は `{0, 2, 3}` のように欠番を含みうる。
 * 消費側（描画・要約）は「0..m-1 の連番」を前提にするため、ここで不変条件を成立させる
 * （docs/260728_fix_scatter_chart_sparse_cluster_labels.md）。昇順で詰めるので、
 * 欠番のない通常ケースでは割当がまったく変わらない。
 */
function compactLabels(labels: readonly number[]): number[] {
  const ordered = [...new Set(labels)].sort((a, b) => a - b)
  const rank = new Map(ordered.map((label, index) => [label, index]))
  return labels.map((label) => rank.get(label) ?? 0)
}

/**
 * points を最大 k クラスタに分割し、各点のクラスタ番号を返す。
 * 返す番号は **0..m-1 の連番（m ≤ k・欠番なし）** で、m は実際に生じたクラスタ数。
 * n <= k の場合は各点を別クラスタにする。
 */
export function kmeans(
  points: readonly Point2D[],
  k: number = DEFAULT_K,
  seed: number = DEFAULT_SEED,
): number[] {
  const n = points.length
  if (n === 0) return []
  if (n <= k) return points.map((_, i) => i)

  // z-score 標準化
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const mx = mean(xs)
  const my = mean(ys)
  const sx = stdev(xs, mx)
  const sy = stdev(ys, my)
  const z: Vec2[] = points.map((p) => [(p.x - mx) / sx, (p.y - my) / sy])

  const rand = mulberry32(seed)

  // k-means++ 初期化
  const centroids: [number, number][] = []
  const firstIdx = Math.min(Math.floor(rand() * n), n - 1)
  const first = z[firstIdx]
  if (first === undefined) return points.map(() => 0)
  centroids.push([first[0], first[1]])
  while (centroids.length < k) {
    const d2 = z.map((p) => Math.min(...centroids.map((c) => dist2(p, c))))
    const total = d2.reduce((sum, value) => sum + value, 0)
    let threshold = rand() * total
    let pick = 0
    for (let i = 0; i < n; i += 1) {
      threshold -= d2[i] ?? 0
      if (threshold <= 0) {
        pick = i
        break
      }
    }
    const chosen = z[Math.min(pick, n - 1)]
    if (chosen === undefined) break
    centroids.push([chosen[0], chosen[1]])
  }

  // Lloyd 反復
  const assign = new Array<number>(n).fill(0)
  for (let iter = 0; iter < MAX_ITER; iter += 1) {
    let changed = false
    for (let i = 0; i < n; i += 1) {
      const zi = z[i]
      if (zi === undefined) continue
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < centroids.length; c += 1) {
        const cc = centroids[c]
        if (cc === undefined) continue
        const d = dist2(zi, cc)
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      if (assign[i] !== best) {
        assign[i] = best
        changed = true
      }
    }

    // 重心再計算
    const sums: [number, number][] = centroids.map(() => [0, 0])
    const counts = new Array<number>(centroids.length).fill(0)
    for (let i = 0; i < n; i += 1) {
      const zi = z[i]
      const c = assign[i]
      const s = c === undefined ? undefined : sums[c]
      if (zi === undefined || s === undefined || c === undefined) continue
      s[0] += zi[0]
      s[1] += zi[1]
      counts[c] = (counts[c] ?? 0) + 1
    }
    for (let c = 0; c < centroids.length; c += 1) {
      const count = counts[c] ?? 0
      const s = sums[c]
      if (count > 0 && s !== undefined) centroids[c] = [s[0] / count, s[1] / count]
    }

    if (!changed) break
  }

  // 空クラスタが生じた場合に欠番が残らないよう詰める（早期 return の経路は既に連番）。
  return compactLabels(assign)
}
