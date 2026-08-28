/**
 * 地図の出典（MapLibre attribution・右下）——**並び順を自分で決める**ためのラッパ
 * （`docs/260828_fix_source_display.md` §3.5 決定 6）。
 *
 * ## 並び：「[重ねたデータの出典] | ベース地図の出典 | MapLibre ⓘ」
 *
 * 提供元（法的に要る側）を先に、エンジン（任意の謝辞）を最後に。右寄せのピルでは
 * 右端だけが動かないので、常に出る「ベース | MapLibre ⓘ」を右端の固定ブロックにし、
 * 災害レイヤで増減する出典は左（伸びる側）に付ける。
 *
 * ## MapLibre は出典を**文字列の長さ順**に並べる
 *
 * `AttributionControl._updateAttributions` は重複除去のために全項目を長さで昇順ソートし、
 * その順のまま表示する（`attribution_control.ts`）。だから既定のままでは
 * 「MapLibre | ベース」になり、災害レイヤ ON では短い素のテキストが先頭に来て
 * 「キキクル | ポータル | MapLibre | ベース」とエンジンが提供元の間に挟まる。
 *
 * ソートは止められないが、**部分文字列は消す**という同じ処理を使えば順を決められる：
 * 「ベース | MapLibre」を **1 本の `customAttribution`** として渡すと、スタイルのソースが
 * 持つベースの出典はその部分文字列なので除かれ、こちらの 1 本だけが残る。
 * 災害レイヤの出典（短い）はソートで必ずその左に付く。
 *
 * ## ⓘ（About を開く）は自前のボタン
 *
 * MapLibre の `summary.maplibregl-ctrl-attrib-button` は `compact: false` でも DOM にあるが、
 * **`<details>` の `summary`** なので表示して押すと既定動作で中身が閉じる。元の ⓘ は
 * 「畳むボタン」で、ドラッグで出典を隠していた張本人でもある（同 §1.2）。見た目だけを借りて、
 * 自前の `<button>` を出典コンテナの末尾に足す。MapLibre は出典の文字を
 * `.maplibregl-ctrl-attrib-inner` の中だけ書き換えるので、兄弟として足したボタンは消えない。
 */

import maplibregl from 'maplibre-gl'
import { MAPLIBRE_CREDIT_HTML } from '@/shared/constants'

/** MapLibre と同じ区切り（ソースの出典と並んだときに見た目が揃う）。 */
const SEPARATOR = ' | '

/** MapLibre 同梱の ⓘ（`svg/maplibregl-ctrl-attrib.svg`・BSD-3）。パスは 1 本。 */
const ICON_VIEWBOX = '0 0 20 20'
const ICON_PATH =
  'M4 10a6 6 0 1 0 12 0 6 6 0 1 0-12 0m5-3a1 1 0 1 0 2 0 1 1 0 1 0-2 0m0 3a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0'
const SVG_NS = 'http://www.w3.org/2000/svg'

export const ATTRIBUTION_ABOUT_CLASS = 'map-attrib-about'
/** ヘッダの ⓘ と同じ文言（同じ場所へ行くので同じ名前で呼ぶ）。 */
export const ATTRIBUTION_ABOUT_LABEL_JA = 'このアプリ・データ出典について'

/** ソース定義の `attribution`（無ければ null）。スタイルの型は広いので型ガードで拾う。 */
function attributionOf(source: unknown): string | null {
  if (typeof source !== 'object' || source === null || !('attribution' in source)) return null
  const value = source.attribution
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * スタイルのソース（定義順）の出典 ＋ MapLibre の表記 → 1 本の文字列。
 * ベース地図が先、MapLibre が最後。同じ文は 1 回。
 */
export function attributionHtml(
  sources: Readonly<Record<string, unknown>>,
  creditHtml: string = MAPLIBRE_CREDIT_HTML,
): string {
  const base = Object.values(sources).flatMap((source) => {
    const attribution = attributionOf(source)
    return attribution === null ? [] : [attribution]
  })
  return [...new Set([...base, creditHtml])].join(SEPARATOR)
}

function iconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', ICON_VIEWBOX)
  svg.setAttribute('fill-rule', 'evenodd')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', ICON_PATH)
  svg.appendChild(path)
  return svg
}

/** 出典ピルに ⓘ を足す。位置と見た目は `globals.css` の `.map-attrib-about`。 */
function appendAboutButton(container: Element, onOpen: () => void): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ATTRIBUTION_ABOUT_CLASS
  button.setAttribute('aria-label', ATTRIBUTION_ABOUT_LABEL_JA)
  button.title = ATTRIBUTION_ABOUT_LABEL_JA
  button.appendChild(iconSvg())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    onOpen()
  })
  container.appendChild(button)
}

/**
 * 出典コントロール（常時展開・並び順つき・ⓘ つき）を右下に足す。
 * **スタイルが読み込まれてから**呼ぶ（`load`）——ベース地図の出典をスタイルから読むため。
 */
export function addAttributionControl(map: maplibregl.Map, onOpenAbout: () => void): void {
  const control = new maplibregl.AttributionControl({
    compact: false,
    customAttribution: attributionHtml(map.getStyle().sources),
  })
  map.addControl(control, 'bottom-right')
  const container = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
  if (container !== null) appendAboutButton(container, onOpenAbout)
}
