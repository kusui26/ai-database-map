/**
 * 地図レポートの材料をそろえる（サーバ専用・PR-13）。
 *
 * `render_map` ツール（要約を返す）と `/api/map`（HTML を返す）の**両方**がここを通るので、
 * 「何が描かれるか」の答えが 2 つにならない。外の世界に触るのはここだけ
 * （駅の座標＝DB、キキクルの時刻＝気象庁）で、HTML の組み立て（`html.ts`）と
 * 地図の意味論（`domain/map/scene.ts`）は純粋なまま。
 */

import { mapScene, type MapScene, type StationPoint } from '@/domain/map/scene'
import { resolveHazardTile, tileTimeLabelJa } from '@/domain/hazard/tile-time'
import { listStations } from '@/db/queries'
import { hazardTileTimes } from '@/lib/hazard/tile-times'
import { getHazardLayer, HAZARD_DISCLAIMER_JA } from '@/shared/hazard'
import { type MapAction } from '@/shared/protocol'
import { MAP_MAX_GRPS } from './token'
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

/** 地図操作 → 描くもの（駅の座標を引いたうえで）。 */
export async function sceneFor(actions: readonly MapAction[]): Promise<MapScene> {
  return mapScene(actions, { stations: await resolveStationPoints(actions) })
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

/** 既定の題（何の地図かが一覧で分かる程度に）。 */
export function defaultTitleJa(scene: MapScene): string {
  const origin = scene.points.find((point) => point.kind === 'origin' && point.labelJa !== null)
  if (origin?.labelJa != null) return `${origin.labelJa} 周辺の地図`
  const stations = scene.points.filter((point) => point.kind === 'station').length
  if (stations > 0) return `駅 ${stations} 件の地図`
  const destinations = scene.points.filter((point) => point.kind === 'destination').length
  if (destinations > 0) return `行き先 ${destinations} 件の地図`
  return '地図'
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
  return [
    // **どの地図にも 1 つは注意が付く**。印だけの地図でも「位置を示しただけ」だと読めるように
    // ——地図は文脈から切り離して眺められるので、断定的に見える状態を作らない（§7.5）。
    '表示は公的オープンデータの二次加工です。原典の定義・年次・集計単位に依存します。',
    ...(destinations === 0
      ? []
      : ['印は場所を指すだけで、経路・所要時間・そこへ行けるかどうかは示していません。']),
    ...(stations === 0 ? [] : ['駅の位置は駅の代表点（代表的な 1 点）です。']),
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
