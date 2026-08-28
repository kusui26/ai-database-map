import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HAZARD_LEVEL_LABELS_JA } from '@/shared/constants'
import { hazardLayers } from '@/shared/hazard'
import {
  HAZARD_TENSE_ASSUMED_JA,
  HAZARD_TENSE_ASSUMED_NOTE_JA,
  HAZARD_TENSE_NOW_JA,
  HAZARD_TENSE_NOW_NOTE_JA,
} from '@/domain/hazard/panels'

/**
 * **時制**（`docs/260828_fix_flood.md` §4.3・§4.4 決定 3）。
 *
 * 利用者から「駅カードの『極めて危険』が、いまの災害情報なのか予想なのか分からない」と
 * 報告された。原因は語彙の衝突で、**気象庁キキクル（いまの危険度分布）と
 * 静的な危険度が 5 段中 3 段で同じ語**である。時制を示す語はどこにも無かった。
 *
 * 直し方は「語を変える」ではなく「**時制の主語を先に置く**」。
 * ここで固定するのは、その前置きが**消えないこと**と、**衝突が実在すること**である。
 */

const BADGE_SOURCE = readFileSync('src/components/hazard/StationHazardBadge.tsx', 'utf-8')
const TAB_SOURCE = readFileSync('src/components/hazard/StationHazardTab.tsx', 'utf-8')

/**
 * **画面に出る側だけ**を残す（コメントと import を落とす）。
 *
 * コメントを残すと「『安全です』とは書かない」と書いた注意書き自体を禁止語として拾い、
 * import を残すと**使うのをやめても import が残っているだけで通ってしまう**
 * ——実際、前置きを消す変異がこれで素通りした。
 */
function rendered(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^import[\s\S]*?from '[^']+'$/gm, '')
}

describe('語彙の衝突（なぜ前置きが要るのか）', () => {
  it('キキクルの危険度と、静的な危険度が 3 語ぶつかる', () => {
    // キキクルの階級は「警戒（警戒レベル3相当）」の形。頭が一致したら衝突とみなす。
    const kikikuru = hazardLayers
      .filter((layer) => layer.group === 'realtime')
      .flatMap((layer) => layer.ranks.map((rank) => rank.labelJa))
    expect(kikikuru.length).toBeGreaterThan(0)

    const collided = Object.values(HAZARD_LEVEL_LABELS_JA).filter((label) =>
      kikikuru.some((rank) => rank.startsWith(label)),
    )
    // ここが減っても増えても、**前置きの要否が変わる**ので気づけるようにしておく。
    expect(collided).toEqual(['注意', '警戒', '極めて危険'])
  })
})

describe('時制の前置き（260828）', () => {
  it('2 つの時制は別の語で、注記が言い切っている', () => {
    expect(HAZARD_TENSE_NOW_JA).not.toBe(HAZARD_TENSE_ASSUMED_JA)
    expect(HAZARD_TENSE_NOW_NOTE_JA).toContain('いま')
    // 「もし起きたら」側は、**いまの話ではない**と明示する（ここが半分の答え）。
    expect(HAZARD_TENSE_ASSUMED_NOTE_JA).toContain('いま起きていることではありません')
  })

  it('バッジは時制を前置きする（定数を共有する＝ずれない）', () => {
    expect(rendered(BADGE_SOURCE)).toContain('HAZARD_TENSE_ASSUMED_JA')
  })

  it('バッジは危険度の語を**画面に出さない**（読み上げにだけ残す）', () => {
    const lines = BADGE_SOURCE.split('\n').filter((line) =>
      line.includes('HAZARD_LEVEL_LABELS_JA['),
    )
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('sr-only')
  })

  it('タブは「いま」と「もし起きたら」を両方出す（並べて初めて伝わる）', () => {
    expect(rendered(TAB_SOURCE)).toContain('HAZARD_TENSE_NOW_JA')
    expect(rendered(TAB_SOURCE)).toContain('HAZARD_TENSE_ASSUMED_JA')
  })

  it('どちらも画面に「安全」とは書かない（§7.5-5）', () => {
    expect(rendered(BADGE_SOURCE)).not.toContain('安全')
    expect(rendered(TAB_SOURCE)).not.toContain('安全')
  })
})
