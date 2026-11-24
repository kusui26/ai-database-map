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
 * 将来推計の既定の年だけは、エリアの要約が先に言う年（`FUTURE_LEAD_YEAR`）にそろえる（同 §10.8）。
 */

import { getEntry, isRankableKey, rankableEntries, type CatalogEntry } from '@/shared/catalog'
import { RADII_M, radiusLabel } from '@/shared/constants'
import { FUTURE_LEAD_YEAR } from '@/domain/area-summary/totals'
import { baseMetricLabel } from '@/domain/metrics'

/** 半径未指定時の既定（アプリ UI の既定と一致）。 */
const DEFAULT_RADIUS_M = 1000
/** 増減率の既定スパン（年）。終点は最新年、スパンはこれに最も近いものを選ぶ（将来推計は除く）。 */
const PREFERRED_SPAN_YEARS = 5
/** ヒントに載せる候補の最大数。 */
const MAX_HINTS = 8
/**
 * ファミリ名のあとに続いてよい語（年・半径・推計の時点・空）。これ以外が続く指定は**別の指標の書き間違い**で、
 * 黙って前方のファミリに解かない（`pop_15_64_2020_1km` を総数の `pop_2020_1km` にしない・計画書 261122 §7.2）。
 */
const PERIOD_TOKEN = /^(?:(?:19|20)\d{2}(?:年度?)?|\d+(?:km|m)|r6|h30)?$/
/**
 * 日本語（ひらがな・カタカナ・漢字）の指定。ファミリの日本語名で解く（同 §7.2）。英字を含む指定（`pop_2020年`）は
 * キーの書き方として今までどおり解く。
 */
const JAPANESE = /[぀-ヿ㐀-鿿]/
const LATIN_LETTER = /[a-z]/i
/** ふだんの言葉 → ファミリ（日本語名に無い言い方）。候補を返すだけで、解決はしない（あいまいなので）。 */
const EVERYDAY_WORDS: Readonly<Record<string, readonly string[]>> = {
  高齢者: ['pop65_share', 'pop65_gr_pred', 'pop65_share_pred', 'pop75_share'],
  働く世代: ['pop15_64', 'pop15_64_share', 'pop15_64_gr', 'pop15_64_gr_pred'],
  現役世代: ['pop15_64', 'pop15_64_share', 'pop15_64_gr', 'pop15_64_gr_pred'],
  子ども: ['pop0_14_share'],
  子供: ['pop0_14_share'],
}

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

/** ファミリ名のあとが年・半径・推計の時点だけか（`pop_15_64_2020_1km` は `pop` のあとに「15」「64」が続く）。 */
function onlyPeriodAfter(lowered: string, base: string): boolean {
  if (lowered === base) return true
  return lowered
    .slice(base.length + 1)
    .split('_')
    .every((token) => PERIOD_TOKEN.test(token))
}

/** 書き間違いに近いファミリ（下線を除いて前方が一致するもの・長い順＝`pop_15_64…` なら pop15_64 が先）。 */
function familiesLike(lowered: string): string[] {
  const compact = (text: string): string => text.replace(/_/g, '')
  return knownBases().filter((base) => compact(lowered).startsWith(compact(base)))
}

/** 同じカテゴリのファミリ（カタログの並び）。`pop_young` の候補に、総数のほか年齢のファミリも並べるため。 */
function familiesInCategoryOf(base: string): string[] {
  const category = rankableEntries.find((entry) => entry.baseMetric === base)?.category
  const inCategory = rankableEntries.filter((entry) => entry.category === category)
  return [...new Set(inCategory.map((entry) => entry.baseMetric))]
}

/** 候補の見せ方（`pop65_share（高齢化率（65歳以上の割合））`）。 */
function withLabels(bases: readonly string[]): string {
  return bases.map((base) => `${base}（${baseMetricLabel(base)}）`).join('、')
}

/** ファミリ名のあとに年・半径でない語が続く指定（`pop_young`）：解かずに、前方の一致と同じカテゴリのファミリを返す。 */
function unknownAfterFamily(raw: string, base: string): MetricResolution {
  const near = [...new Set([...familiesLike(raw.toLowerCase()), ...familiesInCategoryOf(base)])]
  return failure(
    `未知の指標です: ${raw}（${base} のあとに年・半径でない語があります）`,
    `近い指標ファミリ: ${withLabels(near.slice(0, MAX_HINTS))}。` +
      'metric にはファミリ名かカタログのキーを指定してください。',
    near,
  )
}

/** 日本語の名前を比べやすい形に（全角と半角・空白・波ダッシュの字形をそろえる）。 */
function normalizeName(text: string): string {
  return text.normalize('NFKC').replace(/\s/g, '').replace(/〜/g, '~')
}

/** ファミリの日本語名の全体と、括弧の前（`高齢化率（65歳以上の割合）` → `高齢化率`）。 */
function nameForms(base: string): { readonly whole: string; readonly head: string } {
  const whole = normalizeName(baseMetricLabel(base))
  return { whole, head: whole.split('(')[0] ?? whole }
}

/** 日本語名（全体 → 括弧の前の順）が同じファミリ。1 つに決まらなければ null。 */
function familyNamed(text: string): string | null {
  const wanted = normalizeName(text)
  for (const form of ['whole', 'head'] as const) {
    const hits = knownBases().filter((base) => nameForms(base)[form] === wanted)
    if (hits.length === 1) return hits[0] ?? null
    if (hits.length > 1) return null
  }
  return null
}

/** 語の字が、名前の中に同じ順で現れるか（「将来人口」は「将来推計人口」に現れる）。 */
function appearsInOrder(word: string, name: string): boolean {
  const rest = [...word].reduce<string | null>((remaining, char) => {
    if (remaining === null) return null
    const at = remaining.indexOf(char)
    return at < 0 ? null : remaining.slice(at + char.length)
  }, name)
  return rest !== null
}

/**
 * 日本語の名前に近いファミリ。近い順に：ふだんの言葉 → 日本語名がその語を含む → 語の字が日本語名に同じ順で現れる →
 * 語が日本語名（括弧の前）を含む（長い名前から＝「2050年の生産年齢人口」なら生産年齢人口が人口より先）。
 */
function familiesNamedLike(text: string): string[] {
  const wanted = normalizeName(text)
  const bases = [...new Set(rankableEntries.map((entry) => entry.baseMetric))]
  const byWord = Object.entries(EVERYDAY_WORDS).flatMap(([word, list]) =>
    wanted.includes(normalizeName(word)) ? list : [],
  )
  const containing = bases.filter((base) => nameForms(base).whole.includes(wanted))
  const inOrder = bases.filter((base) => appearsInOrder(wanted, nameForms(base).whole))
  const contained = bases
    .filter((base) => wanted.includes(nameForms(base).head))
    .sort((a, b) => nameForms(b).head.length - nameForms(a).head.length)
  return [...new Set([...byWord, ...containing, ...inOrder, ...contained])]
}

/** 日本語の指定（「高齢化率」）：日本語名が 1 つに決まればそのファミリで解き、決まらなければ近いファミリを候補に返す。 */
function resolveJapanese(raw: string, spec: MetricSpec): MetricResolution {
  const family = familyNamed(raw)
  if (family !== null) {
    const resolution = resolveMetricKey({ ...spec, metric: family })
    if (!resolution.ok) return resolution
    const named = `「${raw}」＝${family}`
    return {
      ok: true,
      key: resolution.key,
      note: resolution.note === null ? named : `${named}・${resolution.note}`,
    }
  }
  const candidates = familiesNamedLike(raw)
  const hint =
    candidates.length > 0
      ? `日本語名の近い指標ファミリ: ${withLabels(candidates.slice(0, MAX_HINTS))}。metric にはファミリ名を指定してください。`
      : 'getMetricsCatalog で category / baseMetric を確認してください。'
  return failure(`未知の指標です: ${raw}`, hint, candidates)
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
 * ただし将来推計の増減率は**終点が 2050 年のもの**（`projectionLead`）。
 * 水準（年ペアなし）＝**最新年**。docs/260728_chat_scatter_plot_timeout_mitigation.md §8 の決定（§10.8 で推計だけ変更）。
 */
function pickYearPair(entries: readonly CatalogEntry[]): Narrowed {
  const spans = entries.filter((entry) => entry.year !== null && entry.yearBase !== null)
  const head = spans[0]
  if (head !== undefined) {
    const best =
      projectionLead(spans) ?? spans.reduce((left, right) => preferredSpan(left, right), head)
    const note = entries.length > 1 ? `${best.yearBase}→${best.year}年（既定）` : null
    return { entries: [best], note }
  }
  const years = entries.flatMap((entry) => (entry.year === null ? [] : [entry.year]))
  if (years.length === 0) return { entries, note: null }
  const newest = Math.max(...years)
  const latest = entries.filter((entry) => entry.year === newest)
  return { entries: latest, note: latest.length === entries.length ? null : `${newest}年（既定）` }
}

/**
 * 将来推計（推計時点を持つ）の増減率の既定＝終点がエリアの要約と同じ 2050 年のもの。推計でない・2050 年が無いときは
 * undefined（5 年の規則に倒す）。年を指定されたら、その年の候補しか来ないので指定が勝つ（2040 年なら 2040 年）。
 *
 * 5 年の規則を推計にも当てると 2020→2025 年——推計の起点のすぐ先（もう過ぎた年）で、「将来も人口が増える駅」の
 * 答えにならない。モデルは「将来」「2050年に向けて」と聞かれても年を付けないことが多い（2026-11-14 のデモの下見で、
 * 本番が将来推計で並べた 7 回のうち 5 回が 2020→2025 年。入力を記録すると 16 回中 14 回が year なし）。
 */
function projectionLead(spans: readonly CatalogEntry[]): CatalogEntry | undefined {
  return spans.find((entry) => entry.vintage !== null && entry.year === FUTURE_LEAD_YEAR)
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
 *   日本語の名前（「高齢化率」）は、ファミリの日本語名と同じなら、そのファミリとして解く（2026-11-24）。
 * ③ファミリ不明・ランキング不可・存在しない年の明示・絞り切れない場合は**確定させず**
 *   エラー＋候補を返す（誤った指標を黙って出さない）。ファミリ名のあとに年・半径でない語が続く指定
 *   （`pop_15_64_2020_1km`）も、前方のファミリ（総数の `pop`）に黙って解かない（2026-11-24）。
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
  if (JAPANESE.test(raw) && !LATIN_LETTER.test(raw)) return resolveJapanese(raw, spec)
  const parsed = parseMetricToken(raw)
  if (parsed.baseMetric === null) {
    return failure(
      `未知の指標です: ${raw}`,
      'getMetricsCatalog で category / baseMetric を確認してください。',
      suggestMetricKeys(raw),
    )
  }
  if (!onlyPeriodAfter(raw.toLowerCase(), parsed.baseMetric)) {
    return unknownAfterFamily(raw, parsed.baseMetric)
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
