/**
 * MCP Apps（PR-9 スパイク・`docs/260828_research_claude_auth.md` §4.6）の定数。
 *
 * 仕様は ext-apps 2026-01-26（SEP-1865）：
 * - リソースは `ui://` スキーム・mimeType **`text/html;profile=mcp-app`**
 * - ツール側は `_meta.ui.resourceUri` で参照（対応ホストだけが描画。Claude Code CLI は
 *   無視してテキストにフォールバック＝既存挙動は不変）
 * - CSP は resources/read の contents[]._meta.ui.csp（既定は外部接続ゼロ）
 */

/** パネル・ビューア（GUI Chat Protocol の panels を描く・外部接続ゼロ）。 */
export const PANEL_APP_URI = 'ui://ai-database-map/panels.html'

/** MapLibre 可否プローブ（blob Worker / WebGL / タイル到達を実測して表に出す）。 */
export const MAP_PROBE_URI = 'ui://ai-database-map/map-probe.html'

/** MCP Apps の HTML リソース mimeType（仕様で MUST）。 */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** プローブが接続を試す地図タイルのホスト（CSP の connectDomains に宣言する）。 */
export const MAP_TILE_ORIGIN = 'https://cyberjapandata.gsi.go.jp'
