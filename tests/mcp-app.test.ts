import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAP_CONNECT_ORIGINS, MAP_PANEL_APP_HTML } from '@/ai/mcp-app/map-panel-app'
import { MAP_PROBE_HTML } from '@/ai/mcp-app/map-probe'
import { MAP_TILE_ORIGIN, MCP_APP_MIME_TYPE } from '@/ai/mcp-app/meta'
import { PANEL_APP_HTML } from '@/ai/mcp-app/panel-app'
import { hazardLayers } from '@/shared/hazard'
import { mapActionSchema, panelSchema } from '@/shared/protocol'

/**
 * **MCP Apps のビューア／プローブ**（PR-9/9b・`docs/260828_research_claude_auth.md` §4.6）。
 *
 * 固定するのは、①ビューアが **GUI Chat Protocol の全パネル型**にレンダラを持つこと
 * （protocol に型を足したらここが落ちる＝描き忘れ検知）、②仕様どおりのハンドシェイク
 * （ui/initialize → initialized → tool-result 受信）が入っていること、③XSS 安全
 * （innerHTML 不使用）と軽量版の**外部接続ゼロ**（既定 CSP で動く）、④サイズが控えめなこと。
 * 地図つき版（PR-9b）はさらに、⑤ **mapActions の全型**を扱うこと、⑥ハザードレイヤの
 * 定義が**カタログから**埋め込まれること、⑦ MapLibre が **package.json と同じ版**で
 * 同梱されること、⑧ CSP の接続先がカタログから算出されること。
 */

/** protocol の判別ユニオンから全パネル型リテラルを導出（手書きリストにしない）。 */
const PANEL_TYPES = panelSchema.options.map((option) => option.shape.type.value)

/** protocol の判別ユニオンから全 mapAction 型リテラルを導出（手書きリストにしない）。 */
const MAP_ACTION_TYPES = mapActionSchema.options.map((option) => option.shape.type.value)

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

  it('軽量版に MapLibre は入らない（1.1MB を全ツールに配らない）', () => {
    expect(PANEL_APP_HTML.includes('MapLibre GL JS')).toBe(false)
  })

  it('パネルが無い結果はテキストへフォールバックする', () => {
    expect(PANEL_APP_HTML).toContain('表示できる結果がありません')
  })

  it('サイズは控えめ（150,000 文字未満）', () => {
    expect(PANEL_APP_HTML.length).toBeLessThan(150_000)
  })
})

describe('地図つきパネル・ビューア（MAP_PANEL_APP_HTML・PR-9b）', () => {
  it('全パネル型のレンダラを持つ（軽量版と同じ部品）', () => {
    for (const type of PANEL_TYPES) {
      expect(MAP_PANEL_APP_HTML, String(type)).toContain(`${String(type)}:`)
    }
  })

  it('mapActions の全型を扱う（protocol に型を足したら扱い忘れで落ちる）', () => {
    expect(MAP_ACTION_TYPES.length).toBeGreaterThanOrEqual(7)
    for (const type of MAP_ACTION_TYPES) {
      expect(MAP_PANEL_APP_HTML, String(type)).toContain(`'${String(type)}'`)
    }
    expect(MAP_PANEL_APP_HTML).toContain('renderMapActions')
  })

  it('MapLibre は package.json と同じ版が同梱される（コピーの陳腐化を防ぐ）', () => {
    const raw = readFileSync(
      join(process.cwd(), 'node_modules', 'maplibre-gl', 'package.json'),
      'utf8',
    )
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
      throw new Error('maplibre-gl の package.json に version がありません')
    }
    const { version } = parsed
    expect(typeof version).toBe('string')
    expect(MAP_PANEL_APP_HTML).toContain('MapLibre GL JS')
    expect(MAP_PANEL_APP_HTML).toContain(`v${String(version)}/`)
  })

  it('ハザードレイヤの定義はカタログから埋め込まれる（key と URL が漏れなく入る）', () => {
    const rasterLayers = hazardLayers.filter(
      (layer) => layer.tile !== null && layer.tile.format === 'png',
    )
    expect(rasterLayers.length).toBeGreaterThanOrEqual(15)
    for (const layer of rasterLayers) {
      expect(MAP_PANEL_APP_HTML, layer.key).toContain(`"${layer.key}"`)
      if (layer.tile !== null) expect(MAP_PANEL_APP_HTML, layer.key).toContain(layer.tile.url)
    }
  })

  it('CSP の接続先はカタログ＋ベースマップから算出される（3 オリジン）', () => {
    expect([...MAP_CONNECT_ORIGINS].sort()).toEqual(
      [
        'https://cyberjapandata.gsi.go.jp', // ベースマップ（淡色）＋地形（カタログと重複＝畳まれる）
        'https://disaportaldata.gsi.go.jp', // 重ねるハザードマップ
        'https://www.jma.go.jp', // キキクル（タイル＋targetTimes.json）
      ].sort(),
    )
  })

  it('ハンドシェイクと全画面要求が入っている・サイズは MapLibre 込みで 1.6MB 未満', () => {
    expect(MAP_PANEL_APP_HTML).toContain("'ui/initialize'")
    expect(MAP_PANEL_APP_HTML).toContain("'ui/notifications/tool-result'")
    expect(MAP_PANEL_APP_HTML).toContain('ui/request-display-mode')
    expect(MAP_PANEL_APP_HTML.length).toBeGreaterThan(800_000) // MapLibre が実際に入っている
    expect(MAP_PANEL_APP_HTML.length).toBeLessThan(1_600_000)
  })

  it('XSS 安全（innerHTML でパネルを組まない）', () => {
    // MapLibre 本体は innerHTML を内部で使うため、検査対象は自前モジュールに限る。
    const ownScripts = MAP_PANEL_APP_HTML.slice(MAP_PANEL_APP_HTML.indexOf('var MAP_DATA'))
    expect(ownScripts.includes('innerHTML')).toBe(false)
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
