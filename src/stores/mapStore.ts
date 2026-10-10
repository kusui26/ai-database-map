/**
 * 地図の一時 UI 状態（URL に載せないもの）。Zustand。
 * 選択駅・半径は URL（nuqs）に載せる（共有リンク）。ここはホバー等の揮発状態。
 * Step2（P8b）でチャットの地図操作（ハイライト・任意 flyTo）もここを介して地図へ伝える。
 */

import { create } from 'zustand'
import { type ColoredStation } from '@/domain/style/coloring'
import { roundViewport, sameViewport, type Viewport } from '@/shared/viewport'

export type HoverInfo = {
  readonly name: string
  /** 2 行目（色分けしている駅の「値・段」・無ければ null）。 */
  readonly detailJa: string | null
  readonly x: number
  readonly y: number
}

/**
 * 地図に描く駅の色分け（2026-10-11 B5c）。URL の条件（`?color&colorIn`）を共通 API で引いた結果を、凡例の入れ物
 * （`ColoringHost`）が書く。地図は描くだけ（取得も分け方も持たない）。
 */
export type MapStationColoring = {
  /** エリアの並び（同じエリアで指標だけ替えたときは寄せ直さない）。 */
  readonly areasKey: string
  readonly stations: readonly ColoredStation[]
}

/**
 * チャットが指した**駅ではない地点**（`showPoint`・260824_flood §6.4）。
 * 水害は「その一点の話」なので、駅選択とは別の操作系が要る。
 */
export type MarkedPoint = {
  readonly lon: number
  readonly lat: number
  readonly labelJa: string | null
}

/**
 * 地図に置く**行き先**（避難先・`docs/260824_flood.md` §8.5）。
 * `markedPoint`（今いる・聞かれた 1 点）とは**別の印**にする——
 * 同じ見た目にすると「どこからどこへ」が読めない。並びは一覧と同じで、番号が出る。
 */
export type HighlightedPoint = {
  readonly lon: number
  readonly lat: number
  readonly labelJa: string
}

/**
 * いま見ている場所（地図の中心・**丸めてある**）。
 *
 * 警戒バナー（§7.4）が「この地域に何が出ているか」を引くのに使う。生の中心をそのまま持つと
 * 1px 動かすたびに問い合わせが走るので、**約 1km に丸めてから**入れる。
 * 警報は市区町村単位なので、この粗さで答えは実質変わらない。
 */
export type MapCenter = {
  readonly lon: number
  readonly lat: number
}

/** 中心の丸め（小数 2 桁 ≒ 1.1km）。 */
const CENTER_DECIMALS = 2

/** チャットの flyTo 要求（同一座標でも seq で再実行させる・GUI Chat Protocol の mapAction）。 */
export type FlyToRequest = {
  readonly lon: number
  readonly lat: number
  readonly zoom?: number
  readonly seq: number
}

type MapStore = {
  /**
   * 地図が使える状態になったか（スタイル読込＋駅データの追加まで完了）。
   * 「初期表示が終わった」の唯一の合図として、重いチャンクの先読み開始にも使う
   * （早すぎると地図の取得と帯域を奪い合い、LCP が悪化する・260805）。
   */
  ready: boolean
  setReady: (ready: boolean) => void

  hovered: HoverInfo | null
  setHovered: (info: HoverInfo | null) => void

  /** チャットがハイライトする駅群（ランキング上位など・地図に枠を描く）。 */
  highlightedGrps: readonly string[]
  setHighlightedGrps: (grps: readonly string[]) => void

  /** チャットの任意 flyTo（駅選択を伴わない移動）。 */
  flyTo: FlyToRequest | null
  requestFlyTo: (target: { lon: number; lat: number; zoom?: number }) => void

  /** チャットが指した地点（null＝印なし）。地図にピンとラベルを出す。 */
  markedPoint: MarkedPoint | null
  setMarkedPoint: (point: MarkedPoint | null) => void

  /** 行き先の印（空＝出さない）。 */
  highlightedPoints: readonly HighlightedPoint[]
  setHighlightedPoints: (points: readonly HighlightedPoint[]) => void

  /** 駅の色分け（null＝描かない）。 */
  stationColoring: MapStationColoring | null
  setStationColoring: (coloring: MapStationColoring | null) => void

  /** 地図の中心（丸め済み・未初期化は null）。 */
  center: MapCenter | null
  /** 地図が止まったときに呼ぶ。**丸めて変化が無ければ何もしない**（無駄な再描画を作らない）。 */
  setCenter: (center: MapCenter) => void

  /**
   * いま地図に出している範囲（パネルに隠れていない部分・外向きに丸め済み・未初期化は null）。チャットの送信に同送し、
   * 同じ名前の路線（「中央線」＝JR・大阪メトロ）を決めるのと（2026-10-08 L3）、「このあたり」の質問（2026-10-09 B3）に使う
   * （`shared/viewport.ts`・`components/map/visibleBounds.ts`）。
   */
  viewport: Viewport | null
  /** 地図が止まったときに呼ぶ。中心と同じく、丸めて変化が無ければ何もしない。 */
  setViewport: (bounds: Viewport) => void
}

function roundCenter(center: MapCenter): MapCenter {
  return {
    lon: Number(center.lon.toFixed(CENTER_DECIMALS)),
    lat: Number(center.lat.toFixed(CENTER_DECIMALS)),
  }
}

export const useMapStore = create<MapStore>((set, get) => ({
  ready: false,
  setReady: (ready) => set({ ready }),

  hovered: null,
  setHovered: (info) => set({ hovered: info }),

  highlightedGrps: [],
  setHighlightedGrps: (grps) => set({ highlightedGrps: grps }),

  flyTo: null,
  requestFlyTo: (target) =>
    set((state) => ({ flyTo: { ...target, seq: (state.flyTo?.seq ?? 0) + 1 } })),

  markedPoint: null,
  setMarkedPoint: (point) => set({ markedPoint: point }),

  highlightedPoints: [],
  setHighlightedPoints: (points) => set({ highlightedPoints: points }),

  stationColoring: null,
  setStationColoring: (coloring) => set({ stationColoring: coloring }),

  center: null,
  setCenter: (center) => {
    const rounded = roundCenter(center)
    const current = get().center
    if (current?.lon === rounded.lon && current.lat === rounded.lat) return
    set({ center: rounded })
  },

  viewport: null,
  setViewport: (bounds) => {
    const rounded = roundViewport(bounds)
    if (sameViewport(get().viewport, rounded)) return
    set({ viewport: rounded })
  },
}))
