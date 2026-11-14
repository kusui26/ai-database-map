'use client'

/**
 * 図（ランキング・散布の各軸）の指標の選択＝カテゴリと指標（2026-11-14）。**半径は地図に合わせる**：
 *
 * - 開いた直後の指標は、呼ぶ側が地図の半径で決める（`openingMetricKey`）
 * - 開いたあとに地図の半径が替わったら、同じ指標をその半径に替える（無ければ近い半径）。開いた時点の半径では
 *   替えない——チャットの ⤢・戻る・共有リンクで開いた図の条件を上書きしないため
 * - カテゴリを替えたら、新しいカテゴリの最初の指標を、いまの指標の半径（半径の無い指標なら地図の半径）で選ぶ。
 *   以前はカテゴリの先頭（多くは 500m）に飛んでいた
 *
 * 図の中で半径を替えても、地図の半径は替えない（散布は X 軸・Y 軸で別の半径を選べる）。
 */

import { useCallback, useState } from 'react'
import { getEntry } from '@/shared/catalog'
import { type Category, type RadiusM } from '@/shared/constants'
import { firstKeyAtRadius, keyAtRadius, preferredRadius } from '@/domain/metrics/at-radius'
import { useOnChange } from '@/hooks/useOnChange'

export type MetricChoice = {
  readonly category: Category
  readonly metricKey: string
  readonly onCategory: (category: Category) => void
  readonly onMetric: (key: string) => void
}

export function useMetricChoice(
  initialKey: string,
  fallbackCategory: Category,
  mapRadiusM: RadiusM,
): MetricChoice {
  const [category, setCategory] = useState<Category>(
    () => getEntry(initialKey)?.category ?? fallbackCategory,
  )
  const [metricKey, setMetricKey] = useState<string>(initialKey)
  const followMap = useCallback((radiusM: RadiusM) => {
    setMetricKey((key) => keyAtRadius(key, radiusM))
  }, [])
  useOnChange(mapRadiusM, followMap)
  const onCategory = useCallback(
    (next: Category) => {
      setCategory(next)
      setMetricKey((key) => firstKeyAtRadius(next, preferredRadius(key, mapRadiusM)) ?? key)
    },
    [mapRadiusM],
  )
  return { category, metricKey, onCategory, onMetric: setMetricKey }
}
