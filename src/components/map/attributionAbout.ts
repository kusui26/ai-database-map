/**
 * 地図の出典ピルの右端に置く ⓘ（`docs/260828_fix_source_display.md` §3.2 決定 3）。
 *
 * 押すと About（このアプリ・データ出典・ライセンス）が開く。
 *
 * ## MapLibre の ⓘ（`summary.maplibregl-ctrl-attrib-button`）は使わない
 *
 * `compact: false` でも DOM には残っているが、**`<details>` の `summary`** なので、表示して
 * 押すと既定動作で中身（出典の文字）が閉じる。元の ⓘ は「畳むボタン」であり、
 * ドラッグで出典を隠していた張本人でもある（同 §1.2）。見た目だけを借りて、
 * 自前の `<button>` を出典コンテナ（`details.maplibregl-ctrl-attrib`）の末尾に足す。
 * MapLibre は出典の文字を `.maplibregl-ctrl-attrib-inner` の中だけ書き換えるので、
 * 兄弟として足したボタンは消えない。
 */

import type maplibregl from 'maplibre-gl'

/** MapLibre 同梱の ⓘ（`svg/maplibregl-ctrl-attrib.svg`・BSD-3）。パスは 1 本。 */
const ICON_VIEWBOX = '0 0 20 20'
const ICON_PATH =
  'M4 10a6 6 0 1 0 12 0 6 6 0 1 0-12 0m5-3a1 1 0 1 0 2 0 1 1 0 1 0-2 0m0 3a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0'
const SVG_NS = 'http://www.w3.org/2000/svg'

export const ATTRIBUTION_ABOUT_CLASS = 'map-attrib-about'
/** ヘッダの ⓘ と同じ文言（同じ場所へ行くので同じ名前で呼ぶ）。 */
export const ATTRIBUTION_ABOUT_LABEL_JA = 'このアプリ・データ出典について'

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

/**
 * 出典ピルに ⓘ を足す。出典コントロールが無ければ何もしない（`attributionControl: false` の保険）。
 * 位置と見た目は `globals.css` の `.map-attrib-about`。
 */
export function addAttributionAboutButton(map: maplibregl.Map, onOpen: () => void): void {
  const container = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
  if (container === null) return
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
