/**
 * 駅別ハザードサマリ（事前計算）の**形**（`docs/260828_research_claude_auth.md` §5.3 ③ PR-6）。
 *
 * `station_hazard.summary`（jsonb）・ビルダー出力（jsonl）・`get_hazard_summary` 応答・
 * `build_dataset` の `include_hazard` 列は、すべてこの 1 ファイルの型と列定義を通る。
 *
 * - **決定 9**：災害は指標ではない——`metric_catalog` に入れず、この独立した形で持つ
 * - レベルは**順序尺度**（none < caution < warning < danger < critical）。足し算・平均はできない
 * - `none` は「区域図の上で該当なし」。`uncovered=true`（この地域に区域図が無い）の駅を
 *   安全と読ませない——CSV でもフラグ列として運ぶ
 * - 射影（`HazardPointResponse` → この形）は `domain/hazard/summary.ts`（カタログ参照が要るため）
 */

import { z } from 'zod'
import { evacuationActionSchema, hazardCertaintySchema, hazardLevelSchema } from './hazard'

/** サマリの版（形を変えたら上げる。DB・jsonl・応答すべてに随伴させる）。 */
export const STATION_HAZARD_VERSION = 1

/** サマリが束ねるハザードグループ（terrain＝参考情報・realtime＝「いま」は含めない）。 */
export const SUMMARY_HAZARD_GROUPS = [
  'flood',
  'inland_flood',
  'storm_surge',
  'tsunami',
  'landslide',
] as const
export type SummaryHazardGroup = (typeof SUMMARY_HAZARD_GROUPS)[number]

/** 1 グループぶんの要約。 */
export const hazardGroupSummarySchema = z.object({
  /** グループ内で最も重い危険度（該当なしは 'none'）。 */
  level: hazardLevelSchema,
  /** 最も重い該当の言い方（「レイヤ名：値」。該当なしは null）。**サーバが作った文字列**。 */
  worstJa: z.string().nullable(),
  /** 点は区域外だが、すぐ近く（約 20m／隣接 250m メッシュ）が区域。 */
  nearby: z.boolean(),
  /** この地域に区域図が無いレイヤがある（未整備の可能性＝「安全」とは言えない）。 */
  uncovered: z.boolean(),
})
export type HazardGroupSummary = z.infer<typeof hazardGroupSummarySchema>

/** 駅 1 件のハザードサマリ（`pointHazard` と同じ関数系から射影した静的想定の要約）。 */
export const stationHazardSummarySchema = z.object({
  grp: z.string(),
  /** 総合の危険度（最重・verdict.level と同値）。 */
  level: hazardLevelSchema,
  /** 立退き/垂直/その場。**判定できないときは null**（断定しない）。 */
  evacuation: evacuationActionSchema.nullable(),
  /** 1 文の結論（サーバが作った文字列・「安全」と言わない語彙）。 */
  headlineJa: z.string(),
  certainty: hazardCertaintySchema,
  /** 平均標高（m・250m メッシュ。無い区画は null）。 */
  elevationM: z.number().nullable(),
  groups: z.object({
    flood: hazardGroupSummarySchema,
    inland_flood: hazardGroupSummarySchema,
    storm_surge: hazardGroupSummarySchema,
    tsunami: hazardGroupSummarySchema,
    landslide: hazardGroupSummarySchema,
  }),
})
export type StationHazardSummary = z.infer<typeof stationHazardSummarySchema>

// --- build_dataset の include_hazard 列（§5.3 ②・hazard_ 接頭辞で指標と混ぜない） ----

/** CSV セルの役割（値列＝欠損は空欄／フラグ列＝0/1・欠損は 0）。csv.ts の規約と同じ。 */
export type HazardColumnRole = 'value' | 'flag'

export type HazardDatasetColumn = {
  readonly key: string
  readonly role: HazardColumnRole
  readonly labelJa: string
  /** レベル列は順序尺度（単位なし）。標高だけ m。 */
  readonly unit: 'm' | null
}

const GROUP_COLUMN_LABELS: Readonly<Record<SummaryHazardGroup, string>> = {
  flood: '洪水',
  inland_flood: '内水氾濫',
  storm_surge: '高潮',
  tsunami: '津波',
  landslide: '土砂災害',
}

/**
 * include_hazard で CSV に足す列（この順で出す）。
 * レベル列の値は none/caution/warning/danger/critical（**順序尺度・線形加点しない**）。
 */
export const HAZARD_DATASET_COLUMNS: readonly HazardDatasetColumn[] = [
  { key: 'hazard_level', role: 'value', labelJa: '総合危険度（最重・順序尺度）', unit: null },
  {
    key: 'hazard_evacuation',
    role: 'value',
    labelJa: '避難の目安（takeaway=立退き / vertical=垂直 / stay=その場 / 空欄=判定できない）',
    unit: null,
  },
  ...SUMMARY_HAZARD_GROUPS.map((group): HazardDatasetColumn => ({
    key: `hazard_${group}_level`,
    role: 'value',
    labelJa: `${GROUP_COLUMN_LABELS[group]}の危険度（順序尺度）`,
    unit: null,
  })),
  { key: 'hazard_elev_m', role: 'value', labelJa: '平均標高（250m メッシュ）', unit: 'm' },
  ...SUMMARY_HAZARD_GROUPS.map((group): HazardDatasetColumn => ({
    key: `hazard_${group}_nearby`,
    role: 'flag',
    labelJa: `${GROUP_COLUMN_LABELS[group]}：点は区域外だがすぐ近くが区域（1=該当）`,
    unit: null,
  })),
  ...SUMMARY_HAZARD_GROUPS.map((group): HazardDatasetColumn => ({
    key: `hazard_${group}_uncovered`,
    role: 'flag',
    labelJa: `${GROUP_COLUMN_LABELS[group]}：この地域に区域図が無い（1=図なし・安全とは言えない）`,
    unit: null,
  })),
]

/** サマリ → CSV セル（列は `HAZARD_DATASET_COLUMNS` と同じキー）。 */
export function hazardCsvCells(summary: StationHazardSummary): Record<string, string | number> {
  const cells: Record<string, string | number> = {
    hazard_level: summary.level,
    hazard_evacuation: summary.evacuation ?? '',
    hazard_elev_m: summary.elevationM ?? '',
  }
  for (const group of SUMMARY_HAZARD_GROUPS) {
    const each = summary.groups[group]
    cells[`hazard_${group}_level`] = each.level
    cells[`hazard_${group}_nearby`] = each.nearby ? 1 : 0
    cells[`hazard_${group}_uncovered`] = each.uncovered ? 1 : 0
  }
  return cells
}
