/**
 * ドメイン：**指標ファミリ（`pop_gr`）→ その半径で使えるカタログのエントリ**（純関数）。
 *
 * おすすめ（`recommend/metrics.ts`）と駅周辺のプロフィール（`profile/items.ts`・2026-10-09 B4）が
 * 同じ規則で選ぶ。規則を 2 か所に持つと、同じ「将来人口」が画面ごとに別の年を指しうる。
 */

import { entries, type CatalogEntry } from '@/shared/catalog'

/** 年の新しい順。増減率は終点年（`year`）で比べる。 */
function newestFirst(a: CatalogEntry, b: CatalogEntry): number {
  return (b.year ?? 0) - (a.year ?? 0) || (b.yearBase ?? 0) - (a.yearBase ?? 0)
}

/** 増減率が見ている期間（年）。水準（`year` だけ）は null。 */
function spanOf(entry: CatalogEntry): number | null {
  return entry.year === null || entry.yearBase === null ? null : entry.year - entry.yearBase
}

/**
 * ファミリ名 → その半径で使えるエントリ（新しい年が先）。駅で決まる指標（乗降客数＝半径なし）も含む。
 *
 * 期間の指定があれば**まず期間で絞る**。「いちばん新しい」だけで選ぶと、
 * 将来人口（終点年が動く）は最も遠い年、地価トレンド（起点年が動く）は最も短い期間、と
 * **同じ規則が逆の意味になる**。期間を先に見れば、どちらも指定どおりになる。
 * 指定した期間が無ければ新しい順に倒す（呼び出し側が選んだ key を利用者に見せるので、黙って消えはしない）。
 */
export function familyCandidates(
  family: string,
  radiusM: number,
  spanYears?: number,
): readonly CatalogEntry[] {
  const all = entries
    .filter((entry) => entry.baseMetric === family && entry.kind !== 'flag')
    .filter((entry) => entry.radiusM === radiusM || entry.radiusM === null)
    .sort(newestFirst)
  if (spanYears === undefined) return all
  const matched = all.filter((entry) => spanOf(entry) === spanYears)
  return matched.length > 0 ? matched : all
}
