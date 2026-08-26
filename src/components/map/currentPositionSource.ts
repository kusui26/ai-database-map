'use client'

/**
 * 現在地のピンと**精度円**を地図に描く（`docs/260824_flood.md` §8.3・§7.6）。
 *
 * **精度円を必ず出す**のがこの機能の肝である。GPS の誤差は 5〜50m、屋内なら 1km を超えることもあり、
 * 250m メッシュより粗いことすらある（§11 リスク 3）。点だけを打つと「ここにいる」と誤解させるので、
 * **どれだけ確からしいかを図形で示す**。カードの文言（「メッシュのごく一部が…」）と役割が同じ。
 */

import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { circlePolygon } from '@/shared/geo'
import type { CurrentPosition } from '@/stores/geoStore'

const POSITION_SOURCE = 'current-position'
const ACCURACY_SOURCE = 'current-accuracy'
/** 現在地の色。ハザード（暖色）と半径サークル（アクセント）のどちらとも違う色にする。 */
const POSITION_COLOR = '#2563eb'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** 現在地の source と layer を用意する（`MapView.addLayers` の最後＝いちばん上に描く）。 */
export function addCurrentPositionLayers(map: maplibregl.Map): void {
  map.addSource(ACCURACY_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(POSITION_SOURCE, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'current-accuracy-fill',
    type: 'fill',
    source: ACCURACY_SOURCE,
    paint: { 'fill-color': POSITION_COLOR, 'fill-opacity': 0.1 },
  })
  map.addLayer({
    id: 'current-accuracy-line',
    type: 'line',
    source: ACCURACY_SOURCE,
    paint: { 'line-color': POSITION_COLOR, 'line-width': 1, 'line-opacity': 0.5 },
  })
  map.addLayer({
    id: 'current-position-dot',
    type: 'circle',
    source: POSITION_SOURCE,
    paint: {
      'circle-color': POSITION_COLOR,
      'circle-radius': 6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
    },
  })
}

/** 現在地を反映する（`null`＝消す）。精度が無い端末でも点だけは出す。 */
export function syncCurrentPosition(map: maplibregl.Map, position: CurrentPosition | null): void {
  const dot = map.getSource<maplibregl.GeoJSONSource>(POSITION_SOURCE)
  const accuracy = map.getSource<maplibregl.GeoJSONSource>(ACCURACY_SOURCE)
  if (dot === undefined || accuracy === undefined) return
  if (position === null) {
    dot.setData(EMPTY)
    accuracy.setData(EMPTY)
    return
  }
  dot.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
        properties: {},
      },
    ],
  })
  accuracy.setData({
    type: 'FeatureCollection',
    features:
      position.accuracyM > 0
        ? [
            {
              type: 'Feature',
              geometry: circlePolygon(position.lon, position.lat, position.accuracyM),
              properties: {},
            },
          ]
        : [],
  })
}
