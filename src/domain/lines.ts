/**
 * ドメイン：路線（運行系統・駅データ.jp）の参照（261008 L2・docs/261001_fix_user_feedback_ui.md §6.8）。
 *
 * 共通 API の条件 `lines` は路線コード（GET /api/lines の lineCd）で受け、ここで名前を引いて
 * 応答（図の題・おすすめの対象の言い方）に**名前で**返す。知らないコードは黙って捨てずに理由を返す
 * ——捨てると、利用者が指定したのとは別の駅の集合で答えてしまう。
 *
 * 路線は利用者が呼ぶ路線（JR山手線＝環状 30 駅）で、法令上の路線（`routes`・S12）とは別の条件。
 */

import { linesByCodes, type LineRow } from '@/db/queries'
import { type Line, type LineRef, type LinesResponse } from '@/shared/api'
import { LINE_SOURCE, lineTypeLabel } from '@/shared/constants'

export type LineResolution =
  | { readonly ok: true; readonly lines: readonly LineRef[] }
  | { readonly ok: false; readonly messageJa: string }

/** 指定の順を保ったまま、重ねて指定されたコードを 1 回にする。 */
function uniqueCodes(codes: readonly number[]): number[] {
  return [...new Set(codes)]
}

/** 路線コード → 参照（純関数）。`known` は DB で引いた結果（知らないコードは入っていない）。 */
export function matchLineCodes(
  codes: readonly number[],
  known: readonly LineRef[],
): LineResolution {
  const byCode = new Map(known.map((line) => [line.lineCd, line]))
  const wanted = uniqueCodes(codes)
  const unknown = wanted.filter((code) => !byCode.has(code))
  if (unknown.length > 0) {
    return {
      ok: false,
      messageJa: `知らない路線コードです: ${unknown.join(', ')}（GET /api/lines の lineCd を指定してください）`,
    }
  }
  return { ok: true, lines: wanted.flatMap((code) => byCode.get(code) ?? []) }
}

/** 路線コード → 参照（主キーで名前を引く）。指定が無ければ DB に行かない。 */
export async function resolveLineCodes(codes: readonly number[]): Promise<LineResolution> {
  if (codes.length === 0) return { ok: true, lines: [] }
  return matchLineCodes(codes, await linesByCodes(uniqueCodes(codes)))
}

function toLine(row: LineRow): Line {
  return {
    lineCd: row.lineCd,
    name: row.name,
    formalName: row.formalName,
    companyName: row.companyName,
    companyShort: row.companyShort,
    operator: row.operator,
    color: row.color,
    colorName: row.colorName,
    lineType: row.lineType,
    lineTypeLabel: lineTypeLabel(row.lineType),
    isLoop: row.isLoop,
    stationCount: row.stationCount,
    prefectures: [...row.prefectures],
  }
}

/** 路線の一覧の応答（表示名・出典をここで付ける＝UI と AI が同じ言葉を使う）。 */
export function linesResponse(rows: readonly LineRow[]): LinesResponse {
  return {
    source: rows[0]?.source ?? LINE_SOURCE.nameJa,
    sourceUrl: LINE_SOURCE.url,
    lines: rows.map(toLine),
  }
}
