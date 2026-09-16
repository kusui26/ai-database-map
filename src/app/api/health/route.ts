import { DbError } from '@/db/client'
import { healthCheck } from '@/db/queries'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/health — DB に 1 クエリ投げて `{ok:true}` を返すだけ（`vercel.json` の日次 cron `0 3 * * *`）。
 *
 * ## ⚠ これは死活監視ではない
 *
 * **失敗を知らせる仕組みを、こちらでは用意していない。** 気づく道は Vercel の cron 実行履歴を
 * 開くことだけである（プラットフォーム側の通知設定は未確認）。
 * 元は Supabase 無料枠の「7 日無活動で pause」対策だったが（`plan_fable.md` §2.2-⑦）、
 * **Pro にその制約は無い**（2026-09-16・`docs/260916_ops_guard.md` §7）。
 *
 * いま残っている値打ちは 1 つだけ——**本番から DB へ届くことを毎日 1 回確かめている唯一の経路**
 * だということ。利用者がまだほとんどいないので、鍵のローテーションや環境変数の抜けは、
 * これ以外に踏む道が無い。
 *
 * 本物の監視にしたいなら、失敗の通知先を作るか、ついでに DB サイズを記録する
 * （`docs/260816_sales.md` §12.4 の「監視」）。どちらも別 PR。
 */
export function GET(): Promise<Response> {
  return handle(async () => {
    const ok = await healthCheck()
    if (!ok) throw new DbError('health check failed')
    return json({ ok: true }, CACHE.none)
  })
}
