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
 *
 * ## 条件は URL に置く
 *
 * 開いたときに URL から読み、変わったら書き戻す（`history: 'replace'`）。共有できて、
 * 再現できて、閉じても消えない。中身は閉じるたびに unmount されるので、ここが唯一の置き場になる。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryStates } from 'nuqs'
import { useMapStore } from '@/stores/mapStore'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useStationFilters } from '@/components/metrics/useStationFilters'
import { resultAdvice } from './advice'
import { RecommendControls } from './RecommendControls'
import {
  RecommendAdvice,
  RecommendFlaggedNote,
  RecommendFootnotes,
  RecommendSummaryBar,
} from './RecommendNotes'
import { RecommendTable, WeightLegend } from './RecommendTable'
import { hasArea, type RecommendCriteria } from './query'
import { criteriaFromUrl, criteriaToUrl, RECOMMEND_PARSERS } from './url'
import { useMunicipalities } from './useMunicipalities'
import { useDebounced, useRecommend } from './useRecommend'

/** URL の書き換えは、取得と同じ間隔で落ち着かせる（スライダ 1 回で何十回も書かない）。 */
const URL_DEBOUNCE_MS = 400

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
  const [urlValues, setUrlValues] = useQueryStates(RECOMMEND_PARSERS, { history: 'replace' })
  // URL は**開いたときにだけ**読む（以後は書くだけ。戻る/進むで途中に戻らないよう replace にしてある）。
  const [initial] = useState<RecommendCriteria>(() => criteriaFromUrl(urlValues))
  const filters = useStationFilters(active, initial)
  const [recipe, setRecipe] = useState<RecommendCriteria>(initial)
  const prefectures = filters.values.prefectures
  const prefecture = prefectures.length === 1 ? (prefectures[0] ?? null) : null
  const municipalities = useMunicipalities(active ? prefecture : null)

  // 都道府県が**変わったら**市区町村は捨てる（別の県の市区町村が残ると 0 件になる）。
  // 初回は捨てない——URL で渡された条件が、開いた瞬間に消えてしまう。
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
  const latest = useRef(criteria)
  latest.current = criteria

  // 条件が落ち着いたら URL へ。既定と同じ値は nuqs が自動で消す（URL を既定で汚さない）。
  const urlKey = useDebounced(JSON.stringify(criteriaToUrl(criteria)), URL_DEBOUNCE_MS)
  const written = useRef(JSON.stringify(criteriaToUrl(initial)))
  useEffect(() => {
    const next = criteriaToUrl(latest.current)
    const key = JSON.stringify(next)
    if (key === written.current) return
    written.current = key
    void setUrlValues(next)
  }, [urlKey, setUrlValues])

  const { data, isLoading, isRefreshing, errorJa } = useRecommend(criteria, active)

  // 地図に上位を印す。**表を閉じたあとも残す**——地図の上で場所を確かめるのが次の一手なので。
  const setHighlightedGrps = useMapStore((state) => state.setHighlightedGrps)
  useEffect(() => {
    if (data === undefined) return
    setHighlightedGrps(data.rows.slice(0, data.topN).map((row) => row.grp))
  }, [data, setHighlightedGrps])

  const onChange = useCallback((patch: Partial<RecommendCriteria>) => {
    setRecipe((current) => ({ ...current, ...patch }))
  }, [])

  const advice = data === undefined ? null : resultAdvice(data)

  // 狭い画面では、結果が出たら条件を畳む。つまみ全部で画面の 6 割が埋まると、
  // 「直して確かめる」のたびに上下へ長くスクロールすることになる（実測 390px）。
  // 自分で開けたあとは畳まない（`hasResult` が変わらないので再発火しない）。
  const isDesktop = useIsDesktop()
  const [openControls, setOpenControls] = useState(true)
  const hasResult = data !== undefined
  useEffect(() => {
    if (!isDesktop && hasResult) setOpenControls(false)
  }, [isDesktop, hasResult])

  return (
    <>
      <div className="border-b border-slate-100 px-4 py-3">
        {openControls ? (
          <>
            <RecommendControls
              criteria={criteria}
              filters={filters}
              municipalities={municipalities}
              onChange={onChange}
            />
            {!isDesktop && hasResult && (
              <button
                type="button"
                onClick={() => setOpenControls(false)}
                className="mt-2 w-full rounded-lg bg-slate-50 py-1.5 text-xs font-medium text-slate-500"
              >
                条件を閉じる
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpenControls(true)}
            className="flex w-full items-center justify-between gap-2 text-left text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-slate-700">
              {data?.area.labelJa}
              <span className="ml-1.5 text-xs text-slate-400">{data?.preset.labelJa}</span>
            </span>
            <span className="shrink-0 text-xs font-medium text-indigo-600">条件を変える</span>
          </button>
        )}
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
            {advice !== null && <RecommendAdvice advice={advice} />}
            {data.rankedCount > 0 && (
              <>
                <div className="mt-3">
                  <WeightLegend metrics={data.metrics} />
                  <RecommendFlaggedNote response={data} />
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
