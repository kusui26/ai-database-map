'use client'

/**
 * 駅の色分けの凡例（地図の右下・2026-10-11 B5c・`docs/261001_fix_user_feedback_ui.md` §6.12.6）。
 *
 * 段の範囲・色・駅の数・色の意味・出典は、すべてサーバ（`GET /api/stations/classes`）とドメイン
 * （`domain/style/coloring.ts`）が決めた言葉をそのまま出す——**ここに文を書かない**（AI が同じ言葉で説明する）。
 *
 * - 携帯は畳んで始める（地図を隠さない）。広い画面は開いて始める。どちらも畳める
 * - ✕ で色分けを消す（URL から外す＝戻るで戻せる）
 * - 色分けしなかった（駅が少ないなど）ときは段を出さず、理由と「強調して出している」を出す
 * - 取得中・取得の失敗（知らない指標・エリア）も、ここで言う（壊れたリンクを開いた人に理由を届ける）
 */

import { useState } from 'react'
import {
  coloringNotesJa,
  coloringScopeJa,
  COLORED_STROKE_COLOR,
  FLAGGED_NOTE_JA,
  isColored,
} from '@/domain/style/coloring'
import { type StationClassesResponse, type StationLegend } from '@/shared/area-summary'
import { cn } from '@/lib/utils'

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full border-[1.5px]"
      style={{ backgroundColor: color, borderColor: COLORED_STROKE_COLOR }}
    />
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-4 transition-transform', open ? 'rotate-180' : 'rotate-0')}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Row({
  color,
  labelJa,
  count,
  noteJa,
}: {
  color: string
  labelJa: string
  count: number
  noteJa?: string
}) {
  return (
    <li className="flex items-center gap-2 text-[12px] leading-5 text-slate-700">
      <Swatch color={color} />
      <span className="min-w-0 flex-1">
        {labelJa}
        {noteJa !== undefined && <span className="text-[11px] text-slate-400">（{noteJa}）</span>}
      </span>
      <span className="shrink-0 text-slate-500 tabular-nums">
        {count.toLocaleString('en-US')} 駅
      </span>
    </li>
  )
}

/** 段と参考値の行（色分けしたときだけ）。 */
function Rows({ legend }: { legend: StationLegend }) {
  if (!isColored(legend)) return null
  return (
    <ul className="mt-2 space-y-0.5" aria-label="色の段">
      {legend.classes.map((cls) => (
        <Row key={cls.index} color={cls.color} labelJa={cls.labelJa} count={cls.count} />
      ))}
      {legend.flagged.count > 0 && (
        <Row
          color={legend.flagged.color}
          labelJa={legend.flagged.labelJa}
          count={legend.flagged.count}
          noteJa={FLAGGED_NOTE_JA}
        />
      )}
    </ul>
  )
}

/** 凡例の本文（範囲・段・注意・出典）。色分けしなかったときは、最初の注意（理由）を目立たせる。 */
function Body({ classes }: { classes: StationClassesResponse }) {
  const { legend } = classes
  const colored = isColored(legend)
  const notes = coloringNotesJa(classes)
  const reasonJa = colored ? null : (notes[0] ?? null)
  const smallNotes = colored ? notes : notes.slice(1)
  return (
    <div>
      <p className="text-[11px] leading-4 text-slate-500">{coloringScopeJa(classes)}</p>
      <Rows legend={legend} />
      {reasonJa !== null && (
        <p className="mt-2 rounded-md bg-amber-50 px-1.5 py-1 text-[11px] leading-4 text-amber-800">
          {reasonJa}
        </p>
      )}
      <ul className="mt-2 space-y-0.5 text-[11px] leading-4 text-slate-500">
        {smallNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] leading-4 text-slate-400">出典: {legend.sourceJa}</p>
    </div>
  )
}

export type ColoringLegendProps = {
  readonly classes: StationClassesResponse | undefined
  readonly isLoading: boolean
  /** 取得の失敗（サーバの日本語・知らない指標やエリアの理由）。 */
  readonly errorJa: string | null
  /** 開いて始めるか（携帯は畳んで始める）。 */
  readonly initiallyOpen: boolean
  readonly onClose: () => void
}

/** 見出し（指標の名前。取得中・失敗はその旨）。 */
function titleOf(props: ColoringLegendProps): string {
  if (props.errorJa !== null) return '色分けできませんでした'
  if (props.classes === undefined) return props.isLoading ? '色分けを読み込み中…' : '色分け'
  return props.classes.legend.titleJa
}

export function ColoringLegend(props: ColoringLegendProps) {
  const [open, setOpen] = useState(props.initiallyOpen)
  const { classes, errorJa, onClose } = props
  return (
    <section
      aria-label="色分けの凡例"
      className="pointer-events-auto max-h-[min(50dvh,30rem)] w-[min(18rem,calc(100vw-1.25rem))] overflow-y-auto rounded-xl bg-white/95 p-2.5 shadow-lg ring-1 ring-slate-200 backdrop-blur"
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-1 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold tracking-wide text-slate-400">
              色分け
            </span>
            <span className="block text-xs leading-4 font-semibold text-slate-800">
              {titleOf(props)}
            </span>
          </span>
          <span className="mt-2 text-slate-400">
            <ChevronIcon open={open} />
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="色分けを消す"
          className="mt-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <CloseIcon />
        </button>
      </div>
      {open && errorJa !== null && (
        <p className="mt-2 rounded-md bg-red-50 px-1.5 py-1 text-[11px] leading-4 text-red-700">
          {errorJa}
        </p>
      )}
      {open && errorJa === null && classes !== undefined && (
        <div className="mt-1.5">
          <Body classes={classes} />
        </div>
      )}
    </section>
  )
}
