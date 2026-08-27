/**
 * ドメイン：**警戒モード**——平時と同じ画面のままにしない（`docs/260824_flood.md` §7.4）。
 *
 * 警戒レベル3相当以上が出ている地域を見ているとき、アプリは
 * ①上部に警戒バナーを出し、②既定レイヤを「いまの危険度（キキクル）＋想定区域」に切り替える。
 *
 * ## 言えることの境界（ここが最重要）
 *
 * 出せるのは気象庁の「**◯◯相当**」までで、**「避難指示が出ています」とは絶対に書かない**
 * ——避難情報を出すのは市町村で、このアプリは知り得ない。文言は `level.ts` が持つ
 * `alertHeadlineJa` / `ALERT_LIMITATION_JA` をそのまま使い、ここで新しい言い方を作らない。
 *
 * ## レイヤは「出ている現象」に合わせる
 *
 * §7.4 の表は「キキクル ON ＋ 洪水 ON」だが、**土砂災害の警戒中に洪水の面を出しても意味が無い**。
 * そこで、いちばん重い発表の現象に合わせて 1 組だけ選ぶ。キキクルは 3 種とも `base` なので、
 * `toggleHazardLayer` の不変条件どおり**同時に出せるのは 1 枚だけ**である。
 */

import type { AlertLevel } from '@/shared/constants'
import { resolveHazardLayerKeys } from './catalog'

/** 警戒モードに入る警戒レベル相当（§7.4 の表）。 */
export const WARNING_MODE_MIN_LEVEL = 3

/** 気象庁が発表している 1 件（このモジュールが読むぶんだけ）。 */
export type WarningLike = {
  readonly code: string
  readonly nameJa: string
  readonly alertLevel: AlertLevel
}

/** いま警戒モードか。 */
export function isWarningMode(alertLevel: AlertLevel): boolean {
  return alertLevel >= WARNING_MODE_MIN_LEVEL
}

/** 警戒モードで出す現象。`null` は「水害・土砂災害の体系の外」（暴風・波浪など）。 */
export type WarningPhenomenon = 'landslide' | 'inundation' | 'flood' | 'storm_surge'

/**
 * 種別コード → 現象。名前から読めないときの受け皿。
 * 大雨（03・10）は土砂か浸水か分からないので、面としては浸水を出す
 * ——土砂の警戒中なら土砂災害警戒情報が別に出て、そちらの方が重くなる。
 */
const PHENOMENON_BY_CODE: Readonly<Record<string, WarningPhenomenon>> = {
  '33': 'inundation', // 大雨特別警報
  '03': 'inundation', // 大雨警報
  '10': 'inundation', // 大雨注意報
  '04': 'flood', // 洪水警報
  '18': 'flood', // 洪水注意報
  '38': 'storm_surge', // 高潮特別警報
  '08': 'storm_surge', // 高潮警報
  '19': 'storm_surge', // 高潮注意報
}

/**
 * 名前から読む現象。**名前を先に見る**——コード表に無い発表（土砂災害警戒情報・
 * 気象庁の「危険度」）はここでしか拾えないうえ、「大雨警報（土砂災害）」のように
 * 名前の方が具体的なことがあるためである。
 */
const PHENOMENON_BY_NAME: readonly (readonly [string, WarningPhenomenon])[] = [
  ['土砂', 'landslide'],
  ['洪水', 'flood'],
  ['浸水', 'inundation'],
  ['高潮', 'storm_surge'],
]

/** 発表 1 件 → 現象（分からなければ null）。 */
export function phenomenonOf(warning: WarningLike): WarningPhenomenon | null {
  const byName = PHENOMENON_BY_NAME.find(([needle]) => warning.nameJa.includes(needle))
  return byName?.[1] ?? PHENOMENON_BY_CODE[warning.code] ?? null
}

/**
 * その現象で見せるレイヤ（キキクル＝いまの危険度 ＋ 想定区域＝もし起きたら）。
 *
 * 高潮にはキキクルが無い（気象庁が出していない）ので想定区域だけになる。
 * **無いものを埋めない**——それらしいレイヤを代わりに出すと、別の現象の面を
 * 高潮の危険度だと読ませてしまう。
 *
 * ⚠ **浸水だけは洪水の想定区域も一緒に出す。** 理由は 2 つあり、どちらも実測で確かめた
 * （2026-08-27・氷見市の大雨特別警報・§10.4）。
 * ①気象庁の見出し自身が「低い土地の浸水**や河川の増水**に最大級の警戒を」と書く。
 * ②内水は 47 都道府県中 22 でしか整備されておらず、**富山県には 1 枚も無い**
 * （`02_naisui_data` が全タイル 404）。内水だけを出すと、警戒レベル5相当の最中に
 * **地図が真っ白**になる——白は「安全」に読まれる（§7.5-1）。
 */
const LAYERS_BY_PHENOMENON: Readonly<Record<WarningPhenomenon, readonly string[]>> = {
  landslide: ['kikikuru_land', 'dosekiryu', 'kyukeisha', 'jisuberi'],
  inundation: ['kikikuru_inund', 'naisui', 'flood_l2'],
  flood: ['kikikuru_flood', 'flood_l2'],
  storm_surge: ['hightide_l2'],
}

/** 発表が無いときに出す既定（§7.4 の表の「洪水 ON」）。 */
const DEFAULT_PHENOMENON: WarningPhenomenon = 'flood'

/** いちばん重い発表の現象（河川の予報は必ず洪水）。 */
export function leadingPhenomenon(
  warnings: readonly WarningLike[],
  hasFloodForecast: boolean,
): WarningPhenomenon {
  if (hasFloodForecast) return 'flood'
  const heaviest = [...warnings]
    .sort((a, b) => b.alertLevel - a.alertLevel)
    .map(phenomenonOf)
    .find((phenomenon) => phenomenon !== null)
  return heaviest ?? DEFAULT_PHENOMENON
}

/**
 * 警戒モードで自動的に出すレイヤ（カタログ順・実在するものだけ）。
 * **利用者が自分で選んだレイヤがあるときは呼ばない**——選択を勝手に奪わないため、
 * 判断は呼び出し側（`useWarningMode`）が持つ。
 */
export function warningModeLayers(
  warnings: readonly WarningLike[],
  hasFloodForecast: boolean,
): readonly string[] {
  return resolveHazardLayerKeys(LAYERS_BY_PHENOMENON[leadingPhenomenon(warnings, hasFloodForecast)])
}
