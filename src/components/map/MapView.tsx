'use client'

/**
 * 全国 9,273 駅の地図（MapLibre）。
 * ベースは地理院 最適化ベクトルタイル（淡色・出典表示）。全駅 GeoJSON を 1 回取得し、
 * クラスタ（z<10）→ circle（乗降客数の平方根スケール）→ ラベル（z≥12）で描画。
 * クリックで選択（flyTo＋ハイライト＋半径サークル）、状態は URL（?grp&r）に同期。
 */

import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ACCENT_COLOR } from '@/shared/constants'
import { circlePolygon } from '@/shared/geo'
import { type HoverInfo, useMapStore } from '@/stores/mapStore'
import { HoverTooltip } from './HoverTooltip'
import { useMapUrlState } from './useMapUrlState'

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? '/map/gsi-pale-style.json'
const TOKYO_STATION: [number, number] = [139.767, 35.681]
const FLY_PADDING = { top: 64, bottom: 64, left: 64, right: 64 }
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const NONE = '__none__'

type Coord = { readonly lon: number; readonly lat: number; readonly name: string }
type SetGrp = (grp: string | null) => void

function collectCoords(fc: FeatureCollection, into: Map<string, Coord>): void {
  for (const feature of fc.features) {
    if (feature.geometry.type !== 'Point') continue
    const [lon, lat] = feature.geometry.coordinates
    const grp = feature.properties?.grp
    const name = feature.properties?.name
    if (typeof grp === 'string' && typeof lon === 'number' && typeof lat === 'number') {
      into.set(grp, { lon, lat, name: typeof name === 'string' ? name : grp })
    }
  }
}

function addLayers(map: maplibregl.Map): void {
  // 半径サークル（駅の下）
  map.addLayer({
    id: 'radius-fill',
    type: 'fill',
    source: 'radius',
    paint: { 'fill-color': ACCENT_COLOR, 'fill-opacity': 0.08 },
  })
  map.addLayer({
    id: 'radius-line',
    type: 'line',
    source: 'radius',
    paint: { 'line-color': ACCENT_COLOR, 'line-width': 1.5, 'line-opacity': 0.5 },
  })

  // クラスタ（低ズーム）
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'stations',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#64748b',
      'circle-opacity': 0.85,
      'circle-radius': ['step', ['get', 'point_count'], 12, 50, 16, 200, 22, 1000, 30],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  })
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'stations',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['NotoSansJP-Regular'],
      'text-size': 11,
    },
    paint: { 'text-color': '#ffffff' },
  })

  // 個別駅（乗降客数の平方根スケール）
  map.addLayer({
    id: 'stations-circle',
    type: 'circle',
    source: 'stations',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#1e293b',
      'circle-opacity': 0.72,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['sqrt', ['coalesce', ['get', 'pax'], 1]],
        0,
        2.5,
        200,
        5,
        1700,
        18,
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  })

  // 選択駅（アクセント色・フィルタで切替）
  map.addLayer({
    id: 'stations-selected',
    type: 'circle',
    source: 'stations',
    filter: ['==', ['get', 'grp'], NONE],
    paint: {
      'circle-color': ACCENT_COLOR,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['sqrt', ['coalesce', ['get', 'pax'], 1]],
        0,
        5,
        1700,
        20,
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })

  // ラベル（z≥12）
  map.addLayer({
    id: 'stations-label',
    type: 'symbol',
    source: 'stations',
    filter: ['!', ['has', 'point_count']],
    minzoom: 12,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['NotoSansJP-Regular'],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  })
}

function addHandlers(
  map: maplibregl.Map,
  setGrpRef: { current: SetGrp },
  setHoveredRef: { current: (info: HoverInfo | null) => void },
): void {
  const pointerLayers = ['stations-circle', 'stations-selected']

  for (const layer of pointerLayers) {
    map.on('click', layer, (e) => {
      const grp = e.features?.[0]?.properties?.grp
      if (typeof grp === 'string') void setGrpRef.current(grp)
    })
    map.on('mousemove', layer, (e) => {
      map.getCanvas().style.cursor = 'pointer'
      const name = e.features?.[0]?.properties?.name
      setHoveredRef.current({
        name: typeof name === 'string' ? name : '',
        x: e.point.x,
        y: e.point.y,
      })
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
      setHoveredRef.current(null)
    })
  }

  map.on('click', 'clusters', (e) => {
    const feature = e.features?.[0]
    const clusterId = feature?.properties?.cluster_id
    const source = map.getSource<maplibregl.GeoJSONSource>('stations')
    if (feature === undefined || source === undefined || typeof clusterId !== 'number') return
    void source.getClusterExpansionZoom(clusterId).then((zoom) => {
      if (feature.geometry.type !== 'Point') return
      const lon = feature.geometry.coordinates[0]
      const lat = feature.geometry.coordinates[1]
      if (typeof lon === 'number' && typeof lat === 'number') {
        map.easeTo({ center: [lon, lat], zoom })
      }
    })
  })
  map.on('mouseenter', 'clusters', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'clusters', () => {
    map.getCanvas().style.cursor = ''
  })
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const coordsRef = useRef<Map<string, Coord>>(new Map())
  const [ready, setReady] = useState(false)

  const { grp, setGrp, radiusM } = useMapUrlState()
  const setHovered = useMapStore((state) => state.setHovered)

  // ハンドラから常に最新のセッターを参照するための ref
  const setGrpRef = useRef(setGrp)
  setGrpRef.current = setGrp
  const setHoveredRef = useRef(setHovered)
  setHoveredRef.current = setHovered

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: TOKYO_STATION,
      zoom: 9,
      minZoom: 4,
      maxZoom: 18,
    })
    mapRef.current = map
    // 拡大縮小は左下（ロゴと重ならない・デスクトップは FAB の上／CSS で余白）
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left')

    map.on('load', () => {
      void (async () => {
        const response = await fetch('/api/stations/geojson')
        const featureCollection: FeatureCollection = await response.json()
        collectCoords(featureCollection, coordsRef.current)
        map.addSource('stations', {
          type: 'geojson',
          data: featureCollection,
          cluster: true,
          clusterMaxZoom: 9,
          clusterRadius: 48,
        })
        map.addSource('radius', { type: 'geojson', data: EMPTY_FC })
        addLayers(map)
        addHandlers(map, setGrpRef, setHoveredRef)
        setReady(true)
      })()
    })

    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // 選択：ハイライト更新＋flyTo
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    map.setFilter('stations-selected', ['==', ['get', 'grp'], grp ?? NONE])
    if (grp !== null) {
      const coord = coordsRef.current.get(grp)
      if (coord !== undefined) {
        map.flyTo({
          center: [coord.lon, coord.lat],
          zoom: Math.max(map.getZoom(), 12),
          padding: FLY_PADDING,
        })
      }
    }
  }, [ready, grp])

  // 半径サークル：選択駅＋半径で再描画
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    const source = map.getSource<maplibregl.GeoJSONSource>('radius')
    if (source === undefined) return
    const coord = grp === null ? undefined : coordsRef.current.get(grp)
    if (coord === undefined) {
      source.setData(EMPTY_FC)
      return
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: circlePolygon(coord.lon, coord.lat, radiusM), properties: {} },
      ],
    })
  }, [ready, grp, radiusM])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="size-full" />
      <HoverTooltip />
    </div>
  )
}
