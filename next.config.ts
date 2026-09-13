import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 地図レポート（PR-13）は Leaflet の配布ファイルを実行時に読んでインライン同梱する。
  // Vercel のサーバレス関数に必ず同送させる（NFT のトレース対象に明示）。
  // URL を発行するのは /api/mcp、HTML を組むのは /api/map なので、両方に要る。
  outputFileTracingIncludes: {
    '/api/map': [
      'node_modules/leaflet/dist/leaflet.js',
      'node_modules/leaflet/dist/leaflet.css',
      'node_modules/leaflet/package.json',
    ],
  },
}

export default nextConfig
