/**
 * 絞り込みのセレクタの検索（純関数・2026-10-08 L4）。
 *
 * 全角・半角と大文字・小文字を揃え（「ＪＲ」「jr」→「jr」、「Osaka」→「osaka」）、空白で区切った語が
 * **どれも**含まれる候補を当てる（「JR 中央」→ JR の中央線たち）。路線と会社のセレクタで同じ規則を使う。
 */

/** 検索語 → 語の並び（空なら絞らない）。 */
export function searchTokens(query: string): string[] {
  return normalizeForSearch(query)
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

/** 比べる前に揃える（検索語と候補の両方に当てる）。 */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

/** 候補の名前たちが、どの語も含むか（語が無ければ当たる）。 */
export function matchesTokens(
  fields: readonly (string | null)[],
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) return true
  const text = normalizeForSearch(
    fields.flatMap((field) => (field === null ? [] : [field])).join(' '),
  )
  return tokens.every((token) => text.includes(token))
}
