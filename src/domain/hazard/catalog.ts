/**
 * ドメイン：ハザード・レイヤカタログの問い合わせ（凡例・レイヤ選択・出典）。
 *
 * `shared/hazard`（カタログの単一の真実）を参照し、UI と AI が使う「レイヤの選び方・見せ方」を
 * 純関数で組み立てる。**意味づけは必ずここを通す**——凡例テキスト・出典・危険度の重さ比較を
 * UI に直書きすると、同じことを AI ができなくなる（.claude/CLAUDE.md §2）。
 *
 * 設計の正は `docs/260824_flood.md` §5.4・§7.1。
 */

import {
  getHazardLayer,
  hazardLayers,
  hazardLayersForGroup,
  type HazardLayer,
  type HazardRank,
} from '@/shared/hazard'
import {
  clampHazardOpacity,
  HAZARD_GROUPS,
  HAZARD_GROUP_LABELS_JA,
  HAZARD_LEVELS,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_LABELS_JA,
  HAZARD_TERRAIN_OPACITY_SCALE,
  hazardLevelWeight,
  type HazardGroup,
  type HazardLevel,
} from '@/shared/constants'

/** レイヤ制御の見出し 1 つ（グループ）。レイヤが 0 件のグループは UI に出さない。 */
export type HazardGroupView = {
  readonly group: HazardGroup
  readonly labelJa: string
  readonly layerKeys: readonly string[]
}

/** 凡例の 1 行（色見本＋ラベル＋意味）。色が未確定の階級は `color: null` のまま出す。 */
export type HazardLegendRow = {
  readonly order: number
  readonly labelJa: string
  readonly meaningJa: string
  readonly color: string | null
  /** 色の確からしさに注記が要るか（`measured`＝実測で対応に推定を含む）。 */
  readonly colorUncertain: boolean
  readonly level: HazardLevel
}

/**
 * 地点で当たった階級（**メッシュの原典コード由来**でも**タイルの画素由来**でも同じ形）。
 *
 * `min` / `max` を実単位（m・時間）で持つのが要点。判定（§6.2）は「コード 3 以上」ではなく
 * 「3m 以上」で書けるので、**情報源が変わっても同じルールで判断できる**——
 * メッシュは原典の 6 階級、タイルは詳細版の 8 階級と、階級の刻みが違うため。
 */
export type HazardPointRank = {
  readonly layerKey: string
  readonly labelJa: string
  readonly meaningJa: string
  readonly actionJa: string | null
  readonly level: HazardLevel
  readonly min: number | null
  readonly max: number | null
  /** 公式凡例の色（未確定は null）。 */
  readonly color: string | null
}

/** 危険度レベルの自己記述（API 応答・凡例バッジで共用）。 */
export type HazardLevelView = {
  readonly level: HazardLevel
  readonly labelJa: string
  readonly color: string
}

/** レイヤを持つグループだけを表示順に返す（レイヤ制御の骨格）。 */
export function hazardGroupViews(): readonly HazardGroupView[] {
  return HAZARD_GROUPS.map((group) => ({
    group,
    labelJa: HAZARD_GROUP_LABELS_JA[group],
    layerKeys: hazardLayersForGroup(group).map((layer) => layer.key),
  })).filter((view) => view.layerKeys.length > 0)
}

/** 危険度レベルの一覧（軽い順・ラベルと色つき）。 */
export function hazardLevelViews(): readonly HazardLevelView[] {
  return HAZARD_LEVELS.map((level) => ({
    level,
    labelJa: HAZARD_LEVEL_LABELS_JA[level],
    color: HAZARD_LEVEL_COLORS[level],
  }))
}

/** 階級 → 凡例の 1 行。 */
function legendRow(rank: HazardRank): HazardLegendRow {
  return {
    order: rank.order,
    labelJa: rank.labelJa,
    meaningJa: rank.meaningJa,
    color: rank.color,
    colorUncertain: rank.colorSource !== 'official',
    level: rank.level,
  }
}

/** レイヤの凡例（`order` 昇順＝軽い順）。階級を持たないレイヤは空配列。 */
export function hazardLegend(layer: HazardLayer): readonly HazardLegendRow[] {
  return [...layer.ranks].sort((a, b) => a.order - b.order).map(legendRow)
}

/** 凡例の 1 まとまり（1 レイヤぶん）。UI はこれを上から描くだけでよい。 */
export type HazardLegendSection = {
  readonly layerKey: string
  readonly labelJa: string
  readonly summaryJa: string
  /** 「2025年度」など。年度が無いレイヤは null。 */
  readonly vintageJa: string | null
  readonly sourceJa: string
  readonly coverageNoteJa: string | null
  readonly legendUrl: string | null
  readonly rows: readonly HazardLegendRow[]
  /** 地形グループか（ハザードと視覚的に分けるための印・§3.7）。 */
  readonly isTerrain: boolean
}

/**
 * 表示中レイヤの凡例（**描画順と同じ並び**＝地図で上に載っているものが下に来る）。
 * 年度・出典・網羅性の注記まで 1 まとまりにするので、UI がどれかを出し忘れられない（§7.5）。
 */
export function hazardLegendSections(layerKeys: readonly string[]): readonly HazardLegendSection[] {
  return hazardDrawOrder(layerKeys).flatMap((key) => {
    const layer = getHazardLayer(key)
    if (layer === undefined) return []
    return [
      {
        layerKey: layer.key,
        labelJa: layer.labelJa,
        summaryJa: layer.summaryJa,
        vintageJa: layer.vintage === null ? null : `${layer.vintage}年度`,
        sourceJa: layer.source,
        coverageNoteJa: layer.coverageNoteJa,
        legendUrl: layer.legendUrl,
        rows: hazardLegend(layer),
        isTerrain: layer.group === 'terrain',
      },
    ]
  })
}

/**
 * 入力のレイヤ key 列を、**実在するものだけ・重複なし・カタログ順**に正規化する。
 * `?hz=` の復元と API のホワイトリストで共用する（生 key のパススルーを禁止）。
 */
export function resolveHazardLayerKeys(input: readonly string[]): readonly string[] {
  const requested = new Set(input.filter((key) => getHazardLayer(key) !== undefined))
  return hazardLayers.filter((layer) => requested.has(layer.key)).map((layer) => layer.key)
}

/**
 * 表示中レイヤの出典表示（重複を畳んでカタログ順）。
 * 出典は「常時見える」ことが利用条件なので、レイヤを足せば自動で増える形にしておく。
 */
export function hazardAttributions(layerKeys: readonly string[]): readonly string[] {
  const resolved = resolveHazardLayerKeys(layerKeys)
  const seen = new Set<string>()
  return resolved.flatMap((key) => {
    const layer = getHazardLayer(key)
    if (layer === undefined || seen.has(layer.attribution)) return []
    seen.add(layer.attribution)
    return [layer.attribution]
  })
}

/** 危険度レベルのうち最も重いもの（空なら `none`）。地点の総合判定の土台。 */
export function heaviestHazardLevel(levels: readonly HazardLevel[]): HazardLevel {
  return levels.reduce<HazardLevel>(
    (worst, level) => (hazardLevelWeight(level) > hazardLevelWeight(worst) ? level : worst),
    'none',
  )
}

/**
 * レイヤの ON/OFF を 1 つ切り替えた結果を返す（純関数・UI もチャットもこれを通す）。
 *
 * 不変条件：**同じグループで `base` は同時に 1 つだけ**。面をベタ塗りするレイヤを重ねると
 * 色が混ざって読めなくなる（想定最大規模と計画規模を同時に出しても、どちらの色か分からない）。
 * `overlay`（家屋倒壊・土砂）は base の上に何枚でも載せてよい。
 */
export function toggleHazardLayer(current: readonly string[], key: string): readonly string[] {
  const target = getHazardLayer(key)
  if (target === undefined) return resolveHazardLayerKeys(current)
  if (current.includes(key)) return resolveHazardLayerKeys(current.filter((each) => each !== key))
  const kept = current.filter((each) => {
    if (target.display === 'overlay') return true
    const layer = getHazardLayer(each)
    return layer === undefined || layer.group !== target.group || layer.display !== 'base'
  })
  return resolveHazardLayerKeys([...kept, key])
}

/**
 * 描画順に並べ替える（`base` を先、`overlay` を後）。
 * 細い赤（家屋倒壊）や土砂の区域が、浸水深のベタ塗りに隠れないようにする。
 */
export function hazardDrawOrder(layerKeys: readonly string[]): readonly string[] {
  const resolved = resolveHazardLayerKeys(layerKeys)
  const isBase = (key: string): boolean => getHazardLayer(key)?.display === 'base'
  return [...resolved.filter(isBase), ...resolved.filter((key) => !isBase(key))]
}

/**
 * 配布メッシュに入っている**原典のコード値**（`sourceCode`）→ 意味。
 *
 * カタログの `ranks` は**タイルの凡例**（浸水深は詳細版 8 階級）を表すが、
 * ベクタの原典は 6 階級で来る。両者の橋渡しが `ranks[].sourceCode` で、
 * 同じコードを持つ階級を**束ねる**と、原典の階級そのもの（例 0.5〜3.0m 未満）に戻る。
 * 深さは束ねた範囲、危険度は**その中で最も重いもの**を採る（安全側）。
 */
export function hazardRankOfSourceCode(
  layerKey: string,
  sourceCode: number,
): HazardPointRank | null {
  const layer = getHazardLayer(layerKey)
  if (layer === undefined || sourceCode <= 0) return null
  const matched = layer.ranks.filter((rank) => rank.sourceCode === sourceCode)
  const first = matched[0]
  const last = matched[matched.length - 1]
  if (first === undefined || last === undefined) return null
  return {
    layerKey: layer.key,
    labelJa: rangeLabel(first.min, last.max, layer.rankUnit) ?? last.labelJa,
    meaningJa: last.meaningJa,
    actionJa: last.actionJa,
    level: heaviestHazardLevel(matched.map((rank) => rank.level)),
    min: first.min,
    max: last.max,
    color: last.color,
  }
}

/** 階級 1 つを地点の答えの形へ（タイルの画素・浸水ナビの実測から共用）。 */
function toPointRank(layerKey: string, rank: HazardRank): HazardPointRank {
  return {
    layerKey,
    labelJa: rank.labelJa,
    meaningJa: rank.meaningJa,
    actionJa: rank.actionJa,
    level: rank.level,
    min: rank.min,
    max: rank.max,
    color: rank.color,
  }
}

/**
 * **公式タイルの画素の色** → 階級（`docs/260824_flood.md` §6.3 の優先順位 ②）。
 *
 * 画面に描いてあるものと同じ答えになるので、「地図は白いのにカードは浸水域」が起きない。
 * 色は**完全一致だけ**を採る——中間色（境界の描画）を近い階級に丸めると、
 * 実測で 1 画素も無かった状況（§10.2 ③）を勝手に作ってしまう。
 */
export function hazardRankOfColor(layerKey: string, hex: string): HazardPointRank | null {
  const layer = getHazardLayer(layerKey)
  const matched = layer?.ranks.find((rank) => rank.color === hex)
  return layer === undefined || matched === undefined ? null : toPointRank(layer.key, matched)
}

/**
 * **浸水ナビの実測値（m）** → 階級（同 ①）。
 * 深さそのものが分かっているので、その値を含む階級を選ぶ（上限は開区間）。
 */
export function hazardRankOfDepth(layerKey: string, depthM: number): HazardPointRank | null {
  const layer = getHazardLayer(layerKey)
  if (layer === undefined || layer.rankUnit !== 'm' || !(depthM > 0)) return null
  const matched = layer.ranks.find(
    (rank) => (rank.min ?? 0) <= depthM && (rank.max === null || depthM < rank.max),
  )
  return matched === undefined ? null : toPointRank(layer.key, matched)
}

/** 点の答えを持ちうるレイヤ（タイルがあり、色つきの階級を持つもの）。 */
export function hazardLayersWithPointAnswer(): readonly string[] {
  return hazardLayers
    .filter((layer) => layer.tile !== null && layer.ranks.some((rank) => rank.color !== null))
    .map((layer) => layer.key)
}

/** 束ねた階級の表示ラベル（単位が無いレイヤは null＝元のラベルを使う）。 */
function rangeLabel(min: number | null, max: number | null, unit: string | null): string | null {
  if (unit === null || min === null) return null
  const suffix = unit === 'm' ? 'm' : '時間'
  return max === null ? `${min}${suffix} 以上` : `${min}〜${max}${suffix} 未満`
}

/**
 * そのレイヤに適用する不透明度。
 * 「参考：地形」は**ハザードではない**ので一段薄くして、背景の参考情報として読ませる（§3.7）。
 * 未知の key は素通し（描画側が無視するため、ここで例外にしない）。
 */
export function hazardOpacityFor(layerKey: string, opacity: number): number {
  const clamped = clampHazardOpacity(opacity)
  return getHazardLayer(layerKey)?.group === 'terrain'
    ? clamped * HAZARD_TERRAIN_OPACITY_SCALE
    : clamped
}

/**
 * 網羅性の注記が要るレイヤの key（`coverageNoteJa` を持つもの）。
 * 「白＝安全」と読ませないための注記を、UI が出し忘れないようにする（§7.5-2）。
 */
export function layersNeedingCoverageNote(layerKeys: readonly string[]): readonly string[] {
  return resolveHazardLayerKeys(layerKeys).filter(
    (key) => getHazardLayer(key)?.coverageNoteJa != null,
  )
}
