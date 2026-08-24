'use client'

/**
 * ハザードのラスタタイルを MapLibre に反映する（追加・削除・不透明度）。
 *
 * タイルは**重ねるハザードマップ／地理院タイルを直接**読む（自前ホスティングなし・
 * `docs/260824_flood.md` §3.2・§8.1）。ここが持つのは「どこに・どの順で挿すか」だけで、
 * どのレイヤがあるか・何色か・どう重ねるかはすべてカタログとドメインが決める。
 */

import type maplibregl from 'maplibre-gl'
import { getHazardLayer } from '@/shared/hazard'
import { hazardDrawOrder, hazardOpacityFor } from '@/domain/hazard/catalog'

/** ハザード由来の source / layer に付ける接頭辞（既存レイヤと衝突させない）。 */
const HAZARD_ID_PREFIX = 'hazard-'

/**
 * ハザードを挿す位置＝アプリのレイヤ群の先頭（`MapView.addLayers` の最初）。
 * こうするとハザードは**ベースマップの直上・駅と駅名ラベルの直下**に入り、
 * 塗りつぶしても駅名が読めなくならない（§7.6）。
 */
const APP_FIRST_LAYER_ID = 'radius-fill'

/** レイヤ key → MapLibre の source / layer id。 */
function idOf(layerKey: string): string {
  return `${HAZARD_ID_PREFIX}${layerKey}`
}

/** 現在地図に載っているハザードレイヤの id（描画順）。 */
function currentHazardLayerIds(map: maplibregl.Map): readonly string[] {
  return map
    .getStyle()
    .layers.map((layer) => layer.id)
    .filter((id) => id.startsWith(HAZARD_ID_PREFIX))
}

/** 1 レイヤを追加する（source の attribution は MapLibre の出典表示にそのまま出る）。 */
function addHazardLayer(map: maplibregl.Map, layerKey: string, opacity: number): void {
  const layer = getHazardLayer(layerKey)
  if (layer?.tile === undefined || layer.tile === null) return
  const id = idOf(layerKey)
  map.addSource(id, {
    type: 'raster',
    tiles: [layer.tile.url],
    tileSize: 256,
    minzoom: layer.tile.minZoom,
    maxzoom: layer.tile.maxZoom,
    // 出典は「常時見える」ことが利用条件。source に持たせると、レイヤの表示に
    // 追随して MapLibre の出典表示に出入りする（自前の同期が要らない）。
    attribution: layer.attribution,
  })
  map.addLayer(
    {
      id,
      type: 'raster',
      source: id,
      paint: { 'raster-opacity': hazardOpacityFor(layerKey, opacity) },
    },
    map.getLayer(APP_FIRST_LAYER_ID) === undefined ? undefined : APP_FIRST_LAYER_ID,
  )
}

/** 1 レイヤを取り除く（source も一緒に。残すと出典表示が消えない）。 */
function removeHazardLayer(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id) !== undefined) map.removeLayer(id)
  if (map.getSource(id) !== undefined) map.removeSource(id)
}

/**
 * 表示中レイヤと不透明度を地図に反映する。
 *
 * 並びが変わらないときは**不透明度だけ**を書き換える（タイルを取り直さない）。
 * 並びが変わったときは全部外して入れ直す——`base` が先で `overlay` が後、という
 * 描画順の不変条件（`hazardDrawOrder`）を、部分的な挿し替えより確実に保てるため。
 */
export function syncHazardLayers(
  map: maplibregl.Map,
  layerKeys: readonly string[],
  opacity: number,
): void {
  try {
    const desired = hazardDrawOrder(layerKeys)
    const desiredIds = desired.map(idOf)
    const currentIds = currentHazardLayerIds(map)
    const sameOrder =
      currentIds.length === desiredIds.length &&
      desiredIds.every((id, index) => currentIds[index] === id)

    if (sameOrder) {
      desired.forEach((key) =>
        map.setPaintProperty(idOf(key), 'raster-opacity', hazardOpacityFor(key, opacity)),
      )
      return
    }
    currentIds.forEach((id) => removeHazardLayer(map, id))
    desired.forEach((key) => addHazardLayer(map, key, opacity))
  } catch (error) {
    // ハザードが出ないだけで地図は使える。原因を残して静かに諦める（駅データと同じ方針）。
    console.error(`ハザードレイヤを地図に反映できませんでした（${layerKeys.join(',')}）`, error)
  }
}
