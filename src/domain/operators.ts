/**
 * ドメイン：運営会社の表示名（2026-10-08 L4・`docs/261001_fix_user_feedback_ui.md` §6.8.7）。
 *
 * 会社の**鍵**は国土数値情報（S12）の会社名（「東日本旅客鉄道」「東京地下鉄」「東京都」）のまま——条件・URL・SQL は
 * これで動く。**人に見せる名前**は駅データ.jp の事業者名（「JR東日本」「東京メトロ」「東京都交通局」「Osaka Metro」）にする。
 * 都営が「東京都」だと、図の題「（全国・東京都・上位）」が都道府県と紛れる。
 *
 * 対応は路線の一覧（`lines.operator` → `lines.company_name`）から作る（L1 の対応表・古い社名は L1 の直しの表で直してある）。
 * 路線の無い会社（ケーブルカーなど・駅データ.jp に無い）は S12 の名前のまま。言い方はサーバが決め、画面と AI が同じ名前を使う。
 */

import { lineNames, type LineRow, type OperatorRow } from '@/db/queries'
import { type OperatorsResponse } from '@/shared/api'

/** 表示名を作るのに要る路線の列。 */
export type OperatorLabelSource = Pick<LineRow, 'operator' | 'companyName' | 'stationCount'>

/** S12 の会社名 → 表示名。 */
export type OperatorLabels = ReadonlyMap<string, string>

/**
 * 路線の一覧 → 会社の表示名。1 つの会社に事業者名が 2 つ以上あるときは、駅の多いほう（決まった結果にする）。
 * 線路の持ち主の路線（会社が無い神戸高速）は数えない。
 */
export function operatorLabelMap(lines: readonly OperatorLabelSource[]): OperatorLabels {
  const counts = lines.reduce((acc, line) => {
    if (line.operator === null) return acc
    const byName = acc.get(line.operator) ?? new Map<string, number>()
    byName.set(line.companyName, (byName.get(line.companyName) ?? 0) + line.stationCount)
    return acc.set(line.operator, byName)
  }, new Map<string, Map<string, number>>())
  const entries = [...counts.entries()].map(([operator, byName]): [string, string] => {
    const [best] = [...byName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return [operator, best?.[0] ?? operator]
  })
  return new Map(entries)
}

/** 表示名（対応が無ければ S12 の名前のまま）。 */
export function operatorLabelOf(name: string, labels: OperatorLabels): string {
  return labels.get(name) ?? name
}

/** 会社の一覧の応答（鍵の `name` と、表示名の `label`）。 */
export function operatorsResponse(
  rows: readonly OperatorRow[],
  labels: OperatorLabels,
): OperatorsResponse {
  return {
    operators: rows.map((row) => ({
      name: row.name,
      label: operatorLabelOf(row.name, labels),
      stationCount: row.stationCount,
      prefectures: [...row.prefectures],
    })),
  }
}

/** 表示名の対応をサーバの中で持つ時間（路線の一覧はデータの更新でしか変わらない）。 */
const LABELS_TTL_MS = 60 * 60 * 1000

type CacheEntry = { readonly loadedAt_ms: number; readonly labels: Promise<OperatorLabels> }

const cache: { entry: CacheEntry | null } = { entry: null }

/** 表示名の対応（1 時間持つ。読めなかったときは持たない＝次の呼び出しで読み直す）。 */
export function loadOperatorLabels(now_ms: number = Date.now()): Promise<OperatorLabels> {
  const entry = cache.entry
  if (entry !== null && now_ms - entry.loadedAt_ms < LABELS_TTL_MS) return entry.labels
  const labels = lineNames().then(operatorLabelMap)
  cache.entry = { loadedAt_ms: now_ms, labels }
  labels.catch(() => {
    if (cache.entry?.labels === labels) cache.entry = null
  })
  return labels
}

/** 会社名（S12）の並び → 表示名の並び（同じ順）。指定が無ければ一覧も読まない。 */
export async function labelsOfOperators(names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return []
  const labels = await loadOperatorLabels()
  return names.map((name) => operatorLabelOf(name, labels))
}

/** キャッシュを捨てる（テストと、データを入れ替えたあとの読み直し）。 */
export function clearOperatorLabelCache(): void {
  cache.entry = null
}
