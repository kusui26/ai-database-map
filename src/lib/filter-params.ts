/**
 * 共通 API の絞り込みのクエリを読む（ランキング・散布で同じ・2026-10-08 B2）。
 *
 * 値はスキーマ（`rankingQuerySchema`・`growthQuerySchema`）が検証する。ここは URL から取り出して、
 * スキーマが受ける形（カンマ区切り → 配列、未指定 → undefined＝スキーマの既定）にするだけ。
 */

/** カンマ区切りのクエリを配列に（未指定は undefined＝スキーマの既定）。 */
export function listParam(value: string | null): string[] | undefined {
  return value === null ? undefined : value.split(',').filter(Boolean)
}

/** 未指定・空の値は undefined（スキーマの optional に任せる。空の「prefecture=」と同じく絞らない）。 */
function optionalParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)
  return value === null || value === '' ? undefined : value
}

/** 絞り込みのクエリ（都道府県・会社・法令上の路線・種別・路線・市区町村・範囲・近傍）。 */
export function filterParams(params: URLSearchParams): Record<string, unknown> {
  const types = listParam(params.get('routeTypes'))
  return {
    prefectures: listParam(params.get('prefecture')),
    operators: listParam(params.get('operators')),
    routes: listParam(params.get('routes')),
    routeTypes: types?.map(Number).filter((type) => Number.isInteger(type)),
    lines: listParam(params.get('lines'))?.map(Number),
    municipality: optionalParam(params, 'municipality'),
    bbox: optionalParam(params, 'bbox'),
    nearStation: optionalParam(params, 'nearStation'),
    withinM: optionalParam(params, 'withinM'),
  }
}
