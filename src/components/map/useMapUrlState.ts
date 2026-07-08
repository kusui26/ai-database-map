'use client'

/**
 * 選択駅（?grp）と半径（?r）を URL に双方向同期する（nuqs）。
 * 共有リンク・リロード・戻る/進むで状態が復元される（地図アプリの必須機能）。
 */

import { parseAsInteger, parseAsString, useQueryState } from 'nuqs'
import { RADII_M } from '@/shared/constants'

const DEFAULT_RADIUS_M = 1000

export function useMapUrlState() {
  const [grp, setGrp] = useQueryState('grp', parseAsString)
  const [r, setRadiusM] = useQueryState('r', parseAsInteger.withDefault(DEFAULT_RADIUS_M))
  // 不正な r（6段以外）は既定に丸める
  const radiusM = RADII_M.some((valid) => valid === r) ? r : DEFAULT_RADIUS_M
  return { grp, setGrp, radiusM, setRadiusM }
}
