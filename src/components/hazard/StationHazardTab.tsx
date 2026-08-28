'use client'

/**
 * 駅詳細の「災害」タブの中身（`docs/260828_fix_flood.md` §4.3）。
 *
 * **上から「いま」→「もし起きたら」の 2 段**にする。並べて初めて時制の違いが伝わるからで、
 * これが「予想の危険度が、いまの災害情報に読まれる」という報告への構造側の答えである
 * （語彙側の答えはバッジの前置き・同 §4.4 決定 3）。
 *
 * 出すのは**現在地カード・警戒バナーと同じパネル**——同じ共通API・同じドメイン関数を通るので、
 * 地図をクリックしたときやチャットの答えと食い違わない（`.claude/CLAUDE.md` §2）。
 *
 * ## 取りに行く回数
 *
 * - 「もし起きたら」は**バッジと同じ SWR キー**なので、タブを開いても増えない
 * - 「いま」は**このタブを開いたときだけ**取る（平時はほぼ毎回「発表なし」で、
 *   駅を選ぶたびに気象庁を叩く価値が無い・同 §4.5）。警戒バナーと同じキーなので、
 *   同じ座標を既に引いていれば重複しない
 *
 * ⚠ ③「逃げる」（避難先・脱出方向）は PR-3 でこの下に足す。
 */

import type { HazardAlertsResponse } from '@/shared/api'
import {
  hazardAlertCardPanel,
  hazardCardPanel,
  reportedAtJa,
  HAZARD_TENSE_ASSUMED_JA,
  HAZARD_TENSE_ASSUMED_NOTE_JA,
  HAZARD_TENSE_NOW_JA,
  HAZARD_TENSE_NOW_NOTE_JA,
} from '@/domain/hazard/panels'
import { isWarningMode } from '@/domain/hazard/warning-mode'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useIsOnline } from '@/hooks/useIsOnline'
import { useHazardAlerts } from './useHazardAlerts'
import { useHazardPoint, type HazardTarget } from './useHazardPoint'

/** 段の見出し。**時制の主語**を必ず添える（見出しだけでは伝わらない）。 */
function TenseHeading({ titleJa, noteJa }: { titleJa: string; noteJa: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
      <h3 className="text-sm font-bold text-slate-900">{titleJa}</h3>
      <p className="text-[11px] text-slate-500">{noteJa}</p>
    </div>
  )
}

/** 出せないときの言い方（**「該当なし」と混同させない**）。 */
function Unavailable({ messageJa }: { messageJa: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-400">{messageJa}</div>
  )
}

/**
 * どの区域の発表か。**気象庁の発表は地点ではなく区域に出る**ので、主語を必ず書く——
 * 書かないと「駅の 1 点にいま警報が出ている」と読める（応答の `placeJa` は「この地点」）。
 */
function areaJa(alerts: HazardAlertsResponse): string {
  const area = alerts.area
  return area === null
    ? '区域を特定できませんでした'
    : `対象：${area.prefectureJa}${area.municipalityJa}`
}

/**
 * 警戒レベル3相当に届いていないときの「いま」。
 *
 * **1 行で済ませる**（平時にここが大きいと、下の「もし起きたら」が押し出される）。
 * 文言は共通API の `headlineJa` をそのまま——**「安全です」とは書かない**（§7.5-5）。
 * 限界（避難情報は市町村が出す）は畳まずに必ず出す。
 */
function CalmNow({ alerts }: { alerts: HazardAlertsResponse }) {
  const reported = reportedAtJa(alerts.reportedAt)
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-sm leading-snug text-slate-800">{alerts.headlineJa}</p>
      {reported !== null && <p className="mt-1 text-[11px] text-slate-500">{reported}</p>}
      {alerts.limitationsJa.map((limitation) => (
        <p key={limitation} className="mt-1 text-[11px] leading-snug text-slate-600">
          {limitation}
        </p>
      ))}
    </div>
  )
}

/** 「いま」の本体。警戒中は**バナーと同じカード**をそのまま出す（言うことを割らない）。 */
function NowBody({ alerts }: { alerts: HazardAlertsResponse }) {
  if (isWarningMode(alerts.alertLevel)) {
    return <PanelRenderer panel={hazardAlertCardPanel(alerts, 'compact')} />
  }
  return <CalmNow alerts={alerts} />
}

/** ①「いま」。オフラインでは**取りに行かない**——古い発表を「今」として出さないため。 */
function NowSection({ target }: { target: HazardTarget }) {
  const online = useIsOnline()
  const { alerts, error } = useHazardAlerts({
    lon: target.lon,
    lat: target.lat,
    isCurrentPosition: false,
  })
  const messageJa = !online
    ? 'オフラインのため、いまの発表は取れません（端末に保存していないデータです）。'
    : error === undefined
      ? 'いまの発表を確認しています…'
      : 'いまの発表を取得できませんでした。'
  return (
    <section>
      <TenseHeading titleJa={HAZARD_TENSE_NOW_JA} noteJa={HAZARD_TENSE_NOW_NOTE_JA} />
      {alerts === undefined ? (
        <Unavailable messageJa={messageJa} />
      ) : (
        <>
          {/* 主語は**どちらの見え方でも**先に出す（警戒中のカードは `placeJa` が「この地点」）。 */}
          <p className="mb-1 text-[11px] text-slate-500">{areaJa(alerts)}</p>
          <NowBody alerts={alerts} />
        </>
      )}
    </section>
  )
}

/** ②「もし起きたら」。バッジと同じ地点・同じキーなので、追加の通信は起きない。 */
function AssumedSection({ target }: { target: HazardTarget }) {
  const { point, isLoading } = useHazardPoint(target)
  return (
    <section className="border-t border-slate-100 pt-4">
      <TenseHeading titleJa={HAZARD_TENSE_ASSUMED_JA} noteJa={HAZARD_TENSE_ASSUMED_NOTE_JA} />
      {point === undefined ? (
        <Unavailable
          messageJa={isLoading ? '災害リスクを調べています…' : '災害の情報を取得できませんでした。'}
        />
      ) : (
        <PanelRenderer panel={hazardCardPanel(point)} />
      )}
    </section>
  )
}

export function StationHazardTab({ target }: { target: HazardTarget }) {
  return (
    <div className="space-y-4">
      <NowSection target={target} />
      <AssumedSection target={target} />
    </div>
  )
}
