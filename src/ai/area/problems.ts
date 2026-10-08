/**
 * エリアの言い方を決められなかったときに LLM へ返すもの（2026-10-08 B2）。路線の名前の `problems`
 * （`src/ai/routes/resolve.ts`）と同じ形で、`candidates` は呼び直しにそのまま使える値。
 */

/** 起点の駅の候補（`near.station` にそのまま渡せる grp）。 */
export type StationCandidate = {
  readonly station: string
  readonly name: string
  readonly prefecture: string
  readonly municipality: string | null
}

/** 市区町村の候補（`municipality` と `prefectures` にそのまま渡せる値）。 */
export type MunicipalityCandidate = {
  readonly municipality: string
  readonly prefecture: string
  readonly stationCount: number
}

export type AreaProblem = {
  readonly input: string
  readonly problem: string
  readonly candidates?: readonly (StationCandidate | MunicipalityCandidate)[]
  readonly didYouMean?: readonly string[]
}

/** 候補として挙げる数の上限。 */
export const MAX_AREA_CANDIDATES = 8
/** 説明に並べるほかの候補の数（多ければ「など」）。 */
export const MAX_LISTED = 3

/** 名前を「・」で並べる（多ければ先頭だけ並べて「など」）。 */
export function listNames(names: readonly string[]): string {
  const head = names.slice(0, MAX_LISTED).join('・')
  return names.length > MAX_LISTED ? `${head} など` : head
}
