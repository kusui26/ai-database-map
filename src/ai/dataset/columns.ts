/**
 * build_dataset の列解決（純関数・`docs/260828_research_claude_auth.md` §5.3 PR-5）。
 *
 * metrics（カタログキーまたはファミリ）＋ radiusM / years から、CSV に出す列を
 * **カタログだけを参照して**決定的に確定する。生 SQL をエージェントに書かせない（§5.5）
 * 代わりに、ここが「カタログで検証された語彙」への唯一の入口になる。
 *
 * - ファミリの確定は `resolveMetricKey`（ランキング・散布と同じ解決器）——**言うことを割らない**
 * - years を並べるとファミリ×各年で列が増える（例 pop × [2015, 2020] → 2 列）
 * - 値列の信頼性フラグ（reliabilityFlagKey / noticeFlagKey）は**自動で同伴**する
 *   （§5.4-4「欠損とフラグを黙って使わない」を CSV の形で強制する）
 */

import { getEntry, type CatalogEntry } from '@/shared/catalog'
import { resolveMetricKey, suggestMetricKeys } from '@/ai/metric-resolver'

/** 値列の上限（駅 2,000 × 列 60 目安・§5.3）。自動で付くフラグ列は数えない。 */
export const DATASET_MAX_VALUE_COLUMNS = 60

export type DatasetColumnRole = 'value' | 'flag'

/** CSV の 1 列（カタログ由来の意味を運ぶ。meta.json にもこのまま出る）。 */
export type DatasetColumn = {
  readonly key: string
  readonly role: DatasetColumnRole
  readonly labelJa: string
  readonly unit: CatalogEntry['unit']
  readonly kind: CatalogEntry['kind']
  readonly category: CatalogEntry['category']
  readonly radiusM: number | null
  readonly year: number | null
  readonly yearBase: number | null
  readonly vintage: number | null
  /** この列（値列）の除外用フラグ列 key。フラグ列自身では null。 */
  readonly reliabilityFlagKey: string | null
  readonly source: string
  readonly license: string
}

export type DatasetColumnsOk = {
  readonly ok: true
  readonly columns: readonly DatasetColumn[]
  readonly valueKeys: readonly string[]
  readonly flagKeys: readonly string[]
  /** 既定で埋めた事実（半径・年など）。応答の notes に載せて可視化する。 */
  readonly notes: readonly string[]
}

export type DatasetColumnsError = {
  readonly ok: false
  readonly error: string
  readonly hint: string
  readonly didYouMean: readonly string[]
}

export type DatasetColumnsResult = DatasetColumnsOk | DatasetColumnsError

function toColumn(entry: CatalogEntry, role: DatasetColumnRole): DatasetColumn {
  return {
    key: entry.key,
    role,
    labelJa: entry.labelJa,
    unit: entry.unit,
    kind: entry.kind,
    category: entry.category,
    radiusM: entry.radiusM,
    year: entry.year,
    yearBase: entry.yearBase,
    vintage: entry.vintage,
    reliabilityFlagKey: role === 'value' ? entry.reliabilityFlagKey : null,
    source: entry.source,
    license: entry.license,
  }
}

type ResolvedItem = {
  readonly ok: true
  readonly keys: readonly string[]
  readonly notes: readonly string[]
}

/** 1 指定（キーまたはファミリ）→ カタログキー列。フラグ列の直接指定は誤用として弾く。 */
function resolveOne(
  item: string,
  radiusM: number | undefined,
  years: readonly number[],
): ResolvedItem | DatasetColumnsError {
  const exact = getEntry(item)
  if (exact !== undefined && exact.kind === 'flag') {
    return {
      ok: false,
      error: `フラグ列は直接指定できません: ${item}`,
      hint: '信頼性フラグ列は値列に自動で同伴します。値の指標（水準・増減率）だけを指定してください。',
      didYouMean: suggestMetricKeys(exact.baseMetric),
    }
  }
  if (exact !== undefined) return { ok: true, keys: [exact.key], notes: [] }
  if (years.length > 0) {
    const keys: string[] = []
    const notes: string[] = []
    for (const year of years) {
      const resolution = resolveMetricKey({ metric: item, radiusM, year })
      if (!resolution.ok) {
        return {
          ok: false,
          error: `${resolution.error}（${item} × ${year}年）`,
          hint: resolution.hint,
          didYouMean: resolution.didYouMean,
        }
      }
      keys.push(resolution.key)
      if (resolution.note !== null) notes.push(`${item}: ${resolution.note}`)
    }
    return { ok: true, keys, notes }
  }
  const resolution = resolveMetricKey({ metric: item, radiusM })
  if (!resolution.ok) {
    return {
      ok: false,
      error: resolution.error,
      hint: resolution.hint,
      didYouMean: resolution.didYouMean,
    }
  }
  return {
    ok: true,
    keys: [resolution.key],
    notes: resolution.note === null ? [] : [`${item}: ${resolution.note}`],
  }
}

/** 値エントリに同伴させるフラグ列 key（除外用＋バッジ用・実在するものだけ）。 */
function flagKeysOf(entry: CatalogEntry): readonly string[] {
  const candidates = [entry.reliabilityFlagKey, entry.noticeFlagKey]
  return candidates.filter((key): key is string => key !== null && getEntry(key) !== undefined)
}

/**
 * metrics（キー／ファミリ混在可）→ CSV 列の確定。
 *
 * ①完全一致キーはそのまま（フラグ列の直接指定だけ弾く）。②ファミリは resolveMetricKey で
 * 確定し、years 配列なら年ごとに展開。③重複は落とし、値列が上限を超えたら確定させない。
 * ④値列の信頼性フラグ列を末尾に自動で付ける。
 */
export function resolveDatasetColumns(
  metrics: readonly string[],
  radiusM: number | undefined,
  years: 'latest' | readonly number[] | undefined,
): DatasetColumnsResult {
  const items = metrics.map((item) => item.trim()).filter((item) => item.length > 0)
  if (items.length === 0) {
    return {
      ok: false,
      error: '指標が指定されていません',
      hint: 'metrics にカタログキー（例 pop_2020_1km）または指標ファミリ（例 pop, lp_med）を指定してください。',
      didYouMean: [],
    }
  }
  const yearList = years === undefined || years === 'latest' ? [] : [...new Set(years)]

  const valueKeys: string[] = []
  const notes: string[] = []
  for (const item of items) {
    const resolved = resolveOne(item, radiusM, yearList)
    if (!resolved.ok) return resolved
    for (const key of resolved.keys) {
      if (!valueKeys.includes(key)) valueKeys.push(key)
    }
    for (const note of resolved.notes) {
      if (!notes.includes(note)) notes.push(note)
    }
  }
  if (valueKeys.length > DATASET_MAX_VALUE_COLUMNS) {
    return {
      ok: false,
      error: `列が多すぎます: ${valueKeys.length} 列（上限 ${DATASET_MAX_VALUE_COLUMNS}）`,
      hint: 'metrics か years を絞ってください（データセットを分割して複数回呼んでもよい）。',
      didYouMean: [],
    }
  }

  const valueEntries = valueKeys
    .map((key) => getEntry(key))
    .filter((entry): entry is CatalogEntry => entry !== undefined)
  const flagKeys: string[] = []
  for (const entry of valueEntries) {
    for (const key of flagKeysOf(entry)) {
      if (!flagKeys.includes(key)) flagKeys.push(key)
    }
  }
  const flagEntries = flagKeys
    .map((key) => getEntry(key))
    .filter((entry): entry is CatalogEntry => entry !== undefined)
  return {
    ok: true,
    columns: [
      ...valueEntries.map((entry) => toColumn(entry, 'value')),
      ...flagEntries.map((entry) => toColumn(entry, 'flag')),
    ],
    valueKeys,
    flagKeys,
    notes,
  }
}

export type ColumnsFromKeysResult =
  | { readonly ok: true; readonly columns: readonly DatasetColumn[] }
  | { readonly ok: false; readonly missing: readonly string[] }

/**
 * 確定済みキー列 → 列メタ（`/api/dataset` が署名トークンから再構成する）。
 * role はカタログの kind から導く（flag はフラグ列・それ以外は値列）。
 * カタログ更新でキーが消えていたら missing を返す（黙って欠けさせない）。
 */
export function columnsFromKeys(keys: readonly string[]): ColumnsFromKeysResult {
  const missing = keys.filter((key) => getEntry(key) === undefined)
  if (missing.length > 0) return { ok: false, missing }
  const columns = keys.flatMap((key) => {
    const entry = getEntry(key)
    if (entry === undefined) return []
    return [toColumn(entry, entry.kind === 'flag' ? 'flag' : 'value')]
  })
  return { ok: true, columns }
}
