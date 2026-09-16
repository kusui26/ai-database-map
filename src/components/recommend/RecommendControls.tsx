'use client'

/**
 * おすすめの条件（エリア・ペルソナ・重み・災害の扱い・正規化の方法）。
 *
 * 並びは「どこを → どんな人向けに → 何をどれだけ重く → 災害をどう扱うか」。
 * 絞り込みの 3 セレクタ（都道府県・会社・路線）は**ランキング／散布と同じ部品**を使う
 * （同じ条件の指定が画面ごとに違う、という食い違いを作らない・260801）。
 */

import {
  HAZARD_GROUP_LABELS_JA,
  HAZARD_LEVEL_LABELS_JA,
  RADII_M,
  radiusLabel,
  type HazardLevel,
} from '@/shared/constants'
import { SUMMARY_HAZARD_GROUPS, type SummaryHazardGroup } from '@/shared/hazard-summary'
import type { HazardPolicyMode, NormalizeMethod } from '@/shared/recommend'
import { HAZARD_PENALTY_LABELS_JA, PRESET_IDS, RECOMMEND_PRESETS } from '@/domain/recommend/presets'
import { METRIC_SELECT_CLASS } from '@/components/metrics/MetricSelect'
import { StationFilterControls } from '@/components/metrics/StationFilterControls'
import type { StationFiltersState } from '@/components/metrics/useStationFilters'
import { cn } from '@/lib/utils'
import type { RecommendCriteria } from './query'
import type { MunicipalitiesState } from './useMunicipalities'
import { WeightSliders } from './WeightSliders'

/** 足切りに使える下限。`none` は入れない——「想定区域外以上」は候補が全部消えるだけで意味がない。 */
const CUTOFF_LEVELS: readonly HazardLevel[] = ['caution', 'warning', 'danger', 'critical']

const METHOD_LABELS_JA: Readonly<Record<NormalizeMethod, string>> = {
  percentile: 'パーセンタイル',
  minmax: 'min-max',
  zscore: 'z-score',
}

const HAZARD_MODE_LABELS_JA: Readonly<Record<HazardPolicyMode, string>> = {
  exclude: '足切り',
  penalty: '段階減点',
  off: '見ない',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
      {label}
      {children}
    </label>
  )
}

/**
 * セグメント（半径セレクタと同じ見た目・`MetricSelect` の作法に合わせる）。
 *
 * `overflow-x-auto` は必須。**入れないと狭い画面で右端の選択肢が切れて押せなくなる**
 * （実測：390px で「予算重視」がモーダルの外にはみ出して消えた）。
 */
function Segment<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex min-w-0 shrink gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5"
    >
      {options.map(([option, labelJa]) => (
        <button
          key={String(option)}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={cn(
            'shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            option === value
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {labelJa}
        </button>
      ))}
    </div>
  )
}

/** 市区町村（都道府県を 1 つに絞ったときだけ。実在する値だけを出すので空振りしない）。 */
function MunicipalitySelect({
  value,
  prefecture,
  state,
  onChange,
}: {
  value: string
  prefecture: string | null
  state: MunicipalitiesState
  onChange: (value: string) => void
}) {
  if (prefecture === null) {
    return <span className="text-xs text-slate-400">都道府県を 1 つ選ぶと市区町村を選べます</span>
  }
  return (
    <select
      // 狭い画面では折り返して 1 行を占める（詰めると「横…」まで縮んで選べなくなる）。
      className={cn(METRIC_SELECT_CLASS, 'w-full min-w-40 sm:w-auto sm:max-w-64 sm:flex-1')}
      aria-label="市区町村"
      value={value}
      disabled={state.isLoading}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{state.isLoading ? '読み込み中…' : `${prefecture}（全域）`}</option>
      <optgroup label="市全体（区をまとめる）">
        {state.options
          .filter((option) => option.kind === 'city')
          .map((option) => (
            <option key={`city:${option.value}`} value={option.value}>
              {option.labelJa}・{option.stationCount} 駅
            </option>
          ))}
      </optgroup>
      <optgroup label="市区町村">
        {state.options
          .filter((option) => option.kind === 'municipality')
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.labelJa}・{option.stationCount} 駅
            </option>
          ))}
      </optgroup>
    </select>
  )
}

/** 災害の扱い。**線形加点は選択肢に無い**（順序尺度なので・§13.4-3）。 */
function HazardControls({
  criteria,
  onChange,
}: {
  criteria: RecommendCriteria
  onChange: (patch: Partial<RecommendCriteria>) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-slate-400">災害</span>
      <Segment
        ariaLabel="災害の扱い"
        value={criteria.hazard}
        onChange={(hazard) => onChange({ hazard })}
        options={(['exclude', 'penalty', 'off'] as const).map((mode) => [
          mode,
          HAZARD_MODE_LABELS_JA[mode],
        ])}
      />
      {criteria.hazard !== 'off' && (
        <select
          className={METRIC_SELECT_CLASS}
          aria-label="災害の種類"
          value={criteria.hazardGroup}
          onChange={(event) => onChange({ hazardGroup: toGroup(event.target.value) })}
        >
          {SUMMARY_HAZARD_GROUPS.map((group) => (
            <option key={group} value={group}>
              {HAZARD_GROUP_LABELS_JA[group]}
            </option>
          ))}
        </select>
      )}
      {criteria.hazard === 'exclude' && (
        <Field label="この危険度以上を外す">
          <select
            className={METRIC_SELECT_CLASS}
            aria-label="足切りの下限"
            value={criteria.hazardAtOrAbove}
            onChange={(event) => onChange({ hazardAtOrAbove: toLevel(event.target.value) })}
          >
            {CUTOFF_LEVELS.map((level) => (
              <option key={level} value={level}>
                {HAZARD_LEVEL_LABELS_JA[level]}
              </option>
            ))}
          </select>
        </Field>
      )}
      {criteria.hazard === 'penalty' && (
        <Field label="減点の強さ">
          <Segment
            ariaLabel="減点の強さ"
            value={criteria.hazardPenalty}
            onChange={(hazardPenalty) => onChange({ hazardPenalty })}
            options={(['light', 'standard', 'heavy'] as const).map((id) => [
              id,
              HAZARD_PENALTY_LABELS_JA[id],
            ])}
          />
        </Field>
      )}
    </div>
  )
}

/** 文字列 → 列挙（`as` を使わずに型を絞る）。知らない値は既定へ。 */
function toGroup(value: string): SummaryHazardGroup {
  return SUMMARY_HAZARD_GROUPS.find((group) => group === value) ?? 'flood'
}

function toLevel(value: string): HazardLevel {
  return CUTOFF_LEVELS.find((level) => level === value) ?? 'danger'
}

function toMethod(value: string): NormalizeMethod {
  const methods: readonly NormalizeMethod[] = ['percentile', 'minmax', 'zscore']
  return methods.find((method) => method === value) ?? 'percentile'
}

export function RecommendControls({
  criteria,
  filters,
  municipalities,
  onChange,
}: {
  criteria: RecommendCriteria
  filters: StationFiltersState
  municipalities: MunicipalitiesState
  onChange: (patch: Partial<RecommendCriteria>) => void
}) {
  const prefecture = filters.values.prefectures.length === 1 ? filters.values.prefectures[0] : null
  const customized = Object.keys(criteria.weights).length > 0

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StationFilterControls state={filters} />
        <MunicipalitySelect
          value={criteria.municipality}
          prefecture={prefecture ?? null}
          state={municipalities}
          onChange={(municipality) => onChange({ municipality })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segment
          ariaLabel="ペルソナ"
          value={criteria.preset}
          onChange={(preset) => onChange({ preset, weights: {} })}
          options={PRESET_IDS.map((id) => [id, RECOMMEND_PRESETS[id].labelJa])}
        />
        <Field label="半径">
          <Segment
            ariaLabel="集計半径"
            value={criteria.radiusM}
            onChange={(radiusM) => onChange({ radiusM })}
            options={RADII_M.map((radius) => [radius, radiusLabel(radius)])}
          />
        </Field>
        <Field label="正規化">
          <select
            className={METRIC_SELECT_CLASS}
            aria-label="正規化の方法"
            value={criteria.method}
            onChange={(event) => onChange({ method: toMethod(event.target.value) })}
          >
            {(['percentile', 'minmax', 'zscore'] as const).map((method) => (
              <option key={method} value={method}>
                {METHOD_LABELS_JA[method]}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={criteria.flagged === 'exclude'}
            onChange={(event) =>
              onChange({ flagged: event.target.checked ? 'exclude' : 'annotate' })
            }
            className="size-4 accent-indigo-600"
          />
          ⚠除外
        </label>
      </div>

      <details className="rounded-lg bg-slate-50 px-2.5 py-1.5">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          重みを調整
          <span className="ml-1 font-normal text-slate-400">
            {customized
              ? '（既定から変更しています）'
              : `（${RECOMMEND_PRESETS[criteria.preset].noteJa}）`}
          </span>
        </summary>
        <div className="mt-2">
          <WeightSliders
            preset={criteria.preset}
            weights={criteria.weights}
            onChange={(weights) => onChange({ weights })}
          />
        </div>
      </details>

      <HazardControls criteria={criteria} onChange={onChange} />
    </div>
  )
}
