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

import { useEffect, useState } from 'react'
import {
  ALERT_LEVEL_LABELS_JA,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
} from '@/shared/constants'
import {
  escapeDirectionPanel,
  evacuationListPanel,
  hazardAlertCardPanel,
  reportedAtJa,
} from '@/domain/hazard/panels'
import { evacuationDisasterFor, isWarningMode } from '@/domain/hazard/warning-mode'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useIsOnline } from '@/hooks/useIsOnline'
import { cn } from '@/lib/utils'
import { useMapStore } from '@/stores/mapStore'
import type { HazardAlertsResponse } from '@/shared/api'
import { useAlertTarget, useHazardAlerts } from './useHazardAlerts'
import { useEvacuationSites, type EvacuationTarget } from './useEvacuationSites'
import { useEscapeDirection } from './useEscapeDirection'

/** 開いている引き出し（避難先は押されるまで取りに行かない）。 */
type Drawer = 'none' | 'detail' | 'evacuation'

/**
 * 避難場所を出せないときの言い方。
 *
 * **オフラインで「取得できませんでした」だけ出すのは不親切**——なぜ出ないのか、
 * 代わりに何が見られるのかを言う。方向（`escapeDirection`）は端末の中だけで出せる。
 */
function evacuationMessageJa(online: boolean, loading: boolean): string {
  if (!online) {
    return (
      'オフラインのため、避難場所の一覧は出せません（端末に保存していないデータです）。' +
      '上の「区域の外へ出る向き」は、保存した 250m メッシュだけで出しています。'
    )
  }
  return loading ? '避難場所を探しています…' : '避難場所を取得できませんでした。'
}

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
  const [drawer, setDrawer] = useState<Drawer>('none')
  const setHighlightedPoints = useMapStore((state) => state.setHighlightedPoints)

  // 避難先は**押されたときだけ**取りに行く（`null` の間は問い合わせが走らない）。
  // 災害種別は「いま出ている発表」から決める——洪水に対応していない場所を出さないため。
  const evacuationTarget: EvacuationTarget | null =
    drawer === 'evacuation' && alerts !== undefined && target !== null
      ? {
          lon: target.lon,
          lat: target.lat,
          placeJa: target.isCurrentPosition ? '現在地' : (alerts.area?.municipalityJa ?? 'この地点'),
          disaster: evacuationDisasterFor(alerts.warnings, alerts.floodForecasts.length > 0),
        }
      : null
  // 避難場所は**他ドメインのデータ**（国土地理院のタイル）なので、端末に保存していない。
  // オフラインでは取りに行かず、取れないことを正直に言う（§8.3）。
  const { evacuation, isLoading: evacuationLoading } = useEvacuationSites(
    online ? evacuationTarget : null,
  )
  // 「どちらへ動けば区域を出られるか」も同じ場面で要る（§8.6）。押す回数は増やさない。
  const { escape } = useEscapeDirection(evacuationTarget)

  // 一覧と地図の印を揃える（並びも番号も同じ）。閉じたら消す。
  const sites = evacuation?.sites
  useEffect(() => {
    if (sites === undefined) return
    setHighlightedPoints(sites.map((site) => ({ lon: site.lon, lat: site.lat, labelJa: site.nameJa })))
  }, [sites, setHighlightedPoints])
  useEffect(() => {
    if (drawer !== 'evacuation') setHighlightedPoints([])
  }, [drawer, setHighlightedPoints])

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
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* 主 CTA（§7.4）。**警戒中の画面でいちばん押されるべきもの**なので、
              「詳しく見る」より目立たせる。 */}
          <button
            type="button"
            onClick={() => setDrawer((current) => (current === 'evacuation' ? 'none' : 'evacuation'))}
            aria-expanded={drawer === 'evacuation'}
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            {drawer === 'evacuation' ? '閉じる' : '安全な場所を探す'}
          </button>
          <button
            type="button"
            onClick={() => setDrawer((current) => (current === 'detail' ? 'none' : 'detail'))}
            aria-expanded={drawer === 'detail'}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
          >
            {drawer === 'detail' ? '閉じる' : '詳しく見る'}
          </button>
        </div>
      </div>
      {drawer !== 'none' && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-slate-200 bg-slate-50 p-2">
          {drawer === 'detail' && <PanelRenderer panel={hazardAlertCardPanel(alerts, 'compact')} />}
          {drawer === 'evacuation' && (
            <div className="space-y-2">
              {/* 「どちらへ動けば区域を出られるか」を先に。**行き先が数 km 先のこともある**ので、
                  向きだけでも先に分かる方が役に立つ（§8.6）。区域の外にいるときは出さない。 */}
              {escape?.inside === true && (
                <PanelRenderer panel={escapeDirectionPanel(escape, 'compact')} />
              )}
              {evacuation !== undefined ? (
                <PanelRenderer panel={evacuationListPanel(evacuation, 'compact')} />
              ) : (
                <p
                  className={cn(
                    'rounded-lg p-2 text-xs',
                    online ? 'text-slate-500' : 'bg-amber-50 font-medium text-amber-800',
                  )}
                >
                  {evacuationMessageJa(online, evacuationLoading)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
