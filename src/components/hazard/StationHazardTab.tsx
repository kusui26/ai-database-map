'use client'

/**
 * 駅詳細の「災害」タブの中身（`docs/260828_fix_flood.md` §4.3）。
 *
 * **上から「いま」→「もし起きたら」→「逃げる」の 3 段**にする。
 * ①と②を並べて初めて時制の違いが伝わり（語彙側の答えはバッジの前置き・同 §4.4 決定 3）、
 * ③は実装済みなのに駅カードから辿れなかった避難先・脱出方向への入口である（同 §3）。
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
 * - 「逃げる」は**ボタンを押したときだけ**取る（同 §4.3・警戒バナーの引き出しと同じ流儀）。
 *   国土地理院のタイルを、見られないまま終わる駅のぶんまで叩かない
 */

import { useEffect, useState } from 'react'
import type { HazardAlertsResponse } from '@/shared/api'
import {
  escapeDirectionPanel,
  evacuationDisasterForPoint,
  evacuationListPanel,
  evacuationUnavailableJa,
  hazardAlertCardPanel,
  hazardCardPanel,
  hazardEscapeNoteJa,
  reportedAtJa,
  HAZARD_ESCAPE_CLOSE_JA,
  HAZARD_ESCAPE_OPEN_JA,
  HAZARD_ESCAPE_TITLE_JA,
  HAZARD_TENSE_ASSUMED_JA,
  HAZARD_TENSE_ASSUMED_NOTE_JA,
  HAZARD_TENSE_NOW_JA,
  HAZARD_TENSE_NOW_NOTE_JA,
} from '@/domain/hazard/panels'
import { isWarningMode } from '@/domain/hazard/warning-mode'
import { PanelRenderer } from '@/components/panels/PanelRenderer'
import { useIsOnline } from '@/hooks/useIsOnline'
import { cn } from '@/lib/utils'
import { useMapStore } from '@/stores/mapStore'
import { useEscapeDirection } from './useEscapeDirection'
import { useEvacuationSites, type EvacuationTarget } from './useEvacuationSites'
import { useHazardAlerts } from './useHazardAlerts'
import { useHazardPoint, type HazardTarget } from './useHazardPoint'

/** 段の見出し。**主語**（時制・どの災害の話か）を必ず添える（見出しだけでは伝わらない）。 */
function SectionHeading({ titleJa, noteJa }: { titleJa: string; noteJa: string }) {
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
      <SectionHeading titleJa={HAZARD_TENSE_NOW_JA} noteJa={HAZARD_TENSE_NOW_NOTE_JA} />
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
      <SectionHeading titleJa={HAZARD_TENSE_ASSUMED_JA} noteJa={HAZARD_TENSE_ASSUMED_NOTE_JA} />
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

/**
 * ③「逃げる」。**押したときだけ**取りに行く（§4.3・警戒バナーの引き出しと同じ流儀）。
 *
 * ## 種別は「もし起きたら」から決める（いまの発表からではない）
 *
 * このタブの③は**想定の段**なので、②に出ているいちばん重い静的ハザードの種別で探す。
 * いまの発表に合わせるのは警戒バナーの仕事で、警戒中はバナーの CTA が
 * `evacuationDisasterFor`（発表由来）で同じパネルを出す。2 つの入口が別の問いに
 * 答えているだけで、同じ問いに別の答えを出すことはない。
 *
 * ## 該当が無い駅では段ごと出さない
 *
 * 種別を勝手に選ぶと、その災害に対応していない避難場所を出しかねない（§11 リスク 10）。
 *
 * ## 地図の印
 *
 * 一覧と地図の印を揃える（並びも番号も同じ・バナーと同じ `mapStore`）。
 * 閉じたら・タブや駅を離れたら消す。
 */
function EscapeSection({ target }: { target: HazardTarget }) {
  const online = useIsOnline()
  const { point } = useHazardPoint(target)
  const [open, setOpen] = useState(false)
  const setHighlightedPoints = useMapStore((state) => state.setHighlightedPoints)

  const disaster = point === undefined ? null : evacuationDisasterForPoint(point)
  const escapeTarget: EvacuationTarget | null =
    open && disaster !== null
      ? { lon: target.lon, lat: target.lat, placeJa: target.placeJa, disaster }
      : null
  // 避難場所は**他ドメインのデータ**（国土地理院のタイル）なので、端末に保存していない。
  // オフラインでは取りに行かず、取れないことを正直に言う（§8.3）。
  const { evacuation, isLoading } = useEvacuationSites(online ? escapeTarget : null)
  // 「どちらへ動けば区域を出られるか」も同じ場面で要る（§8.6）。押す回数は増やさない。
  // 対応していない種別（洪水・内水以外）は応答の `inside` が null になり、何も出ない。
  const { escape } = useEscapeDirection(escapeTarget)

  // 一覧を出している間だけ印を置き、やめるとき（閉じる・駅やタブを離れる）に消す。
  // **置いていないときは触らない**——警戒バナーも同じ store に印を置くので、
  // 無条件に消すと、開いてもいない駅タブがバナーの印を消してしまう。
  const sites = evacuation?.sites
  useEffect(() => {
    if (!open || sites === undefined) return
    setHighlightedPoints(
      sites.map((site) => ({ lon: site.lon, lat: site.lat, labelJa: site.nameJa })),
    )
    return () => setHighlightedPoints([])
  }, [open, sites, setHighlightedPoints])

  if (disaster === null) return null

  return (
    <section className="border-t border-slate-100 pt-4">
      <SectionHeading titleJa={HAZARD_ESCAPE_TITLE_JA} noteJa={hazardEscapeNoteJa(disaster)} />
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
      >
        {open ? HAZARD_ESCAPE_CLOSE_JA : HAZARD_ESCAPE_OPEN_JA}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
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
              {evacuationUnavailableJa(online, isLoading)}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export function StationHazardTab({ target }: { target: HazardTarget }) {
  return (
    <div className="space-y-4">
      <NowSection target={target} />
      <AssumedSection target={target} />
      {/* 駅が替わったら「開いている・取得済み」を持ち越さない（押したときだけ取る、の「押した」は駅ごと）。 */}
      <EscapeSection key={`${target.lon},${target.lat}`} target={target} />
    </div>
  )
}
