import { loadAreas } from '@/domain/area-summary/catalog'
import { CACHE, handle, json } from '@/lib/http'

export const runtime = 'nodejs'

/**
 * GET /api/areas — エリアのカタログ（2026-10-10 B5b・`docs/261001_fix_user_feedback_ui.md` §6.12.7）。
 * 行政区域（全国・都道府県・政令市・東京 23 区・市区町村・区）の鍵・名前・親・駅の数・出せない値と理由、沿線の幅、
 * 区域の指標（名前・単位・年・作り方・出典）、エリアの文字列の書き方。AI・画面・MCP がここから選ぶ（自己記述）。
 */
export function GET(): Promise<Response> {
  return handle(async () => json(await loadAreas(), CACHE.day))
}
