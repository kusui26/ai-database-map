import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAP_ATTRIBUTION_STRIP_PX, MAPLIBRE_CREDIT_HTML, PANEL_GAP_PX } from '@/shared/constants'
import {
  attributionHtml,
  ATTRIBUTION_ABOUT_CLASS,
  ATTRIBUTION_ABOUT_LABEL_JA,
} from '@/components/map/attribution'
import { hazardLayers } from '@/shared/hazard'
import { useUiStore } from '@/stores/uiStore'

/**
 * **地図の出典（MapLibre attribution）が、どの画面状態でも読めること**（2026-08-28）。
 *
 * 出典の表示は利用条件（国土地理院・気象庁・国土交通省）だが、
 * - デスクトップ：パネルが `bottom-3` まで届き、**駅を選ぶと出典がドロワーの裏に隠れた**
 * - モバイル：既定のレスポンシブ表示が ⓘ に畳み、**押さないと読めなかった**
 * - さらに MapLibre の既定は**地図をドラッグすると畳む**（`_updateCompactMinimize`）
 * （ハッカソン事務局からの指摘「提供元および権利表記が確認できるよう、出典を明記」）。
 *
 * 直し方は「下端に地図のフッター行を空ける」——浮遊 UI（チャット・駅詳細・FAB）を
 * 帯より上に退かせ、出典は常時展開のピルにする（`docs/260828_fix_source_display.md`）。
 * ここで固定するのは、**帯の高さが 1 か所の定数で語られ、退く側がそれに揃っていること**、
 * **消えやすいもの（MapLibre 表記・ⓘ）が消えていないこと**、**並び順が崩れないこと**である。
 * 実寸（バーの高さ・重なりの有無）は Playwright の実測で確かめた（PR 記載）。
 */

const MAP_VIEW = readFileSync('src/components/map/MapView.tsx', 'utf-8')
const ATTRIBUTION = readFileSync('src/components/map/attribution.ts', 'utf-8')
const CHAT = readFileSync('src/components/chat/ChatPanel.tsx', 'utf-8')
const DETAIL = readFileSync('src/components/detail/StationDetailPanel.tsx', 'utf-8')
const FAB = readFileSync('src/components/Fab.tsx', 'utf-8')
const HEADER = readFileSync('src/components/AppHeader.tsx', 'utf-8')
const CSS = readFileSync('src/app/globals.css', 'utf-8')

/** 本番のベース地図スタイル（`MapView` の既定 `STYLE_URL`）。 */
const STYLE: unknown = JSON.parse(readFileSync('public/map/gsi-pale-style.json', 'utf-8'))

const TAILWIND_SPACING_PX = 4

function styleSources(style: unknown): Readonly<Record<string, unknown>> {
  if (typeof style !== 'object' || style === null || !('sources' in style)) return {}
  const sources = style.sources
  return typeof sources === 'object' && sources !== null ? { ...sources } : {}
}

describe('出典は常時展開（畳まれない）・スタイルが読めてから足す', () => {
  it('既定のコントロールを使わず、load の中で自前のコントロールを足す', () => {
    expect(MAP_VIEW).toContain('attributionControl: false')
    expect(MAP_VIEW).toContain('addAttributionControl(map')
    // 既定（compact: true）だと ⓘ 付きのピルで出て、ドラッグすると畳まれる。
    expect(ATTRIBUTION).toContain('compact: false')
  })
})

describe('並び順：「[重ねたデータの出典] | ベース地図 | MapLibre」（決定 6）', () => {
  const GSI = '<a href="https://www.gsi.go.jp/">国土地理院</a>'

  it('ベース地図の出典が先、MapLibre が最後。出典の無いソースは飛ばす', () => {
    const html = attributionHtml({
      gsi: { type: 'vector', attribution: GSI },
      stations: { type: 'geojson' },
      empty: { type: 'raster', attribution: '   ' },
    })
    expect(html).toBe(`${GSI} | ${MAPLIBRE_CREDIT_HTML}`)
  })

  it('同じ文は 1 回（同じ出典を持つソースが複数あっても繰り返さない）', () => {
    const html = attributionHtml({ a: { attribution: GSI }, b: { attribution: GSI } })
    expect(html).toBe(`${GSI} | ${MAPLIBRE_CREDIT_HTML}`)
  })

  it('本番のスタイルでは「国土地理院最適化ベクトルタイル | MapLibre」になる', () => {
    const html = attributionHtml(styleSources(STYLE))
    expect(html.startsWith('<a href="https://www.gsi.go.jp/"')).toBe(true)
    expect(html).toContain('国土地理院最適化ベクトルタイル')
    expect(html.endsWith(MAPLIBRE_CREDIT_HTML)).toBe(true)
    expect(html.indexOf('国土地理院')).toBeLessThan(html.indexOf('MapLibre'))
  })

  it('MapLibre は出典を長さ順に並べるので、重ねたデータの出典はどれも 1 本の文字列より短い', () => {
    // ここが崩れると、災害レイヤの出典がベース地図の右（固定ブロックの中）に割り込む。
    const combined = attributionHtml(styleSources(STYLE)).length
    for (const layer of hazardLayers) {
      expect(layer.attribution.length, layer.key).toBeLessThan(combined)
    }
  })

  it('スタイルの出典は 1 本の文字列の部分文字列（MapLibre の重複除去で 2 重に出ない）', () => {
    const html = attributionHtml(styleSources(STYLE))
    for (const source of Object.values(styleSources(STYLE))) {
      if (typeof source !== 'object' || source === null || !('attribution' in source)) continue
      if (typeof source.attribution === 'string') expect(html).toContain(source.attribution)
    }
  })
})

describe('MapLibre の表記（決定 4）', () => {
  it('表記を明示的に持つ（オプションを渡すと既定が丸ごと置き換わる）', () => {
    expect(ATTRIBUTION).toContain('MAPLIBRE_CREDIT_HTML')
    expect(MAPLIBRE_CREDIT_HTML).toContain('https://maplibre.org/')
    expect(MAPLIBRE_CREDIT_HTML).toContain('>MapLibre<')
  })
})

describe('ⓘ は About を開く（決定 3）', () => {
  it('出典ピルに自前の ⓘ を足し、About を開く', () => {
    expect(MAP_VIEW).toContain('openAbout()')
    expect(ATTRIBUTION).toContain(`className = ATTRIBUTION_ABOUT_CLASS`)
    // 見た目は globals.css がクラス名で受ける。
    expect(CSS).toContain(`.${ATTRIBUTION_ABOUT_CLASS}`)
  })

  it('ヘッダの ⓘ と同じ名前で、同じ store から開く', () => {
    expect(HEADER).toContain(`aria-label="${ATTRIBUTION_ABOUT_LABEL_JA}"`)
    expect(HEADER).toContain('useUiStore')
    expect(HEADER).not.toContain('useState(false)')
  })

  it('store：開くと「一度開いた」も立ち、閉じても下りない（遅延ロードの再取得を防ぐ）', () => {
    useUiStore.setState({ aboutOpen: false, aboutSeen: false })
    useUiStore.getState().openAbout()
    expect(useUiStore.getState()).toMatchObject({ aboutOpen: true, aboutSeen: true })
    useUiStore.getState().setAboutOpen(false)
    expect(useUiStore.getState()).toMatchObject({ aboutOpen: false, aboutSeen: true })
  })
})

describe('下端のフッター行（デスクトップ）', () => {
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

  it('出典ピルは下余白 6px（決定 2・帯 36px の中で取る）', () => {
    expect(CSS).toMatch(/maplibregl-ctrl-attrib \{[\s\S]{0,200}margin: 0 10px 6px 0/)
  })

  it('スケールは拡大縮小より先に足す（左下の器は後から足したものが上に積まれる）', () => {
    const scaleAt = MAP_VIEW.indexOf('new maplibregl.ScaleControl(')
    const zoomAt = MAP_VIEW.indexOf('new maplibregl.NavigationControl(')
    expect(scaleAt).toBeGreaterThan(-1)
    expect(zoomAt).toBeGreaterThan(scaleAt)
  })

  it('拡大縮小は、退いた FAB のさらに上（重なりを実測した値）', () => {
    // FAB 上端 36 + 36 = 72px。器の余白ではなくグループに付ける（スケールは帯の中に残す）。
    expect(CSS).toMatch(/maplibregl-ctrl-group \{[\s\S]{0,80}margin-bottom: 58px/)
  })
})

describe('モバイル（帯なし・FAB の上へ）', () => {
  it('出典を下部中央の FAB より上に置き、最大幅を絞る', () => {
    expect(CSS).toMatch(
      /max-width: 639px[\s\S]{0,200}maplibregl-ctrl-attrib \{[\s\S]{0,120}margin-bottom: 3\.5rem/,
    )
    expect(CSS).toContain('max-width: calc(100vw - 3.5rem)')
  })

  it('スケールは出さない（左下に拡大縮小があり、帯も無い）', () => {
    expect(CSS).toMatch(
      /max-width: 639px[\s\S]{0,600}maplibregl-ctrl-scale \{[\s\S]{0,40}display: none/,
    )
  })
})
