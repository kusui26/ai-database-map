/**
 * 地図レポートの材料をそろえる（サーバ専用・PR-13）。
 *
 * `render_map` ツール（要約を返す）と `/api/map`（HTML を返す）の**両方**がここを通るので、
 * 「何が描かれるか」の答えが 2 つにならない。外の世界に触るのはここだけ
 * （駅の座標＝DB、キキクルの時刻＝気象庁）で、HTML の組み立て（`html.ts`）と
 * 地図の意味論（`domain/map/scene.ts`）は純粋なまま。
 */

import {
  coloringRequestIn,
  mapScene,
  type ColoringRequest,
  type ColoringResolution,
  type MapScene,
  type ResolvedColoring,
  type StationPoint,
} from '@/domain/map/scene'
import { resolveHazardTile, tileTimeLabelJa } from '@/domain/hazard/tile-time'
import {
  coloredStationDetailJa,
  coloredStations,
  coloringNotesJa,
  coloringScopeJa,
  isColored,
} from '@/domain/style/coloring'
import { loadStationClasses } from '@/domain/style/load'
import { listStations, stationCatalog } from '@/db/queries'
import { hazardTileTimes } from '@/lib/hazard/tile-times'
import { ttlCache } from '@/lib/ttl-cache'
import { type StationClassesResponse } from '@/shared/area-summary'
import { getHazardLayer, HAZARD_DISCLAIMER_JA } from '@/shared/hazard'
import { type MapAction } from '@/shared/protocol'
import { MAP_MAX_COLORED_STATIONS, MAP_MAX_GRPS } from './token'
import { stationLabelsOmitted, type MapReportLayer } from './html'

/** 地図操作に出てくる駅 grp（`selectStation` と `highlightStations`）。 */
export function grpsIn(actions: readonly MapAction[]): readonly string[] {
  return [
    ...new Set(
      actions.flatMap((action) => {
        if (action.type === 'selectStation') return [action.grp]
        if (action.type === 'highlightStations') return action.grps
        return []
      }),
    ),
  ]
}

/**
 * grp → 座標を DB から引く。
 * ブラウザのビューアには無い、サーバだけの持ち物——だから `render_map` は
 * ランキングの結果（`highlightStations` で grp だけ）も地図にできる。
 */
export async function resolveStationPoints(
  actions: readonly MapAction[],
): Promise<ReadonlyMap<string, StationPoint>> {
  const grps = grpsIn(actions)
  if (grps.length === 0) return new Map()
  const stations = await listStations({ grps, limit: MAP_MAX_GRPS + 1 })
  return new Map(
    stations.map((station) => [
      station.grp,
      { lon: station.lon, lat: station.lat, nameJa: station.label },
    ]),
  )
}

/** 全駅の座標の索引を持つ期間（データの更新でしか変わらない・AI の名前の索引と同じ 1 時間）。 */
const STATION_INDEX_TTL_MS = 60 * 60 * 1000

/**
 * 全駅の座標（`station_catalog`・サーバの中で持つ）。色分けは数千駅になるので、`highlightStations` のように
 * 駅を名指しで引かない（一覧の RPC は 2,000 駅が上限）。
 */
const stationIndexCache = ttlCache(async (): Promise<ReadonlyMap<string, StationPoint>> => {
  const stations = await stationCatalog()
  return new Map(
    stations.map((station) => [
      station.grp,
      { lon: station.lon, lat: station.lat, nameJa: station.label },
    ]),
  )
}, STATION_INDEX_TTL_MS)

/** 全駅の座標の索引を捨てる（テストと、データを入れ替えたあとの読み直し）。 */
export function clearStationIndexCache(): void {
  stationIndexCache.clear()
}

/** 色分けで描く駅が多すぎるときの断り方（絞り方つき）。 */
export function tooManyColoredJa(count: number): string {
  return (
    `色分けする駅が ${count.toLocaleString('en-US')} 駅あり、地図レポートに描ける ` +
    `${MAP_MAX_COLORED_STATIONS.toLocaleString('en-US')} 駅を超える。エリアを都道府県・市区町村・路線などに絞る。`
  )
}

/** 色分けの応答 → 座標つきの印（座標の分からない駅は描かず、数を残す）。 */
export function placeColoredStations(
  classes: StationClassesResponse,
  index: ReadonlyMap<string, StationPoint>,
): ResolvedColoring {
  const colored = coloredStations(classes)
  const points = colored.flatMap((station) => {
    const at = index.get(station.grp)
    if (at === undefined) return []
    const { kind, color } = station
    return [
      {
        lon: at.lon,
        lat: at.lat,
        nameJa: at.nameJa,
        kind,
        color,
        detailJa: coloredStationDetailJa(station),
      },
    ]
  })
  return { classes, points, unplacedCount: colored.length - points.length }
}

/**
 * 色分けの条件 → 描く色分け。分け方は共通 API（`GET /api/stations/classes`）と同じ関数を通す——
 * Web 地図と同じ段・同じ色・同じ凡例になる。知らない指標・エリアは共通 API と同じ理由で断る。
 */
export async function resolveColoring(request: ColoringRequest): Promise<ColoringResolution> {
  const result = await loadStationClasses(request.metricKey, request.areas)
  if (!result.ok) return { ok: false, reasonJa: result.messageJa }
  const count = result.response.stations.length
  if (count > MAP_MAX_COLORED_STATIONS) return { ok: false, reasonJa: tooManyColoredJa(count) }
  return {
    ok: true,
    coloring: placeColoredStations(result.response, await stationIndexCache.get()),
  }
}

/** 地図操作 → 描くもの（駅の座標と、色分けを引いたうえで）。 */
export async function sceneFor(actions: readonly MapAction[]): Promise<MapScene> {
  const request = coloringRequestIn(actions)
  const [stations, coloring] = await Promise.all([
    resolveStationPoints(actions),
    request === null ? Promise.resolve(undefined) : resolveColoring(request),
  ])
  return mapScene(actions, { stations, coloring })
}

/**
 * ハザードの面を「そのまま `<img>` で読める URL」に解決する。
 *
 * キキクルは 10 分ごとに新しい面が出るので、**時刻を差し込めたものだけ**を載せる。
 * 差し込めないレイヤは落として `dropped` に残す——プレースホルダのまま渡すと
 * 404 が並んで**白い地図**になり、「危険が無い」と読まれる（`docs/260824_flood.md` §7.5-1）。
 */
export async function resolveReportLayers(scene: MapScene): Promise<{
  readonly layers: readonly MapReportLayer[]
  readonly dropped: readonly string[]
}> {
  // 同じ `targetTimes.json` を複数レイヤが使うので、取得は URL ごとに 1 回にまとめる。
  const timesUrls = [
    ...new Set(
      scene.layers.flatMap((layer) =>
        layer.needsTime && layer.timesUrl !== null ? [layer.timesUrl] : [],
      ),
    ),
  ]
  const fetched = await Promise.all(
    timesUrls.map(async (url) => {
      try {
        return [url, await hazardTileTimes(url)] as const
      } catch (error) {
        console.warn(`[map-report] 配信時刻を取得できません: ${url}`, error)
        return [url, null] as const
      }
    }),
  )
  const timesByUrl = new Map(fetched)

  const resolved = scene.layers.map((layer): MapReportLayer | null => {
    if (!layer.needsTime) {
      return {
        key: layer.key,
        labelJa: layer.labelJa,
        url: layer.urlTemplate,
        opacity: layer.opacity,
        minZoom: layer.minZoom,
        maxNativeZoom: layer.maxZoom,
        attribution: layer.attribution,
        timeLabelJa: null,
      }
    }
    const times = layer.timesUrl === null ? null : (timesByUrl.get(layer.timesUrl) ?? null)
    const tile = times === null ? null : resolveHazardTile(layer.key, times)
    if (tile === null) return null
    return {
      key: layer.key,
      labelJa: layer.labelJa,
      url: tile.url,
      opacity: layer.opacity,
      minZoom: layer.minZoom,
      maxNativeZoom: layer.maxZoom,
      attribution: layer.attribution,
      timeLabelJa: tileTimeLabelJa(tile.basetime),
    }
  })
  return {
    layers: resolved.filter((layer): layer is MapReportLayer => layer !== null),
    dropped: scene.layers.flatMap((layer, index) =>
      resolved[index] === null ? [layer.labelJa] : [],
    ),
  }
}

/** 地図に描いた色分けの要約（凡例と同じ言葉。LLM が色の意味をこの文で説明する）。 */
export type MapReportColoring = {
  readonly titleJa: string
  /** 「神奈川県横浜市の 137 駅」。 */
  readonly scopeJa: string
  /** 地図に描いた駅の数（座標の分からない駅は除く）。 */
  readonly drawnStations: number
  /** 段（「25,000 人未満（27 駅）」）。色分けしなかったときは空。 */
  readonly classesJa: readonly string[]
  readonly meaningJa: string | null
  /** 色分けしなかった理由（駅が少ないなど・色分けしたら null）。 */
  readonly reasonJa: string | null
}

/** 色分けの要約（描いていなければ null）。 */
export function coloringSummary(scene: MapScene): MapReportColoring | null {
  const resolved = scene.coloring?.resolved
  if (resolved === undefined || resolved === null) return null
  const { classes, points } = resolved
  const { legend } = classes
  return {
    titleJa: legend.titleJa,
    scopeJa: coloringScopeJa(classes),
    drawnStations: points.length,
    classesJa: isColored(legend)
      ? legend.classes.map((cls) => `${cls.labelJa}（${cls.count} 駅）`)
      : [],
    meaningJa: legend.meaningJa,
    reasonJa: legend.reasonJa,
  }
}

/** 既定の題（何の地図かが一覧で分かる程度に）。 */
export function defaultTitleJa(scene: MapScene): string {
  const classes = scene.coloring?.resolved?.classes
  if (classes !== undefined) {
    return `${classes.areaLabelsJa.join('・')}の駅：${classes.legend.titleJa}`
  }
  const origin = scene.points.find((point) => point.kind === 'origin' && point.labelJa !== null)
  if (origin?.labelJa != null) return `${origin.labelJa} 周辺の地図`
  const stations = scene.points.filter((point) => point.kind === 'station').length
  if (stations > 0) return `駅 ${stations} 件の地図`
  const destinations = scene.points.filter((point) => point.kind === 'destination').length
  if (destinations > 0) return `行き先 ${destinations} 件の地図`
  return '地図'
}

/**
 * 色分けの注意。描けたら凡例と同じ注意（駅ごとの値で、エリア全体の値ではない・色の意味・値の無い駅）と、座標の分からなかった駅の数。
 * 描けなければ理由（知らない指標・エリア、駅が多すぎる）——色分けを頼まれたのに描かなかったことを黙らない。
 */
function coloringReportNotesJa(coloring: MapScene['coloring']): readonly string[] {
  if (coloring === null) return []
  if (coloring.resolved === null) {
    return [`駅の色分けは描いていません：${coloring.issueJa ?? '理由が分かりません。'}`]
  }
  const { classes, unplacedCount } = coloring.resolved
  return [
    ...coloringNotesJa(classes),
    ...(unplacedCount === 0
      ? []
      : [`${unplacedCount} 駅は座標が分からず、色分けに描いていません。`]),
  ]
}

/**
 * 本文に必ず出す注記。**削らない**——地図だけを切り取って使われても、
 * 何が言えて何が言えないかが読めるようにする。
 */
export function reportNotesJa(args: {
  readonly scene: MapScene
  /** 時刻を解決する**前**でも呼べるよう、使う項目だけを要求する。 */
  readonly layers: readonly {
    readonly key: string
    readonly labelJa: string
    readonly timeLabelJa: string | null
  }[]
  readonly dropped: readonly string[]
}): readonly string[] {
  const { scene, layers, dropped } = args
  const coverage = layers.flatMap((layer) => {
    const note = getHazardLayer(layer.key)?.coverageNoteJa
    return note === undefined || note === null ? [] : [`${layer.labelJa}：${note}`]
  })
  const destinations = scene.points.filter((point) => point.kind === 'destination').length
  const stations = scene.points.filter((point) => point.kind === 'station').length
  const colored = scene.coloring?.resolved?.points.length ?? 0
  return [
    // **どの地図にも 1 つは注意が付く**。印だけの地図でも「位置を示しただけ」だと読めるように
    // ——地図は文脈から切り離して眺められるので、断定的に見える状態を作らない（§7.5）。
    '表示は公的オープンデータの二次加工です。原典の定義・年次・集計単位に依存します。',
    ...coloringReportNotesJa(scene.coloring),
    ...(destinations === 0
      ? []
      : ['印は場所を指すだけで、経路・所要時間・そこへ行けるかどうかは示していません。']),
    ...(stations + colored === 0 ? [] : ['駅の位置は駅の代表点（代表的な 1 点）です。']),
    ...(stationLabelsOmitted(scene)
      ? [
          `駅が ${stations} 件と多いため、名前は地図に出していません（点の位置だけを見てください）。`,
        ]
      : []),
    ...(scene.circle === null
      ? []
      : [
          `半径 ${scene.circle.radiusM.toLocaleString('en-US')}m の円は**駅の代表点**を中心にしたもので、` +
            '生活圏・商圏・駅勢圏そのものではありません。',
        ]),
    ...(layers.some((layer) => layer.timeLabelJa !== null)
      ? ['キキクル（危険度分布）は取得時点の最新の面です（10 分毎に更新されます）。']
      : []),
    ...coverage,
    ...(layers.length === 0
      ? []
      : [
          'ハザードは「もし起きたら」の想定であり、いまの状況ではありません。',
          HAZARD_DISCLAIMER_JA,
        ]),
    ...(dropped.length === 0
      ? []
      : [`次の面は配信時刻を取得できなかったため出していません: ${dropped.join('・')}`]),
    ...(scene.undrawableLayerKeys.length === 0
      ? []
      : [
          `次のレイヤは地図に出せません（画像で配信されていない・未知の名前）: ${scene.undrawableLayerKeys.join('・')}`,
        ]),
    ...(scene.unresolvedGrps.length === 0
      ? []
      : [
          `${scene.unresolvedGrps.length} 駅は座標が分からず地図に出していません（一覧で確認してください）。`,
        ]),
  ]
}
