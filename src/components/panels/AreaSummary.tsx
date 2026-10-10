'use client'

/**
 * areaSummary Panel のレンダラ（エリアの要約・比較・2026-10-10 B5b）。
 *
 * 描くだけ。値・増減・作り方・当たり具合・分布・凡例・注記は、すべて共通 API（`src/domain/area-summary/`）が決めている。
 * ここで守る不変条件：
 *  1. **区域の値と駅の周りの値を分けて見せる**（見出しを分け、駅の周りは「駅の周り（1km 圏・137 駅）」と名乗る）。
 *     横浜市の人口は −0.7% だが、駅の周りの中央値は +2.5%——同じ欄に並べると、駅の値を市の値と読まれる
 *  2. **区域の値は作り方を名乗る**（公表値・推計・メッシュの按分・駅の円の値）。年は見出しの文に入っている
 *  3. **無い値の理由・見ていないことは常に出す**（畳まない）。比較のときだけ、駅の周りの分布を畳む（表が主役）
 */

import { radiusLabel } from '@/shared/constants'
import {
  type AreaComparisonTable,
  type AreaStations,
  type AreaStationStat,
  type AreaSummaryCard,
  type AreaTotalLine,
  type StationLegend,
} from '@/shared/area-summary'
import { type AreaSummaryPanel } from '@/shared/protocol'
import { cn } from '@/lib/utils'
import { SourceList } from './SourceList'

/** 作り方の札（公表値は濃く、按分・推計は淡く）。 */
function MethodBadge({ total }: { total: AreaTotalLine }) {
  const official = total.method === 'official'
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
        official ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
      )}
    >
      {total.methodJa}
    </span>
  )
}

/** 区域の値 1 系統（名前・作り方 ／ 見出しの文 ／ 推計の山と当たり具合）。 */
function TotalRow({ total }: { total: AreaTotalLine }) {
  return (
    <li className="border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs font-semibold text-slate-500">{total.labelJa}</p>
        <MethodBadge total={total} />
      </div>
      <p className="mt-0.5 text-sm font-semibold text-slate-900 tabular-nums">{total.headlineJa}</p>
      {total.peak !== null && (
        <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
          推計の山：{total.peak.year}年 {total.peak.valueJa}
        </p>
      )}
      {total.accuracy !== null && (
        <p className="mt-0.5 text-[11px] text-slate-500">{total.accuracy.textJa}</p>
      )}
    </li>
  )
}

/** 区域の値（無ければ出さない＝無い理由は `Unavailable` が言う）。 */
function Totals({ totals }: { totals: readonly AreaTotalLine[] }) {
  if (totals.length === 0) return null
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500">エリア全体の値</h4>
      <ul>
        {totals.map((total) => (
          <TotalRow key={total.id} total={total} />
        ))}
      </ul>
    </div>
  )
}

/** 出せない値とその理由（**常に出す**）。 */
function Unavailable({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="space-y-0.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-slate-200">
      {items.map((item) => (
        <li key={item}>出せない値：{item}</li>
      ))}
    </ul>
  )
}

/** 上位・下位の駅（「上位 みなとみらい +24.3%・馬車道 +18.3%」）。 */
function EdgeStations({ label, stations }: { label: string; stations: AreaStationStat['top'] }) {
  if (stations.length === 0) return null
  return (
    <p className="text-[11px] text-slate-500">
      <span className="text-slate-400">{label}</span>{' '}
      {stations.map((each) => `${each.labelJa} ${each.valueJa}`).join('・')}
    </p>
  )
}

/** 数えなかった駅（⚠・値なし）。 */
function excludedText(stat: AreaStationStat): string | null {
  const parts = [
    stat.flaggedN > 0 ? `⚠ ${stat.flaggedN} 駅は参考値なので除いた` : null,
    stat.missingN > 0 ? `値なし ${stat.missingN} 駅` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? null : parts.join('・')
}

/** 駅の周りの 1 指標（名前・期間 ／ 中央値 ／ 四分位 ／ 上位・下位 ／ 注記）。 */
function StationStatRow({ stat }: { stat: AreaStationStat }) {
  const excluded = excludedText(stat)
  return (
    <li className="border-b border-slate-100 py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm text-slate-700">
          {stat.labelJa}
          {/* 期間はひとかたまりで折り返す（「2020→2050」と「年・R6推計」に割らない）。 */}
          <span className="ml-1.5 inline-block text-[11px] whitespace-nowrap text-slate-400">
            {stat.periodJa}
          </span>
        </p>
        <p className="shrink-0 text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">
          <span className="mr-1 text-[10px] font-normal text-slate-400">中央値</span>
          {stat.medianJa}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
        中ほどの半分：{stat.rangeJa}（値のある {stat.n} 駅）
      </p>
      <EdgeStations label="上位" stations={stat.top} />
      <EdgeStations label="下位" stations={stat.bottom} />
      {excluded !== null && <p className="text-[11px] text-slate-400">{excluded}</p>}
      {stat.noteJa !== null && <p className="text-[11px] text-slate-400">{stat.noteJa}</p>}
    </li>
  )
}

/** 駅の周りの分布（エリア全体の値ではない、と見出しで名乗る）。駅が無ければ出さない。 */
function StationStats({ stations }: { stations: AreaStations }) {
  if (stations.stats.length === 0) return null
  return (
    <ul>
      {stations.stats.map((stat) => (
        <StationStatRow key={stat.key} stat={stat} />
      ))}
    </ul>
  )
}

function stationsHeading(stations: AreaStations): string {
  return `駅の周り（${radiusLabel(stations.radiusM)}圏・${stations.count} 駅）`
}

/** エリア 1 つ（1 つのときは全部、比較のときは名前・無い値・当たり具合と、畳んだ駅の周り）。 */
function AreaCard({ card, comparing }: { card: AreaSummaryCard; comparing: boolean }) {
  const accuracies = card.totals.flatMap((total) =>
    total.accuracy === null ? [] : [total.accuracy.textJa],
  )
  const facts = [
    card.kindJa,
    `駅 ${card.stationCount}`,
    card.areaKm2 === null ? null : `${card.areaKm2} km²`,
  ]
  return (
    <div className="space-y-2">
      {comparing && <h4 className="text-sm font-semibold text-slate-800">{card.labelJa}</h4>}
      <p className="text-[11px] text-slate-500">
        {facts.filter((fact) => fact !== null).join('・')}
      </p>
      {comparing ? (
        accuracies.map((text) => (
          <p key={text} className="text-[11px] text-slate-500">
            推計の当たり具合：{text}
          </p>
        ))
      ) : (
        <Totals totals={card.totals} />
      )}
      <Unavailable items={card.unavailableJa} />
      {card.stations.stats.length > 0 && (
        <StationsBlock stations={card.stations} collapsed={comparing} />
      )}
    </div>
  )
}

/** 駅の周り（比較のときは畳む）。 */
function StationsBlock({ stations, collapsed }: { stations: AreaStations; collapsed: boolean }) {
  const heading = stationsHeading(stations)
  if (collapsed) {
    return (
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500">{heading}</summary>
        <StationStats stations={stations} />
      </details>
    )
  }
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-slate-500">{heading}</h4>
      <StationStats stations={stations} />
    </div>
  )
}

/**
 * 比べる表（行＝項目・列＝エリア）。項目と値は折り返す——折り返さないと表が横に長くなり、携帯では 2 つ目のエリアが
 * 画面の外に出て並べて比べられなかった。値の列には最小の幅を持たせ、エリアが 3〜4 つで収まらなければ表だけを横に送る。
 */
function ComparisonTable({ comparison }: { comparison: AreaComparisonTable }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead>
          <tr className="border-b border-slate-200 text-left align-bottom">
            <th className="py-1 pr-2" />
            {comparison.names.map((name) => (
              <th key={name} className="py-1 pr-2 font-semibold text-slate-700">
                <div className="min-w-[5.5rem]">{name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.labelJa} className="border-b border-slate-100 align-top last:border-b-0">
              <th className="py-1 pr-2 text-left font-normal text-slate-500">
                <div className="min-w-[5.5rem]">{row.labelJa}</div>
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={`${row.labelJa}#${comparison.refs[index] ?? index}`}
                  className="py-1 pr-2 text-slate-800"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 色の見本 1 つ。 */
function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-full ring-1 ring-slate-500/60"
      style={{ backgroundColor: color }}
    />
  )
}

/** 色分けの凡例（段・色・駅の数・⚠・値なし・色の意味。色分けしなかったら理由）。 */
function LegendBlock({ legend }: { legend: StationLegend }) {
  return (
    <div className="rounded-lg px-3 py-2 ring-1 ring-slate-200">
      <p className="text-xs font-semibold text-slate-600">地図の色分け：{legend.titleJa}</p>
      {legend.reasonJa !== null ? (
        <p className="mt-1 text-[11px] text-slate-500">{legend.reasonJa}</p>
      ) : (
        <LegendClasses legend={legend} />
      )}
      <p className="mt-1 text-[11px] text-slate-400">出典：{legend.sourceJa}</p>
    </div>
  )
}

function LegendClasses({ legend }: { legend: StationLegend }) {
  return (
    <>
      <ul className="mt-1.5 space-y-0.5">
        {legend.classes.map((each) => (
          <li key={each.index} className="flex items-center gap-2 text-[11px] text-slate-700">
            <Swatch color={each.color} />
            <span className="min-w-0 flex-1">{each.labelJa}</span>
            <span className="shrink-0 text-slate-400 tabular-nums">{each.count} 駅</span>
          </li>
        ))}
        {legend.flagged.count > 0 && (
          <li className="flex items-center gap-2 text-[11px] text-slate-500">
            <Swatch color={legend.flagged.color} />
            <span className="min-w-0 flex-1">{legend.flagged.labelJa}</span>
            <span className="shrink-0 text-slate-400 tabular-nums">{legend.flagged.count} 駅</span>
          </li>
        )}
      </ul>
      {legend.missingCount > 0 && (
        <p className="mt-1 text-[11px] text-slate-400">
          値なし {legend.missingCount} 駅（描かない）
        </p>
      )}
      {legend.meaningJa !== null && (
        <p className="mt-1 text-[11px] text-slate-500">{legend.meaningJa}</p>
      )}
    </>
  )
}

/** 見ていないこと（**常に出す**）。 */
function NotIncluded({ items }: { items: readonly string[] }) {
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
      <p className="text-xs font-semibold text-amber-800">この要約で見ていないこと</p>
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

export function AreaSummary({ panel }: { panel: AreaSummaryPanel }) {
  const compact = panel.size === 'compact'
  const comparing = panel.comparison !== null
  return (
    <section className={cn('space-y-4 rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <h3 className={cn('font-semibold text-slate-800', compact ? 'text-sm' : 'text-base')}>
        {panel.title}
      </h3>
      {panel.comparison !== null && <ComparisonTable comparison={panel.comparison} />}
      {panel.areas.map((card) => (
        <AreaCard key={card.ref} card={card} comparing={comparing} />
      ))}
      {panel.legend !== null && <LegendBlock legend={panel.legend} />}
      <NotIncluded items={panel.notIncludedJa} />
      <ul className="space-y-0.5 text-[11px] text-slate-400">
        {[...panel.notesJa, ...(panel.comparison?.notesJa ?? [])].map((note) => (
          <li key={note}>・{note}</li>
        ))}
      </ul>
      <SourceList sources={panel.sources} />
    </section>
  )
}
