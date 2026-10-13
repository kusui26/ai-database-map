/**
 * エリアの要約 → LLM 向けの要約（純関数・2026-10-11 B5d・`docs/261001_fix_user_feedback_ui.md` §6.12.9）。
 *
 * 値・増減・年・作り方・推計の当たり具合・内訳・駅の周りの分布・色の意味は、**サーバが書いた文のまま**渡す——
 * LLM に足し算や増減率を作らせない（駅の値は足せない・§6.12.2）。答え方は返却の `answerGuide` に載せる
 * （システムプロンプトに書くと別の問が崩れる・B4 の決めたこと 6）。
 */

import {
  type AreaBreakdown,
  type AreaBreakdownRow,
  type AreaStationStat,
  type AreaSummary,
  type AreaSummaryResponse,
  type AreaTotal,
  type StationLegend,
} from '@/shared/area-summary'
import { radiusLabel } from '@/shared/constants'

/** 答え方（B4 と同じく返却に載せる・§6.12.9 の 6 つ）。 */
export const AREA_SUMMARY_ANSWER_GUIDE_JA =
  '答え方：①エリア全体の問いには区域の値（areas[].totals）で答える。駅の周りの値（aroundStations）は「駅の周りでは」と言い分け、エリア全体の値として言わない。' +
  '②値には必ず年を添える（市区町村・都道府県は 2025 年まで、沿線と駅の周りは 2020 年まで）。比べるときは comparison のそろえた年で比べる。' +
  '③将来推計人口は確定した未来ではない。accuracy（2025 年の実績と推計の差）があれば一言添えてよい。' +
  '④駅の値を足したり、自分で計算したりしない（増減率・差・合計・割合を作らない。返却の文のまま使う。割合は comparison の「占める割合」の行にあるときだけ言う）。' +
  '⑤増えた・減った理由（再開発・マンション・転入・人気など）はデータに無いので書かない。' +
  '⑥coloring.colored が true のときだけ、地図の色の意味を coloring.meaning のとおり一言添える。色分けしていないのに「色分けした」と書かない。' +
  '出せない値（unavailable）があれば、その理由を一言。箇条書きにせず 3〜4 文の短い段落で。'

/** 内訳で LLM に渡す行の数（伸びの上位と下位それぞれ）。 */
const BREAKDOWN_EDGE_ROWS = 5

/** 区域の値 1 系統（見出しの文に年と増減が入っている・作り方・推計の山・当たり具合）。 */
function totalForLlm(total: AreaTotal) {
  return {
    label: total.labelJa,
    headline: total.headlineJa,
    method: total.methodJa,
    ...(total.peak === null
      ? {}
      : { peak: `推計の山 ${total.peak.year}年（${total.peak.valueJa}）` }),
    ...(total.accuracy === null ? {} : { accuracy: total.accuracy.textJa }),
  }
}

/** 駅の周りの分布 1 指標（中央値・中ほどの半分・上位と下位の駅）。 */
function statForLlm(stat: AreaStationStat): string {
  const head = `${stat.labelJa}（${stat.periodJa}）中央値 ${stat.medianJa}`
  const range = stat.rangeJa === '' ? '' : `・中ほどの半分 ${stat.rangeJa}`
  const top = stat.top.map((each) => `${each.labelJa} ${each.valueJa}`).join('・')
  const bottom = stat.bottom.map((each) => `${each.labelJa} ${each.valueJa}`).join('・')
  const edges = [top === '' ? '' : `上位 ${top}`, bottom === '' ? '' : `下位 ${bottom}`]
  const note = stat.noteJa === null ? '' : `（${stat.noteJa}）`
  return [head + range, ...edges].filter((part) => part !== '').join('｜') + note
}

function rowForLlm(row: AreaBreakdownRow): string {
  return `${row.nameJa} ${row.changeJa}（${row.valueJa}・将来 ${row.futureJa}）`
}

/** 増減のある行を、増減の大きい順に（増減の無い行は上位にも下位にも入れない）。 */
function byChange(rows: readonly AreaBreakdownRow[]): AreaBreakdownRow[] {
  const changed = rows.flatMap((row) => (row.change === null ? [] : [{ row, change: row.change }]))
  return changed.sort((a, b) => b.change - a.change).map((each) => each.row)
}

/** 内訳（伸びの上位と下位を数行ずつ・列の意味つき）。 */
function breakdownForLlm(breakdown: AreaBreakdown) {
  const sorted = byChange(breakdown.rows)
  const top = sorted.slice(0, BREAKDOWN_EDGE_ROWS)
  const bottom = sorted.slice(BREAKDOWN_EDGE_ROWS).slice(-BREAKDOWN_EDGE_ROWS).reverse()
  return {
    by: breakdown.byJa,
    count: breakdown.rows.length,
    columns: `増減＝${breakdown.changeLabelJa}・値＝${breakdown.valueLabelJa}・将来＝${breakdown.futureLabelJa}`,
    order:
      '増減の大きい順の上位（highest）と、小さい順の下位（lowest）。上位でも増えたとは限らない',
    highest: top.map(rowForLlm),
    lowest: bottom.map(rowForLlm),
    ...(breakdown.noteJa === null ? {} : { note: breakdown.noteJa }),
  }
}

function areaForLlm(area: AreaSummary) {
  const { stations } = area
  return {
    area: area.ref,
    name: area.labelJa,
    kind: area.kindJa,
    stations: area.stationCount,
    totals: area.totals.map(totalForLlm),
    ...(area.unavailableJa.length === 0 ? {} : { unavailable: area.unavailableJa }),
    ...(stations.stats.length === 0
      ? {}
      : {
          aroundStations: {
            note: `駅の周り（${radiusLabel(stations.radiusM)}圏）の値の分布。エリア全体の値ではない`,
            stats: stations.stats.map(statForLlm),
          },
        }),
    ...(area.breakdown === null ? {} : { breakdown: breakdownForLlm(area.breakdown) }),
  }
}

/** 色分け（したか・色の意味・駅のある段・しなかった理由）。`note` は指標の決め方（既定の年など）。 */
function coloringForLlm(legend: StationLegend | null, colored: boolean, note: string | null) {
  const noted = note === null ? {} : { note: `色分けの指標：${note}` }
  if (legend === null) return { colored: false, meaning: '色分けしていない（colorBy:none）。' }
  if (!colored) return { colored: false, meaning: `色分けしていない：${legend.reasonJa ?? ''}` }
  const classes = legend.classes
    .filter((cls) => cls.count > 0)
    .map((cls) => `${cls.labelJa}（${cls.count} 駅）`)
    .join('・')
  return {
    colored: true,
    metric: legend.titleJa,
    meaning: legend.meaningJa ?? '',
    classes,
    ...noted,
  }
}

/** 比べる表（そろえた年・項目ごとの値）。 */
function comparisonForLlm(response: AreaSummaryResponse) {
  const { comparison } = response
  if (comparison === null) return {}
  return {
    comparison: {
      areas: comparison.names,
      rows: comparison.rows.map((row) => `${row.labelJa}：${row.cells.join(' / ')}`),
      notes: comparison.notesJa,
    },
  }
}

/** エリアの要約 → LLM 向けの要約。`nameNotes` は名前の読み替え（「横浜市（神奈川県）として扱いました」）、`colorNote` は色分けの指標の決め方。 */
export function areaSummaryForLlm(
  response: AreaSummaryResponse,
  nameNotes: readonly string[],
  colorNote: string | null = null,
) {
  return {
    areas: response.areas.map(areaForLlm),
    ...comparisonForLlm(response),
    coloring: coloringForLlm(response.legend, response.coloring !== null, colorNote),
    ...(nameNotes.length === 0 ? {} : { nameNotes }),
    notes: response.notesJa,
    notIncluded: response.notIncludedJa,
    sources: response.sources.map((each) => each.source),
    answerGuide: AREA_SUMMARY_ANSWER_GUIDE_JA,
  }
}
