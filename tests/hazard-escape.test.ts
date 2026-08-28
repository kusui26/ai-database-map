import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evacuationDisasterForPoint,
  evacuationUnavailableJa,
  hazardEscapeNoteJa,
  HAZARD_ESCAPE_CLOSE_JA,
  HAZARD_ESCAPE_OPEN_JA,
  HAZARD_ESCAPE_TITLE_JA,
} from '@/domain/hazard/panels'
import { hazardLayersWithPointAnswer } from '@/domain/hazard/catalog'
import { evacuationDisasterLabelJa } from '@/shared/evacuation'

/**
 * **駅タブの③「逃げる」**（`docs/260828_fix_flood.md` §4.3・PR-3）。
 *
 * ここで固定するのは、**種別の取り違えが起きないこと**である。
 * 洪水に対応していない避難場所へ誘導したら本末転倒で、
 * `docs/260824_flood.md` §11 のリスク 10（人命）そのものになる。
 */

const TAB_SOURCE = readFileSync('src/components/hazard/StationHazardTab.tsx', 'utf-8')
const BANNER_SOURCE = readFileSync('src/components/hazard/HazardAlertBanner.tsx', 'utf-8')

/** 画面に出る側だけを残す（`tests/hazard-tense.test.ts` と同じ理由・同じ落とし方）。 */
function rendered(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^import[\s\S]*?from '[^']+'$/gm, '')
}

describe('種別の導出（グループ → 指定緊急避難場所の災害種別）', () => {
  it.each([
    ['flood_l2', 'flood'],
    ['naisui', 'inland_flood'],
    ['hightide_l2', 'storm_surge'],
    ['tsunami_shinsui', 'tsunami'],
    ['dosekiryu', 'landslide'],
  ])('%s のグループは %s に対応づく', (layerKey, disaster) => {
    expect(evacuationDisasterForPoint({ hazards: [{ layerKey }] })).toBe(disaster)
  })

  it('地点カードに出うるレイヤは、必ずどれかの種別に対応づく', () => {
    // ここが欠けると「②には出るのに③が黙って消える」駅ができる。
    // カタログにレイヤが増えたときに、対応表の追記漏れをここで捕まえる。
    for (const layerKey of hazardLayersWithPointAnswer()) {
      expect(evacuationDisasterForPoint({ hazards: [{ layerKey }] })).not.toBeNull()
    }
  })

  it('いちばん重いハザードの種別を採る（hazards は重い順）', () => {
    const point = { hazards: [{ layerKey: 'tsunami_shinsui' }, { layerKey: 'flood_l2' }] }
    expect(evacuationDisasterForPoint(point)).toBe('tsunami')
  })

  it('該当が無ければ null（種別を勝手に選ばない）', () => {
    expect(evacuationDisasterForPoint({ hazards: [] })).toBeNull()
  })

  it('未知のレイヤは飛ばして、次に重いものから決める', () => {
    const point = { hazards: [{ layerKey: 'unknown_layer' }, { layerKey: 'flood_l2' }] }
    expect(evacuationDisasterForPoint(point)).toBe('flood')
  })
})

describe('文言（§7.5-5）', () => {
  it('ボタンと見出しに「安全」と書かない', () => {
    // 指定緊急避難場所は「指定されている」だけで、開設も安全も言えない。
    for (const text of [HAZARD_ESCAPE_TITLE_JA, HAZARD_ESCAPE_OPEN_JA, HAZARD_ESCAPE_CLOSE_JA]) {
      expect(text).not.toContain('安全')
    }
  })

  it('注記はどの災害の話かを主語として言う', () => {
    expect(hazardEscapeNoteJa('flood')).toContain(evacuationDisasterLabelJa('flood'))
    expect(hazardEscapeNoteJa('landslide')).toContain(evacuationDisasterLabelJa('landslide'))
  })

  it('オフラインの言い方は、なぜ出ないか・代わりに何が見られるかを言う', () => {
    const offline = evacuationUnavailableJa(false, false)
    expect(offline).toContain('オフライン')
    expect(offline).toContain('区域の外へ出る向き')
  })
})

describe('駅タブの③（画面側の不変条件）', () => {
  it('タブは「逃げる」の段を出す（定数を共有する＝ずれない）', () => {
    expect(rendered(TAB_SOURCE)).toContain('HAZARD_ESCAPE_TITLE_JA')
  })

  it('避難先を出せないときの文言は、タブとバナーで同じ関数を使う', () => {
    // 別々に書くと必ずずれる（言うことを割らない・CLAUDE.md §2）。
    expect(rendered(TAB_SOURCE)).toContain('evacuationUnavailableJa(')
    expect(rendered(BANNER_SOURCE)).toContain('evacuationUnavailableJa(')
  })

  it('脱出方向は「区域の中にいる」ときだけ出す（バナーと同じ条件）', () => {
    // `inside` は 3 値（§5.9）。true 以外（外・判定できない）で方向を出すと、
    // 「区域の外にいるのに逃げる向きを言う」ことになる。
    expect(rendered(TAB_SOURCE)).toContain('escape?.inside === true')
    expect(rendered(BANNER_SOURCE)).toContain('escape?.inside === true')
  })
})
