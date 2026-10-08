import { lineNames } from '@/db/queries'
import { linesResponse } from '@/domain/lines'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/lines — 路線（運行系統・駅データ.jp）の一覧（261008 L2・docs/261001_fix_user_feedback_ui.md §6.8）。
 *
 * 利用者が呼ぶ路線（「JR山手線」＝環状 30 駅・「JR中央線(快速)」＝東京〜高尾）を、事業者名・路線色・区分・
 * 駅のある都道府県つきで返す**自己記述の表面**。一覧・ランキング・散布・データセット・おすすめの共通の条件
 * `lines` には、ここの `lineCd` を渡す。法令上の路線（S12）の一覧は `/api/routes`（別物・互換のため残す）。
 * データの更新でしか変わらない（原典は取り直さない）ので 1 日キャッシュ。
 */
export function GET(): Promise<Response> {
  return handle(async () => json(linesResponse(await lineNames()), CACHE.day))
}
