'use client'

/**
 * チャットが指した**地点**の印（`showPoint`・`docs/260824_flood.md` §6.4・§7.1）。
 *
 * 駅の選択（`selectStation`）とは別の操作系にしてある。水害は「その一点の話」で、
 * **駅ではない場所**（現在地・避難先・地図をクリックした点）を指す必要があるためである。
 * 現在地のピン（青・精度円つき）とも見た目を変える——**測った位置か、指し示した位置か**は別物なので。
 */

import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { ACCENT_COLOR } from '@/shared/constants'
import type { MarkedPoint } from '@/stores/mapStore'

const SOURCE_ID = 'marked-point'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** 指し示した地点の source と layer を用意する（現在地の下・駅ラベルの上）。 */
export function addPointMarkerLayers(map: maplibregl.Map): void {
  map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'marked-point-halo',
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-color': ACCENT_COLOR,
      'circle-opacity': 0.15,
      'circle-radius': 16,
      'circle-stroke-color': ACCENT_COLOR,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.6,
    },
  })
  map.addLayer({
    id: 'marked-point-dot',
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-color': ACCENT_COLOR,
      'circle-radius': 5,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: 'marked-point-label',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['has', 'labelJa'],
    layout: {
      'text-field': ['get', 'labelJa'],
      'text-font': ['NotoSansJP-Regular'],
      'text-size': 12,
      'text-offset': [0, -1.6],
      'text-anchor': 'bottom',
    },
    paint: {
      'text-color': ACCENT_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  })
}

/** 指し示した地点を反映する（`null`＝消す）。 */
export function syncPointMarker(map: maplibregl.Map, point: MarkedPoint | null): void {
  const source = map.getSource<maplibregl.GeoJSONSource>(SOURCE_ID)
  if (source === undefined) return
  source.setData(
    point === null
      ? EMPTY
      : {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
              properties: point.labelJa === null ? {} : { labelJa: point.labelJa },
            },
          ],
        },
  )
}
