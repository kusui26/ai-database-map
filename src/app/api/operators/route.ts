import { operatorNames } from '@/db/queries'
import { loadOperatorLabels, operatorsResponse } from '@/domain/operators'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/operators — 運営会社の一覧（社名＋表示名＋駅グループ数・多い順）。
 *
 * 散布図・ランキング・おすすめの会社セレクタと AI ツールが参照する自己記述の表面
 * （docs/260730_scatter_plot_operators_filter.md §4）。`name` は条件に使う鍵（国土数値情報の会社名）、
 * `label` は人に見せる名前（駅データ.jp の事業者名：「JR東日本」「東京メトロ」・2026-10-08 L4）。
 * データ更新でしか変わらないため 1 日キャッシュ。
 */
export function GET(): Promise<Response> {
  return handle(async () => {
    const [rows, labels] = await Promise.all([operatorNames(), loadOperatorLabels()])
    return json(operatorsResponse(rows, labels), CACHE.day)
  })
}
