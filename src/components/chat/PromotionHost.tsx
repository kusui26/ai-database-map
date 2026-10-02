'use client'

/**
 * 狭い画面で、開いている図（URL の `?fig`）をモーダルで出す（plan_fable §2.4 ルール③）。
 * 図はチャットの ⤢・FAB・共有リンクのどれからでも開く。駅詳細の昇格は usePromote が
 * ?grp＋焦点タブで右ドロワーを開くため、ここでは扱わない。
 *
 * 260802：**広い画面ではキャンバス（ChatCanvas）が同じ図を担当する**ので、
 * ここは narrow・モバイルだけを受け持つ（同じ図が二重に出ないようにする）。
 *
 * 2026-10-02：図の状態を Zustand から URL へ移した。開く・閉じるは履歴に積まれ、
 * ブラウザの「戻る」で閉じ、「進む」で開き直せる（`figure/url.ts`）。
 */

import { useIsWide } from '@/hooks/useIsWide'
import { useFigureHost } from '@/components/figure/useFigureHost'
// FAB と同じ遅延ロードを使う（Suspense 境界の定義を二重に持たない・260805）。
// 同じモジュールなので、FAB 側の先読みがそのままここにも効く。
import { RankingDialog, ScatterDialog } from '@/components/lazyDialogs'

export function PromotionHost() {
  const isWide = useIsWide()
  const { figure, bodyKey, onConditions, close } = useFigureHost()

  if (isWide || figure === null) return null

  const onOpenChange = (next: boolean): void => {
    if (!next) close()
  }

  // key＝外から図が変わったときだけ作り直す（戻る/進む・⤢・FAB。条件の書き戻しでは作り直さない）。
  return figure.kind === 'ranking' ? (
    <RankingDialog
      key={bodyKey}
      open
      onOpenChange={onOpenChange}
      initial={figure}
      onConditions={onConditions}
    />
  ) : (
    <ScatterDialog
      key={bodyKey}
      open
      onOpenChange={onOpenChange}
      initial={figure}
      onConditions={onConditions}
    />
  )
}
