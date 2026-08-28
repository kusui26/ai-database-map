/**
 * ドメイン：災害データの出典（**About と各応答の唯一の真実**・`docs/260824_flood.md` §7.5-3）。
 *
 * 出典の表示は**利用条件**である（国土地理院・気象庁とも出典明示を求めている）。
 * 応答ごとに書き散らすと、どれか 1 つを直し忘れたときに**表示が食い違う**ので、
 * ここに 1 か所だけ持ち、API の応答も About のダイアログも同じものを読む。
 *
 * 2 種類ある。
 * - **レイヤの出典**（重ねるハザードマップ・地理院タイル）… カタログが持っている
 * - **API の出典**（気象庁の警報・浸水ナビ・指定緊急避難場所・逆ジオ）… ここが持つ
 */

import { hazardLayers } from '@/shared/hazard'
import { EVACUATION_SITE_KIND_JA } from '@/shared/evacuation'
import type { SourceRef } from '@/shared/protocol'

/** 気象庁の警報・注意報（`/api/hazard/alerts`）。 */
export const JMA_WARNING_SOURCE: SourceRef = {
  labelJa: '出典：気象庁 気象警報・注意報',
  url: 'https://www.jma.go.jp/bosai/warning/',
  license: '気象庁 公共データ利用規約（第1.0版）',
  forJa: null,
}

/** 国土地理院の逆ジオコーディング（地点 → 市区町村）。 */
export const GSI_REVERSE_GEOCODER_SOURCE: SourceRef = {
  labelJa: '出典：国土地理院 逆ジオコーディング',
  url: 'https://maps.gsi.go.jp/',
  license: '国土地理院コンテンツ利用規約',
  forJa: null,
}

/** 指定緊急避難場所（`/api/hazard/evacuation`）。 */
export const EVACUATION_SITE_SOURCE: SourceRef = {
  labelJa: `出典：国土地理院 ${EVACUATION_SITE_KIND_JA}データ`,
  url: 'https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html',
  license: '国土地理院コンテンツ利用規約',
  forJa: null,
}

/** 浸水ナビ（河川ごとの浸水深・到達時間）。 */
export const SUIBOU_NAVI_SOURCE: SourceRef = {
  labelJa: '国土地理院 地点別浸水シミュレーション検索システム（浸水ナビ）',
  url: 'https://suiboumap.gsi.go.jp/',
  license: '国土交通省 利用規約',
  forJa: null,
}

/** キキクル（危険度分布・表示専用）。 */
export const KIKIKURU_SOURCE: SourceRef = {
  labelJa: '出典：気象庁 キキクル（危険度分布）',
  url: 'https://www.jma.go.jp/bosai/risk/',
  license: '気象庁 公共データ利用規約（第1.0版）',
  forJa: null,
}

/** API から取る出典（レイヤのタイル以外で、答えに使っているもの）と、その役割。 */
const API_SOURCES: readonly { readonly ref: SourceRef; readonly usedForJa: string }[] = [
  { ref: JMA_WARNING_SOURCE, usedForJa: 'いまの警報・注意報と警戒レベル相当' },
  { ref: KIKIKURU_SOURCE, usedForJa: 'いまの危険度の分布（表示のみ）' },
  { ref: SUIBOU_NAVI_SOURCE, usedForJa: '河川ごとの浸水深・到達時間・継続時間' },
  { ref: EVACUATION_SITE_SOURCE, usedForJa: `近くの${EVACUATION_SITE_KIND_JA}` },
  { ref: GSI_REVERSE_GEOCODER_SOURCE, usedForJa: '地点から市区町村の特定' },
]

/** About に出す 1 行（出典・ライセンス・何に使っているか）。 */
export type HazardDataSource = {
  readonly source: string
  readonly license: string | null
  /** そのデータで何を出しているか（レイヤ名、または API の役割）。 */
  readonly usedForJa: readonly string[]
}

/** 「出典：」の前置きを外す（ラベルは地図の出典表示のために付いている）。 */
function withoutPrefix(labelJa: string): string {
  return labelJa.startsWith('出典：') ? labelJa.slice('出典：'.length) : labelJa
}

/**
 * 災害データの出典一覧（カタログ ＋ API）。
 *
 * **手で書かない。** レイヤを足したら自動で増える——増えないと、
 * 使っているのに出典が出ていない状態が生まれる（利用条件違反になりうる）。
 */
export function hazardDataSources(): readonly HazardDataSource[] {
  const grouped = new Map<string, { source: string; license: string | null; usedFor: string[] }>()
  const add = (source: string, license: string | null, usedFor: string): void => {
    const key = `${source}\u0000${license ?? ''}`
    const current = grouped.get(key) ?? { source, license, usedFor: [] }
    if (!current.usedFor.includes(usedFor)) current.usedFor.push(usedFor)
    grouped.set(key, current)
  }
  for (const layer of hazardLayers) add(layer.source, layer.license, layer.labelJa)
  for (const api of API_SOURCES) add(withoutPrefix(api.ref.labelJa), api.ref.license, api.usedForJa)
  return [...grouped.values()].map((group) => ({
    source: group.source,
    license: group.license,
    usedForJa: group.usedFor,
  }))
}
