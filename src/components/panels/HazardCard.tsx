'use client'

/**
 * hazardCard Panel のレンダラ（地点のハザード・docs/260824_flood.md §6.4・§7.3）。
 *
 * 描画だけを担い、意味づけ（危険度・結論・行動・注記）はすべてサーバの `hazardCard` が持つ。
 * ここで守る不変条件は 3 つ：
 *  1. **色だけで危険度を伝えない**（色 ＋ 記号 ＋ テキストの 3 重・§7.6）
 *  2. **網羅性の注記を必ず出す**（「白＝安全」と読ませない・§7.5-2）
 *  3. **免責を必ず出す**（避難の判断は市町村の情報が正・§7.5-5）
 *  4. **確からしさと出所を隠さない**（§5.9・§6.3）——1 行ごとに「浸水ナビの実測／地図と同じ／
 *     250m メッシュ」を出し、`partial` のカードには全体の但し書きを付ける。
 *     同じ「3〜5m 未満」でも、点で確定しているのか 250m の区間なのかで意味が違う
 */

import { type HazardCardPanel, type HazardItem } from '@/shared/protocol'
import {
  EVACUATION_LABELS_JA,
  HAZARD_CERTAINTY_LABELS_JA,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
  HAZARD_LEVEL_LABELS_JA,
  HAZARD_SOURCE_LABELS_JA,
} from '@/shared/constants'
import { cn } from '@/lib/utils'
import { Emphasis } from './Emphasis'
import { SourceList } from './SourceList'

/** 危険度バッジ（色 ＋ 記号 ＋ ラベルの 3 重）。 */
function LevelBadge({ level }: { level: HazardCardPanel['level'] }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: HAZARD_LEVEL_COLORS[level] }}
    >
      <span aria-hidden>{HAZARD_LEVEL_ICONS[level]}</span>
      {HAZARD_LEVEL_LABELS_JA[level]}
    </span>
  )
}

/** 出所のバッジ（どこから来た値か）。**メッシュ由来だけ色を変えて区別する**。 */
function SourceBadge({ item }: { item: HazardItem }) {
  return (
    <span
      className={cn(
        'ml-1 shrink-0 rounded px-1 py-px text-[10px] font-medium whitespace-nowrap',
        item.source === 'mesh' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500',
      )}
    >
      {HAZARD_SOURCE_LABELS_JA[item.source]}
    </span>
  )
}

/** 該当ハザード 1 件（公式凡例の色見本＋レイヤ名＋階級＋意味＋出所）。 */
function HazardRow({ item }: { item: HazardItem }) {
  return (
    <li className="flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-b-0">
      <span
        aria-hidden
        className="mt-1 size-3 shrink-0 rounded-sm ring-1 ring-slate-300"
        style={item.color === null ? undefined : { backgroundColor: item.color }}
      />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
          {item.labelJa}
          <SourceBadge item={item} />
        </p>
        <p className="text-sm font-medium text-slate-900">
          <span aria-hidden className="mr-1">
            {HAZARD_LEVEL_ICONS[item.level]}
          </span>
          {item.valueJa}
          <span className="ml-1 text-xs font-normal text-slate-400">
            （{HAZARD_LEVEL_LABELS_JA[item.level]}）
          </span>
        </p>
        {item.meaningJa !== null && <p className="text-xs text-slate-500">{item.meaningJa}</p>}
      </div>
    </li>
  )
}

export function HazardCard({ panel }: { panel: HazardCardPanel }) {
  const compact = panel.size === 'compact'

  return (
    <section className={cn('rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn('font-bold text-slate-900', compact ? 'text-base' : 'text-lg')}>
          {panel.placeJa}
        </h2>
        <LevelBadge level={panel.level} />
      </div>

      <p className="mt-2 text-sm font-medium text-slate-800">
        <Emphasis text={panel.headlineJa} />
      </p>

      {panel.certainty !== 'exact' && (
        <p className="mt-1 text-xs text-amber-700">
          ⓘ {HAZARD_CERTAINTY_LABELS_JA[panel.certainty]}
          {panel.certainty === 'partial'
            ? 'での判断です。この地点そのものの値は、地図の色でご確認ください。'
            : 'での判断です。通信できるようになったら、もう一度ご確認ください。'}
        </p>
      )}

      {panel.evacuation !== null && (
        <p className="mt-1 text-sm font-semibold text-slate-900">
          → {EVACUATION_LABELS_JA[panel.evacuation]}
        </p>
      )}

      {panel.items.length > 0 && (
        <ul className="mt-3">
          {panel.items.map((item) => (
            <HazardRow key={item.layerKey} item={item} />
          ))}
        </ul>
      )}

      {panel.reasonsJa.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
          {panel.reasonsJa.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {panel.coverageNotesJa.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {panel.coverageNotesJa.map((note) => (
            <li key={note}>
              <Emphasis text={note} />
            </li>
          ))}
        </ul>
      )}

      <SourceList sources={panel.sources} className="mt-3" />

      <p className="mt-2 text-[11px] text-slate-500">ⓘ {panel.disclaimerJa}</p>
    </section>
  )
}
