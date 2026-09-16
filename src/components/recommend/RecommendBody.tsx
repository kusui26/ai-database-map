'use client'

/**
 * おすすめ駅の中身（条件 → 表 → 脚注）。**枠を持たない**ので、モーダルにも他の器にも置ける
 * （`RankingBody` と同じ形）。
 *
 * ## 出すのは順位だけではない
 *
 * 画面には、対話の相手がいない。「その駅は東京へ直通しないから外そう」と言ってくれる人が
 * いないので、**何を候補にしたか**を必ず出す（W2 の突き合わせで、候補が 1 駅違うだけで
 * 4 位以下が入れ替わることを実測している）。方法・重み・除外・敏感度・限界・出典も同じ理由で、
 * 表と一緒に必ず出す（§13.4）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMapStore } from '@/stores/mapStore'
import { useRecommendStore } from '@/stores/recommendStore'
import { useStationFilters } from '@/components/metrics/useStationFilters'
import { RecommendControls } from './RecommendControls'
import { RecommendFootnotes, RecommendSummaryBar } from './RecommendNotes'
import { RecommendTable, WeightLegend } from './RecommendTable'
import { hasArea, type RecommendCriteria } from './query'
import { useMunicipalities } from './useMunicipalities'
import { useRecommend } from './useRecommend'

function Notice({ tone, children }: { tone: 'plain' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === 'warn'
          ? 'rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200'
          : 'grid h-full place-items-center px-6 text-center text-sm text-slate-400'
      }
    >
      {children}
    </div>
  )
}

export function RecommendBody({
  active,
  onSelect,
}: {
  /** 表示中か（false の間は取得しない）。 */
  active: boolean
  onSelect: (grp: string) => void
}) {
  // 閉じたときの条件から再開する（モーダルの中身は閉じるたびに unmount される）。
  // 初期値としてだけ読む（以後の変化は購読しない＝開いている間に外から書き換わらない）。
  const [remembered] = useState(() => useRecommendStore.getState().criteria)
  const remember = useRecommendStore((state) => state.remember)
  const filters = useStationFilters(active, remembered)
  const [recipe, setRecipe] = useState<RecommendCriteria>(remembered)
  const prefectures = filters.values.prefectures
  const prefecture = prefectures.length === 1 ? (prefectures[0] ?? null) : null
  const municipalities = useMunicipalities(active ? prefecture : null)

  // 都道府県が**変わったら**市区町村は捨てる（別の県の市区町村が残ると 0 件になる）。
  // 初回は捨てない——覚えていた条件で開き直したときに、選び直しになってしまう。
  const lastPrefecture = useRef(prefecture)
  useEffect(() => {
    if (lastPrefecture.current === prefecture) return
    lastPrefecture.current = prefecture
    setRecipe((current) =>
      current.municipality === '' ? current : { ...current, municipality: '' },
    )
  }, [prefecture])

  const criteria = useMemo<RecommendCriteria>(
    () => ({ ...recipe, ...filters.values }),
    [recipe, filters.values],
  )
  const { data, isLoading, isRefreshing, errorJa } = useRecommend(criteria, active)

  // 閉じる（unmount する）ときに、そのときの条件を覚える。
  const latest = useRef(criteria)
  latest.current = criteria
  useEffect(() => () => remember(latest.current), [remember])

  // 地図に上位を印す。**表を閉じたあとも残す**——地図の上で場所を確かめるのが次の一手なので。
  const setHighlightedGrps = useMapStore((state) => state.setHighlightedGrps)
  useEffect(() => {
    if (data === undefined) return
    setHighlightedGrps(data.rows.slice(0, data.topN).map((row) => row.grp))
  }, [data, setHighlightedGrps])

  const onChange = useCallback((patch: Partial<RecommendCriteria>) => {
    setRecipe((current) => ({ ...current, ...patch }))
  }, [])

  return (
    <>
      <div className="border-b border-slate-100 px-4 py-3">
        <RecommendControls
          criteria={criteria}
          filters={filters}
          municipalities={municipalities}
          onChange={onChange}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!hasArea(criteria) ? (
          <Notice tone="plain">
            都道府県・市区町村・路線のいずれかを選んでください。
            <br />
            おすすめは<b>そのエリアの中での相対評価</b>なので、範囲が決まらないと順位が出せません。
          </Notice>
        ) : errorJa !== undefined ? (
          <Notice tone="warn">{errorJa}</Notice>
        ) : data === undefined ? (
          <Notice tone="plain">{isLoading ? '集計中…' : '条件を選んでください'}</Notice>
        ) : (
          <div className={isRefreshing ? 'opacity-60 transition-opacity' : undefined}>
            <RecommendSummaryBar response={data} />
            {data.rankedCount === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                {data.candidateCount === 0
                  ? '該当する駅がありませんでした。エリアの条件を見直してください。'
                  : `候補 ${data.candidateCount} 駅はすべて除外されました。下の理由をご覧ください。`}
              </p>
            ) : (
              <>
                <div className="mt-3">
                  <WeightLegend metrics={data.metrics} />
                </div>
                <div className="mt-2">
                  <RecommendTable response={data} onSelect={onSelect} />
                </div>
                {data.rows.length < data.rankedCount && (
                  <p className="mt-1.5 text-center text-xs text-slate-400">
                    上位 {data.rows.length} 駅を表示しています（順位が付いたのは {data.rankedCount}{' '}
                    駅）
                  </p>
                )}
              </>
            )}
            <RecommendFootnotes response={data} />
          </div>
        )}
      </div>
    </>
  )
}
