/**
 * ドメイン：順位表を**一続きで**作る（取得 → 注意の印 → 組み立て・2026-11-25・計画書 261122 §8.2）。
 *
 * このファイルだけが非純粋（DB を読む）。共通 API（`/api/ranking`）と AI のツール（`rankStations`・MCP の `rank_stations`）は
 * ここを 1 回呼ぶだけでよい——往復の順番と回数を呼び出し側に持たせると、画面とチャットで別の答えになりうる（駅詳細の
 * `stations/load.ts` と同じ作法）。往復は順位の 1 回と、注意の印を出す指標（`notice.ts`）だけ、並んだ駅（50 駅まで）の
 * 注意のフラグを 1 回（`dataset_rows`）。
 */

import {
  datasetRows,
  rankByColumn,
  type RankPage,
  type RankRow,
  type StationFilter,
} from '@/db/queries'
import { type RankingResponse } from '@/shared/api'
import { requireEntry } from '@/shared/catalog'
import { rankingNoticeOf } from './notice'
import { buildRanking, type RankingOptions } from './presenter'

/** 並んだ駅のうち、注意のフラグが立っている駅（と印の意味）。印を出さない指標・駅が無いときは undefined。 */
async function noticeOf(
  metricKey: string,
  rows: readonly RankRow[],
): Promise<RankingOptions['notice']> {
  const notice = rankingNoticeOf(requireEntry(metricKey))
  if (notice === null || rows.length === 0) return undefined
  const grps = rows.map((row) => row.grp)
  const values = await datasetRows(grps, [notice.flagKey])
  const noticed = grps.filter((grp) => values[grp]?.[notice.flagKey] === 1)
  return { noticeJa: notice.noticeJa, grps: new Set(noticed) }
}

/** 指標・絞り込み・ページ → 順位表（題に使う絞り込みの名前は `options`）。 */
export async function loadRanking(
  metricKey: string,
  prefectures: readonly string[],
  filter: StationFilter,
  page: RankPage,
  options: RankingOptions = {},
): Promise<RankingResponse> {
  const { rows, total } = await rankByColumn(metricKey, filter, page)
  const notice = await noticeOf(metricKey, rows)
  return buildRanking(metricKey, prefectures, page.order, rows, total, page.offset, {
    ...options,
    ...(notice === undefined ? {} : { notice }),
  })
}
