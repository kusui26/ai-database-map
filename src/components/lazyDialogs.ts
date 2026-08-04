'use client'

/**
 * ランキング／散布のモーダルを遅延ロードするための**単一の入口**（260805）。
 *
 * `next/dynamic` は **`ssr: false` か `loading` を渡したときだけ**自前の Suspense 境界を作る
 * （出荷実装の `hasSuspenseBoundary = !opts.ssr || !!opts.loading`）。どちらも渡さないと
 * `React.Fragment` で包まれるだけなので、初回のチャンク取得で中断したときに React が遡り、
 * `page.tsx` の `<Suspense fallback={<MapSkeleton/>}>` が使われて
 * **アプリ全体が「地図を読み込み中…」に差し替わる**（実測 3/3 回・325ms／
 * docs/260804_loading_map.md §2）。地図は再読み込みされておらず、隠されているだけだった。
 *
 * そこで `loading: () => null` を必ず渡す。fallback が null なので**地図は出たまま**になる。
 *
 * 読み込みを名前付き関数にしているのは、**先読みと同じモジュールを指すため**。
 * 先読み側に `import()` をもう一度書くと、綴りがずれたときに「先読みしたのに効かない」
 * という気づきにくい不具合になる。
 */

import dynamic from 'next/dynamic'

const loadRankingDialog = () => import('./ranking/RankingDialog')
const loadScatterDialog = () => import('./scatter/ScatterDialog')

export const RankingDialog = dynamic(() => loadRankingDialog().then((m) => m.RankingDialog), {
  loading: () => null,
})

export const ScatterDialog = dynamic(() => loadScatterDialog().then((m) => m.ScatterDialog), {
  loading: () => null,
})

/**
 * 先読みの対象。クリック前にアイドル中で取得しておくと、クリック後の待ちから
 * チャンク取得（6 本 166KB・4G 相当で 1,342ms／3G 相当で 9,193ms）が消える。
 * 参照の同一性を保つためモジュール定数にする（`useEffect` の依存に渡すため）。
 */
export const DIALOG_LOADERS: readonly (() => Promise<unknown>)[] = [
  loadRankingDialog,
  loadScatterDialog,
]
