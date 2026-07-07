/**
 * 数値の表示整形（カタログの `format` 指定に従う・純関数）。
 *
 * すべて `tabular-nums`（tnum）前提の桁揃え表示。欠損（null/undefined/NaN）は「—」。
 * 意味づけ（単位・format）はカタログが持つ（.claude/CLAUDE.md §2）。UI はこの関数のみを使う。
 */

/** カタログの format 語彙（catalog.json の `format`）。 */
export type MetricFormat = 'int' | 'decimal1' | 'percent1' | 'ratio1' | 'yen'

/** 欠損値の表示（em dash）。 */
export const MISSING = '—'

export type FormatOptions = {
  /** 増減率など「変化量」に符号（+）を付ける。 */
  readonly signed?: boolean
}

const isMissing = (value: number | null | undefined): value is null | undefined =>
  value === null || value === undefined || Number.isNaN(value)

/** 整数部を3桁区切りにし、小数を `decimals` 桁で丸める（ロケール非依存・決定的）。 */
const fixedGrouped = (value: number, decimals: number): string => {
  const negative = value < 0
  const [intPart, fracPart] = Math.abs(value).toFixed(decimals).split('.')
  const grouped = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = fracPart ? `${grouped}.${fracPart}` : grouped
  return negative ? `-${body}` : body
}

/** 絶対値の表示 `absBody` に、値の符号（+/-）を明示的に付す。 */
const withSign = (value: number, absBody: string): string =>
  value >= 0 ? `+${absBody}` : `-${absBody}`

/** 数値を format 指定で文字列化する（単位は付けない）。 */
export function formatNumber(
  value: number | null | undefined,
  format: MetricFormat | null,
  options: FormatOptions = {},
): string {
  if (isMissing(value)) return MISSING
  switch (format) {
    case 'int':
    case 'yen':
      return fixedGrouped(value, 0)
    case 'decimal1':
      return fixedGrouped(value, 1)
    case 'percent1':
      return options.signed
        ? withSign(value, `${fixedGrouped(Math.abs(value), 1)}%`)
        : `${fixedGrouped(value, 1)}%`
    case 'ratio1':
      // 0–1 の割合を ×100 して % 表示
      return `${fixedGrouped(value * 100, 1)}%`
    case null:
      return fixedGrouped(value, 0)
  }
}

/** 数値＋単位で文字列化する（欠損は単位を付けず「—」）。円/㎡ などはカタログ単位を後置。 */
export function formatWithUnit(
  value: number | null | undefined,
  format: MetricFormat | null,
  unit: string | null,
  options: FormatOptions = {},
): string {
  if (isMissing(value)) return MISSING
  const num = formatNumber(value, format, options)
  // % は数値に含まれるため単位重複を避ける
  if (unit === null || unit === '%') return num
  return `${num} ${unit}`
}
