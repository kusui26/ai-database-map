/**
 * ドメイン：**確からしさを言い方に変える**（純関数・`docs/260824_flood.md` §8.3・§7.5）。
 *
 * 250m メッシュの 1 セルは点ではなく**区間**で、区域と非区域が混ざったセルが多い
 * （全国の flood_l2 で、区域にかかるセルの **74% が「一部」**）。だから
 * **確定して言えるのは被覆率の両端だけ**——0 は「一切かからない」、1 は「全域」。
 * その事実をそのまま文にするのがこのファイルの仕事である。
 *
 * ここを UI に書くと AI が同じ言い方をできなくなる（.claude/CLAUDE.md §2）。
 * だから**文字列はここでだけ作り、UI もチャットも同じものを読む**。
 *
 * ## 「被覆率 0」を「安全」と訳してはいけない（実測で 2 つ理由がある）
 *
 * 1. **原典どうしの差**。区域外セルの **1.7%** で、A31b には半径 2km 以内に図形が 1 つも無いのに
 *    公式タイルはそこを塗っていた（§8.2b）。メッシュは公式タイルより薄いことがある
 * 2. **レイヤの網羅性**。内水は 47 都道府県中 22 しか収録が無く、高潮・津波・土砂はメッシュ化していない
 */

import { COVERAGE_STEPS } from '@/shared/hazard-mesh'
import type { HazardCertainty, HazardSource } from '@/shared/hazard'

/** 「ごく一部」と言う上限（1/15 ＝ 約 6.7%）。量子化の 1 段ぶん。 */
const SLIGHT_COVERAGE = 1 / COVERAGE_STEPS

/** 情報源と被覆率から確からしさを決める（メッシュ以外は点で確定している）。 */
export function certaintyOf(source: HazardSource, coverage: number | null): HazardCertainty {
  if (source !== 'mesh') return 'exact'
  if (coverage === null) return 'unknown'
  return coverage >= 1 ? 'exact' : 'partial'
}

/** カード全体の確からしさ（**最も弱いものに合わせる**——強い方に丸めると嘘になる）。 */
export function weakestCertainty(values: readonly HazardCertainty[]): HazardCertainty {
  if (values.includes('unknown')) return 'unknown'
  return values.includes('partial') ? 'partial' : 'exact'
}

/** 被覆率 → 量の言い方だけ（0 と 1 だけが厳密・§5.9）。文はこれを組み合わせて作る。 */
export function coverageAmountJa(coverage: number): string {
  if (coverage >= 1) return '全域'
  if (coverage <= SLIGHT_COVERAGE) return 'ごく一部'
  return `約 ${Math.round(coverage * 100)}%`
}

/**
 * 地点の 1 行の値。**情報源によって言い方が変わる**のがこの関数の要点。
 * メッシュ由来で区間でしか言えないときは、値そのものに「このメッシュの◯」を織り込む——
 * こうすると、一覧・見出し・根拠のどこに出ても**幅つきであることが落ちない**。
 */
export function valuePhraseJa(
  rankLabelJa: string,
  source: HazardSource,
  depthM: number | null,
  coverage: number | null,
): string {
  if (source === 'suibou-navi' && depthM !== null) return `${depthM.toFixed(2)}m・${rankLabelJa}`
  if (source === 'mesh' && coverage !== null && coverage < 1) {
    return `${rankLabelJa}（このメッシュの${coverageAmountJa(coverage)}）`
  }
  return rankLabelJa
}

/** メッシュで答えたときに添える 1 文（区間であることを隠さない）。 */
export function meshNoteJa(layerLabelJa: string, coverage: number): string {
  if (coverage >= 1) return `${layerLabelJa}：この場所を含む 250m メッシュは全域が区域です`
  return (
    `${layerLabelJa}：この場所を含む 250m メッシュの${coverageAmountJa(coverage)}が区域です。` +
    '正確な位置は地図でご確認ください'
  )
}

/**
 * 区間でしか言えないときの見出し。**「この場所は…に入っています」と断定しない。**
 * 250m セルの 74% は区域と非区域の混在で、点がどちら側かはメッシュには分からない（§5.9）。
 */
export function partialHeadlineJa(
  layerLabelJa: string,
  rankLabelJa: string,
  coverage: number,
): string {
  return (
    `この場所を含む 250m メッシュの${coverageAmountJa(coverage)}が` +
    `${layerLabelJa}（${rankLabelJa}）です。正確な位置は地図でご確認ください。`
  )
}

/** 隣のメッシュだけが区域のときの 1 文（GPS 誤差と混在セルを補う・§8.3）。 */
export function neighbourNoteJa(layerLabelJa: string): string {
  return `${layerLabelJa}：この場所は区域外ですが、**隣の 250m メッシュ**が区域です（GPS の誤差にご注意ください）`
}

/**
 * 何にも当たらなかったときの 1 文。**「安全です」とは決して言わない。**
 * 言えるのは「指定された区域のデータには入っていない」ことだけである。
 */
export function noHazardHeadlineJa(certainty: HazardCertainty): string {
  const base =
    'この場所は、表示できるハザードの指定区域には入っていません（安全という意味ではありません）。'
  return certainty === 'unknown'
    ? `${base}オフラインのため、250m メッシュだけで判断しています。`
    : base
}

// --- 浸水ナビの河川情報を 1 文にする（§6.1 の reasonsJa） -----------------

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/** 分 → 読める長さ（「約 30 分」「約 3 時間」「約 10 日間」）。 */
export function durationPhraseJa(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) return `約 ${Math.round(minutes)} 分`
  const hours = minutes / MINUTES_PER_HOUR
  if (hours < HOURS_PER_DAY) return `約 ${Math.round(hours)} 時間`
  return `約 ${Math.round(hours / HOURS_PER_DAY)} 日間`
}

/** 数のうち最小・最大を持つ要素（無ければ null）。 */
function extremeBy<T>(
  items: readonly T[],
  value: (item: T) => number | null,
  largest: boolean,
): T | null {
  return items.reduce<T | null>((best, item) => {
    const [mine, theirs] = [value(item), best === null ? null : value(best)]
    if (mine === null) return best
    if (theirs === null) return item
    return (largest ? mine > theirs : mine < theirs) ? item : best
  }, null)
}

/**
 * 河川ごとの到達・継続を根拠の文にする。**いちばん早いものといちばん長いもの**だけを言う——
 * 5 本ぶん並べても読まれないし、避難の判断に効くのはこの 2 つである。
 */
export function riverReasonsJa(
  rivers: readonly { nameJa: string; arriveMin: number | null; continueMin: number | null }[],
): readonly string[] {
  const fastest = extremeBy(rivers, (river) => river.arriveMin, false)
  const longest = extremeBy(rivers, (river) => river.continueMin, true)
  return [
    fastest === null || fastest.arriveMin === null
      ? null
      : `${fastest.nameJa}の氾濫では${durationPhraseJa(fastest.arriveMin)}で浸水が始まる想定です`,
    longest === null || longest.continueMin === null
      ? null
      : `${longest.nameJa}の氾濫では最大${durationPhraseJa(longest.continueMin)}浸水が続く想定です`,
  ].filter((reason): reason is string => reason !== null)
}
