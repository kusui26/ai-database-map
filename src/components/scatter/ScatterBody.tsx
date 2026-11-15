'use client'

/**
 * 散布図の中身（指標ピッカ・絞り込み・チャート）。**枠を持たない**ので、
 * モーダル（`ScatterDialog`）とチャットのキャンバス（`ChatCanvas`）の両方に置ける
 * （`StationDetailPanel` が `DetailBody` を aside と Drawer で共用しているのと同じ形・260802）。
 *
 * x/y 指標ピッカ × 都道府県 × 運営会社 × 路線 × ⚠除外 → /api/growth（決定的 k-means 済み）
 * → Chart.js 散布（クラスタ色分け）。点クリックは `onSelect` に委ねる（枠側の作法に従う）。
 *
 * 条件は**開いた図**（URL の `?fig`・`figure/url.ts`）から始め、変えたら `onConditions` で知らせる
 * （入れ物が URL へ書き戻す＝戻る・進む・リロードで同じ条件の散布が出る・2026-10-02）。
 * 各軸の半径は地図の半径に合わせる（FAB で開いたら地図の半径で始め、地図の半径が替われば合わせる・`useMetricChoice`）。
 * 以前は既定の X 軸が 2km に決め打ちで、地図の半径（既定 1km）と食い違っていた（2026-11-14）。
 */

import { useEffect, useState } from 'react'
import { type Category } from '@/shared/constants'
import { getEntry } from '@/shared/catalog'
import { DEFAULT_SCATTER_X, DEFAULT_SCATTER_Y } from '@/domain/metrics'
import { openingMetricKey } from '@/domain/metrics/at-radius'
import { scatterPanel } from '@/domain/growth/panel'
import { ScatterChart, SCATTER_HEIGHT } from '@/components/panels/ScatterChart'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { MetricSelect } from '@/components/metrics/MetricSelect'
import { StationFilterControls } from '@/components/metrics/StationFilterControls'
import { useMetricChoice } from '@/components/metrics/useMetricChoice'
import { useStationFilters } from '@/components/metrics/useStationFilters'
import { type ScatterFigure } from '@/components/figure/url'
import { useGrowth } from './useGrowth'
import { messageJaOf } from '@/lib/fetch-json'

const X_CATEGORY: Category = getEntry(DEFAULT_SCATTER_X)?.category ?? 'population'
const Y_CATEGORY: Category = getEntry(DEFAULT_SCATTER_Y)?.category ?? 'passenger'

export function ScatterBody({
  initial,
  active,
  onSelect,
  onConditions,
}: {
  /** 開いた図（条件の初期値）。FAB で開いた直後は x/y が null＝既定の指標。 */
  initial: ScatterFigure
  /** 表示中か（false の間は取得しない。モーダルの open／キャンバスの表示状態）。 */
  active: boolean
  onSelect: (grp: string) => void
  /** 条件が変わったら呼ぶ（開いた直後の既定の補完を含む）。入れ物が URL へ書き戻す。 */
  onConditions?: (figure: ScatterFigure) => void
}) {
  const { radiusM: mapRadiusM } = useMapUrlState()
  const x = useMetricChoice(
    openingMetricKey(initial.xKey, DEFAULT_SCATTER_X, mapRadiusM),
    X_CATEGORY,
    mapRadiusM,
  )
  const y = useMetricChoice(
    openingMetricKey(initial.yKey, DEFAULT_SCATTER_Y, mapRadiusM),
    Y_CATEGORY,
    mapRadiusM,
  )
  const xKey = x.metricKey
  const yKey = y.metricKey
  // 絞り込み（都道府県・会社・路線・種別）と連動は散布とランキングで共有する（260801）。
  const filters = useStationFilters(active, initial)
  // 既定で信頼性の低い値（⚠）を除外する：母数が小さい駅の増減率・中央値は外れ値に
  // なりやすく、既定の散布が数駅の極端値に引きずられるため（チャットからの昇格時は
  // AI が実際に使った条件をそのまま反映する＝開いた図の値を優先）。
  const [excludeLowN, setExcludeLowN] = useState<boolean>(initial.excludeLowN)

  const { values } = filters
  useEffect(() => {
    onConditions?.({ kind: 'scatter', xKey, yKey, ...values, excludeLowN })
  }, [onConditions, xKey, yKey, values, excludeLowN])

  const { growth, isLoading, isValidating, error } = useGrowth(
    { x: xKey, y: yKey, ...filters.values, excludeLowN },
    active,
  )

  return (
    <>
      <div className="space-y-2 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <StationFilterControls state={filters} originLabel={growth?.near?.label ?? null} />
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
            category={x.category}
            metricKey={xKey}
            mapRadiusM={mapRadiusM}
            onCategory={x.onCategory}
            onMetric={x.onMetric}
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 text-xs font-medium text-slate-400">Y軸</span>
          <MetricSelect
            ariaPrefix="Y軸 "
            category={y.category}
            metricKey={yKey}
            mapRadiusM={mapRadiusM}
            onCategory={y.onCategory}
            onMetric={y.onMetric}
            className="flex-1"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error !== undefined ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
            {messageJaOf(
              error,
              '散布データを取得できませんでした。時間をおいて再度お試しください。',
            )}
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
