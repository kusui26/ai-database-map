/**
 * ドメイン：**おすすめ駅の言い方**（純関数・`docs/260912_gui_chat_protocol.md` §13.4）。
 *
 * 文字列をここに集めてあるのは、**UI と AI で言い方を割らない**ため（CLAUDE.md §2）。
 * 「min-max で正規化」「洪水が『危険』以上を除外」をフロントで組み立て直すと、
 * 同じ計算の説明が画面とチャットで食い違う。サーバが 1 回だけ作る。
 *
 * ⚠ 言い切らない語彙を守る。`none` は**「想定区域外」であって「安全」ではない**し、
 * 足切りを通った駅を「安全な駅」とは呼ばない。
 */

import type { ListStationsFilter } from '@/db/queries'
import { getEntry } from '@/shared/catalog'
import {
  HAZARD_GROUP_LABELS_JA,
  HAZARD_LEVEL_LABELS_JA,
  radiusLabel,
  routeTypeLabel,
} from '@/shared/constants'
import type { HazardPenaltyId, MetricDirection, NormalizeMethod } from '@/shared/recommend'
import { HAZARD_PENALTY_LABELS_JA } from './presets'
import type { ExclusionReason, FlaggedPolicy, HazardPolicy, Sensitivity } from './types'

/** 除外理由に並べる指標名の上限（これを超えたら「ほか n 件」）。 */
const MAX_LISTED_KEYS = 3

/** 正規化の方法（**必ず 1 行で表示する**・§13.4-1）。 */
const METHOD_LABELS_JA: Readonly<Record<NormalizeMethod, string>> = {
  percentile: 'エリア内パーセンタイル（候補の中での位置を 0〜1 に）',
  minmax: 'min-max（候補の最小〜最大を 0〜1 に）',
  zscore: 'z-score（候補の平均からの標準偏差）',
}

export function methodJa(method: NormalizeMethod): string {
  return METHOD_LABELS_JA[method]
}

const DIRECTION_LABELS_JA: Readonly<Record<MetricDirection, string>> = {
  higher: '高いほど良い',
  lower: '低いほど良い',
}

export function directionJa(direction: MetricDirection): string {
  return DIRECTION_LABELS_JA[direction]
}

const FLAGGED_LABELS_JA: Readonly<Record<FlaggedPolicy, string>> = {
  annotate: '⚠（値が信用できない）は印を付けて残す',
  exclude: '⚠（値が信用できない）がある駅は候補から外す',
}

export function flaggedJa(policy: FlaggedPolicy): string {
  return FLAGGED_LABELS_JA[policy]
}

/** 災害の扱い。**「安全」とは言わない**——外したのは想定区域の重さで並べただけ。 */
export function hazardPolicyJa(policy: HazardPolicy, penalty: HazardPenaltyId): string {
  if (policy.mode === 'off') return '災害は見ていません（順位に反映していません）'
  const groupJa = HAZARD_GROUP_LABELS_JA[policy.group]
  if (policy.mode === 'exclude') {
    return `${groupJa}が「${HAZARD_LEVEL_LABELS_JA[policy.atOrAbove]}」以上の駅を候補から外しました`
  }
  return `${groupJa}の危険度に応じて段階減点しました（${HAZARD_PENALTY_LABELS_JA[penalty]}・表のとおり）`
}

/** 絞り込みの日本語（「横浜市（東海道線・根岸線）」）。 */
export function areaLabelJa(filter: ListStationsFilter): string {
  const places = [
    ...(filter.municipality === undefined ? [] : [filter.municipality]),
    ...(filter.prefectures ?? []),
    ...(filter.bbox === undefined ? [] : ['地図の表示範囲']),
  ]
  const lines = [
    ...(filter.routes ?? []),
    ...(filter.operators ?? []),
    ...(filter.routeTypes ?? []).map(routeTypeLabel),
  ]
  const head = places.length > 0 ? places.join('・') : '全国'
  return lines.length > 0 ? `${head}（${lines.join('・')}）` : head
}

/** 指標 key の並び → 日本語（多すぎるときは頭だけ）。 */
function metricNamesJa(keys: readonly string[]): string {
  const names = keys.slice(0, MAX_LISTED_KEYS).map((key) => getEntry(key)?.labelJa ?? key)
  const rest = keys.length - names.length
  return rest > 0 ? `${names.join('・')} ほか ${rest} 件` : names.join('・')
}

/** 候補から外れた理由（**必ず理由を言う**・§13.4-5）。 */
export function exclusionJa(reason: ExclusionReason): string {
  if (reason.kind === 'missing') return `${metricNamesJa(reason.keys)}の値がないため`
  if (reason.kind === 'flagged')
    return `${metricNamesJa(reason.keys)}が ⚠（値が信用できない）のため`
  const groupJa = HAZARD_GROUP_LABELS_JA[reason.group]
  return `${groupJa}が「${HAZARD_LEVEL_LABELS_JA[reason.level]}」のため`
}

/** 敏感度の 1 行（§13.4-4）。「頑健」か「僅差」かをここで言い切る。 */
export function sensitivityJa(sensitivity: Sensitivity, topN: number): string {
  return sensitivity.stable
    ? `頑健（重みを ±20% 振っても上位 ${topN} の並びは変わりません・${sensitivity.runs} 通り）`
    : `僅差（重みを ±20% 振ると上位 ${topN} の並びが変わります・${sensitivity.runs} 通り）`
}

/** 半径と年の但し書き（「1km 圏」）。 */
export function radiusJa(radiusM: number): string {
  return `${radiusLabel(radiusM)} 圏`
}
