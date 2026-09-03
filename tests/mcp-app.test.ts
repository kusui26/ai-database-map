import { describe, expect, it } from 'vitest'
import { MAP_PROBE_HTML } from '@/ai/mcp-app/map-probe'
import { MAP_TILE_ORIGIN, MCP_APP_MIME_TYPE } from '@/ai/mcp-app/meta'
import { PANEL_APP_HTML } from '@/ai/mcp-app/panel-app'
import { panelSchema } from '@/shared/protocol'

/**
 * **MCP Apps のビューア／プローブ**（PR-9・`docs/260828_research_claude_auth.md` §4.6）。
 *
 * 固定するのは、①ビューアが **GUI Chat Protocol の全パネル型**にレンダラを持つこと
 * （protocol に型を足したらここが落ちる＝描き忘れ検知）、②仕様どおりのハンドシェイク
 * （ui/initialize → initialized → tool-result 受信）が入っていること、③XSS 安全
 * （innerHTML 不使用）と**外部接続ゼロ**（既定 CSP で動く）、④サイズが控えめなこと。
 */

/** protocol の判別ユニオンから全パネル型リテラルを導出（手書きリストにしない）。 */
const PANEL_TYPES = panelSchema.options.map((option) => option.shape.type.value)

describe('パネル・ビューア（PANEL_APP_HTML）', () => {
  it('全パネル型のレンダラを持つ（型を足したら描き忘れで落ちる）', () => {
    expect(PANEL_TYPES.length).toBeGreaterThanOrEqual(10)
    for (const type of PANEL_TYPES) {
      expect(PANEL_APP_HTML, String(type)).toContain(`${String(type)}:`)
    }
  })

  it('仕様どおりのハンドシェイク（2026-01-26）が入っている', () => {
    expect(PANEL_APP_HTML).toContain("'ui/initialize'")
    expect(PANEL_APP_HTML).toContain("'ui/notifications/initialized'")
    expect(PANEL_APP_HTML).toContain("'ui/notifications/tool-result'")
  })

  it('XSS 安全（innerHTML 不使用）・外部接続ゼロ（https 参照なし）', () => {
    expect(PANEL_APP_HTML.includes('innerHTML')).toBe(false)
    expect(PANEL_APP_HTML.includes('https://')).toBe(false) // SVG 名前空間（http://www.w3.org）だけ許す
  })

  it('パネルが無い結果はテキストへフォールバックする', () => {
    expect(PANEL_APP_HTML).toContain('表示できる結果がありません')
  })

  it('サイズは控えめ（150,000 文字未満）', () => {
    expect(PANEL_APP_HTML.length).toBeLessThan(150_000)
  })
})

describe('MapLibre 可否プローブ（MAP_PROBE_HTML）', () => {
  it('4 つの検査（blob Worker・WebGL・OffscreenCanvas・タイル接続）を持つ', () => {
    expect(MAP_PROBE_HTML).toContain('blob: Web Worker')
    expect(MAP_PROBE_HTML).toContain('WebGL コンテキスト')
    expect(MAP_PROBE_HTML).toContain('OffscreenCanvas')
    expect(MAP_PROBE_HTML).toContain(MAP_TILE_ORIGIN)
  })

  it('ハンドシェイクが入っている・サイズ控えめ', () => {
    expect(MAP_PROBE_HTML).toContain("'ui/initialize'")
    expect(MAP_PROBE_HTML.length).toBeLessThan(20_000)
  })
})

describe('定数', () => {
  it('mimeType は仕様の MUST に一致する', () => {
    expect(MCP_APP_MIME_TYPE).toBe('text/html;profile=mcp-app')
  })
})
