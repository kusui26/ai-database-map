'use client'

/**
 * 全国 9,273 駅の地図（MapLibre）。
 * ベースは地理院 最適化ベクトルタイル（淡色・出典表示）。全駅 GeoJSON を 1 回取得し、
 * クラスタ（z<10）→ circle（乗降客数の平方根スケール）→ ラベル（z≥12）で描画。
 * クリックで選択（flyTo＋ハイライト＋半径サークル）、状態は URL（?grp&r）に同期。
 */

import { useEffect, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ACCENT_COLOR, PANEL_WIDTH_PX } from '@/shared/constants'
import { circlePolygon } from '@/shared/geo'
import { type HoverInfo, useMapStore } from '@/stores/mapStore'
import { useChatStore } from '@/stores/chatStore'
import { useGeoStore } from '@/stores/geoStore'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { HoverTooltip } from './HoverTooltip'
import { addCurrentPositionLayers, syncCurrentPosition } from './currentPositionSource'
import { syncHazardLayers } from './hazardSource'
import { loadStations } from './stationsSource'
import { useHazardUrlState } from './useHazardUrlState'
import { useMapUrlState } from './useMapUrlState'

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? '/map/gsi-pale-style.json'
const TOKYO_STATION: [number, number] = [139.767, 35.681]
const BASE_PAD = 64
// 左チャット／右ドロワーの幅は共通定数（260804）。ここを合わせないと flyTo が
// 選択駅をパネルの裏に置いてしまう。
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }
const NONE = '__none__'

/** 開いているパネル幅を避けて可視領域の中心へ寄せる flyTo padding（plan_fable §2.4 ルール④）。 */
function flyPadding(
  isDesktop: boolean,
  chatOpen: boolean,
  drawerOpen: boolean,
): maplibregl.PaddingOptions {
  return {
    top: BASE_PAD,
    bottom: BASE_PAD,
    left: isDesktop && chatOpen ? PANEL_WIDTH_PX + BASE_PAD : BASE_PAD,
    right: isDesktop && drawerOpen ? PANEL_WIDTH_PX + BASE_PAD : BASE_PAD,
  }
}

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

  // ハイライト（チャットのランキング上位など・複数駅を枠で示す）。
  // クラスタ源とは別の**非クラスタ源**から描くので、全国（低ズーム＝駅がクラスタに吸収される）でも枠が消えない。
  map.addLayer({
    id: 'stations-highlight',
    type: 'circle',
    source: 'highlight',
    paint: {
      'circle-color': ACCENT_COLOR,
      'circle-opacity': 0.14,
      'circle-radius': 9,
      'circle-stroke-color': ACCENT_COLOR,
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': 0.95,
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

  // 現在地はいちばん上（ハザードの塗りにも駅名にも隠されない）。
  addCurrentPositionLayers(map)
}

function addHandlers(
  map: maplibregl.Map,
  setGrpRef: { current: SetGrp },
  setHoveredRef: { current: (info: HoverInfo | null) => void },
): void {
  const pointerLayers = ['stations-circle', 'stations-highlight', 'stations-selected']

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
  // 「地図が使える」は他（重いチャンクの先読みの開始条件）でも要るのでストアに持つ。
  const ready = useMapStore((state) => state.ready)
  const setReady = useMapStore((state) => state.setReady)

  const { grp, setGrp, radiusM } = useMapUrlState()
  const { layerKeys: hazardLayerKeys, opacity: hazardOpacity } = useHazardUrlState()
  const currentPosition = useGeoStore((state) => state.position)
  const setHovered = useMapStore((state) => state.setHovered)
  const highlightedGrps = useMapStore((state) => state.highlightedGrps)
  const flyToReq = useMapStore((state) => state.flyTo)
  const chatOpen = useChatStore((state) => state.open)
  const isDesktop = useIsDesktop()

  // ハンドラから常に最新のセッターを参照するための ref
  const setGrpRef = useRef(setGrp)
  setGrpRef.current = setGrp
  const setHoveredRef = useRef(setHovered)
  setHoveredRef.current = setHovered

  // flyTo padding は開いているパネル（チャット/ドロワー）に依存するが、
  // その変化だけで再 flyTo はしたくないので ref 経由で参照する。
  const paddingRef = useRef<maplibregl.PaddingOptions>(
    flyPadding(isDesktop, chatOpen, grp !== null),
  )
  paddingRef.current = flyPadding(isDesktop, chatOpen, grp !== null)
  // ハイライト効果内で「選択駅の有無」を参照するための ref（grp 変化で効果を再走させない）。
  const grpRef = useRef(grp)
  grpRef.current = grp

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    // 駅データの取得を**地図の生成より先に**始める。以前は load の中で fetch していたため、
    // スタイルとタイルが揃うまで取りに行きもしなかった（260803・§4-②）。
    const stations = loadStations()

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

    // 待っている間にアンマウントされたら、消えた地図に触らない。
    let disposed = false

    map.on('load', () => {
      void (async () => {
        try {
          const featureCollection: FeatureCollection = await stations
          if (disposed) return
          collectCoords(featureCollection, coordsRef.current)
          map.addSource('stations', {
            type: 'geojson',
            data: featureCollection,
            cluster: true,
            clusterMaxZoom: 9,
            clusterRadius: 48,
          })
          map.addSource('radius', { type: 'geojson', data: EMPTY_FC })
          map.addSource('highlight', { type: 'geojson', data: EMPTY_FC }) // 非クラスタ（ハイライト専用）
          addLayers(map)
          addHandlers(map, setGrpRef, setHoveredRef)
          setReady(true)
        } catch (error) {
          // 駅が出ないだけで地図は使える。原因を残して静かに諦める。
          console.error('駅データを地図に追加できませんでした', error)
        }
      })()
    })

    return () => {
      disposed = true
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
          padding: paddingRef.current,
        })
      }
    }
  }, [ready, grp])

  // ハイライト：非クラスタ源に点を流し込み（全国でも枠が見える）＋その範囲へフィット
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    const source = map.getSource<maplibregl.GeoJSONSource>('highlight')
    if (source === undefined) return
    const bounds = new maplibregl.LngLatBounds()
    const features: FeatureCollection['features'] = []
    for (const grp of highlightedGrps) {
      const coord = coordsRef.current.get(grp)
      if (coord === undefined) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [coord.lon, coord.lat] },
        properties: { grp, name: coord.name },
      })
      bounds.extend([coord.lon, coord.lat])
    }
    source.setData({ type: 'FeatureCollection', features })
    // 選択駅がある場合はその flyTo にカメラを任せる（二重のカメラ操作を避ける）。
    if (features.length > 0 && grpRef.current === null) {
      map.fitBounds(bounds, { padding: paddingRef.current, maxZoom: 12, duration: 800 })
    }
  }, [ready, highlightedGrps])

  // 任意 flyTo：チャットの flyTo（駅選択を伴わない移動・seq で再実行）
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null || flyToReq === null) return
    map.flyTo({
      center: [flyToReq.lon, flyToReq.lat],
      zoom: flyToReq.zoom ?? Math.max(map.getZoom(), 12),
      padding: paddingRef.current,
    })
  }, [ready, flyToReq])

  // ハザードレイヤ：?hz / ?hzop に追随してラスタを差し替える。
  // 出典は source の attribution に載せてあるので、MapLibre の出典表示が自動で追随する。
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    syncHazardLayers(map, hazardLayerKeys, hazardOpacity)
  }, [ready, hazardLayerKeys, hazardOpacity])

  // 現在地：ピンと精度円。**精度円を必ず出す**（点だけだと「ここにいる」と誤解させる・§7.6）。
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    syncCurrentPosition(map, currentPosition)
  }, [ready, currentPosition])

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
      <div
        ref={containerRef}
        className="size-full"
        role="application"
        aria-label="駅データの地図（ドラッグで移動・ホイールで拡大縮小）"
      />
      <HoverTooltip />
    </div>
  )
}
