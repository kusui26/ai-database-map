/**
 * 散布図の dataset 構築（純関数・テスト容易化のため描画から分離）。
 *
 * クラスタ番号は domain 側で 0..clusterCount-1 の連番に正規化されるが、
 * 描画は「実際に存在する番号」だけを見て組み立て、上流の不変条件に依存しない
 * （docs/260728_fix_scatter_chart_sparse_cluster_labels.md 案 C）。
 */

import { type ScatterPoint } from '@/shared/protocol'

/**
 * 点をクラスタ番号ごとに 1 パスで束ね、番号の昇順で返す。
 * 空のクラスタは生まれず、どの点も必ずいずれかの dataset に入る（描画漏れゼロ）。
 */
export function groupPointsByCluster(points: readonly ScatterPoint[]): ScatterPoint[][] {
  const byCluster = new Map<number, ScatterPoint[]>()
  for (const point of points) {
    const bucket = byCluster.get(point.cluster) ?? []
    bucket.push(point)
    byCluster.set(point.cluster, bucket)
  }
  return [...byCluster.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, clusterPoints]) => clusterPoints)
}
