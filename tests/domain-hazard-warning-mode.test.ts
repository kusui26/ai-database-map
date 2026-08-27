import { describe, expect, it } from 'vitest'
import {
  isWarningMode,
  leadingPhenomenon,
  phenomenonOf,
  warningModeLayers,
  WARNING_MODE_MIN_LEVEL,
  type WarningLike,
} from '@/domain/hazard/warning-mode'
import { ALERT_LEVELS, type AlertLevel } from '@/shared/constants'
import { getHazardLayer } from '@/shared/hazard'
import { toggleHazardLayer } from '@/domain/hazard/catalog'

/**
 * 警戒モードの既定レイヤ（`docs/260824_flood.md` §7.4）。
 *
 * 守りたいのは 2 つ——**出ている現象の面を出す**ことと、
 * **同じグループで base を重ねない**（色が混ざって読めなくなる）ことである。
 */

function warning(code: string, nameJa: string, alertLevel: AlertLevel): WarningLike {
  return { code, nameJa, alertLevel }
}

describe('domain/hazard: 警戒モード', () => {
  it('レベル3相当以上で警戒モードに入る（§7.4 の表）', () => {
    expect(WARNING_MODE_MIN_LEVEL).toBe(3)
    const entering = ALERT_LEVELS.filter(isWarningMode)
    expect(entering).toEqual([3, 4, 5])
  })

  it('現象は名前を先に読む（コード表に無い発表も拾える）', () => {
    expect(phenomenonOf(warning('', '土砂災害の危険度', 4))).toBe('landslide')
    expect(phenomenonOf(warning('', '浸水害の危険度', 4))).toBe('inundation')
    expect(phenomenonOf(warning('', '洪水の危険度', 3))).toBe('flood')
    // 名前が具体的なら、コード表より名前を採る（大雨警報 → 本来は浸水）。
    expect(phenomenonOf(warning('03', '大雨警報（土砂災害）', 3))).toBe('landslide')
  })

  it('名前から読めない発表はコード表で補う', () => {
    expect(phenomenonOf(warning('03', '大雨警報', 3))).toBe('inundation')
    expect(phenomenonOf(warning('33', '大雨特別警報', 5))).toBe('inundation')
    expect(phenomenonOf(warning('08', '高潮警報', 4))).toBe('storm_surge')
    // 水害・土砂災害の体系の外（暴風・波浪）は現象を持たない。
    expect(phenomenonOf(warning('05', '暴風警報', 0))).toBeNull()
    expect(phenomenonOf(warning('99', '未知の発表（コード 99）', 0))).toBeNull()
  })

  it('いちばん重い発表の現象を採る', () => {
    const warnings = [warning('03', '大雨警報', 3), warning('', '土砂災害の危険度', 4)]
    expect(leadingPhenomenon(warnings, false)).toBe('landslide')
    // 指定河川洪水予報があれば必ず洪水（名指しの河川がいちばん具体的）。
    expect(leadingPhenomenon(warnings, true)).toBe('flood')
    // 現象が読めない発表しか無くても、既定（洪水）に落として黙らない。
    expect(leadingPhenomenon([warning('05', '暴風警報', 0)], false)).toBe('flood')
    expect(leadingPhenomenon([], false)).toBe('flood')
  })

  it('現象に合った「いまの危険度＋想定区域」を出す', () => {
    expect(warningModeLayers([warning('', '土砂災害の危険度', 4)], false)).toEqual([
      'dosekiryu',
      'kyukeisha',
      'jisuberi',
      'kikikuru_land',
    ])
    // 浸水は洪水の想定区域も一緒に（内水は整備されていない県がある・真っ白にしない）。
    expect(warningModeLayers([warning('03', '大雨警報', 3)], false)).toEqual([
      'flood_l2',
      'naisui',
      'kikikuru_inund',
    ])
    expect(warningModeLayers([warning('04', '洪水警報', 3)], false)).toEqual([
      'flood_l2',
      'kikikuru_flood',
    ])
  })

  it('キキクルが無い現象（高潮）に、別の現象の面を代わりに出さない', () => {
    const layers = warningModeLayers([warning('08', '高潮警報', 4)], false)
    expect(layers).toEqual(['hightide_l2'])
    expect(layers.some((key) => key.startsWith('kikikuru'))).toBe(false)
  })

  it('どの現象でも、同じグループの base を重ねない（色が混ざらない）', () => {
    const cases: readonly WarningLike[][] = [
      [warning('', '土砂災害の危険度', 4)],
      [warning('03', '大雨警報', 3)],
      [warning('04', '洪水警報', 3)],
      [warning('08', '高潮警報', 4)],
    ]
    for (const warnings of cases) {
      const layers = warningModeLayers(warnings, false)
      const baseGroups = layers.flatMap((key) => {
        const layer = getHazardLayer(key)
        return layer?.display === 'base' ? [layer.group] : []
      })
      expect(new Set(baseGroups).size, layers.join(',')).toBe(baseGroups.length)
      // ON/OFF の不変条件（`toggleHazardLayer`）とも矛盾しない＝そのまま URL に入れてよい。
      const rebuilt = layers.reduce<readonly string[]>(toggleHazardLayer, [])
      expect(rebuilt).toEqual(layers)
    }
  })

  it('出すレイヤはすべてカタログに実在する', () => {
    const all = [
      ...warningModeLayers([warning('', '土砂災害の危険度', 4)], false),
      ...warningModeLayers([warning('03', '大雨警報', 3)], false),
      ...warningModeLayers([], true),
    ]
    expect(all.every((key) => getHazardLayer(key) !== undefined)).toBe(true)
  })
})
