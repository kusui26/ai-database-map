/**
 * ドメイン：**「いま、警戒レベル◯相当か」を決める**（純関数・`docs/260824_flood.md` §3.3(d)・§8.4）。
 *
 * ## 判定は警報 JSON を正とする（決定 5）
 *
 * キキクル（危険度分布）のタイルは**表示専用**で、**色からレベルを判定しない**（§9.1）。
 * 画像を読んで色を数えるのは、配色が変われば静かに壊れるし、そもそも判定の根拠にならない。
 *
 * ## ⚠ ここで分かるのは「全部」ではない
 *
 * `warning/map.json` が持つのは**警報・注意報**だけである。警戒レベル4相当の主役である
 * **土砂災害警戒情報**と**指定河川洪水予報（氾濫危険情報など）は別の情報**で、ここには現れない。
 * だから **`ALERT_LIMITATION_JA` を必ず添える**——「レベル2相当です」を
 * 「レベル4は出ていません」と読ませたら、それは §7.5 が防ごうとしている誤った安心そのものになる。
 *
 * ## 言い方
 *
 * 出せるのは**「◯◯相当情報」まで**。レベル4「避難指示」を出すのは市町村で、こちらは知り得ない。
 * **「避難指示が出ています」とは絶対に書かない**（§7.4）。
 */

import {
  ALERT_LEVELS,
  ALERT_LEVEL_LABELS_JA,
  ALERT_LEVEL_TO_HAZARD,
  type AlertLevel,
  type HazardLevel,
} from '@/shared/constants'
import { jmaWarningKind, type JmaWarningKind } from '@/shared/jma'

/** 発表中でない状態（`map.json` の `status`）。これらは数えない。 */
const INACTIVE_STATUSES: readonly string[] = ['解除', '発表警報・注意報はなし']

/**
 * この判定に含まれていないもの。**必ず応答に添える。**
 * 「レベル2相当」を「レベル4は出ていない」と読ませないための 1 文である。
 */
export const ALERT_LIMITATION_JA =
  '土砂災害警戒情報と指定河川洪水予報（氾濫危険情報など）は、この判定に含まれていません。警戒レベル4相当が発表されていても、ここには現れないことがあります。'

/** 気象庁が発表している 1 件（意味づけ済み）。 */
export type AlertWarning = {
  readonly code: string
  readonly nameJa: string
  /** 未知のコードは種別も分からない（`null`）。**黙って落とさない**。 */
  readonly kindJa: JmaWarningKind | null
  readonly alertLevel: AlertLevel
  /** どの二次細分区域の発表か（市が複数区域に分かれるとき効く）。 */
  readonly areaJa: string
  readonly statusJa: string
}

/** `map.json` の 1 行（コードが無い行＝「発表なし」もある）。 */
export type RawWarning = { readonly code?: string; readonly status?: string }

/** 発表中か（解除済み・「発表なし」を除く）。 */
function isActive(row: RawWarning): boolean {
  return row.code !== undefined && !INACTIVE_STATUSES.includes(row.status ?? '')
}

/**
 * 生の行 → 意味づけ済みの発表。**未知のコードも捨てずに残す**——
 * 表に無いものを黙って落とすと、発表されている警報が画面から消える。
 */
export function toAlertWarning(row: RawWarning, areaJa: string): AlertWarning | null {
  if (!isActive(row) || row.code === undefined) return null
  const known = jmaWarningKind(row.code)
  return {
    code: row.code,
    nameJa: known?.nameJa ?? `未知の発表（コード ${row.code}）`,
    kindJa: known?.kindJa ?? null,
    alertLevel: known?.alertLevel ?? 0,
    areaJa,
    statusJa: row.status ?? '発表',
  }
}

/** 最も重い警戒レベル相当（発表が無ければ 0）。 */
export function heaviestAlertLevel(warnings: readonly AlertWarning[]): AlertLevel {
  return warnings.reduce<AlertLevel>(
    (worst, warning) => (warning.alertLevel > worst ? warning.alertLevel : worst),
    ALERT_LEVELS[0],
  )
}

/** 警戒レベル相当 → カードや地図で使う危険度。 */
export function hazardLevelOfAlert(level: AlertLevel): HazardLevel {
  return ALERT_LEVEL_TO_HAZARD[level]
}

/** レベルを決めた発表（同じレベルなら特別警報 → 警報 → 注意報の順で代表を選ぶ）。 */
function leadingWarning(warnings: readonly AlertWarning[]): AlertWarning | undefined {
  const level = heaviestAlertLevel(warnings)
  const order: readonly (JmaWarningKind | null)[] = ['特別警報', '警報', '注意報', null]
  const matched = warnings.filter((warning) => warning.alertLevel === level)
  return order.flatMap((kind) => matched.filter((warning) => warning.kindJa === kind))[0]
}

/**
 * 1 文の結論。**「◯◯相当」を必ず付け、「避難指示」とは書かない**（§7.4）。
 * 発表が無いときも「安全」とは言わない——言えるのは「発表されていない」までである。
 */
export function alertHeadlineJa(placeJa: string, warnings: readonly AlertWarning[]): string {
  const leading = leadingWarning(warnings)
  if (leading === undefined) {
    return `${placeJa}に、いま発表されている警報・注意報はありません。`
  }
  if (leading.alertLevel === 0) {
    const names = [...new Set(warnings.map((warning) => warning.nameJa))].join('・')
    return `${placeJa}に${names}が発表されています（水害・土砂災害の警戒レベルに対応する発表はありません）。`
  }
  return `${placeJa}に${leading.nameJa}（${ALERT_LEVEL_LABELS_JA[leading.alertLevel]}）が発表されています。`
}

/** 根拠（発表ごとに 1 行・重い順）。UI も AI も同じ文字列を読む。 */
export function alertReasonsJa(warnings: readonly AlertWarning[]): readonly string[] {
  return [...warnings]
    .sort((a, b) => b.alertLevel - a.alertLevel)
    .map((warning) =>
      warning.alertLevel === 0
        ? `${warning.areaJa}：${warning.nameJa}（${warning.statusJa}）`
        : `${warning.areaJa}：${warning.nameJa}（${ALERT_LEVEL_LABELS_JA[warning.alertLevel]}・${warning.statusJa}）`,
    )
}
