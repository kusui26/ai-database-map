'use client'

/**
 * 散布図のモーダル（FAB から開く）。x/y 指標ピッカ × 都道府県 × 運営会社 × 低分母除外 → /api/growth
 * （決定的 k-means 済み）→ Chart.js 散布（クラスタ色分け）。点クリックで駅選択（?grp）。
 */

import { useCallback, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_SCATTER_X, DEFAULT_SCATTER_Y, rankableGroups } from '@/domain/metrics'
import { scatterPanel } from '@/domain/growth/panel'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { ScatterChart, SCATTER_HEIGHT } from '@/components/panels/ScatterChart'
import { MetricSelect } from '@/components/metrics/MetricSelect'
import { OperatorMultiSelect } from '@/components/metrics/OperatorMultiSelect'
import { PrefectureMultiSelect } from '@/components/metrics/PrefectureMultiSelect'
import { useOperators } from '@/components/metrics/useOperators'
import { useGrowth } from './useGrowth'
import {
  applyManualPrefectures,
  EMPTY_LINK,
  type LinkState,
  operatorsInPrefectures,
  prefectureIndex,
  prefecturesOfOperators,
  pruneAutoPrefectures,
  selectOperatorPrefectures,
} from './operatorLink'

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
  readonly excludeLowN: boolean
}

export function ScatterDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ScatterInitial
}) {
  const { setGrp } = useMapUrlState()
  const initialX = initial?.xKey ?? DEFAULT_SCATTER_X
  const initialY = initial?.yKey ?? DEFAULT_SCATTER_Y
  const [xCategory, setXCategory] = useState<Category>(getEntry(initialX)?.category ?? X_CATEGORY)
  const [xKey, setXKey] = useState<string>(initialX)
  const [yCategory, setYCategory] = useState<Category>(getEntry(initialY)?.category ?? Y_CATEGORY)
  const [yKey, setYKey] = useState<string>(initialY)
  // 都道府県は「手動で入れた分」と「会社連動で入った分（auto）」を区別して持つ（260731）。
  const [link, setLink] = useState<LinkState>(
    initial ? { prefectures: [...initial.prefectures], auto: [] } : EMPTY_LINK,
  )
  const [operators, setOperators] = useState<string[]>(
    initial ? [...(initial.operators ?? [])] : [],
  )
  // 既定で低分母（⚠）を除外する：母数が小さい駅の増減率・中央値は外れ値になりやすく、
  // 既定の散布が数駅の極端値に引きずられるため（チャットからの昇格時は AI が実際に
  // 使った条件をそのまま反映する＝initial 優先）。
  const [excludeLowN, setExcludeLowN] = useState<boolean>(initial?.excludeLowN ?? true)

  const prefectures = link.prefectures
  const {
    operators: operatorList,
    isLoading: operatorsLoading,
    error: operatorsError,
  } = useOperators(open)
  const index = useMemo(() => prefectureIndex(operatorList), [operatorList])

  // 双方向の連動：会社を選べば県の候補が、県を選べば会社の候補が絞られる（未選択なら全件）。
  const allowedPrefectures = useMemo(
    () => (operators.length === 0 ? undefined : prefecturesOfOperators(operators, index)),
    [operators, index],
  )
  const allowedOperators = useMemo(
    () =>
      prefectures.length === 0 ? undefined : operatorsInPrefectures(prefectures, operatorList),
    [prefectures, operatorList],
  )
  const applyCount = useMemo(
    () =>
      prefecturesOfOperators(operators, index).filter(
        (prefecture) => !prefectures.includes(prefecture),
      ).length,
    [operators, index, prefectures],
  )

  const onPrefectures = useCallback((next: string[]) => {
    setLink((state) => applyManualPrefectures(state, next))
  }, [])
  const onOperators = useCallback(
    (next: string[]) => {
      setOperators(next)
      setLink((state) => pruneAutoPrefectures(state, next, index))
    },
    [index],
  )
  const onApplyPrefectures = useCallback(() => {
    setLink((state) => selectOperatorPrefectures(state, operators, index))
  }, [operators, index])

  const { growth, isLoading, isValidating, error } = useGrowth(
    xKey,
    yKey,
    prefectures,
    operators,
    excludeLowN,
    open,
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
  const onSelect = useCallback(
    (grp: string) => {
      void setGrp(grp)
      onOpenChange(false)
    },
    [setGrp, onOpenChange],
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">散布図</Dialog.Title>
            <Dialog.Close
              aria-label="閉じる"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="space-y-2 border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <PrefectureMultiSelect
                selected={[...prefectures]}
                onChange={onPrefectures}
                allowed={allowedPrefectures}
              />
              <OperatorMultiSelect
                selected={operators}
                onChange={onOperators}
                operators={operatorList}
                isLoading={operatorsLoading}
                error={operatorsError}
                allowed={allowedOperators}
                onApplyPrefectures={onApplyPrefectures}
                applyPrefectureCount={applyCount}
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={excludeLowN}
                  onChange={(e) => setExcludeLowN(e.target.checked)}
                  className="size-4 accent-indigo-600"
                />
                低分母（⚠）を除外
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
                        低分母（信頼性フラグ）の {growth.excludedLowN} 駅を除外しています。
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
