/**
 * ドメイン：比べるエリアの**占める割合**（純関数・2026-10-13 B5d″・`docs/261001_fix_user_feedback_ui.md` §6.19）。
 *
 * 「横浜市は神奈川県全体と比べてどう？」に、モデルが割合を自分で計算していた（§6.17）。割合はサーバで作る。
 *
 * - 比べるエリアの中に、**ほかのエリアを含むエリア**があるときだけ。含む・含まれるは行政区域の上下で決める
 *   （区 ⊂ 政令市・23 区の区 ⊂ 東京23区・県の中 ⊂ 都道府県・全国以外 ⊂ 全国）
 * - 含むエリアが 2 つ以上あれば、**いちばん近い（小さい）入れ物**に対して（中区は横浜市の、横浜市は神奈川県の）
 * - 沿線・起点の駅から N m・地図の範囲には付けない：行政区域と境界が重ならず、作り方も違うので「その一部」を意味しない
 */

import { type AreaKind } from '@/shared/area-catalog'
import { formatNumber } from '@/shared/format'

/** 行政区域の上下を決めるのに要るもの（`area_catalog` の行から）。 */
export type AdminPlace = {
  readonly ref: string
  readonly kind: AreaKind
  /** 都道府県の名前（全国は null）。 */
  readonly prefecture: string | null
  /** 親（区 → 政令市・市区町村 → 都道府県・都道府県 → 全国）。 */
  readonly parentRef: string | null
  /** 束（23 区の区 → 東京23区）。 */
  readonly groupRef: string | null
}

/** 入れ物の大きさの順（小さいほど近い）。区・市区町村は入れ物にならない。 */
const CONTAINER_RANK: Readonly<Partial<Record<AreaKind, number>>> = {
  city: 1,
  special_wards: 1,
  prefecture: 2,
  country: 3,
}

/** 割合を「未満」と書くさかい（%）。丸めて 0.0% や 0.1% と書くと、ほぼ 0 か 0.1 か区別できない。 */
const TINY_SHARE_PERCENT = 0.1

/** `place` が `container` に入っているか（行政区域の上下）。 */
export function isWithin(place: AdminPlace, container: AdminPlace): boolean {
  if (place.ref === container.ref) return false
  switch (container.kind) {
    case 'country':
      return place.kind !== 'country'
    case 'prefecture':
      return (
        place.kind !== 'country' &&
        place.kind !== 'prefecture' &&
        place.prefecture === container.prefecture
      )
    case 'city':
      return place.parentRef === container.ref
    case 'special_wards':
      return place.groupRef === container.ref
    default:
      return false
  }
}

function rankOf(place: AdminPlace): number {
  return CONTAINER_RANK[place.kind] ?? Number.POSITIVE_INFINITY
}

/** いちばん近い入れ物（比べるエリアの中で・無ければ undefined）。 */
function nearestContainer(
  place: AdminPlace,
  places: readonly AdminPlace[],
): AdminPlace | undefined {
  const containers = places.filter((other) => isWithin(place, other))
  return containers.reduce<AdminPlace | undefined>(
    (nearest, each) => (nearest === undefined || rankOf(each) < rankOf(nearest) ? each : nearest),
    undefined,
  )
}

/** エリアの文字列 → いちばん近い入れ物のエリアの文字列（入れ物のあるエリアだけ）。 */
export function nearestContainers(places: readonly AdminPlace[]): ReadonlyMap<string, string> {
  return new Map(
    places.flatMap((place) => {
      const container = nearestContainer(place, places)
      return container === undefined ? [] : [[place.ref, container.ref] as const]
    }),
  )
}

/** 割合の書き方（「神奈川県の 40.8%」・0.1% 未満）。全体が 0 以下なら null（割合にならない）。 */
export function shareJa(part: number, whole: number, containerNameJa: string): string | null {
  if (whole <= 0) return null
  const percent = (part / whole) * 100
  const text = percent < TINY_SHARE_PERCENT ? '0.1% 未満' : formatNumber(percent, 'percent1')
  return `${containerNameJa}の ${text}`
}
