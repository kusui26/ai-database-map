import { DbError } from '@/db/client'
import { healthCheck } from '@/db/queries'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/** GET /api/health — cron 用（DB 1 クエリ）。Supabase pause 対策。 */
export function GET(): Promise<Response> {
  return handle(async () => {
    const ok = await healthCheck()
    if (!ok) throw new DbError('health check failed')
    return json({ ok: true }, CACHE.none)
  })
}
