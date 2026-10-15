'use client'

/**
 * エリアの選び方（図の中に開く・2026-10-15 B5e・`docs/261001_fix_user_feedback_ui.md` §6.12.10）。
 *
 * 選び方は 3 つ：行政区域（都道府県 → 市区町村。政令市は全体と区）・路線の沿線（L4 の並べ方と幅）・いまの地図の範囲。
 * 札を押したときは、そのエリアの選び方の段を開いて、そのエリアを選んだ状態で始める（沿線なら沿線の段）。
 * ポップオーバーにしない——キャンバスの列・モーダル・携帯のどれでも同じ形で、図の中に押し広げて出す。
 */

import { useState } from 'react'
import { parseAreaRef } from '@/shared/area-ref'
import { MAP_AREA_LABEL_JA } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { AdminAreaTab } from './AdminAreaTab'
import { LineAreaTab } from './LineAreaTab'
import { MapAreaTab } from './MapAreaTab'

type PickerTab = 'admin' | 'line' | 'map'

const TAB_LABELS_JA: Readonly<Record<PickerTab, string>> = {
  admin: '市区町村',
  line: '沿線',
  map: MAP_AREA_LABEL_JA,
}
const TABS: readonly PickerTab[] = ['admin', 'line', 'map']

/** 札のエリアの選び方の段（沿線は沿線・範囲は範囲・ほかは行政区域）。 */
function tabOf(ref: string | null): PickerTab {
  const parsed = ref === null ? null : parseAreaRef(ref)
  if (parsed === null || !parsed.ok) return 'admin'
  if (parsed.ref.type === 'line') return 'line'
  return parsed.ref.type === 'bbox' ? 'map' : 'admin'
}

function TabButtons({ tab, onTab }: { tab: PickerTab; onTab: (tab: PickerTab) => void }) {
  return (
    <div
      role="group"
      aria-label="エリアの選び方"
      className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5"
    >
      {TABS.map((each) => (
        <button
          key={each}
          type="button"
          aria-pressed={each === tab}
          onClick={() => onTab(each)}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            each === tab
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {TAB_LABELS_JA[each]}
        </button>
      ))}
    </div>
  )
}

export function AreaPicker({
  headingJa,
  currentRef,
  anchorRef,
  submitJa,
  onPick,
  onCancel,
}: {
  /** 見出し（「比べるエリアを足す」「「神奈川県横浜市」を替える」）。 */
  headingJa: string
  /** 替えるエリア（足すときは null）。 */
  currentRef: string | null
  /** 行政区域の段で、開いた直後に選んでおくエリア（替えるエリア・無ければ 1 つ目のエリア）。 */
  anchorRef: string | null
  submitJa: string
  onPick: (ref: string) => void
  onCancel: () => void
}) {
  const [tab, setTab] = useState<PickerTab>(tabOf(currentRef))
  return (
    <section
      aria-label={headingJa}
      className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold text-slate-700">{headingJa}</h3>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
        >
          やめる
        </button>
      </div>
      <TabButtons tab={tab} onTab={setTab} />
      {tab === 'admin' && (
        <AdminAreaTab anchorRef={anchorRef} submitJa={submitJa} onPick={onPick} />
      )}
      {tab === 'line' && (
        <LineAreaTab currentRef={currentRef} submitJa={submitJa} onPick={onPick} />
      )}
      {tab === 'map' && <MapAreaTab submitJa={submitJa} onPick={onPick} />}
    </section>
  )
}
