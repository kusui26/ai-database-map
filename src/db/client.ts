/**
 * Supabase クライアント（サーバ専用・anon キー・RLS read-only）。
 * 複雑クエリは RPC（migrations 管理の SQL 関数）を叩く（plan_fable §2.2-④）。
 * fetch は AbortController でタイムアウトを付す（.claude/CLAUDE.md §3）。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const TIMEOUT_MS = 10_000

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

let cached: SupabaseClient | null = null

/** 遅延生成のシングルトン（env 未設定なら初回利用時に throw）。 */
export function db(): SupabaseClient {
  if (cached !== null) return cached
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が未設定です')
  }
  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timeoutFetch },
  })
  return cached
}

/** DB 由来のエラー（Route Handler が 500 封筒に変換）。 */
export class DbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbError'
  }
}
