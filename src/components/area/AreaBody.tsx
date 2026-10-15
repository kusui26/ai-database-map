'use client'

/**
 * エリアの図の中身（2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。**枠を持たない**ので、広い画面のキャンバス
 * （チャットの右の列）と、狭い画面・携帯のモーダル（`AreaDialog`）の両方に置ける（`RankingBody` と同じ形）。
 *
 * - **エリア**（1〜4）：札を押すと替え、「＋比べる」で足す。選び方は都道府県 → 市区町村・路線の沿線と幅・いまの地図の範囲
 * - **開いた直後**（FAB・エリアが空）：選択中の駅の市区町村、無ければ地図の中心に近い駅で、寄り方に合わせて決める
 *   （サーバ・`GET /api/areas/locate`）。決めた手がかりを添える
 * - **中身**はチャットと同じパネル（`areaSummaryPanels`：要約・推移・内訳）。値と言い方はすべて共通 API が決める
 * - **地図の色分け**の指標と駅の周りの半径を選べる。地図の色分け（URL の `color`）は**図のいまの応答のとおり**に書く——
 *   色分けしなかった・しないなら消す（図と食い違う色分けを地図に残さない・`useMirroredColoring`）
 *
 * 条件は開いた図から始め、変えたら `onConditions` で知らせる（入れ物が URL へ書き戻す＝戻る・進む・リロードで同じ図）。
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { isRadiusM, type RadiusM } from '@/shared/constants'
import { type AreaLocateResponse, type AreaSummaryResponse } from '@/shared/area-summary'
import { areaSummaryPanels } from '@/domain/area-summary/panel'
import { useMapStore } from '@/stores/mapStore'
import { messageJaOf } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'
import { PanelStack } from '@/components/panels/PanelRenderer'
import { useColoringUrlState } from '@/components/map/useColoringUrlState'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { DEFAULT_AREA_RADIUS_M, type AreaFigure } from '@/components/figure/url'
import { AreaColorControls } from './AreaColorControls'
import { AreaPicker } from './AreaPicker'
import { AreaSlots } from './AreaSlots'
import { colorByAtRadius, normalizeColorBy } from './areaColor'
import { samePickTarget, slotLabels, withoutAt, withPicked, type PickTarget } from './areaList'
import { useAreaSummary, type AreaSummaryState } from './useAreaSummary'
import { useLocatedArea } from './useLocatedArea'

function radiusOf(value: number): RadiusM {
  return isRadiusM(value) ? value : DEFAULT_AREA_RADIUS_M
}

type AreaConditions = {
  readonly areas: readonly string[]
  readonly setAreas: Dispatch<SetStateAction<readonly string[]>>
  readonly radiusM: RadiusM
  readonly changeRadius: (radiusM: RadiusM) => void
  readonly colorBy: string | null
  readonly setColorBy: (colorBy: string | null) => void
}

/** 図の条件（エリア・半径・色分け）。半径を替えたら、色分けの指標もその半径で引き直す。 */
function useAreaConditions(initial: AreaFigure): AreaConditions {
  const [areas, setAreas] = useState<readonly string[]>(initial.areas)
  const [radiusM, setRadiusM] = useState<RadiusM>(() => radiusOf(initial.radiusM))
  const [colorBy, setColorBy] = useState<string | null>(() =>
    normalizeColorBy(initial.colorBy, radiusOf(initial.radiusM)),
  )
  const changeRadius = useCallback((next: RadiusM) => {
    setRadiusM(next)
    setColorBy((current) => colorByAtRadius(current, next))
  }, [])
  return { areas, setAreas, radiusM, changeRadius, colorBy, setColorBy }
}

type InitialArea = {
  /** 開いた直後に決めた手がかり（そのエリアのままの間だけ）。 */
  readonly basis: AreaLocateResponse | null
  readonly locating: boolean
  readonly error: Error | undefined
}

/** 開いた直後（エリアが空）のエリアを決める（利用者が先に選んでいれば、それを残す）。 */
function useInitialArea(conditions: AreaConditions, active: boolean): InitialArea {
  const { areas, setAreas } = conditions
  const { grp } = useMapUrlState()
  const viewport = useMapStore((state) => state.viewport)
  const needed = areas.length === 0
  const { located, error } = useLocatedArea(active && needed, grp, viewport)
  const [basis, setBasis] = useState<AreaLocateResponse | null>(null)
  useEffect(() => {
    if (located === undefined) return
    setAreas((current) => (current.length === 0 ? [located.ref] : current))
    setBasis(located)
  }, [located, setAreas])
  const shown = basis !== null && areas.length === 1 && areas[0] === basis.ref ? basis : null
  return {
    basis: shown,
    locating: needed && error === undefined,
    error: needed ? error : undefined,
  }
}

/**
 * 地図の色分けを、図のいまの応答のとおりに書く（色分けしなかった・しないなら消す）。応答ごとに 1 回だけ——
 * 凡例の ✕ で消したあと、同じ応答のまま色分けを戻さない。履歴は積まない（図を開いた履歴・条件の書き戻しに含める）。
 */
function useMirroredColoring(summary: AreaSummaryResponse | undefined, active: boolean): void {
  const { setColoring } = useColoringUrlState()
  const applied = useRef<AreaSummaryResponse | null>(null)
  useEffect(() => {
    if (!active || summary === undefined || applied.current === summary) return
    applied.current = summary
    setColoring(summary.coloring, 'replace')
  }, [active, summary, setColoring])
}

function Notice({ children }: { children: string }) {
  return (
    <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
      {children}
    </div>
  )
}

/** 図の本文（要約・推移・内訳）。条件を替えた直後は、前の図を薄くして出したまま待つ。 */
function AreaContent({ state, initial }: { state: AreaSummaryState; initial: InitialArea }) {
  const { summary, latest, isLoading, error } = state
  const panels = useMemo(() => (latest === undefined ? [] : areaSummaryPanels(latest)), [latest])
  if (initial.error !== undefined) {
    return (
      <Notice>{`${messageJaOf(initial.error, '開いた直後のエリアを決められませんでした。')} エリアを選んでください。`}</Notice>
    )
  }
  if (error !== undefined) {
    return (
      <Notice>
        {messageJaOf(error, 'エリアの要約を取得できませんでした。時間をおいて再度お試しください。')}
      </Notice>
    )
  }
  if (latest === undefined) {
    const waiting = initial.locating
      ? 'エリアを決めています…'
      : isLoading
        ? '集計中…'
        : 'エリアを選んでください'
    return <div className="grid min-h-40 place-items-center text-sm text-slate-400">{waiting}</div>
  }
  const stale = summary === undefined
  return (
    <div aria-busy={stale}>
      {stale && <p className="mb-2 text-xs text-slate-400">集計中…</p>}
      <PanelStack panels={panels} className={cn('transition-opacity', stale && 'opacity-50')} />
    </div>
  )
}

/** 選び方の見出しと「決める」の言葉。 */
function pickerWords(
  target: PickTarget,
  areas: readonly string[],
  labels: readonly (string | null)[],
): { readonly headingJa: string; readonly submitJa: string } {
  if (target.mode === 'replace') {
    const label = labels[target.index] ?? 'エリア'
    return { headingJa: `「${label}」を替える`, submitJa: 'このエリアにする' }
  }
  return areas.length === 0
    ? { headingJa: 'エリアを選ぶ', submitJa: 'このエリアにする' }
    : { headingJa: '比べるエリアを足す', submitJa: '比べる' }
}

type PickerState = {
  /** 開いている選び方の入れ先（閉じていれば null）。 */
  readonly target: PickTarget | null
  /** 開く（同じ札・「＋比べる」をもう一度押したら閉じる）。 */
  readonly toggle: (next: PickTarget) => void
  readonly close: () => void
}

/** 選び方の開閉。開いた直後のエリアを決められなければ、選び方を開いておく（行き止まりにしない・閉じてもよい）。 */
function usePicker(locateError: Error | undefined): PickerState {
  const [target, setTarget] = useState<PickTarget | null>(null)
  useEffect(() => {
    if (locateError !== undefined) setTarget((current) => current ?? { mode: 'add' })
  }, [locateError])
  const toggle = useCallback((next: PickTarget) => {
    setTarget((current) => (current !== null && samePickTarget(current, next) ? null : next))
  }, [])
  const close = useCallback(() => setTarget(null), [])
  return { target, toggle, close }
}

/** 図の上の操作（エリアの札・選び方・開いた直後の手がかり・地図の色分けと半径）。 */
function AreaControls({
  conditions,
  labels,
  picker,
  basis,
}: {
  conditions: AreaConditions
  labels: readonly (string | null)[]
  picker: PickerState
  basis: AreaLocateResponse | null
}) {
  const { areas, setAreas, radiusM, changeRadius, colorBy, setColorBy } = conditions
  const { target, toggle, close } = picker
  const pick = (ref: string): void => {
    if (target !== null) setAreas((current) => withPicked(current, target, ref))
    close()
  }
  const remove = (index: number): void => {
    setAreas((current) => withoutAt(current, index))
    close()
  }
  const current = target?.mode === 'replace' ? (areas[target.index] ?? null) : null
  return (
    <div className="space-y-3 border-b border-slate-100 px-4 py-3">
      <AreaSlots
        areas={areas}
        labels={labels}
        picking={target}
        onPick={(index) => toggle({ mode: 'replace', index })}
        onRemove={remove}
        onAdd={() => toggle({ mode: 'add' })}
      />
      {target !== null ? (
        <AreaPicker
          key={target.mode === 'add' ? 'add' : `replace:${target.index}`}
          {...pickerWords(target, areas, labels)}
          currentRef={current}
          anchorRef={current ?? areas[0] ?? null}
          onPick={pick}
          onCancel={close}
        />
      ) : (
        basis !== null && (
          <p className="text-[11px] text-slate-500">
            ⓘ {basis.basisJa}を開きました。札を押すと替えられます。
          </p>
        )
      )}
      <AreaColorControls
        radiusM={radiusM}
        colorBy={colorBy}
        onColorBy={setColorBy}
        onRadius={changeRadius}
      />
    </div>
  )
}

export function AreaBody({
  initial,
  active,
  onConditions,
}: {
  /** 開いた図（条件の初期値）。FAB で開いた直後はエリアが空＝既定のエリアを決める。 */
  initial: AreaFigure
  /** 表示中か（false の間は取得しない。モーダルの open／キャンバスの表示状態）。 */
  active: boolean
  /** 条件が変わったら呼ぶ（開いた直後の既定の補完を含む）。入れ物が URL へ書き戻す。 */
  onConditions?: (figure: AreaFigure) => void
}) {
  const conditions = useAreaConditions(initial)
  const { areas, radiusM, colorBy } = conditions
  useEffect(() => {
    onConditions?.({ kind: 'area', areas, radiusM, colorBy })
  }, [onConditions, areas, radiusM, colorBy])
  const initialArea = useInitialArea(conditions, active)
  const state = useAreaSummary({ areas, radiusM, colorBy }, active)
  useMirroredColoring(state.summary, active)
  const picker = usePicker(initialArea.error)
  const labels = slotLabels(areas, state.summary, state.latest, state.error !== undefined)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <AreaControls
        conditions={conditions}
        labels={labels}
        picker={picker}
        basis={initialArea.basis}
      />
      <div className="px-4 py-3">
        <AreaContent state={state} initial={initialArea} />
      </div>
    </div>
  )
}
