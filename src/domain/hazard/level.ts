/**
 * ドメイン：**「いま、警戒レベル◯相当か」を決める**（純関数・`docs/260824_flood.md` §3.3(d)・§8.4）。
 *
 * ## 判定は警報 JSON を正とする（決定 5）
 *
 * キキクル（危険度分布）のタイルは**表示専用**で、**色からレベルを判定しない**（§9.1）。
 * 画像を読んで色を数えるのは、配色が変われば静かに壊れるし、そもそも判定の根拠にならない。
 *
 * ## レベルは 3 つの情報源の最大を採る
 *
 * | 情報源 | 何を持っているか |
 * |---|---|
 * | **危険度**（`properties[]`・キキクル相当） | **気象庁自身が「警戒レベル◯相当」と書いている**。浸水害・土砂災害はここが主役 |
 * | 種別コード | 高潮警報など、危険度を持たない発表（§3.3(d) の表） |
 * | **指定河川洪水予報** | 氾濫注意〜氾濫発生。`class20Codes` で区域に繋がる |
 *
 * **タイルの色は読まない**（決定 5・§9.1）。テキストで「相当」が publish されているので必要が無い。
 *
 * ## ⚠ それでも「全部」ではない
 *
 * 表に無い種別コードで、かつ危険度も付いていない発表は**レベル 0 として扱う**。
 * だから `ALERT_LIMITATION_JA` を必ず添える——「レベル2相当です」を
 * 「レベル4は出ていません」と読ませたら、それは §7.5 が防ごうとしている誤った安心になる。
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
import {
  alertLevelOfLocalCode,
  jmaWarningKind,
  riskTypeLabelJa,
  type JmaWarningKind,
} from '@/shared/jma'

/** 発表中でない状態（`map.json` の `status`）。これらは数えない。 */
const INACTIVE_STATUSES: readonly string[] = ['解除', '発表警報・注意報はなし']

/**
 * この判定に含まれていないもの。**必ず応答に添える。**
 * 「レベル2相当」を「レベル4は出ていない」と読ませないための 1 文である。
 */
export const ALERT_LIMITATION_JA =
  'ここに出るのは気象庁が発表しているものだけです。避難情報（警戒レベル4「避難指示」など）を出すのは市町村で、この画面では分かりません。'

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
  /** 気象庁が添えている補足（例「２７日８時から１３時まで、警戒レベル４相当」）。 */
  readonly detailJa: string | null
}

/** 危険度（キキクル相当）。`significancyPart` に警戒レベル相当が入っている。 */
export type RawWarningProperty = {
  readonly type?: string
  readonly significancyPart?: { readonly locals: readonly { readonly code: string }[] }
  readonly criteriaPeriod?: { readonly locals: readonly { readonly sentence?: string }[] }
}

/** `r8/map.json` の 1 行（コードが無い行＝「発表なし」もある）。 */
export type RawWarning = {
  readonly code?: string
  readonly status?: string
  readonly properties?: readonly RawWarningProperty[]
}

/** 指定河川洪水予報の 1 件（区域に繋がった形）。 */
export type FloodForecastWarning = {
  readonly riverNameJa: string
  readonly nameJa: string
  readonly alertLevel: AlertLevel
  readonly reportedAt: string | null
}

/** 発表中か（解除済み・「発表なし」を除く）。 */
function isActive(row: RawWarning): boolean {
  return row.code !== undefined && !INACTIVE_STATUSES.includes(row.status ?? '')
}

/** 危険度から読める警戒レベル相当（レベルを運ばないものは null）。 */
function levelOfProperty(property: RawWarningProperty): AlertLevel | null {
  return alertLevelOfLocalCode(property.significancyPart?.locals[0]?.code)
}

/** 危険度が付いている場合の表示名（例「土砂災害の危険度」）。 */
function riskLabelOf(properties: readonly RawWarningProperty[]): string | null {
  const withLevel = properties.find((property) => levelOfProperty(property) !== null)
  return withLevel?.type === undefined ? null : riskTypeLabelJa(withLevel.type)
}

/** 気象庁が添えている補足の文（無ければ null）。 */
function detailOf(properties: readonly RawWarningProperty[]): string | null {
  return (
    properties
      .flatMap((property) => property.criteriaPeriod?.locals ?? [])
      .map((local) => local.sentence)
      .find((sentence) => sentence !== undefined && sentence.length > 0) ?? null
  )
}

/**
 * 生の行 → 意味づけ済みの発表。**未知のコードも捨てずに残す**——
 * 表に無いものを黙って落とすと、発表されている警報が画面から消える。
 *
 * レベルは**種別コードの表と危険度の大きい方**を採る。危険度は気象庁が
 * 「警戒レベル◯相当」と明示しているので、**表に無いコード（土砂災害警戒情報など）でも拾える**。
 */
export function toAlertWarning(row: RawWarning, areaJa: string): AlertWarning | null {
  if (!isActive(row) || row.code === undefined) return null
  const known = jmaWarningKind(row.code)
  const properties = row.properties ?? []
  const levels = properties.flatMap((property) => {
    const level = levelOfProperty(property)
    return level === null ? [] : [level]
  })
  const alertLevel = [known?.alertLevel ?? 0, ...levels].reduce<AlertLevel>(
    (worst, level) => (level > worst ? level : worst),
    0,
  )
  return {
    code: row.code,
    nameJa: known?.nameJa ?? riskLabelOf(properties) ?? `未知の発表（コード ${row.code}）`,
    kindJa: known?.kindJa ?? null,
    alertLevel,
    areaJa,
    statusJa: row.status ?? '発表',
    detailJa: detailOf(properties),
  }
}

/** 全角・半角の数字 1 文字 → 数値（読めなければ 0）。 */
const FULL_WIDTH_DIGITS = '１２３４５'

/**
 * 指定河川洪水予報の名前 → 警戒レベル相当。
 * 気象庁は**名前に「レベル３」と全角で書いている**ので、そこから読む
 * （コードの意味は公開されていないが、名前は自己記述的である）。
 */
export function alertLevelOfFloodName(nameJa: string): AlertLevel {
  const matched = /レベル([１-５1-5])/.exec(nameJa)
  const digit = matched?.[1]
  if (digit === undefined) return 0
  const index = FULL_WIDTH_DIGITS.indexOf(digit)
  const level = index >= 0 ? index + 1 : Number(digit)
  return ALERT_LEVELS.find((candidate) => candidate === level) ?? 0
}

/** 最も重い警戒レベル相当（発表が無ければ 0）。河川の予報も同じ物差しで混ぜられる。 */
export function heaviestAlertLevel(
  warnings: readonly { readonly alertLevel: AlertLevel }[],
): AlertLevel {
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
export function alertHeadlineJa(
  placeJa: string,
  warnings: readonly AlertWarning[],
  floods: readonly FloodForecastWarning[] = [],
): string {
  const worstFlood = [...floods].sort((a, b) => b.alertLevel - a.alertLevel)[0]
  const leading = leadingWarning(warnings)
  // 河川の予報の方が重ければ、そちらを見出しにする（氾濫危険情報は警戒レベル4相当）。
  if (worstFlood !== undefined && worstFlood.alertLevel >= (leading?.alertLevel ?? 0)) {
    return `${worstFlood.riverNameJa}に${worstFlood.nameJa}（${ALERT_LEVEL_LABELS_JA[worstFlood.alertLevel]}）が発表されています。`
  }
  if (leading === undefined) {
    return `${placeJa}に、いま発表されている警報・注意報はありません。`
  }
  if (leading.alertLevel === 0) {
    const names = [...new Set(warnings.map((warning) => warning.nameJa))].join('・')
    return `${placeJa}に${names}が発表されています（水害・土砂災害の警戒レベルに対応する発表はありません）。`
  }
  // 「危険度」は発表される“もの”ではなく状態なので、言い方を変える
  // （「危険度が発表されています」は日本語として通らない）。
  if (leading.nameJa.endsWith('危険度')) {
    return `${placeJa}は${leading.nameJa}が${ALERT_LEVEL_LABELS_JA[leading.alertLevel]}です。`
  }
  return `${placeJa}に${leading.nameJa}（${ALERT_LEVEL_LABELS_JA[leading.alertLevel]}）が発表されています。`
}

/** 発表 1 件 → 1 行（気象庁の補足文があれば添える）。 */
function warningReasonJa(warning: AlertWarning): string {
  const level =
    warning.alertLevel === 0
      ? warning.statusJa
      : `${ALERT_LEVEL_LABELS_JA[warning.alertLevel]}・${warning.statusJa}`
  const detail = warning.detailJa === null ? '' : `／${warning.detailJa}`
  return `${warning.areaJa}：${warning.nameJa}（${level}）${detail}`
}

/** 根拠（重い順）。河川の予報を先に置く——名指しの河川がいちばん具体的なので。 */
export function alertReasonsJa(
  warnings: readonly AlertWarning[],
  floods: readonly FloodForecastWarning[] = [],
): readonly string[] {
  const river = [...floods]
    .sort((a, b) => b.alertLevel - a.alertLevel)
    .map(
      (flood) =>
        `${flood.riverNameJa}：${flood.nameJa}（${ALERT_LEVEL_LABELS_JA[flood.alertLevel]}）`,
    )
  const rest = [...warnings].sort((a, b) => b.alertLevel - a.alertLevel).map(warningReasonJa)
  return [...river, ...rest]
}
