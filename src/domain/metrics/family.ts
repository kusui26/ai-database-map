/**
 * ドメイン：**指標ファミリ（`pop_gr`）→ その半径で使えるカタログのエントリ**（純関数）。
 *
 * おすすめ（`recommend/metrics.ts`）と駅周辺のプロフィール（`profile/items.ts`・2026-10-09 B4）が
 * 同じ規則で選ぶ。規則を 2 か所に持つと、同じ「将来人口」が画面ごとに別の年を指しうる。
 */

import { entries, type CatalogEntry } from '@/shared/catalog'
import { RADII_M, type RadiusM } from '@/shared/constants'

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

/** 選んだ半径に近い順の半径（段の数で近さを測る・同じ近さなら小さい方を先）。 */
export function radiiByCloseness(radiusM: RadiusM): readonly RadiusM[] {
  const at = RADII_M.indexOf(radiusM)
  return [...RADII_M].sort(
    (a, b) => Math.abs(RADII_M.indexOf(a) - at) - Math.abs(RADII_M.indexOf(b) - at) || a - b,
  )
}

/** ファミリをその半径で決めた結果（選んだ半径に無ければ、近い半径に替えた）。 */
export type FamilyAtRadius = {
  readonly entry: CatalogEntry
  /** 選んだ半径に無く、近い半径に替えた（`entry.radiusM` が使った半径）。 */
  readonly substituted: boolean
}

/**
 * ファミリ → 選んだ半径で使うエントリ（無ければ近い半径に替える。どの半径にも無ければ null）。
 * 駅周辺のプロフィール（B4）とエリア要約の駅の分布（B5b）が同じ規則で選ぶ——地価の中央値は 20km、
 * 地価の増減率は 500m・20km を持たないので、黙って落とさずに近い半径へ替え、替えたことを返す。
 */
export function resolveFamilyAtRadius(
  family: string,
  radiusM: RadiusM,
  spanYears?: number,
): FamilyAtRadius | null {
  const entry = radiiByCloseness(radiusM)
    .map((candidate) => familyCandidates(family, candidate, spanYears)[0])
    .find((each): each is CatalogEntry => each !== undefined)
  if (entry === undefined) return null
  return { entry, substituted: entry.radiusM !== null && entry.radiusM !== radiusM }
}
