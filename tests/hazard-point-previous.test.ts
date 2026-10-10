/**
 * 地点のハザードは**別の地点の結果を返さない**（`useHazardPoint`・2026-10-10）。
 *
 * 駅を横浜から東京へ替えると、東京の名前の下に横浜の「⛔ 河岸侵食…」が数秒出ていた（ヘッダのバッジと「災害」タブの
 * 「もし起きたら」）。フックが新しい地点の結果が届くまで前の地点の結果を返していた（SWR の `keepPreviousData`）。
 *
 * フックは React と SWR の中で動くので、このリポジトリの単体（node）では描けない。振る舞いは実ブラウザ
 * （`tests/ui.hazard-station-switch.smoke.py`・新しい駅の応答を遅らせて読む）が見て、ここは
 * **前の結果を出し続けるのは現在地だけ**という線をソースで固定する（`tests/panel-layout.test.ts` のヘッダの不変条件と同じ作法）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK = 'src/components/hazard/useHazardPoint.ts'
const CURRENT_POSITION = 'src/components/hazard/useCurrentPositionHazard.ts'
/** 駅の災害を描くところ（ヘッダのバッジ・「災害」タブ）。 */
const STATION_VIEWS = [
  'src/components/hazard/StationHazardBadge.tsx',
  'src/components/hazard/StationHazardTab.tsx',
]

const read = (path: string): string => readFileSync(path, 'utf-8')

/** src の下の .ts / .tsx（パスは `src/...` の形）。 */
function sourceFiles(): string[] {
  return readdirSync('src', { recursive: true, encoding: 'utf-8' })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => join('src', path))
}

describe('useHazardPoint は別の地点の結果を返さない', () => {
  it('前の地点の結果を出し続けるのは keepPrevious のときだけ（既定は出さない）', () => {
    const hook = read(HOOK)
    expect(hook).toContain('keepPreviousData: options.keepPrevious === true')
    expect(hook).not.toContain('keepPreviousData: true')
  })

  it('keepPrevious を使うのは現在地だけ（同じ「現在地」が動くときにカードをちらつかせない）', () => {
    const users = sourceFiles().filter((path) => /keepPrevious:\s*true/.test(read(path)))
    expect(users).toEqual([CURRENT_POSITION])
  })

  it('駅のバッジと「災害」タブは地点だけを渡す（前の駅の結果を持ち越さない）', () => {
    for (const path of STATION_VIEWS) {
      const calls = [...read(path).matchAll(/useHazardPoint\(([^)]*)\)/g)].map((match) => match[1])
      expect(calls.length, path).toBeGreaterThan(0)
      for (const args of calls) expect(args?.trim(), path).toBe('target')
    }
  })
})
