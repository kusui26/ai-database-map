/**
 * ドメイン：色分けの応答（`GET /api/stations/classes`）→ **描く印と凡例の言葉**（純関数・2026-10-11 B5c・
 * `docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * Web 地図（MapLibre）と地図レポート（`render_map`・Leaflet）が同じ規則で描く。段・色・言葉はサーバが決めたものを写すだけで、
 * ここで分け直さない（分け方は `classify.ts` の 1 か所）。
 *
 * - 段のある駅：段の色。⚠ の参考値：灰色（凡例の「参考値（⚠）」）
 * - 色分けしなかった（値のある駅が 5 未満・値が 1 種類など）：色を付けず**強調**（アクセントの色）で出す——
 *   色分けしていないのに、色分けしたように見せない
 * - どの印にも濃い縁を付ける（淡い色が地図の地色や浸水の面に沈まない）。大きさは一定（乗降客数で変えない＝色を読みやすく）
 */

import {
  type StationClassesResponse,
  type StationColoring,
  type StationLegend,
} from '@/shared/area-summary'
import { ACCENT_COLOR } from '@/shared/constants'

/** 印の縁（slate-900）。 */
export const COLORED_STROKE_COLOR = '#0f172a'

/** 段のある駅・⚠ の参考値・色分けしなかった駅（強調）。 */
export type ColoredStationKind = 'class' | 'flagged' | 'plain'

export type ColoredStation = {
  readonly grp: string
  readonly kind: ColoredStationKind
  readonly color: string
  /** 段の名前（「25,000〜32,000 人」「参考値（⚠）」）。色分けしなかった駅は null。 */
  readonly classLabelJa: string | null
  /** 駅の値（「31,640 人」「+7.2%」）。 */
  readonly valueJa: string
}

/** 色分けしたか（段を作れなかったときは、理由を持って段が空）。 */
export function isColored(legend: StationLegend): boolean {
  return legend.reasonJa === null && legend.classes.length > 0
}

/** 駅 1 つの印（段の index が凡例に無いときは参考値と同じ灰色に倒す——黙って消さない）。 */
function coloredStationOf(
  legend: StationLegend,
  station: StationClassesResponse['stations'][number],
): ColoredStation {
  const base = { grp: station.grp, valueJa: station.valueJa }
  if (!isColored(legend)) return { ...base, kind: 'plain', color: ACCENT_COLOR, classLabelJa: null }
  const cls = station.cls === null ? undefined : legend.classes[station.cls]
  if (cls === undefined) {
    return {
      ...base,
      kind: 'flagged',
      color: legend.flagged.color,
      classLabelJa: legend.flagged.labelJa,
    }
  }
  return { ...base, kind: 'class', color: cls.color, classLabelJa: cls.labelJa }
}

/** 応答 → 描く印（並びは応答のまま）。 */
export function coloredStations(response: StationClassesResponse): readonly ColoredStation[] {
  return response.stations.map((station) => coloredStationOf(response.legend, station))
}

/** ホバーの 2 行目（「31,640 人・25,000〜32,000 人」「+35.2%・参考値（⚠）」）。 */
export function coloredStationDetailJa(station: ColoredStation): string {
  return station.classLabelJa === null
    ? station.valueJa
    : `${station.valueJa}・${station.classLabelJa}`
}

/** エリアの駅の数（値のある駅〔段・参考値〕＋値の無い駅）。 */
export function coloringStationCount(response: StationClassesResponse): number {
  return response.stations.length + response.legend.missingCount
}

/** どこの駅を色分けしたか（「神奈川県横浜市の 137 駅」・2 つ以上は「…・…の 189 駅（合わせて 1 つの物差し）」）。 */
export function coloringScopeJa(response: StationClassesResponse): string {
  const count = coloringStationCount(response)
  const names = response.areaLabelsJa.join('・')
  const together = response.areaLabelsJa.length > 1 ? '（合わせて 1 つの物差し）' : ''
  return `${names}の ${count.toLocaleString('en-US')} 駅${together}`
}

/** 凡例の「参考値（⚠）」の行に添える説明。 */
export const FLAGGED_NOTE_JA = '母数が小さいなど。段に入れていない'

/**
 * 凡例の下に添える注意（Web の凡例と地図レポートの「読むときの注意」が同じ文を出す）。
 * 色は**駅ごとの値**で、エリア全体の値ではない（駅の円は重なる・§6.12.5）。
 */
export function coloringNotesJa(response: StationClassesResponse): readonly string[] {
  const { legend } = response
  const missing =
    legend.missingCount === 0 ? [] : [`値の無い ${legend.missingCount} 駅は描いていない。`]
  if (!isColored(legend)) {
    return [
      legend.reasonJa ?? '色分けしていない。',
      '駅は色を付けずに強調して出している。',
      ...missing,
    ]
  }
  return [
    `色は駅ごとの値（${legend.titleJa}）を、このエリアの駅どうしで比べて分けたもの。エリア全体の値ではない。`,
    ...(legend.meaningJa === null ? [] : [legend.meaningJa]),
    ...missing,
  ]
}

/** 同じ色分けの条件か（どちらも無し・指標とエリアの並びが同じ）。同じ条件を URL に書き直さないために使う。 */
export function sameColoring(a: StationColoring | null, b: StationColoring | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.metricKey === b.metricKey &&
    a.areas.length === b.areas.length &&
    a.areas.every((area, index) => area === b.areas[index])
  )
}
