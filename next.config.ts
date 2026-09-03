import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // MCP Apps の地図つきビューア（PR-9b）が MapLibre の配布ファイルを実行時に読み込んで
  // インライン同梱する。Vercel のサーバレス関数に必ず同送させる（NFT のトレース対象に明示）。
  outputFileTracingIncludes: {
    '/api/mcp': [
      'node_modules/maplibre-gl/dist/maplibre-gl.js',
      'node_modules/maplibre-gl/dist/maplibre-gl.css',
    ],
  },
}

export default nextConfig
