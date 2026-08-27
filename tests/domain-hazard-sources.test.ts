import { describe, expect, it } from 'vitest'
import {
  hazardDataSources,
  EVACUATION_SITE_SOURCE,
  GSI_REVERSE_GEOCODER_SOURCE,
  JMA_WARNING_SOURCE,
  KIKIKURU_SOURCE,
  SUIBOU_NAVI_SOURCE,
} from '@/domain/hazard/sources'
import { hazardFallbackLayers, hazardLegendSections } from '@/domain/hazard/catalog'
import { hazardLayers } from '@/shared/hazard'

/**
 * 災害データの導線（PR-4e）。
 *
 * 守りたいのは 2 つ。**使っているデータの出典が必ず出ること**（表示は利用条件）と、
 * **白い場所を地形で補える導線が押せる形であること**（§3.7・カタログにあるのに読まれていなかった）。
 */

describe('domain/hazard: 出典', () => {
  it('カタログのレイヤの出典を 1 つも落とさない', () => {
    const listed = new Set(hazardDataSources().map((each) => each.source))
    for (const layer of hazardLayers) {
      expect(listed.has(layer.source), layer.key).toBe(true)
    }
  })

  it('API の出典（警報・キキクル・浸水ナビ・避難場所・逆ジオ）も出す', () => {
    const listed = hazardDataSources()
    const has = (needle: string): boolean =>
      listed.some((each) => each.source.includes(needle))
    expect(has('気象警報')).toBe(true)
    expect(has('キキクル')).toBe(true)
    expect(has('浸水ナビ')).toBe(true)
    expect(has('指定緊急避難場所')).toBe(true)
    expect(has('逆ジオコーディング')).toBe(true)
  })

  it('同じ出典は 1 行に畳み、何に使っているかを並べる', () => {
    const listed = hazardDataSources()
    expect(new Set(listed.map((each) => `${each.source}/${each.license}`)).size).toBe(listed.length)
    expect(listed.every((each) => each.usedForJa.length > 0)).toBe(true)
    // 重ねるハザードマップは複数レイヤで使うので、用途が 2 つ以上並ぶ。
    const disaportal = listed.find((each) => each.source.includes('重ねるハザードマップ'))
    expect(disaportal?.usedForJa.length ?? 0).toBeGreaterThan(1)
  })

  it('応答に載せる出典と同じものを使う（About だけ別物にしない）', () => {
    // ラベルは「出典：」付きで地図の出典表示にそのまま出る。About は前置きを外して並べる。
    for (const ref of [
      JMA_WARNING_SOURCE,
      KIKIKURU_SOURCE,
      EVACUATION_SITE_SOURCE,
      GSI_REVERSE_GEOCODER_SOURCE,
      SUIBOU_NAVI_SOURCE,
    ]) {
      expect(ref.license, ref.labelJa).not.toBeNull()
      expect(ref.url, ref.labelJa).not.toBeNull()
    }
  })
})

describe('domain/hazard: 白い場所を補う参考レイヤ（§3.7）', () => {
  it('内水は地形 4 枚を指す（表示名ではなく key で）', () => {
    expect(hazardFallbackLayers('naisui').map((each) => each.key)).toEqual([
      'chisui_chikei',
      'lcm25k',
      'relief',
      'slopemap',
    ])
    // 名前はカタログから引く（UI に書かない）。
    expect(hazardFallbackLayers('naisui').map((each) => each.labelJa)).toContain('治水地形分類図')
  })

  it('すでに出しているレイヤは勧めない', () => {
    const shown = hazardFallbackLayers('naisui', ['chisui_chikei', 'relief'])
    expect(shown.map((each) => each.key)).toEqual(['lcm25k', 'slopemap'])
  })

  it('参考レイヤを持たないレイヤは空（洪水は全国整備なので要らない）', () => {
    expect(hazardFallbackLayers('flood_l2')).toEqual([])
    expect(hazardFallbackLayers('存在しないレイヤ')).toEqual([])
  })

  it('同じ参考レイヤを何度も勧めない（土砂 3 枚はどれも傾斜量図を指す）', () => {
    const sections = hazardLegendSections(['dosekiryu', 'kyukeisha', 'jisuberi'])
    const offered = sections.flatMap((section) => section.fallbacks.map((each) => each.key))
    expect(offered).toEqual(['slopemap'])
  })

  it('凡例の各節が、押せる形の参考レイヤを持って出てくる', () => {
    const sections = hazardLegendSections(['naisui'])
    expect(sections).toHaveLength(1)
    expect(sections[0]?.fallbacks.length).toBeGreaterThan(0)
    // 内水と地形を両方出しているときは、出している地形を勧めない。
    const both = hazardLegendSections(['naisui', 'relief'])
    const naisui = both.find((section) => section.layerKey === 'naisui')
    expect(naisui?.fallbacks.map((each) => each.key)).not.toContain('relief')
  })
})
