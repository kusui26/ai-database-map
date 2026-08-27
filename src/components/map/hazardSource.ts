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
import { needsTileTime } from '@/domain/hazard/tile-time'

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

/**
 * そのレイヤに使うタイル URL（キキクルは差し込み済みのものだけ・未解決なら null）。
 *
 * **プレースホルダ入りの URL を地図に渡さない。** 404 が並ぶだけで面は出ず、
 * 白い地図が「危険なし」に見える（§7.5-1）。解決できるまで**レイヤごと足さない**。
 */
function tileUrlOf(layerKey: string, resolved: HazardTileUrls): string | null {
  const url = getHazardLayer(layerKey)?.tile?.url
  if (url === undefined) return null
  return needsTileTime(layerKey) ? (resolved.get(layerKey) ?? null) : url
}

/** 1 レイヤを追加する（source の attribution は MapLibre の出典表示にそのまま出る）。 */
function addHazardLayer(
  map: maplibregl.Map,
  layerKey: string,
  opacity: number,
  url: string,
): void {
  const layer = getHazardLayer(layerKey)
  if (layer?.tile === undefined || layer.tile === null) return
  const id = idOf(layerKey)
  map.addSource(id, {
    type: 'raster',
    tiles: [url],
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

/** レイヤ key → 時刻を差し込み済みのタイル URL（キキクル以外は空でよい）。 */
export type HazardTileUrls = ReadonlyMap<string, string>

/** ラスタの source か（`setTiles` を持つ）。**`as` で決めつけない**——型ガードで確かめる。 */
function isRasterSource(
  source: maplibregl.Source | undefined,
): source is maplibregl.RasterTileSource {
  return source !== undefined && 'setTiles' in source && typeof source.setTiles === 'function'
}

/**
 * 載せたままのレイヤの URL を差し替える（キキクルの時刻更新）。
 * `setTiles` は同じ source を使い回すので、**面がちらつかずに 10 分ごとの更新が入る**。
 */
function retileHazardLayer(map: maplibregl.Map, layerKey: string, url: string): void {
  const source = map.getSource(idOf(layerKey))
  if (!isRasterSource(source)) return
  if (source.tiles?.[0] === url) return
  source.setTiles([url])
}

/**
 * 表示中レイヤと不透明度を地図に反映する。
 *
 * 並びが変わらないときは**不透明度と URL だけ**を書き換える（source を作り直さない）。
 * 並びが変わったときは全部外して入れ直す——`base` が先で `overlay` が後、という
 * 描画順の不変条件（`hazardDrawOrder`）を、部分的な挿し替えより確実に保てるため。
 *
 * キキクルは**時刻が解決できたものだけ**を載せる（未解決のうちは 1 枚も載せない）。
 */
export function syncHazardLayers(
  map: maplibregl.Map,
  layerKeys: readonly string[],
  opacity: number,
  tileUrls: HazardTileUrls = new Map(),
): void {
  try {
    const desired = hazardDrawOrder(layerKeys).flatMap((key) => {
      const url = tileUrlOf(key, tileUrls)
      return url === null ? [] : [{ key, url }]
    })
    const desiredIds = desired.map((each) => idOf(each.key))
    const currentIds = currentHazardLayerIds(map)
    const sameOrder =
      currentIds.length === desiredIds.length &&
      desiredIds.every((id, index) => currentIds[index] === id)

    if (sameOrder) {
      desired.forEach(({ key, url }) => {
        map.setPaintProperty(idOf(key), 'raster-opacity', hazardOpacityFor(key, opacity))
        retileHazardLayer(map, key, url)
      })
      return
    }
    currentIds.forEach((id) => removeHazardLayer(map, id))
    desired.forEach(({ key, url }) => addHazardLayer(map, key, opacity, url))
  } catch (error) {
    // ハザードが出ないだけで地図は使える。原因を残して静かに諦める（駅データと同じ方針）。
    console.error(`ハザードレイヤを地図に反映できませんでした（${layerKeys.join(',')}）`, error)
  }
}
