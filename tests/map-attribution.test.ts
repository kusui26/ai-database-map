import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAP_ATTRIBUTION_STRIP_PX, PANEL_GAP_PX } from '@/shared/constants'

/**
 * **地図の出典（MapLibre attribution）が、どの画面状態でも読めること**（2026-08-28）。
 *
 * 出典の表示は利用条件（国土地理院・気象庁・国土交通省）だが、
 * - デスクトップ：パネルが `bottom-3` まで届き、**駅を選ぶと出典がドロワーの裏に隠れた**
 * - モバイル：既定のレスポンシブ表示が ⓘ に畳み、**押さないと読めなかった**
 * （ハッカソン事務局からの指摘「提供元および権利表記が確認できるよう、出典を明記」）。
 *
 * 直し方は「下端に出典**だけ**の帯を空ける」——浮遊 UI（チャット・駅詳細・FAB）を
 * 帯より上に退かせ、出典は常時展開にする。ここで固定するのは、
 * **帯の高さが 1 か所の定数で語られ、退く側がそれに揃っていること**である。
 * 実寸（バーの高さ・重なりの有無）は Playwright の実測で確かめた（PR 記載）。
 */

const MAP_VIEW = readFileSync('src/components/map/MapView.tsx', 'utf-8')
const CHAT = readFileSync('src/components/chat/ChatPanel.tsx', 'utf-8')
const DETAIL = readFileSync('src/components/detail/StationDetailPanel.tsx', 'utf-8')
const FAB = readFileSync('src/components/Fab.tsx', 'utf-8')
const CSS = readFileSync('src/app/globals.css', 'utf-8')

const TAILWIND_SPACING_PX = 4

describe('出典は常時展開（畳まれない）', () => {
  it('MapView は compact: false で出典コントロールを作る', () => {
    // 既定（レスポンシブ）だと幅 640px 未満で ⓘ に畳まれる。押さないと読めない出典は
    // 明記になっていない。
    expect(MAP_VIEW).toContain('attributionControl: { compact: false }')
  })
})

describe('下端の帯（デスクトップ）', () => {
  it('帯の高さは Tailwind の bottom-9 と同値（コメントとクラスがずれない）', () => {
    expect(MAP_ATTRIBUTION_STRIP_PX).toBe(9 * TAILWIND_SPACING_PX)
    // 帯はパネルの既定余白（*-3）より、バー 1 本ぶん高い。
    expect(MAP_ATTRIBUTION_STRIP_PX).toBeGreaterThan(PANEL_GAP_PX)
  })

  it('チャットと駅詳細は帯より上に退く（bottom-9・bottom-3 に戻さない）', () => {
    for (const [name, source] of [
      ['ChatPanel', CHAT],
      ['StationDetailPanel', DETAIL],
    ] as const) {
      expect(source, name).toContain('bottom-9')
      expect(source, name).not.toMatch(/['" ]bottom-3[ '"]/)
    }
  })

  it('FAB はデスクトップだけ帯より上に退く（モバイルは帯を作らない）', () => {
    expect(FAB).toContain('sm:bottom-9')
    expect(FAB).toContain('bottom-4')
  })

  it('拡大縮小コントロールは、退いた FAB のさらに上（重なりを実測した値）', () => {
    // FAB 上端 36 + 40 = 76px。3rem（48px）のままだと FAB と 28px 重なる。
    expect(CSS).toMatch(/maplibregl-ctrl-bottom-left[\s\S]{0,80}margin-bottom: 5\.5rem/)
  })
})

describe('モバイル（帯なし・FAB の上へ）', () => {
  it('出典を下部中央の FAB より上に置く', () => {
    expect(CSS).toMatch(
      /max-width: 639px[\s\S]{0,120}maplibregl-ctrl-bottom-right[\s\S]{0,80}margin-bottom: 3\.5rem/,
    )
  })
})
