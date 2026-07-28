/**
 * 指標キーの解決（Step2・純関数・カタログのみを参照）。
 *
 * LLM は「正確なキー文字列」を作るのが苦手で、`pop_gr_2015_2020_2km`（年の順が逆）・
 * `pop_gr_2km`（年ペアなし）・`bus_gr_2000m`（半径表記ゆれ）のような**近いが無効なキー**を
 * 作りがちだった。従来はその都度エラー → `getMetricsCatalog` 照会 → 再試行、という
 * LLM の往復が積み上がり、散布 1 回で 4〜6 回のカタログ照会・所要 40s 超の原因になっていた
 * （計測は docs/260728_chat_scatter_plot_timeout_mitigation.md §2）。
 *
 * ここでは「ファミリ（baseMetric）＋半径＋年」から**サーバ側で決定的にキーを確定**する。
 * 曖昧さは既定値で埋め、埋めた事実は `note` で必ず可視化する（同 §8 の決定事項）。
 * 単一の真実はあくまでカタログで、ここは**カタログ内の候補を絞るだけ**（新しい意味を作らない）。
 */

import { getEntry, isRankableKey, rankableEntries, type CatalogEntry } from '@/shared/catalog'
import { RADII_M, radiusLabel } from '@/shared/constants'

/** 半径未指定時の既定（アプリ UI の既定と一致）。 */
const DEFAULT_RADIUS_M = 1000
/** 増減率の既定スパン（年）。終点は最新年、スパンはこれに最も近いものを選ぶ。 */
const PREFERRED_SPAN_YEARS = 5
/** ヒントに載せる候補の最大数。 */
const MAX_HINTS = 8

/** 指標の指定（正確なキー／ファミリ名のどちらでもよい）。 */
export type MetricSpec = {
  /** カタログキー（例 `pop_gr_2020_2015_2km`）または指標ファミリ（例 `pop_gr`）。 */
  readonly metric: string
  /** 集約半径（m）。km 表記（2）でも受け付ける。半径非依存の指標では無視する。 */
  readonly radiusM?: number
  /** 対象年（増減率では新しい方の年）。 */
  readonly year?: number
  /** 増減率の基準年（古い方の年）。 */
  readonly yearBase?: number
  /** 将来推計の推計時点（2024=R6 / 2018=H30）。 */
  readonly vintage?: number
}

/** 解決結果（成功＝確定したキー＋補正の説明／失敗＝理由と候補）。 */
export type MetricResolution =
  | { readonly ok: true; readonly key: string; readonly note: string | null }
  | {
      readonly ok: false
      readonly error: string
      readonly hint: string
      readonly didYouMean: readonly string[]
    }

/** 失敗（LLM が次に取るべき行動を hint で示す）。 */
function failure(error: string, hint: string, didYouMean: readonly string[]): MetricResolution {
  return { ok: false, error, hint, didYouMean: didYouMean.slice(0, MAX_HINTS) }
}

/** カタログに実在する rankable な baseMetric（長い順＝最長一致で使う）。 */
function knownBases(): readonly string[] {
  const bases = new Set(rankableEntries.map((entry) => entry.baseMetric))
  return [...bases].sort((a, b) => b.length - a.length)
}

/**
 * 指標キーの推定候補（解決に失敗したとき、近いファミリの実在キーを返す）。
 * 「未知のキー」で行き止まりにせず、LLM が次の一手を選べるようにする。
 */
export function suggestMetricKeys(bad: string): string[] {
  const prefix = bad.trim().toLowerCase().split('_')[0] ?? bad.trim().toLowerCase()
  if (prefix.length === 0) return []
  return rankableEntries
    .filter((entry) => entry.baseMetric.toLowerCase().startsWith(prefix))
    .map((entry) => entry.key)
    .slice(0, MAX_HINTS)
}

/** 末尾の半径トークン（`_2km` / `_500m`）を m に直す。 */
function parseRadiusToken(lowered: string): number | null {
  const match = lowered.match(/(?:^|_)(\d+)(km|m)$/)
  if (match === null) return null
  const value = Number(match[1])
  return match[2] === 'km' ? value * 1000 : value
}

/** 数値の半径を正規化（`2` のような km 表記も受ける）。未知の値はそのまま返し後段で丸める。 */
function normalizeRadius(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null
  if (RADII_M.some((radius) => radius === value)) return value
  const asKm = RADII_M.find((radius) => radius === value * 1000)
  return asKm ?? value
}

type ParsedToken = {
  readonly baseMetric: string | null
  readonly years: readonly number[]
  readonly radiusM: number | null
}

/** キー文字列を「ファミリ・年・半径」に分解する（表記ゆれの吸収はここ）。 */
function parseMetricToken(text: string): ParsedToken {
  const lowered = text.trim().toLowerCase()
  const baseMetric =
    knownBases().find((base) => lowered === base || lowered.startsWith(`${base}_`)) ?? null
  // 半径トークン（`_2000m` 等）の数字を年と取り違えないよう、先に切り離す。
  const withoutRadius = lowered.replace(/(?:^|_)\d+(?:km|m)$/, '')
  const years = [...withoutRadius.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].flatMap((match) => {
    const year = Number(match[1])
    return Number.isFinite(year) ? [year] : []
  })
  return { baseMetric, years, radiusM: parseRadiusToken(lowered) }
}

/**
 * 年の指定で候補を絞る（2 つなら年ペア・順不同／1 つなら終点年として扱い、
 * 該当が無ければ基準年としても探す）。
 */
function filterByYears(
  entries: readonly CatalogEntry[],
  years: readonly number[],
): readonly CatalogEntry[] {
  if (years.length === 0) return entries
  const newest = Math.max(...years)
  if (years.length === 1) {
    const asEnd = entries.filter((entry) => entry.year === newest)
    return asEnd.length > 0 ? asEnd : entries.filter((entry) => entry.yearBase === newest)
  }
  const oldest = Math.min(...years)
  return entries.filter((entry) => entry.year === newest && entry.yearBase === oldest)
}

type Narrowed = { readonly entries: readonly CatalogEntry[]; readonly note: string | null }

/** 推計時点（vintage）を絞る（未指定なら最新の推計＝R6 を既定に）。 */
function pickVintage(entries: readonly CatalogEntry[], requested: number | undefined): Narrowed {
  const vintages = [
    ...new Set(entries.flatMap((entry) => (entry.vintage === null ? [] : [entry.vintage]))),
  ]
  if (vintages.length === 0) return { entries, note: null }
  if (requested !== undefined && vintages.includes(requested)) {
    return { entries: entries.filter((entry) => entry.vintage === requested), note: null }
  }
  const newest = Math.max(...vintages)
  const note = vintages.length > 1 ? `${newest}年推計（既定）` : null
  return { entries: entries.filter((entry) => entry.vintage === newest), note }
}

/** 利用可能な半径（昇順・重複なし）。 */
function availableRadii(entries: readonly CatalogEntry[]): readonly number[] {
  const radii = new Set(entries.flatMap((entry) => (entry.radiusM === null ? [] : [entry.radiusM])))
  return [...radii].sort((a, b) => a - b)
}

/** 集約半径を絞る（未指定は 1km／非対応は最も近い半径へ丸め／半径非依存では無視）。 */
function pickRadius(entries: readonly CatalogEntry[], requested: number | null): Narrowed {
  const available = availableRadii(entries)
  const first = available[0]
  if (first === undefined) {
    const note = requested === null ? null : 'この指標は半径に依存しないため半径指定は無視しました'
    return { entries, note }
  }
  const target = requested ?? DEFAULT_RADIUS_M
  if (available.includes(target)) {
    const note = requested === null ? `半径${radiusLabel(target)}（既定）` : null
    return { entries: entries.filter((entry) => entry.radiusM === target), note }
  }
  const nearest = available.reduce(
    (best, radius) => (Math.abs(radius - target) < Math.abs(best - target) ? radius : best),
    first,
  )
  return {
    entries: entries.filter((entry) => entry.radiusM === nearest),
    note: `半径${radiusLabel(target)}は非対応のため${radiusLabel(nearest)}で集計`,
  }
}

/**
 * 年の既定を決める。
 * 増減率（年ペアあり）＝**スパンが 5 年に最も近いもの**（同点なら終点が新しい方）。
 * 水準（年ペアなし）＝**最新年**。docs/260728_chat_scatter_plot_timeout_mitigation.md §8 の決定。
 */
function pickYearPair(entries: readonly CatalogEntry[]): Narrowed {
  const spans = entries.filter((entry) => entry.year !== null && entry.yearBase !== null)
  const head = spans[0]
  if (head !== undefined) {
    const best = spans.reduce((left, right) => preferredSpan(left, right), head)
    const note = entries.length > 1 ? `${best.yearBase}→${best.year}年（既定）` : null
    return { entries: [best], note }
  }
  const years = entries.flatMap((entry) => (entry.year === null ? [] : [entry.year]))
  if (years.length === 0) return { entries, note: null }
  const newest = Math.max(...years)
  const latest = entries.filter((entry) => entry.year === newest)
  return { entries: latest, note: latest.length === entries.length ? null : `${newest}年（既定）` }
}

/** 年ペアの優先度比較（5 年に近い方／同点なら終点が新しい方）。 */
function preferredSpan(left: CatalogEntry, right: CatalogEntry): CatalogEntry {
  const distance = (entry: CatalogEntry): number =>
    Math.abs((entry.year ?? 0) - (entry.yearBase ?? 0) - PREFERRED_SPAN_YEARS)
  const diff = distance(right) - distance(left)
  if (diff !== 0) return diff < 0 ? right : left
  return (right.year ?? 0) > (left.year ?? 0) ? right : left
}

/** 完全一致キーに対して、無視した明示指定があれば注記する。 */
function ignoredSpecNote(entry: CatalogEntry, spec: MetricSpec): string | null {
  const radius = normalizeRadius(spec.radiusM)
  if (radius === null || entry.radiusM === null || entry.radiusM === radius) return null
  return `指定キーを優先し半径${radiusLabel(entry.radiusM)}で集計（指定の${radiusLabel(radius)}は未使用）`
}

/** 年ペアの一覧（エラー時のヒント用）。 */
function yearHints(entries: readonly CatalogEntry[]): string {
  const pairs = new Set(
    entries.map((entry) =>
      entry.yearBase === null ? `${entry.year}` : `${entry.yearBase}→${entry.year}`,
    ),
  )
  return [...pairs].slice(0, MAX_HINTS).join('・')
}

/**
 * 指標指定 → カタログキーを決定的に解決する。
 *
 * ①完全一致キーはそのまま採用（明示指定と食い違う場合はキーを優先し注記）。
 * ②ファミリ名・表記ゆれ・年ペアの順序違いは正規化して解決し、埋めた既定は note に残す。
 * ③ファミリ不明・ランキング不可・存在しない年の明示・絞り切れない場合は**確定させず**
 *   エラー＋候補を返す（誤った指標を黙って出さない）。
 */
export function resolveMetricKey(spec: MetricSpec): MetricResolution {
  const raw = spec.metric.trim()
  if (raw.length === 0) {
    return failure('指標が指定されていません', 'category / baseMetric を指定してください', [])
  }
  if (isRankableKey(raw)) {
    const entry = getEntry(raw)
    return { ok: true, key: raw, note: entry === undefined ? null : ignoredSpecNote(entry, spec) }
  }
  const existing = getEntry(raw)
  if (existing !== undefined && !existing.rankable) {
    return failure(
      `ランキング・散布に使えない指標です: ${raw}`,
      'フラグや秘匿割合などは対象外です。水準・増減率の指標を指定してください。',
      suggestMetricKeys(existing.baseMetric),
    )
  }
  const parsed = parseMetricToken(raw)
  if (parsed.baseMetric === null) {
    return failure(
      `未知の指標です: ${raw}`,
      'getMetricsCatalog で category / baseMetric を確認してください。',
      suggestMetricKeys(raw),
    )
  }
  const family = rankableEntries.filter((entry) => entry.baseMetric === parsed.baseMetric)
  const years =
    spec.year === undefined && spec.yearBase === undefined
      ? parsed.years
      : [spec.year, spec.yearBase].flatMap((year) => (year === undefined ? [] : [year]))
  const byYear = filterByYears(family, years)
  if (byYear.length === 0) {
    return failure(
      `指定した年の指標がありません: ${raw}（${years.join('・')}）`,
      `利用できる年: ${yearHints(family)}`,
      family.slice(0, MAX_HINTS).map((entry) => entry.key),
    )
  }
  const vintage = pickVintage(byYear, spec.vintage)
  const radius = pickRadius(vintage.entries, normalizeRadius(spec.radiusM) ?? parsed.radiusM)
  const pair = pickYearPair(radius.entries)
  const resolved = pair.entries[0]
  if (resolved === undefined || pair.entries.length > 1) {
    return failure(
      `指標を一意に決められませんでした: ${raw}`,
      '年（year / yearBase）や半径（radiusM）を指定してください。',
      pair.entries.map((entry) => entry.key),
    )
  }
  const notes = [vintage.note, radius.note, pair.note].filter(
    (note): note is string => note !== null,
  )
  return { ok: true, key: resolved.key, note: notes.length > 0 ? notes.join('・') : null }
}

/** ファミリ名だけから既定のキーを得る（system-prompt の代表キー生成に使う）。 */
export function defaultKeyForBaseMetric(baseMetric: string): string | null {
  const resolution = resolveMetricKey({ metric: baseMetric })
  return resolution.ok ? resolution.key : null
}
