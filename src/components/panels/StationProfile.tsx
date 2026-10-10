'use client'

/**
 * stationProfile Panel のレンダラ（駅周辺のプロフィール・2026-10-09 B4）。
 *
 * 描くだけ。値・順位・性格の目安・注記・見ていないことは、すべて共通 API（`src/domain/profile/`）が決めている。
 * ここで守る不変条件：
 *  1. **位置は目盛りと文字の両方で**（「上位 19%」と順位／駅数。目盛りだけ・色だけにしない）
 *  2. **見ていないことは常に出す**（畳まない・押さないと読めない注意は無いのと同じ）
 *  3. **災害は危険度の語を出さない**（「危険」はいまの危険度と読まれる・`StationHazardBadge` と同じ）——
 *     時制（もし起きたら）を先に置き、重さは色と記号で示す
 *
 * 駅詳細の「概要」タブは、災害を出さない（`showHazard={false}`）——ヘッダのバッジが同じ駅の災害を常に出している。
 */

import { HAZARD_LEVEL_COLORS, HAZARD_LEVEL_ICONS, HAZARD_LEVEL_LABELS_JA } from '@/shared/constants'
import { formatNumber } from '@/shared/format'
import {
  type AreaCharacter,
  type ProfileHazard,
  type ProfileItem,
  type ProfilePosition,
  type ProfileSection,
} from '@/shared/profile'
import { type StationProfilePanel } from '@/shared/protocol'
import { HAZARD_TENSE_ASSUMED_JA } from '@/domain/hazard/panels'
import { cn } from '@/lib/utils'
import { SourceList } from './SourceList'

/**
 * 位置 1 つ（目盛り＋「県内 上位 19%」＋順位/駅数）。どこの県・市かは凡例（`positionsLegendJa`）が言い、
 * 行には短い言い方だけを書く——「神奈川県内 上位 19%」では 2 列に収まらず、行ごとに折り返していた。
 */
function PositionGauge({ position }: { position: ProfilePosition }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={position.labelJa}>
      <span aria-hidden className="relative h-1.5 w-9 shrink-0 rounded-full bg-slate-200">
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500 ring-2 ring-white"
          style={{ left: `${position.percentile}%` }}
        />
      </span>
      <span className="sr-only">{position.labelJa}</span>
      <span aria-hidden className="min-w-0 truncate text-[11px] text-slate-500">
        {position.shortJa} <span className="font-semibold text-slate-700">{position.shareJa}</span>
        <span className="ml-1 text-slate-400 tabular-nums">
          {formatNumber(position.rank, 'int')}/{formatNumber(position.total, 'int')}
        </span>
      </span>
    </div>
  )
}

/** 指標 1 つの行（名前・年 ／ 値 ／ 位置 ／ 注記）。 */
function ItemRow({ item }: { item: ProfileItem }) {
  return (
    <li className="border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm text-slate-700">
          {item.labelJa}
          <span className="ml-1.5 text-[11px] text-slate-400">{item.periodJa}</span>
        </p>
        <p
          className={cn(
            'shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums',
            item.flagged ? 'text-amber-600' : 'text-slate-900',
          )}
        >
          {item.valueJa}
          {item.flagged ? ' ⚠' : ''}
        </p>
      </div>
      {item.positions.length > 0 && (
        // 2 列は 1 列が 10.5rem（目盛り＋「県内 上位 19%」＋「348/654」）取れるときだけ。会話の中の図（携帯で約 320px）
        // では 1 列に積む——2 列のままだと順位/駅数が「13/3…」と切れて読めなかった。
        <div className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-x-3 gap-y-1">
          {item.positions.map((position) => (
            <PositionGauge key={position.scope} position={position} />
          ))}
        </div>
      )}
      {item.noteJa !== null && <p className="mt-1 text-[11px] text-slate-400">{item.noteJa}</p>}
    </li>
  )
}

function SectionBlock({ section }: { section: ProfileSection }) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500">{section.titleJa}</h4>
      <ul>
        {section.items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  )
}

/** 性格の目安（規則で決めたもの・根拠の数を必ず添える）。 */
function CharacterCard({ character }: { character: AreaCharacter }) {
  const known = character.kind !== 'unknown'
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 ring-1',
        known ? 'bg-indigo-50 ring-indigo-100' : 'bg-slate-50 ring-slate-200',
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-semibold',
            known ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600',
          )}
        >
          {character.labelJa}
        </span>
        <span className="text-sm text-slate-800">{character.summaryJa}</span>
      </p>
      {character.basisJa !== '' && (
        <p className="mt-1 text-[11px] text-slate-500">{character.basisJa}</p>
      )}
    </div>
  )
}

/** 災害の要約（事前計算）。語ではなく色と記号で重さを示し、読み上げにだけ語を残す。 */
function HazardBlock({ hazard }: { hazard: ProfileHazard | null }) {
  if (hazard === null) {
    return (
      <p className="text-xs text-slate-500">
        この駅の災害の要約はありません（安全という意味ではありません）。
      </p>
    )
  }
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500">災害</h4>
      <div className="mt-1 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-[11px] font-medium text-slate-500">
          {HAZARD_TENSE_ASSUMED_JA}
        </span>
        <span
          className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: HAZARD_LEVEL_COLORS[hazard.level] }}
        >
          <span aria-hidden>{HAZARD_LEVEL_ICONS[hazard.level]}</span>
          <span className="sr-only">{HAZARD_LEVEL_LABELS_JA[hazard.level]}</span>
        </span>
        <p className="min-w-0 text-xs text-slate-700">{hazard.headlineJa}</p>
      </div>
      {hazard.hitsJa.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
          {hazard.hitsJa.map((hit) => (
            <li key={hit}>{hit}</li>
          ))}
        </ul>
      )}
      {hazard.uncoveredJa.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">
          区域図が無い災害：{hazard.uncoveredJa.join('・')}（安全という意味ではありません）
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-400">{hazard.caveatJa}</p>
      <p className="mt-1 text-[11px] text-slate-400">
        出典：{hazard.sources.map((each) => each.source).join(' / ')}
      </p>
    </div>
  )
}

/** 見ていないこと（**常に出す**）。 */
function NotCovered({ items }: { items: readonly string[] }) {
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
      <p className="text-xs font-semibold text-amber-800">このプロフィールで見ていないこと</p>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-amber-800 ring-1 ring-amber-200"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StationProfile({
  panel,
  showHazard = true,
}: {
  panel: StationProfilePanel
  /** 災害の要約を出すか（駅詳細はヘッダのバッジが出しているので出さない）。 */
  showHazard?: boolean
}) {
  const compact = panel.size === 'compact'
  return (
    <section className={cn('space-y-4 rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
        {panel.title}
      </h3>
      <CharacterCard character={panel.character} />
      <p className="text-[11px] text-slate-500">{panel.positionsLegendJa}</p>
      {panel.sections.map((section) => (
        <SectionBlock key={section.id} section={section} />
      ))}
      {showHazard && <HazardBlock hazard={panel.hazard} />}
      <NotCovered items={panel.notCoveredJa} />
      <ul className="space-y-0.5 text-[11px] text-slate-400">
        {panel.notesJa.map((note) => (
          <li key={note}>・{note}</li>
        ))}
      </ul>
      <SourceList sources={panel.sources} />
    </section>
  )
}
