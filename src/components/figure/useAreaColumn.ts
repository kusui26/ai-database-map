'use client'

/**
 * 広い画面でエリアの図の列を開いているか（2026-10-15 B5e）。列は地図を全部は覆わないので、地図の寄せる余白が列を避ける
 * （`map/padding.ts`）。狭い画面・携帯ではエリアの図はモーダル（地図の上に重なる）なので、列は無い。
 */

import { useIsWide } from '@/hooks/useIsWide'
import { useFigureUrl } from './useFigureUrl'

export type AreaColumn = {
  readonly open: boolean
  /**
   * 列の図のエリア（地図の色分けの `areasKey` と同じ形＝エリアの文字列の並びの JSON）。列を開いていなければ null。
   * 地図は、列の図と同じエリアを色分けしているときだけ、列を開いたときに寄せ直す（違えば、図が新しい色分けを書いて寄せる）。
   */
  readonly areasKey: string | null
}

export function useAreaColumn(): AreaColumn {
  const isWide = useIsWide()
  const { figure } = useFigureUrl()
  if (!isWide || figure?.kind !== 'area') return { open: false, areasKey: null }
  return { open: true, areasKey: JSON.stringify(figure.areas) }
}

export function useAreaColumnOpen(): boolean {
  return useAreaColumn().open
}
