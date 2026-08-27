'use client'

/**
 * 警戒バナー（`docs/260824_flood.md` §7.4）。**平時と同じ画面のままにしない**ための本体。
 *
 * 警戒レベル3相当以上が出ている地域を見ているときだけ、ヘッダの一番上に出る。
 *
 * ## 書いてよいこと・絶対に書かないこと
 *
 * 出すのは気象庁が発表しているものだけで、文言は**必ず「◯◯相当」**。
 * **「避難指示が出ています」とは絶対に書かない**——避難情報を出すのは市町村で、
 * このアプリは知り得ない。だから限界の 1 文（`limitationsJa`）を**畳まずに常時出す**。
 *
 * ## 文言は 1 文字もここで作らない
 *
 * 見出し・根拠・限界・出典はすべて共通API が返したものをそのまま並べる。
 * ここで言い換えると、**同じ状況について AI とバナーが違うことを言い出す**（`.claude/CLAUDE.md` §2）。
 */

import { useState } from 'react'
import {
  ALERT_LEVEL_LABELS_JA,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
} from '@/shared/constants'
import { hazardAlertCardPanel, reportedAtJa } from '@/domain/hazard/panels'
import { isWarningMode } from '@/domain/hazard/warning-mode'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useIsOnline } from '@/hooks/useIsOnline'
import type { HazardAlertsResponse } from '@/shared/api'
import { useAlertTarget, useHazardAlerts } from './useHazardAlerts'

/** どこの「今」を見ているか（主語をはっきりさせる）。 */
function whereJa(alerts: HazardAlertsResponse, isCurrentPosition: boolean): string {
  const place = isCurrentPosition ? '現在地' : '地図の中心'
  const area = alerts.area
  return area === null ? place : `${place}：${area.prefectureJa}${area.municipalityJa}`
}

export function HazardAlertBanner() {
  const target = useAlertTarget()
  const { alerts } = useHazardAlerts(target)
  const online = useIsOnline()
  const [open, setOpen] = useState(false)

  // 平時は何も出さない（レベル1・2 で毎回バナーを出すと、肝心のときに読まれなくなる）。
  if (alerts === undefined || target === null || !isWarningMode(alerts.alertLevel)) return null

  const reported = reportedAtJa(alerts.reportedAt)
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-auto mb-2 overflow-hidden rounded-xl bg-white/95 shadow-lg ring-1 ring-slate-200 backdrop-blur"
    >
      <div
        className="flex items-start gap-2 px-3 py-2"
        // 危険度は**色だけで伝えない**（§7.6）。左の帯＋アイコン＋文字の 3 重で示す。
        style={{ borderLeft: `6px solid ${HAZARD_LEVEL_COLORS[alerts.level]}` }}
      >
        <span
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: HAZARD_LEVEL_COLORS[alerts.level] }}
        >
          <span aria-hidden>{HAZARD_LEVEL_ICONS[alerts.level]}</span>
          {ALERT_LEVEL_LABELS_JA[alerts.alertLevel]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold break-words text-slate-900">
            {alerts.headlineJa}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {whereJa(alerts, target.isCurrentPosition)}
            {reported === null ? '' : ` ／ ${reported}`}
          </p>
          {/* 畳まない。バナーでいちばん誤解を防ぐ 1 文である。 */}
          {alerts.limitationsJa.map((limitation) => (
            <p key={limitation} className="mt-1 text-[11px] leading-snug text-slate-600">
              {limitation}
            </p>
          ))}
          {!online && (
            <p className="mt-1 text-[11px] leading-snug font-medium text-amber-700">
              オフラインのため、この発表は更新されていません。上の発表時刻を確認してください。
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
        >
          {open ? '閉じる' : '詳しく見る'}
        </button>
      </div>
      {open && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-slate-200 bg-slate-50 p-2">
          <PanelRenderer panel={hazardAlertCardPanel(alerts, 'compact')} />
        </div>
      )}
    </div>
  )
}
