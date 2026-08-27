'use client'

/**
 * 避難先の印（`highlightPoints`・`docs/260824_flood.md` §8.5）。
 *
 * **起点（`showPoint` の印）と見た目を変える。** 同じ印にすると「どこから」「どこへ」が
 * 読めなくなる——避難の画面でそれは致命的である。こちらは
 * **一覧と同じ番号つきの丸**にして、地図と一覧を目で突き合わせられるようにする。
 *
 * 色は緑系（行き先＝向かう場所）にする。ハザードの色（黄・赤・紫）とぶつからず、
 * 「危険を示す印」と誤読されないため。
 */

import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { HighlightedPoint } from '@/stores/mapStore'

const SOURCE_ID = 'evacuation-points'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** 行き先の色（緑＝向かう場所。危険の色と混ぜない）。 */
const DESTINATION_COLOR = '#047857'

/** 避難先の source と layer を用意する（地点の印と同じ帯に置く）。 */
export function addEvacuationPointLayers(map: maplibregl.Map): void {
  map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'evacuation-point-dot',
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-color': DESTINATION_COLOR,
      'circle-radius': 11,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
  // 番号は丸の中に描く。一覧の「1.」と地図の「1」が同じものだと分かる。
  map.addLayer({
    id: 'evacuation-point-index',
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'text-field': ['get', 'indexJa'],
      'text-font': ['NotoSansJP-Regular'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({
    id: 'evacuation-point-label',
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'text-field': ['get', 'labelJa'],
      'text-font': ['NotoSansJP-Regular'],
      'text-size': 12,
      'text-offset': [0, -1.4],
      'text-anchor': 'bottom',
    },
    paint: {
      'text-color': DESTINATION_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  })
}

/** 避難先を反映する（空配列＝消す）。 */
export function syncEvacuationPoints(
  map: maplibregl.Map,
  points: readonly HighlightedPoint[],
): void {
  const source = map.getSource<maplibregl.GeoJSONSource>(SOURCE_ID)
  if (source === undefined) return
  source.setData(
    points.length === 0
      ? EMPTY
      : {
          type: 'FeatureCollection',
          features: points.map((point, index) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
            properties: { labelJa: point.labelJa, indexJa: String(index + 1) },
          })),
        },
  )
}
