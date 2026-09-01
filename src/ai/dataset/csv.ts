/**
 * build_dataset の CSV 組み立て（純関数・I/O なし・`docs/260828_research_claude_auth.md` §5.3）。
 *
 * - 列名は既存の命名規約 `{接頭辞}_{年}_{半径}` のカタログキーそのまま——アプリ・ドキュメント・
 *   CSV で語彙が一致する
 * - 値の欠損は**空欄**（データ無し）。フラグ列の欠損は **0**（値 0 は DB に保存しない規約・260816——
 *   欠損＝0 と同義）。この非対称は notes / meta.json に明記する
 * - RFC 4180：カンマ・引用符・改行を含むフィールドは引用する
 */

import { type StationListItem } from '@/shared/api'
import { type DatasetColumn } from './columns'

export type DatasetShape = 'wide' | 'long'

/** 駅の識別列（wide の先頭）。municipality_code は他の市区町村統計との結合キー。 */
export const DATASET_ID_HEADERS = [
  'grp',
  'station_name',
  'prefecture',
  'municipality',
  'municipality_code',
  'lon',
  'lat',
] as const

/** long 形式の列。 */
export const DATASET_LONG_HEADERS = ['grp', 'station_name', 'prefecture', 'key', 'value'] as const

/** grp → { key → value }（`dataset_rows` RPC の返り）。 */
export type DatasetValues = Readonly<Record<string, Readonly<Record<string, number>>>>

/** RFC 4180 のフィールド引用。 */
function csvField(raw: string): string {
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw
}

/** セル値（欠損：値列＝空欄・フラグ列＝0）。undefined を返したら「行ごと出さない」（long）。 */
function cellFor(column: DatasetColumn, value: number | undefined): string | undefined {
  if (value !== undefined) return String(value)
  return column.role === 'flag' ? '0' : undefined
}

/** 駅の識別セル（DATASET_ID_HEADERS と同順。駅名は表示名 label を使う）。 */
function idCells(station: StationListItem): readonly string[] {
  return [
    station.grp,
    station.label,
    station.prefecture,
    station.municipality ?? '',
    station.municipalityCode ?? '',
    String(station.lon),
    String(station.lat),
  ]
}

function wideRow(
  station: StationListItem,
  values: DatasetValues,
  columns: readonly DatasetColumn[],
): readonly string[] {
  const row = values[station.grp] ?? {}
  return [...idCells(station), ...columns.map((column) => cellFor(column, row[column.key]) ?? '')]
}

function longRows(
  station: StationListItem,
  values: DatasetValues,
  columns: readonly DatasetColumn[],
): readonly (readonly string[])[] {
  const row = values[station.grp] ?? {}
  return columns.flatMap((column) => {
    const cell = cellFor(column, row[column.key])
    if (cell === undefined) return [] // 値列の欠損は行を作らない（NaN 非格納の規約と同じ）
    return [[station.grp, station.label, station.prefecture, column.key, cell]]
  })
}

/** 全行（ヘッダ含む）を 2 次元で返す（CSV 文字列とプレビューの共通材料）。 */
function tableFor(
  stations: readonly StationListItem[],
  values: DatasetValues,
  columns: readonly DatasetColumn[],
  shape: DatasetShape,
): readonly (readonly string[])[] {
  if (shape === 'wide') {
    return [
      [...DATASET_ID_HEADERS, ...columns.map((column) => column.key)],
      ...stations.map((station) => wideRow(station, values, columns)),
    ]
  }
  return [
    [...DATASET_LONG_HEADERS],
    ...stations.flatMap((station) => longRows(station, values, columns)),
  ]
}

/** CSV 文字列（UTF-8・LF・末尾改行あり・BOM なし＝pandas 既定で崩れない）。 */
export function buildDatasetCsv(
  stations: readonly StationListItem[],
  values: DatasetValues,
  columns: readonly DatasetColumn[],
  shape: DatasetShape,
): string {
  const lines = tableFor(stations, values, columns, shape).map((row) => row.map(csvField).join(','))
  lines.push('') // 末尾改行
  return lines.join('\n')
}

/** データ行数（ヘッダを除く）。 */
export function datasetRowCount(
  stations: readonly StationListItem[],
  values: DatasetValues,
  columns: readonly DatasetColumn[],
  shape: DatasetShape,
): number {
  return tableFor(stations, values, columns, shape).length - 1
}

export type DatasetPreview = {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

/** プレビュー行の上限（応答を要約に保つ・§5.3「返すのはスキーマとプレビューだけ」）。 */
export const DATASET_PREVIEW_ROWS = 5

/** 先頭 5 行のプレビュー（LLM が列の並びと値の形を確認するためだけの窓）。 */
export function datasetPreview(
  stations: readonly StationListItem[],
  values: DatasetValues,
  columns: readonly DatasetColumn[],
  shape: DatasetShape,
): DatasetPreview {
  const table = tableFor(stations, values, columns, shape)
  const header = table[0] ?? []
  return { header, rows: table.slice(1, 1 + DATASET_PREVIEW_ROWS) }
}

/** 欠損の多い列を上位から並べる（多い順・同数はキー順で決定的）。 */
function topMissing(missingByKey: ReadonlyMap<string, number>): string {
  return [...missingByKey.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, count]) => `${key}=${count}`)
    .join('・')
}

/**
 * データの注意書き（欠損・フラグ）。**黙って使わせない**ための同梱情報で、
 * ツール応答の notes と meta.json の両方に載せる（§5.4-4）。
 */
export function datasetNotes(
  stations: readonly StationListItem[],
  values: DatasetValues,
  columns: readonly DatasetColumn[],
): readonly string[] {
  const notes: string[] = []
  const missingByKey = new Map<string, number>()
  let totalMissing = 0
  for (const column of columns) {
    if (column.role !== 'value') continue
    const missing = stations.filter(
      (station) => (values[station.grp] ?? {})[column.key] === undefined,
    ).length
    missingByKey.set(column.key, missing)
    totalMissing += missing
  }
  if (totalMissing > 0) {
    notes.push(
      `値の欠損（空欄）が合計 ${totalMissing} セルあります（多い列: ${topMissing(missingByKey)}）。欠損を黙って 0 扱いしないこと。`,
    )
  }
  const flagColumns = columns.filter((column) => column.role === 'flag')
  if (flagColumns.length > 0) {
    const flagged = flagColumns
      .map((column) => {
        const count = stations.filter(
          (station) => ((values[station.grp] ?? {})[column.key] ?? 0) >= 1,
        ).length
        return { key: column.key, count }
      })
      .filter((item) => item.count > 0)
    notes.push(
      'フラグ列は 1=注意（低分母・極端値など）・0=該当なし。該当行は除外するか注記して使うこと。',
    )
    if (flagged.length > 0) {
      notes.push(`フラグが立つ駅: ${flagged.map((item) => `${item.key}=${item.count}`).join('・')}`)
    }
  }
  return notes
}
