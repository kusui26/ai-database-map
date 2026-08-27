'use client'

/**
 * escapeDirection Panel のレンダラ（脱出方向・`docs/260824_flood.md` §8.6）。
 *
 * 描画だけを担い、方向・距離・限界はすべてサーバが持つ。
 * ここで守る不変条件は 3 つ：
 *  1. **矢印は方角だけ**——道順ではない。八方位の文字を必ず添える（記号だけにしない・§7.6）
 *  2. **限界を畳まない**（直線距離である／移動が安全とは限らない／250m の目安）
 *  3. **「そちらへ移動してください」と書かない**——文言はサーバの `headlineJa` をそのまま出す
 */

import { type EscapeDirectionPanel } from '@/shared/protocol'
import { cn } from '@/lib/utils'
import { Emphasis } from './Emphasis'

/** 八方位 → 矢印の回転角（北が 0 度・時計回り）。 */
const BEARING_DEGREES: Readonly<Record<string, number>> = {
  北: 0,
  北東: 45,
  東: 90,
  南東: 135,
  南: 180,
  南西: 225,
  西: 270,
  北西: 315,
}

/** 方角の矢印（**文字と併記**する。記号だけでは伝わらない）。 */
function BearingArrow({ bearingJa }: { bearingJa: string }) {
  const degrees = BEARING_DEGREES[bearingJa]
  if (degrees === undefined) return null
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6 shrink-0 text-emerald-700"
      style={{ transform: `rotate(${degrees}deg)` }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 20V5M12 5l-5 5M12 5l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function EscapeDirection({ panel }: { panel: EscapeDirectionPanel }) {
  const compact = panel.size === 'compact'

  return (
    <section className={cn('rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn('font-bold text-slate-900', compact ? 'text-base' : 'text-lg')}>
          {panel.placeJa}から出るには
        </h2>
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {panel.forDisasterJa}
        </span>
      </div>

      {panel.direction !== null && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
          <BearingArrow bearingJa={panel.direction.bearingJa} />
          <p className="text-sm font-semibold text-emerald-900">
            {panel.direction.bearingJa}へ {panel.direction.distanceJa}
          </p>
        </div>
      )}

      <p className="mt-2 text-sm text-slate-800">
        <Emphasis text={panel.headlineJa} />
      </p>

      {panel.notesJa.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {panel.notesJa.map((note) => (
            <li key={note}>
              <Emphasis text={note} />
            </li>
          ))}
        </ul>
      )}

      {/* 限界は**必ず全部**。方向と距離だけが独り歩きすると、経路案内だと読まれる。 */}
      <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
        {panel.limitationsJa.map((limitation) => (
          <li key={limitation}>
            ※ <Emphasis text={limitation} />
          </li>
        ))}
      </ul>

      {panel.sources.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400">
          {panel.sources.map((source) => (
            <li key={source.labelJa}>
              {source.url === null ? (
                source.labelJa
              ) : (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-slate-600"
                >
                  {source.labelJa}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-slate-500">ⓘ {panel.disclaimerJa}</p>
    </section>
  )
}
