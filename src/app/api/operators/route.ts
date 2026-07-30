import { operatorNames } from '@/db/queries'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/operators — 運営会社の一覧（社名＋駅グループ数・多い順）。
 *
 * 散布図の会社セレクタと AI ツールが参照する自己記述の表面
 * （docs/260730_scatter_plot_operators_filter.md §4）。データ更新でしか変わらないため 1 日キャッシュ。
 */
export function GET(): Promise<Response> {
  return handle(async () => json({ operators: await operatorNames() }, CACHE.day))
}
