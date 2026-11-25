/**
 * 順位のページ（もっと見る・P6c）を 1 つの順位表にまとめる（純関数）。
 *
 * 総数・題の材料・先頭の位置は 1 ページ目のまま、行は全ページを順に並べる。行の注意の印の意味（`noticeJa`）は、
 * 印のある行があるページの応答にだけ載る（`domain/ranking/presenter.ts`）。印のある駅が 51 位から現れる順位
 * （岡山県の高齢化率など）もあるので、どのページのものでも拾う——1 ページ目だけを見ると、※ だけが出て意味が出ない（2026-11-25）。
 */

import { type RankingResponse } from '@/shared/api'

/** 読み込んだページ（順番どおり）→ 1 つの順位表。まだ 1 ページも無ければ undefined。 */
export function mergeRankingPages(pages: readonly RankingResponse[]): RankingResponse | undefined {
  const first = pages[0]
  if (first === undefined) return undefined
  const rows = pages.flatMap((page) => page.rows)
  const noticeJa = pages.find((page) => page.noticeJa !== undefined)?.noticeJa
  return { ...first, rows, ...(noticeJa === undefined ? {} : { noticeJa }) }
}
