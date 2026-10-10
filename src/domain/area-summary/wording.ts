/**
 * ドメイン：エリア要約の数の書き方（純関数・2026-10-10 B5b）。画面と AI が同じ言葉で言うため、ここで 1 回だけ決める。
 *
 * - 値は単位つきの整数（推計の実数も四捨五入して書く・「3,750,952 人」）
 * - 増減は符号つきの小数 1 桁（「+1.4%」「-0.7%」・アプリのほかの増減と同じ書き方）
 */

import { type AreaChange, type AreaPoint } from '@/shared/area-summary'
import { formatNumber, formatWithUnit } from '@/shared/format'

/** 値を単位つきで（「3,750,952 人」「116,479 事業所」）。 */
export function valueJa(value: number, unit: string): string {
  return formatWithUnit(value, 'int', unit)
}

/** 増減率（%）。起点が 0 以下なら null（率にならない）。 */
export function rateOf(from: number, to: number): number | null {
  return from > 0 ? (to / from - 1) * 100 : null
}

/** 増減率の書き方（「+1.4%」「-0.7%」）。 */
export function rateJa(rate: number): string {
  return formatNumber(rate, 'percent1', { signed: true })
}

/** 2 つの点の増減（「2020→2025年で -0.7%」）。率にならなければ null。 */
export function changeOf(from: AreaPoint, to: AreaPoint): AreaChange | null {
  const rate = rateOf(from.value, to.value)
  if (rate === null) return null
  return {
    fromYear: from.year,
    toYear: to.year,
    rate,
    rateJa: rateJa(rate),
    textJa: `${from.year}→${to.year}年で ${rateJa(rate)}`,
  }
}
