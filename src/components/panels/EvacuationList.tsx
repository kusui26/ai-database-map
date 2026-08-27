'use client'

/**
 * evacuationList Panel のレンダラ（避難先・`docs/260824_flood.md` §6.4・§8.5）。
 *
 * 描画だけを担い、意味づけ（距離・方角・区域との重なり・限界）はすべてサーバが持つ。
 * ここで守る不変条件は 4 つ：
 *  1. **どの災害向けの一覧かを必ず見出しに出す**（洪水用を土砂災害に使わせない・§11 リスク 10）
 *  2. **限界を畳まない**（開設されているとは限らない・直線距離・指定避難所ではない）
 *  3. **番号を振る**——地図の印と一覧を突き合わせられるようにする（`highlightPoints` と同じ並び）
 *  4. **備考を捨てない**（「洪水での避難は◯◯川を対象とする」は、その場所が使える条件そのもの）
 */

import { type EvacuationItem, type EvacuationListPanel } from '@/shared/protocol'
import { HAZARD_SOURCE_LABELS_JA } from '@/shared/constants'
import { cn } from '@/lib/utils'
import { Emphasis } from './Emphasis'

/** 想定区域との重なりの見せ方（色 ＋ 記号 ＋ テキストの 3 重・§7.6）。 */
const AREA_STYLE: Readonly<
  Record<string, { readonly icon: string; readonly className: string }>
> = {
  outside: { icon: '○', className: 'bg-emerald-50 text-emerald-700' },
  partial: { icon: '△', className: 'bg-amber-50 text-amber-700' },
  inside: { icon: '✕', className: 'bg-rose-50 text-rose-700' },
  unknown: { icon: '－', className: 'bg-slate-100 text-slate-500' },
}

function AreaBadge({ item }: { item: EvacuationItem }) {
  const style = AREA_STYLE[item.hazardAreaCertainty ?? 'unknown'] ?? AREA_STYLE.unknown
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-px text-[10px] font-medium whitespace-nowrap',
        style?.className,
      )}
      // 同じ「区域の中」でも、地図と同じ画素で見たのか 250m メッシュで見たのかは意味が違う。
      title={
        item.hazardAreaSource === null
          ? undefined
          : `出所：${HAZARD_SOURCE_LABELS_JA[item.hazardAreaSource]}`
      }
    >
      <span aria-hidden className="mr-0.5">
        {style?.icon}
      </span>
      {item.hazardAreaJa}
    </span>
  )
}

/** 避難先 1 件（番号・名前・距離と方角・区域との重なり・住所・備考）。 */
function SiteRow({ item, index }: { item: EvacuationItem; index: number }) {
  return (
    <li className="flex items-start gap-2 border-b border-slate-100 py-2 last:border-b-0">
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-slate-900">{item.nameJa}</span>
          <span className="text-xs text-slate-600">
            {item.bearingJa}へ{item.distanceJa}
          </span>
          <AreaBadge item={item} />
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {item.addressJa}
          {item.elevationM !== null && `／標高 約${item.elevationM.toFixed(1)}m`}
        </p>
        {/* 当たった区域の名前は**捨てない**。「イエローゾーン」か「レッドゾーン」かで意味が違う。 */}
        {item.hazardAreaDetailJa !== null && (
          <p className="mt-0.5 text-[11px] font-medium text-rose-700">
            この場所は「{item.hazardAreaDetailJa}」にかかります
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-slate-400">
          対応：{item.disastersJa.join('・')}
        </p>
        {item.remarksJa !== null && (
          <p className="mt-1 rounded bg-slate-50 p-1.5 text-[11px] text-slate-600">
            {item.remarksJa}
          </p>
        )}
      </div>
    </li>
  )
}

export function EvacuationList({ panel }: { panel: EvacuationListPanel }) {
  const compact = panel.size === 'compact'

  return (
    <section className={cn('rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn('font-bold text-slate-900', compact ? 'text-base' : 'text-lg')}>
          {panel.placeJa}の{panel.siteKindJa}
        </h2>
        {/* どの災害向けか。**畳まない**——洪水用の一覧を土砂災害に使わせないため。 */}
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {panel.forDisasterJa}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-slate-800">
        <Emphasis text={panel.headlineJa} />
      </p>

      {panel.items.length > 0 && (
        <ul className="mt-2">
          {panel.items.map((item, index) => (
            <SiteRow key={`${item.nameJa}-${item.lon}-${item.lat}`} item={item} index={index} />
          ))}
        </ul>
      )}

      {panel.notesJa.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {panel.notesJa.map((note) => (
            <li key={note}>
              <Emphasis text={note} />
            </li>
          ))}
        </ul>
      )}

      {/* 限界は**必ず全部**。1 行落ちるだけで誤解の余地が増える（§11 リスク 10）。 */}
      <ul className="mt-3 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
        {panel.limitationsJa.map((limitation) => (
          <li key={limitation}>
            ※ <Emphasis text={limitation} />
          </li>
        ))}
      </ul>

      {panel.sources.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-slate-400">
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
