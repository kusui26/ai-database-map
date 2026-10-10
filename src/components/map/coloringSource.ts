'use client'

/**
 * 駅の色分けのレイヤ（`colorStations`・`?color&colorIn`・2026-10-11 B5c・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * ハイライトと同じく**クラスタにしない別の源**に描く——全国（低いズーム＝駅がクラスタに吸収される）でも、色の付いた駅は
 * 1 つずつ見える。印の大きさは一定（乗降客数で変えない＝色を読みやすく）で、どの印にも濃い縁を付ける（淡い色が地図の地色や
 * 浸水の面に沈まない）。色分けしている間は、ほかの駅とクラスタを薄くする（色の付いた駅が主役）。
 *
 * 何色で描くか・ホバーに何を出すかはドメイン（`domain/style/coloring.ts`）が決める。ここは「どこに・どう重ねるか」だけ。
 */

import type maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import {
  COLORED_STROKE_COLOR,
  coloredStationDetailJa,
  type ColoredStation,
} from '@/domain/style/coloring'

export const COLORING_SOURCE_ID = 'coloring'
export const COLORING_LAYER_ID = 'stations-coloring'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** 印の半径（px・ズームで少しだけ大きく）。 */
const RADIUS_BY_ZOOM: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  3.5,
  9,
  4.5,
  12,
  6,
  15,
  8,
]

/** 縁の太さ（px）。低いズームで太すぎると色が縁に負ける。 */
const STROKE_BY_ZOOM: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  0.75,
  12,
  1.25,
]

/**
 * 色分けしている間に薄くする、ほかの駅の描画（レイヤ・属性・ふだんの値・薄くした値）。
 * ふだんの値は `MapView.addLayers` と同じ（ずらすと、消したあとに元の見た目へ戻らない）。
 */
const DIMMED_PAINT: readonly {
  readonly layer: string
  readonly property: 'circle-opacity' | 'circle-stroke-opacity' | 'text-opacity'
  readonly normal: number
  readonly dimmed: number
}[] = [
  { layer: 'stations-circle', property: 'circle-opacity', normal: 0.72, dimmed: 0.22 },
  { layer: 'stations-circle', property: 'circle-stroke-opacity', normal: 1, dimmed: 0.3 },
  { layer: 'clusters', property: 'circle-opacity', normal: 0.85, dimmed: 0.28 },
  { layer: 'cluster-count', property: 'text-opacity', normal: 1, dimmed: 0.4 },
]

/** 色分けの source と layer を用意する（ふだんの駅の上・ハイライトと選択駅の下）。 */
export function addColoringLayer(map: maplibregl.Map): void {
  map.addSource(COLORING_SOURCE_ID, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: COLORING_LAYER_ID,
    type: 'circle',
    source: COLORING_SOURCE_ID,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': RADIUS_BY_ZOOM,
      'circle-stroke-color': COLORED_STROKE_COLOR,
      'circle-stroke-width': STROKE_BY_ZOOM,
    },
  })
}

/** 駅の座標（地図が全駅の GeoJSON から作った索引）。 */
export type StationCoord = { readonly lon: number; readonly lat: number; readonly name: string }

/** 経度・緯度の範囲 [西, 南, 東, 北]。 */
export type LonLatBox = readonly [number, number, number, number]

export type ColoringFeatures = {
  readonly collection: FeatureCollection<Point>
  /** 描いた駅が入る範囲（描いた駅が無ければ null）。 */
  readonly bounds: LonLatBox | null
}

function extend(box: LonLatBox | null, lon: number, lat: number): LonLatBox {
  if (box === null) return [lon, lat, lon, lat]
  return [
    Math.min(box[0], lon),
    Math.min(box[1], lat),
    Math.max(box[2], lon),
    Math.max(box[3], lat),
  ]
}

/** 駅 1 つの印（ホバーは駅名と「値・段」を出す）。 */
function featureOf(station: ColoredStation, coord: StationCoord): Feature<Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [coord.lon, coord.lat] },
    properties: {
      grp: station.grp,
      name: coord.name,
      color: station.color,
      kind: station.kind,
      detailJa: coloredStationDetailJa(station),
    },
  }
}

/** 色分けの印 → GeoJSON（座標の分からない駅は描かない）。 */
export function coloringFeatures(
  stations: readonly ColoredStation[],
  coords: ReadonlyMap<string, StationCoord>,
): ColoringFeatures {
  const placed = stations.flatMap((station) => {
    const coord = coords.get(station.grp)
    return coord === undefined ? [] : [{ station, coord }]
  })
  const bounds = placed.reduce<LonLatBox | null>(
    (box, { coord }) => extend(box, coord.lon, coord.lat),
    null,
  )
  const features = placed.map(({ station, coord }) => featureOf(station, coord))
  return { collection: { type: 'FeatureCollection', features }, bounds }
}

/** ほかの駅を薄くする・戻す。 */
export function dimBaseStations(map: maplibregl.Map, dimmed: boolean): void {
  for (const paint of DIMMED_PAINT) {
    if (map.getLayer(paint.layer) === undefined) continue
    map.setPaintProperty(paint.layer, paint.property, dimmed ? paint.dimmed : paint.normal)
  }
}

/** 色分けを地図に反映する（空＝消す）。 */
export function syncColoring(map: maplibregl.Map, collection: FeatureCollection<Point>): void {
  const source = map.getSource<maplibregl.GeoJSONSource>(COLORING_SOURCE_ID)
  if (source === undefined) return
  source.setData(collection)
  dimBaseStations(map, collection.features.length > 0)
}
