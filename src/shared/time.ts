/**
 * 日本時間の表示（`docs/260824_flood.md` §7.4）。
 *
 * **実行環境のタイムゾーンに依存させない。** サーバは UTC、利用者の端末は何でもありうるので、
 * `toLocaleString` に任せると「同じ発表時刻が画面ごとに違う」が起きる。
 * 防災の画面で時刻がずれるのは、情報が古いかどうかの判断そのものを壊す。
 *
 * 気象庁の配信はこの 2 つの形で来る。どちらも入口でエポックミリ秒に直してから扱う。
 * - `targetTimes.json` の `basetime` … **UTC の `yyyyMMddHHmmss`**（実測 2026-08-27）
 * - 警報 JSON の `reportDatetime` … **ISO8601＋09:00**（例 `2026-08-27T10:02:00+09:00`）
 */

/** 日本時間と UTC の差。 */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** `yyyyMMddHHmmss`（UTC）を分解する。14 桁ちょうどでなければ読まない。 */
const COMPACT_UTC = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

function jstDate(epochMs: number): Date {
  return new Date(epochMs + JST_OFFSET_MS)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** UTC の `yyyyMMddHHmmss` → エポックミリ秒（読めなければ null）。 */
export function parseCompactUtc(text: string): number | null {
  const matched = COMPACT_UTC.exec(text)
  if (matched === null) return null
  const [, year, month, day, hour, minute, second] = matched
  const epochMs = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  return Number.isNaN(epochMs) ? null : epochMs
}

/** ISO8601（オフセット付き）→ エポックミリ秒（読めなければ null）。 */
export function parseIso(text: string): number | null {
  const epochMs = Date.parse(text)
  return Number.isNaN(epochMs) ? null : epochMs
}

/** 日本時間の「8月27日 10:10」。 */
export function jstDateTimeJa(epochMs: number): string {
  const jst = jstDate(epochMs)
  const date = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`
  return `${date} ${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`
}

/** 日本時間の「10:10」（同じ日の中で示すとき）。 */
export function jstClockJa(epochMs: number): string {
  const jst = jstDate(epochMs)
  return `${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`
}
