/**
 * 市区町村の名前の読み方（純関数・画面・AI・ドメインで共有）。
 *
 * データの市区町村は、政令市なら区まで入っている（「横浜市中区」）。区を持つ市の**市全体**は、
 * 名前の前方一致（「横浜市」）で全区を束ねる（SQL の述語 `station_matches_filters`・2026-10-08 B2）。
 * その「区を持つ市」の見分け方をここに 1 つだけ置く——画面の市区町村の選択肢、AI の名前の索引、
 * 駅周辺のプロフィールの「市内」（2026-10-09 B4）が同じ規則で読む。
 */

/**
 * 政令市の区（「横浜市港北区」→ 市「横浜市」・区「港北区」）。
 * 東京 23 区（「千代田区」）は頭に「〜市」が無いので当たらない＝区そのものが市区町村。
 * 市の名前は最短で切る（全 1,425 市区町村で、最長で切っても同じ結果・2026-10-09 確認）。
 */
export const CITY_WARD = /^(.+?市)(.+区)$/

/** 政令市の区なら、その市（「横浜市港北区」→「横浜市」）。区でなければ null。 */
export function cityOfWard(municipality: string): string | null {
  return CITY_WARD.exec(municipality)?.[1] ?? null
}

/** 政令市の区なら、区の名前だけ（「横浜市港北区」→「港北区」）。区でなければ null。 */
export function wardOf(municipality: string): string | null {
  return CITY_WARD.exec(municipality)?.[2] ?? null
}
