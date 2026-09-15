/**
 * おすすめ駅の条件を、モーダルを閉じても覚えておく（Zustand）。
 *
 * モーダルの中身は閉じるたびに unmount される（Radix の Portal）。ランキングのように
 * 設定が 1〜2 個なら入れ直せばよいが、おすすめは**エリア・ペルソナ・重み 6 本・災害の扱い**を
 * 組んでから使うもので、しかも「結果を見る → 閉じて地図で確かめる → 開いて重みを直す」という
 * 往復が普通に起きる。そのたびに白紙に戻るのは、機能として成立しない。
 *
 * ⚠ ここはセッション内の一時記憶にすぎない（リロードで消える）。**共有できる状態**にするのは
 * W5 の URL（`nuqs`）で、そのときはこの読み書きの 2 か所を差し替えるだけでよい。
 */

import { create } from 'zustand'
import { DEFAULT_CRITERIA, type RecommendCriteria } from '@/components/recommend/query'

type RecommendStore = {
  /** 最後に使っていた条件（次に開いたときの初期値）。 */
  readonly criteria: RecommendCriteria
  /** 閉じるときに覚える。 */
  readonly remember: (criteria: RecommendCriteria) => void
}

export const useRecommendStore = create<RecommendStore>((set) => ({
  criteria: DEFAULT_CRITERIA,
  remember: (criteria) => set({ criteria }),
}))
