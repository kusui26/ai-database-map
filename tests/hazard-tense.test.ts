import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HAZARD_LEVEL_LABELS_JA } from '@/shared/constants'
import { hazardLayers } from '@/shared/hazard'
import {
  ALERT_LIMITATION_SHORT_JA,
  calmNowNoteJa,
  HAZARD_TENSE_ASSUMED_JA,
  HAZARD_TENSE_ASSUMED_NOTE_JA,
  HAZARD_TENSE_NOW_JA,
  STATION_HAZARD_CAVEAT_JA,
} from '@/domain/hazard/panels'
import { ALERT_LIMITATION_JA } from '@/domain/hazard/level'

/**
 * **時制**（`docs/260828_fix_flood.md` §4.3・§4.4 決定 3）。
 *
 * 利用者から「駅カードの『極めて危険』が、いまの災害情報なのか予想なのか分からない」と
 * 報告された。原因は語彙の衝突で、**気象庁キキクル（いまの危険度分布）と
 * 静的な危険度が 5 段中 3 段で同じ語**である。時制を示す語はどこにも無かった。
 *
 * 直し方は「語を変える」ではなく「**時制の主語を先に置く**」。
 * ここで固定するのは、その前置きが**消えないこと**と、**衝突が実在すること**である。
 * 駅のヘッダのバッジ（前置きつきの 1 行）は 2026-11-11 に外した（`docs/261110_fix_PLAN.md` §5）。
 * 駅の災害は、時制の見出しを持つ災害タブだけで出す。
 */

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
  it('2 つの時制は別の語で、「もし起きたら」の注記が言い切っている', () => {
    expect(HAZARD_TENSE_NOW_JA).not.toBe(HAZARD_TENSE_ASSUMED_JA)
    // 「もし起きたら」側は、**いまの話ではない**と明示する（ここが半分の答え）。
    expect(HAZARD_TENSE_ASSUMED_NOTE_JA).toContain('いま起きていることではありません')
  })

  it('タブは「いま」と「もし起きたら」を両方出し、「もし起きたら」には注記を添える（並べて初めて伝わる）', () => {
    expect(rendered(TAB_SOURCE)).toContain('titleJa={HAZARD_TENSE_NOW_JA}')
    expect(rendered(TAB_SOURCE)).toContain(
      'titleJa={HAZARD_TENSE_ASSUMED_JA} noteJa={HAZARD_TENSE_ASSUMED_NOTE_JA}',
    )
  })

  it('タブは画面に「安全」とは書かない（§7.5-5）', () => {
    expect(rendered(TAB_SOURCE)).not.toContain('安全')
  })
})

/**
 * 平時の「いま」は 2 行（2026-11-11・`docs/261110_fix_PLAN.md` §8.3）。結論の文と、
 * 「気象庁 ◯月◯日 ◯:◯ 発表 ／ 避難情報は市町村が出す」の 1 行。**限界は消さずに短くする。**
 */
describe('平時の「いま」の 2 行目', () => {
  it('発表の時刻を日本時間で言い、限界の短い形を続ける', () => {
    expect(calmNowNoteJa('2026-11-10T17:49:00Z')).toBe(
      `気象庁 11月11日 02:49 発表 ／ ${ALERT_LIMITATION_SHORT_JA}`,
    )
  })

  it('時刻が無くても（発表を確かめられなかった）、限界は言う', () => {
    expect(calmNowNoteJa(null)).toBe(ALERT_LIMITATION_SHORT_JA)
    expect(calmNowNoteJa('こわれた日時')).toBe(ALERT_LIMITATION_SHORT_JA)
  })

  it('短い形も、長い形（応答・AI）と同じことを言う：避難情報を出すのは市町村で、ここでは分からない', () => {
    for (const text of [ALERT_LIMITATION_SHORT_JA, ALERT_LIMITATION_JA]) {
      expect(text).toContain('避難指示')
      expect(text).toContain('市町村')
      expect(text).toMatch(/分かりません/)
    }
    expect(ALERT_LIMITATION_SHORT_JA.length).toBeLessThan(ALERT_LIMITATION_JA.length)
  })

  it('タブは平時の「いま」に、この 1 行を出す（対象の行の代わりに、結論の文が区域を言う）', () => {
    expect(rendered(TAB_SOURCE)).toContain('calmNowNoteJa(alerts.reportedAt)')
  })
})

/** 免責はタブの末尾で 1 回（中のパネル最大 4 枚が同じ 1 文を出していた・261110 §1.4・§8.3）。 */
describe('免責（タブの末尾に 1 回）', () => {
  it('タブは中のパネルに免責を出させず、末尾で 1 回だけ出す', () => {
    const source = rendered(TAB_SOURCE)
    expect(source).toContain('<HazardDisclaimerAtEndContext.Provider value={true}>')
    expect(source.match(/HAZARD_DISCLAIMER_JA/g)).toHaveLength(1)
  })
})

describe('駅の代表点の限界（2026-11-11・261110 §5.1）', () => {
  it('災害タブが限界の 1 文を画面に出す（ヘッダのバッジと一緒に消さない）', () => {
    // 以前はバッジの下に常に出していた。バッジを外しても、駅の代表点 1 点の値であることは言う。
    expect(rendered(TAB_SOURCE)).toContain('STATION_HAZARD_CAVEAT_JA')
    expect(STATION_HAZARD_CAVEAT_JA).toContain('代表点 1 点')
  })
})
