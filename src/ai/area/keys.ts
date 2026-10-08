/**
 * 起点の駅名・市区町村名の照合の鍵（純関数・2026-10-08 B2）。
 *
 * 全角・半角を揃え（NFKC）、空白を除き、「ヶ・ヵ」を「ケ」に揃える（「市ヶ谷」と「市ケ谷」、「鎌ヶ谷市」と「鎌ケ谷市」）。
 * 利用者の言い方の頭の都道府県（「東京都港区」「神奈川県横浜市」）は切り分けて、都道府県の条件として使う。
 */

import { PREFECTURES } from '@/shared/constants'

/** 照合の鍵（駅名・市区町村名・都道府県名に共通）。 */
export function placeKey(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[ヶヵ]/g, 'ケ')
}

/**
 * 利用者の駅名の鍵の候補（末尾の「駅」を除いた形を先に）。「東京駅」→「東京」・「東京駅」の順で引く。
 * 名前に「駅」を含む停留場（路面電車の「富山駅」）は、除いた形で当たらなかったときに当たる。
 */
export function stationKeys(text: string): string[] {
  const key = placeKey(text)
  const stripped = key.endsWith('駅') && key.length > 1 ? key.slice(0, -1) : key
  return stripped === key ? [key] : [stripped, key]
}

const PREFECTURE_NAMES: readonly string[] = PREFECTURES.map((prefecture) => prefecture.name)

/** 都道府県の名前か、末尾の「都・道・府・県」を省いた言い方（「東京」「神奈川」）なら、その都道府県。 */
export function prefectureNamed(text: string): string | null {
  const key = placeKey(text)
  return PREFECTURE_NAMES.find((name) => name === key || name.slice(0, -1) === key) ?? null
}

/** 頭の都道府県を切り分ける（「東京都港区」→ 東京都・港区）。都道府県だけの言い方は切り分けない。 */
export function splitPrefecture(text: string): {
  readonly prefecture: string | null
  readonly rest: string
} {
  const key = placeKey(text)
  const prefecture = PREFECTURE_NAMES.find(
    (name) => key.startsWith(name) && key.length > name.length,
  )
  return prefecture === undefined
    ? { prefecture: null, rest: key }
    : { prefecture, rest: key.slice(prefecture.length) }
}
