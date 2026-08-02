'use client'

/**
 * 散布図の中身（指標ピッカ・絞り込み・チャート）。**枠を持たない**ので、
 * モーダル（`ScatterDialog`）とチャットのキャンバス（`ChatCanvas`）の両方に置ける
 * （`StationDetailPanel` が `DetailBody` を aside と Drawer で共用しているのと同じ形・260802）。
 *
 * x/y 指標ピッカ × 都道府県 × 運営会社 × 路線 × ⚠除外 → /api/growth（決定的 k-means 済み）
 * → Chart.js 散布（クラスタ色分け）。点クリックは `onSelect` に委ねる（枠側の作法に従う）。
 */

import { useCallback, useState } from 'react'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_SCATTER_X, DEFAULT_SCATTER_Y, rankableGroups } from '@/domain/metrics'
import { scatterPanel } from '@/domain/growth/panel'
import { ScatterChart, SCATTER_HEIGHT } from '@/components/panels/ScatterChart'
import { MetricSelect } from '@/components/metrics/MetricSelect'
import { StationFilterControls } from '@/components/metrics/StationFilterControls'
import { useStationFilters } from '@/components/metrics/useStationFilters'
import { useGrowth } from './useGrowth'

const X_CATEGORY: Category = getEntry(DEFAULT_SCATTER_X)?.category ?? 'population'
const Y_CATEGORY: Category = getEntry(DEFAULT_SCATTER_Y)?.category ?? 'passenger'

function firstKeyOf(category: Category): string | undefined {
  return rankableGroups(category)[0]?.entries[0]?.key
}

/** チャットからの昇格で初期 x/y・条件を preset する（未指定は既定）。 */
export type ScatterInitial = {
  readonly xKey: string
  readonly yKey: string
  readonly prefectures: readonly string[]
  /** 運営会社の絞り込み（260730・省略時は全社）。 */
  readonly operators?: readonly string[]
  /** 路線・事業者種別の絞り込み（260731・省略時は全路線。両者は OR）。 */
  readonly routes?: readonly string[]
  readonly routeTypes?: readonly number[]
  readonly excludeLowN: boolean
}

export function ScatterBody({
  initial,
  active,
  onSelect,
}: {
  initial?: ScatterInitial
  /** 表示中か（false の間は取得しない。モーダルの open／キャンバスの表示状態）。 */
  active: boolean
  onSelect: (grp: string) => void
}) {
  const initialX = initial?.xKey ?? DEFAULT_SCATTER_X
  const initialY = initial?.yKey ?? DEFAULT_SCATTER_Y
  const [xCategory, setXCategory] = useState<Category>(getEntry(initialX)?.category ?? X_CATEGORY)
  const [xKey, setXKey] = useState<string>(initialX)
  const [yCategory, setYCategory] = useState<Category>(getEntry(initialY)?.category ?? Y_CATEGORY)
  const [yKey, setYKey] = useState<string>(initialY)
  // 絞り込み（都道府県・会社・路線・種別）と連動は散布とランキングで共有する（260801）。
  const filters = useStationFilters(active, initial)
  // 既定で信頼性の低い値（⚠）を除外する：母数が小さい駅の増減率・中央値は外れ値に
  // なりやすく、既定の散布が数駅の極端値に引きずられるため（チャットからの昇格時は
  // AI が実際に使った条件をそのまま反映する＝initial 優先）。
  const [excludeLowN, setExcludeLowN] = useState<boolean>(initial?.excludeLowN ?? true)

  const { growth, isLoading, isValidating, error } = useGrowth(
    { x: xKey, y: yKey, ...filters.values, excludeLowN },
    active,
  )

  const onXCategory = useCallback((next: Category) => {
    setXCategory(next)
    const k = firstKeyOf(next)
    if (k !== undefined) setXKey(k)
  }, [])
  const onYCategory = useCallback((next: Category) => {
    setYCategory(next)
    const k = firstKeyOf(next)
    if (k !== undefined) setYKey(k)
  }, [])

  return (
    <>
      <div className="space-y-2 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <StationFilterControls state={filters} />
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={excludeLowN}
              onChange={(e) => setExcludeLowN(e.target.checked)}
              className="size-4 accent-indigo-600"
            />
            信頼性の低い値（⚠）を除外
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 text-xs font-medium text-slate-400">X軸</span>
          <MetricSelect
            ariaPrefix="X軸 "
            category={xCategory}
            metricKey={xKey}
            onCategory={onXCategory}
            onMetric={setXKey}
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 text-xs font-medium text-slate-400">Y軸</span>
          <MetricSelect
            ariaPrefix="Y軸 "
            category={yCategory}
            metricKey={yKey}
            onCategory={onYCategory}
            onMetric={setYKey}
            className="flex-1"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error !== undefined ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
            散布データを取得できませんでした。時間をおいて再度お試しください。
          </div>
        ) : (
          <div className="relative">
            {growth === undefined ? (
              // 初回はチャート節と同じ高さ＝データ到着時にサイズが変わらない（P6d）。
              // 加算する 2rem は「タイトル 1 行（text-base=24px）＋mt-2（8px）」ぶん。
              // 幅 896px では既定の指標ラベルが 1 行に収まる（実測でズレ 0px）。
              <div
                className="grid place-items-center text-sm text-slate-400"
                style={{ height: `calc(${SCATTER_HEIGHT.full} + 2rem)` }}
              >
                {isLoading ? '集計中…' : '指標を選んでください'}
              </div>
            ) : (
              <>
                <ScatterChart panel={scatterPanel(growth)} onSelect={onSelect} />
                {growth.excludedLowN > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    信頼性フラグ（低分母・極端値）の {growth.excludedLowN} 駅を除外しています。
                  </p>
                )}
              </>
            )}
            {/* x/y・都道府県・除外の変更で再取得中は前チャートの上に重ねて表示（サイズ不変） */}
            {isValidating && growth !== undefined && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-white/55">
                <span className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-white shadow">
                  集計中…
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
