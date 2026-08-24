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
  HAZARD_GROUPS,
  HAZARD_GROUP_LABELS_JA,
  HAZARD_LEVELS,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_LABELS_JA,
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
 * 網羅性の注記が要るレイヤの key（`coverageNoteJa` を持つもの）。
 * 「白＝安全」と読ませないための注記を、UI が出し忘れないようにする（§7.5-2）。
 */
export function layersNeedingCoverageNote(layerKeys: readonly string[]): readonly string[] {
  return resolveHazardLayerKeys(layerKeys).filter(
    (key) => getHazardLayer(key)?.coverageNoteJa != null,
  )
}
