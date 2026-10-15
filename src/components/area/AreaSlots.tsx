'use client'

/**
 * エリアの図の「エリアの札」（2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * 札を押すとそのエリアを替え、✕ で外し（2 つ以上のとき）、「＋比べる」で足す（4 つまで）。比べているときは札に推移の図の
 * 系列の色（`areaSeriesColor`）の印を付ける——どの線がどのエリアか、札と図が同じ色で分かる。
 */

import { areaSeriesColor } from '@/domain/style/palette'
import { MAX_AREAS } from '@/shared/area-ref'
import { cn } from '@/lib/utils'
import { canAddArea, type PickTarget } from './areaList'

/** 名前がまだ無い札（条件を替えた直後）。 */
const LOADING_LABEL_JA = '読み込み中…'

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0 text-indigo-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

function AreaSlot({
  label,
  color,
  active,
  removable,
  onPick,
  onRemove,
}: {
  label: string | null
  /** 比べているときの系列の色（1 つなら null）。 */
  color: string | null
  active: boolean
  removable: boolean
  onPick: () => void
  onRemove: () => void
}) {
  const text = label ?? LOADING_LABEL_JA
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center rounded-lg border text-sm',
        active ? 'border-indigo-400 bg-indigo-100' : 'border-indigo-200 bg-indigo-50',
      )}
    >
      <button
        type="button"
        onClick={onPick}
        aria-label={`${text}（押すとエリアを替える）`}
        aria-pressed={active}
        title={text}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-lg py-1 pr-1.5 pl-2.5 text-indigo-800 transition-colors hover:bg-indigo-100"
      >
        {color !== null && (
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className={cn('truncate', label === null && 'text-indigo-400')}>{text}</span>
        <Chevron />
      </button>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${text}を外す`}
          title="このエリアを外す"
          className="mr-1 rounded-md p-0.5 text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
        >
          <RemoveIcon />
        </button>
      )}
    </span>
  )
}

function AddButton({
  disabled,
  active,
  first,
  onClick,
}: {
  disabled: boolean
  active: boolean
  /** まだエリアが無い（「エリアを選ぶ」）。 */
  first: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? `比べられるのは ${MAX_AREAS} つまでです` : undefined}
      className={cn(
        'rounded-lg border border-dashed px-2.5 py-1 text-sm font-medium transition-colors',
        active
          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
          : 'border-slate-300 text-slate-600 hover:border-indigo-300 hover:text-indigo-700',
        'disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300',
      )}
    >
      {first ? 'エリアを選ぶ' : '＋比べる'}
    </button>
  )
}

export function AreaSlots({
  areas,
  labels,
  picking,
  onPick,
  onRemove,
  onAdd,
}: {
  areas: readonly string[]
  /** 札の名前（`areas` と同じ並び・null＝読み込み中）。 */
  labels: readonly (string | null)[]
  picking: PickTarget | null
  onPick: (index: number) => void
  onRemove: (index: number) => void
  onAdd: () => void
}) {
  const comparing = areas.length > 1
  return (
    <div role="group" aria-label="エリア" className="flex flex-wrap items-center gap-1.5">
      {areas.map((ref, index) => (
        <AreaSlot
          key={ref}
          label={labels[index] ?? null}
          color={comparing ? areaSeriesColor(index) : null}
          active={picking?.mode === 'replace' && picking.index === index}
          removable={comparing}
          onPick={() => onPick(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
      <AddButton
        disabled={!canAddArea(areas)}
        active={picking?.mode === 'add'}
        first={areas.length === 0}
        onClick={onAdd}
      />
    </div>
  )
}
