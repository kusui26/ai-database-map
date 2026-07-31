import { routeNames } from '@/db/queries'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/routes — 路線の一覧（路線名・駅グループ数・運営会社・事業者種別）。
 *
 * 散布図の路線セレクタと AI ツールが参照する自己記述の表面
 * （docs/260730_scatter_plot_routes.md §5）。同名で会社が異なる路線があるため
 * （「本線」は 10 社）、`operators` を併せて返して UI が識別できるようにする。
 * データ更新でしか変わらないため 1 日キャッシュ。
 */
export function GET(): Promise<Response> {
  return handle(async () => json({ routes: await routeNames() }, CACHE.day))
}
