'use client'

/**
 * エリアの選び方：行政区域（都道府県 → 市区町村・2026-10-15 B5e・§6.12.10）。
 *
 * 1 段目で全国か都道府県を選び、2 段目でその全体・東京 23 区・政令市（全体と区）・市区町村を選ぶ（`areaOptions.ts`）。
 * 選択肢はエリアの一覧（`GET /api/areas`）から作る。どちらもふつうの `<select>`——携帯では OS の選び方が出て、長い一覧も選びやすい。
 * 開いた直後は、替えるエリア（無ければ 1 つ目のエリア）の都道府県と、そのエリアを選んだ状態にする。
 */

import { useMemo, useState } from 'react'
import { type AreaCatalogEntry } from '@/shared/area-summary'
import { messageJaOf } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'
import { METRIC_SELECT_CLASS } from '@/components/metrics/MetricSelect'
import {
  areaOptionGroups,
  prefectureOptions,
  prefectureRefOf,
  type AreaOptionGroup,
} from './areaOptions'
import { SubmitButton } from './SubmitButton'
import { useAreaCatalog } from './useAreaCatalog'

/** 2 段目で選んでいるエリア（選び直していなければ、手がかりのエリアかその都道府県の全体）。 */
function chosenAreaOf(
  groups: readonly AreaOptionGroup[],
  chosen: string | null,
  anchorRef: string | null,
): string {
  const refs = groups.flatMap((group) => group.options.map((option) => option.ref))
  if (chosen !== null && refs.includes(chosen)) return chosen
  if (anchorRef !== null && refs.includes(anchorRef)) return anchorRef
  return refs[0] ?? ''
}

function AdminSelects({
  entries,
  anchorRef,
  submitJa,
  onPick,
}: {
  entries: readonly AreaCatalogEntry[]
  anchorRef: string | null
  submitJa: string
  onPick: (ref: string) => void
}) {
  const [chosenPrefecture, setChosenPrefecture] = useState<string | null>(null)
  const [chosenArea, setChosenArea] = useState<string | null>(null)
  const prefectures = useMemo(() => prefectureOptions(entries), [entries])
  const anchorPrefecture = anchorRef === null ? null : prefectureRefOf(entries, anchorRef)
  const prefectureRef = chosenPrefecture ?? anchorPrefecture ?? ''
  const groups = useMemo(() => areaOptionGroups(entries, prefectureRef), [entries, prefectureRef])
  const areaRef = chosenAreaOf(groups, chosenArea, anchorRef)
  const onPrefecture = (value: string): void => {
    setChosenPrefecture(value)
    setChosenArea(null)
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="都道府県"
          className={METRIC_SELECT_CLASS}
          value={prefectureRef}
          onChange={(event) => onPrefecture(event.target.value)}
        >
          {prefectureRef === '' && <option value="">都道府県を選ぶ</option>}
          {prefectures.map((option) => (
            <option key={option.ref} value={option.ref}>
              {option.labelJa}
            </option>
          ))}
        </select>
        <select
          aria-label="市区町村"
          className={cn(METRIC_SELECT_CLASS, 'w-full min-w-0 sm:w-auto sm:flex-1')}
          value={areaRef}
          disabled={prefectureRef === ''}
          onChange={(event) => setChosenArea(event.target.value)}
        >
          {groups.map((group) => (
            <optgroup key={group.labelJa} label={group.labelJa}>
              {group.options.map((option) => (
                <option key={option.ref} value={option.ref}>
                  {option.labelJa}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <SubmitButton disabled={areaRef === ''} onClick={() => onPick(areaRef)}>
        {submitJa}
      </SubmitButton>
    </>
  )
}

export function AdminAreaTab({
  anchorRef,
  submitJa,
  onPick,
}: {
  /** 開いた直後に選んでおくエリア（替えるエリア・無ければ 1 つ目のエリア）。 */
  anchorRef: string | null
  submitJa: string
  onPick: (ref: string) => void
}) {
  const { entries, isLoading, error } = useAreaCatalog(true)
  if (error !== undefined) {
    return (
      <p className="text-xs text-amber-700">
        {messageJaOf(error, 'エリアの一覧を取得できませんでした。時間をおいて再度お試しください。')}
      </p>
    )
  }
  if (isLoading || entries.length === 0) {
    return <p className="text-xs text-slate-400">エリアの一覧を読み込み中…</p>
  }
  return (
    <AdminSelects entries={entries} anchorRef={anchorRef} submitJa={submitJa} onPick={onPick} />
  )
}
