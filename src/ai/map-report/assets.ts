/**
 * Leaflet の配布ファイルをインライン同梱するための読み込み（サーバ専用・PR-13）。
 *
 * `docs/260912_gui_chat_protocol.md` 決定 14：T1 の地図は **Leaflet**（`<img>` タイル）で描く。
 * 母艦の `presentHtml` は `connect-src 'none'` の sandbox iframe で開くので、**fetch でタイルを
 * 取る MapLibre は動かない**——画像として読む Leaflet だけが描ける（§3 の表）。
 *
 * 配布ファイルは `node_modules` から**実行時に読む**（コピーを持たない＝版ズレしない）。
 * PR-9b の MapLibre と同じ方式で、Vercel へは `next.config.ts` の
 * `outputFileTracingIncludes` で同送する。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** インライン `<script>` に埋めて安全な形へ（`</script>` 混入は組み立てを壊すので拒否）。 */
function inlineSafeScript(source: string, label: string): string {
  if (/<\/script/i.test(source)) {
    throw new Error(`${label} に </script> が含まれるためインライン化できません`)
  }
  // sourceMappingURL は保存した HTML から見ると 404 にしかならないので落とす。
  return source.replace(/^\/\/# sourceMappingURL=.*$/m, '')
}

/** インライン `<style>` に埋めて安全な形へ。 */
function inlineSafeStyle(source: string, label: string): string {
  if (/<\/style/i.test(source)) {
    throw new Error(`${label} に </style> が含まれるためインライン化できません`)
  }
  return source
}

/** 配布ファイルを読む（無ければ文脈つきで即失敗＝壊れた地図を配らない）。 */
function readDist(file: string): string {
  const path = join(process.cwd(), 'node_modules', 'leaflet', file)
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Leaflet の配布ファイルを読めません（${path}）: ${reason}`, { cause: error })
  }
}

const packageSchema = z.object({ version: z.string() })

/** 同梱した Leaflet の版（本文の末尾に出し、テストが package.json と突き合わせる）。 */
export const LEAFLET_VERSION: string = packageSchema.parse(
  JSON.parse(readDist('package.json')),
).version

export const LEAFLET_JS: string = inlineSafeScript(readDist('dist/leaflet.js'), 'leaflet.js')
export const LEAFLET_CSS: string = inlineSafeStyle(readDist('dist/leaflet.css'), 'leaflet.css')
