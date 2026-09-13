/**
 * ドメイン：**地図操作（`MapAction[]`）→ 描くもの**（純関数）。
 *
 * `docs/260912_gui_chat_protocol.md` 決定 11 の「残す部品」のもう半分。
 * 旧 MCP Apps の地図ビューアが文字列 JS で持っていた**意味論**——起点の印／行き先の番号丸／
 * 半径円／ハザードの面（base 先・overlay 後・地形は一段薄く・キキクルは時刻を差し込む）／
 * 座標を持たない操作は描かない——を、消費側（T1 のサーバ生成 HTML、T2 のビューア・プラグイン、
 * そして Web UI）から独立した 1 つの関数にした。
 *
 * ここに置く理由：レイヤの**順序・不透明度・出典**はハザード・カタログの意味づけであって
 * 描画ライブラリの都合ではない。だから `domain/hazard/*` を再利用する（`shared/viewer` は
 * protocol だけに依存する純粋な markup 側で、こちらとは層が違う）。
 *
 * **描けないものを黙って落とさない**：ラスタで描けないレイヤは `undrawableLayerKeys` に残す。
 * 「載らなかったから白い ＝ 危険がない」と読ませないための材料を、消費側に必ず渡す
 * （`docs/260824_flood.md` §7.5-1）。
 */

import { hazardDrawOrder, hazardOpacityFor } from '@/domain/hazard/catalog'
import { needsTileTime } from '@/domain/hazard/tile-time'
import { HAZARD_OPACITY_DEFAULT } from '@/shared/constants'
import { boundingBoxAround, type BoundingBox } from '@/shared/geo'
import { getHazardLayer, hazardLayers } from '@/shared/hazard'
import { type MapAction } from '@/shared/protocol'

/** 地図に置く 1 点。起点（聞かれた場所）と行き先（避難先）は**別の印**にする。 */
export type ScenePoint = {
  readonly lon: number
  readonly lat: number
  readonly labelJa: string | null
  readonly kind: 'origin' | 'destination'
  /** 行き先だけが持つ 1 始まりの通し番号（一覧パネルの並びと同じ）。 */
  readonly index: number | null
}

/** 選択駅の半径円（中心は直前の `flyTo`）。 */
export type SceneCircle = {
  readonly lon: number
  readonly lat: number
  readonly radiusM: number
}

/** カメラの寄せ先。 */
export type SceneFocus = {
  readonly lon: number
  readonly lat: number
  readonly zoom: number | null
}

/** 重ねるラスタ 1 枚（URL テンプレートのまま渡し、時刻の差し込みは消費側が行う）。 */
export type SceneLayer = {
  readonly key: string
  readonly labelJa: string
  /** XYZ テンプレート。キキクルは `{basetime}` 等が残る。 */
  readonly urlTemplate: string
  /** 時刻を差し込まないと 1 枚も描けないレイヤか（＝キキクル）。 */
  readonly needsTime: boolean
  /** 時刻の取得先（要らないレイヤは null）。 */
  readonly timesUrl: string | null
  readonly minZoom: number
  readonly maxZoom: number
  /** 適用する不透明度（「参考：地形」は一段薄い）。 */
  readonly opacity: number
  readonly attribution: string
}

/** 1 回の応答で地図に描くもの一式。 */
export type MapScene = {
  readonly points: readonly ScenePoint[]
  readonly circle: SceneCircle | null
  readonly focus: SceneFocus | null
  /** 描画順（base 先・overlay 後）。 */
  readonly layers: readonly SceneLayer[]
  /** 要求されたが描けなかったレイヤ（未知の key・ラスタでない配信）。 */
  readonly undrawableLayerKeys: readonly string[]
  /** 表示する出典（重複を畳んで描画順）。 */
  readonly attributions: readonly string[]
  /** 時刻つきの面（キキクル）を含むか＝「10 分毎更新」の注記が要る。 */
  readonly hasTimedLayer: boolean
  /** 地図を出す価値があるか（false なら畳む＝前の結果の地図を残して誤読させない）。 */
  readonly drawable: boolean
}

/** 畳み込みの途中状態。 */
type Draft = {
  readonly points: readonly ScenePoint[]
  readonly circleRadiusM: number | null
  readonly focus: SceneFocus | null
  readonly layerKeys: readonly string[]
  readonly opacity: number
}

const EMPTY: Draft = {
  points: [],
  circleRadiusM: null,
  focus: null,
  layerKeys: [],
  opacity: HAZARD_OPACITY_DEFAULT,
}

/**
 * 操作 1 つを畳み込む。**7 型すべてを列挙**する——protocol に型を足すと、
 * 返り値が `Draft` にならず型エラーになる（扱い忘れが実行時まで残らない）。
 */
function applyAction(draft: Draft, action: MapAction): Draft {
  switch (action.type) {
    case 'flyTo':
      return { ...draft, focus: { lon: action.lon, lat: action.lat, zoom: action.zoom ?? null } }
    case 'selectStation':
      // 座標を持たない操作。半径だけを受け取り、中心は直前の `flyTo` から採る。
      return action.radiusM === undefined ? draft : { ...draft, circleRadiusM: action.radiusM }
    case 'highlightStations':
      // grp だけで座標が無い。**地図には描かない**（一覧パネルで読む）。
      return draft
    case 'clearOverlays':
      return { ...draft, points: [], circleRadiusM: null, layerKeys: [] }
    case 'setHazardLayers':
      return { ...draft, layerKeys: action.layers, opacity: action.opacity ?? draft.opacity }
    case 'showPoint':
      return {
        ...draft,
        points: [
          ...draft.points,
          {
            lon: action.lon,
            lat: action.lat,
            labelJa: action.labelJa ?? null,
            kind: 'origin',
            index: null,
          },
        ],
      }
    case 'highlightPoints':
      return {
        ...draft,
        points: [
          ...draft.points,
          ...action.points.map((point) => ({
            lon: point.lon,
            lat: point.lat,
            labelJa: point.labelJa,
            kind: 'destination' as const,
            index: null,
          })),
        ],
      }
  }
}

/** 行き先に 1 始まりの通し番号を振り直す（一覧の並びと一致させる）。 */
function numbered(points: readonly ScenePoint[]): readonly ScenePoint[] {
  return points.reduce<{ seen: number; points: ScenePoint[] }>(
    (acc, point) => {
      if (point.kind !== 'destination') return { ...acc, points: [...acc.points, point] }
      const index = acc.seen + 1
      return { seen: index, points: [...acc.points, { ...point, index }] }
    },
    { seen: 0, points: [] },
  ).points
}

/** 描画順に並べたレイヤ（ラスタで描けるものだけ）。 */
function sceneLayers(layerKeys: readonly string[], opacity: number): readonly SceneLayer[] {
  return hazardDrawOrder(layerKeys).flatMap((key) => {
    const layer = getHazardLayer(key)
    if (layer === undefined || layer.tile === null || layer.tile.format !== 'png') return []
    return [
      {
        key: layer.key,
        labelJa: layer.labelJa,
        urlTemplate: layer.tile.url,
        needsTime: needsTileTime(layer.key),
        timesUrl: layer.tile.timesUrl,
        minZoom: layer.tile.minZoom,
        maxZoom: layer.tile.maxZoom,
        opacity: hazardOpacityFor(layer.key, opacity),
        attribution: layer.attribution,
      },
    ]
  })
}

/** 地図操作の列 → 描くもの一式。 */
export function mapScene(actions: readonly MapAction[]): MapScene {
  const draft = actions.reduce(applyAction, EMPTY)
  const circle =
    draft.circleRadiusM === null || draft.focus === null
      ? null
      : { lon: draft.focus.lon, lat: draft.focus.lat, radiusM: draft.circleRadiusM }
  // 半径円だけだと中心（＝選択した駅）が読めないので、Web UI の選択駅ドットに合わせて印を置く。
  const points = numbered(
    circle !== null && draft.points.length === 0
      ? [{ lon: circle.lon, lat: circle.lat, labelJa: null, kind: 'origin', index: null }]
      : draft.points,
  )
  const layers = sceneLayers(draft.layerKeys, draft.opacity)
  const drawn = new Set(layers.map((layer) => layer.key))
  return {
    points,
    circle,
    focus: draft.focus,
    layers,
    // 未知の key もラスタでない配信も、ここに残る（描かれなかった事実を消費側へ渡す）。
    undrawableLayerKeys: [...new Set(draft.layerKeys)].filter((key) => !drawn.has(key)),
    attributions: [...new Set(layers.map((layer) => layer.attribution))],
    hasTimedLayer: layers.some((layer) => layer.needsTime),
    drawable: points.length > 0 || circle !== null || layers.length > 0 || draft.focus !== null,
  }
}

/**
 * 全部が入る矩形（無ければ null）。カメラを合わせるのに使う。
 * 円は**半径を必ず含む**矩形で数える（`boundingBoxAround`）。
 */
export function sceneBounds(scene: MapScene): BoundingBox | null {
  const boxes = [
    ...scene.points.map((point) => ({
      west: point.lon,
      south: point.lat,
      east: point.lon,
      north: point.lat,
    })),
    ...(scene.circle === null
      ? []
      : [boundingBoxAround(scene.circle.lon, scene.circle.lat, scene.circle.radiusM)]),
  ]
  const first = boxes[0]
  if (first === undefined) return null
  return boxes.reduce<BoundingBox>(
    (box, each) => ({
      west: Math.min(box.west, each.west),
      south: Math.min(box.south, each.south),
      east: Math.max(box.east, each.east),
      north: Math.max(box.north, each.north),
    }),
    first,
  )
}

/**
 * 地図が接続するタイル・ホスト（重複なし）。
 * **カタログから算出する**——レイヤを足したら自動で増える（手書きリストにしない）。
 * T1 の CSP 案内・T2 のホスト宣言がこれを使う。
 */
export function hazardTileOrigins(): readonly string[] {
  const urls = hazardLayers.flatMap((layer) =>
    layer.tile === null || layer.tile.format !== 'png'
      ? []
      : [layer.tile.url, ...(layer.tile.timesUrl === null ? [] : [layer.tile.timesUrl])],
  )
  // `{z}` 等のプレースホルダは仮埋めしてから読む（URL として解釈できる形にする）。
  return [...new Set(urls.map((url) => new URL(url.replace(/\{[a-z]+\}/g, '0')).origin))]
}
