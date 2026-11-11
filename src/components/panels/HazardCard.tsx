'use client'

/**
 * hazardCard Panel のレンダラ（地点のハザード・docs/260824_flood.md §6.4・§7.3）。
 *
 * 描画だけを担い、意味づけ（危険度・結論・行動・注記・言い方）はすべてサーバとドメインが持つ。
 * 描き方は 2 つある（`docs/261110_fix_PLAN.md` §8.3・§8.4）。
 * - **災害の種類ごとの状態（`groupStates`）があれば**——地点のカード：その場所に固有の注意を見せ、一般論は畳む
 * - **無ければ**——警報のカードと、配備の切り替わりの間にキャッシュに残る古い応答：今までの描き方
 *
 * ここで守る不変条件：
 *  1. **色だけで危険度を伝えない**（色 ＋ 記号 ＋ テキストの 3 重・§7.6）。行の危険度の語は読み上げに残す
 *  2. **「白＝安全」と読ませない**（§7.5-1・2）。種類ごとの状態（該当なし・想定区域図なし…）と
 *     「安全という意味ではありません」の 1 文は**畳まない**。レイヤごとの一般論・メッシュの注記・取れなかったもの・
 *     規則ごとの根拠は「根拠と注意（N）」に畳むが、**1 行も捨てない**（2026-11-11 に「注意は畳まない」から改めた・
 *     §7.5-2 の追記）。今までの描き方では、これまでどおり網羅性の注記を全部出す
 *  3. **免責を必ず出す**（§7.5-5）。入れ物（駅の災害タブ）が末尾で 1 回出すときだけ、カードでは出さない
 *  4. **確からしさと出所を隠さない**（§5.9・§6.3）。今までの描き方は 1 行ごとに出所を出す。地点のカードは
 *     「地図と同じ」以外（浸水ナビの実測・250m メッシュ）の行にだけ出す——地図と同じなら言わなくても分かり、
 *     区間でしか言えない行と実測の行は今までどおり札で見分けられる。`partial` の但し書きは、
 *     結論が同じことを言っていないときに出す
 */

import { type HazardCardPanel, type HazardGroupStateKind, type HazardItem } from '@/shared/protocol'
import {
  EVACUATION_LABELS_JA,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
  HAZARD_LEVEL_LABELS_JA,
  HAZARD_SOURCE_LABELS_JA,
} from '@/shared/constants'
import { cardCertaintyNoteJa, certaintyNoteJa } from '@/domain/hazard/wording'
import {
  groupStateLines,
  hazardDetailsSummaryJa,
  reasonsBesideHighlightsJa,
  HAZARD_NOTES_TITLE_JA,
  HAZARD_REASONS_TITLE_JA,
  type GroupStateLine,
} from '@/domain/hazard/panels'
import { cn } from '@/lib/utils'
import { Emphasis } from './Emphasis'
import { HazardDisclaimer } from './HazardDisclaimer'
import { PHRASE_WRAP_CLASS } from './phraseWrap'
import { SourceList } from './SourceList'

/** 種類ごとの状態・畳まない注意・固有の事実を持つカード（地点のカード）。 */
type GroupedHazardCardPanel = HazardCardPanel & {
  readonly groupStates: NonNullable<HazardCardPanel['groupStates']>
  readonly keyNotesJa: NonNullable<HazardCardPanel['keyNotesJa']>
  readonly highlightsJa: NonNullable<HazardCardPanel['highlightsJa']>
}

function isGrouped(panel: HazardCardPanel): panel is GroupedHazardCardPanel {
  return (
    panel.groupStates !== undefined &&
    panel.keyNotesJa !== undefined &&
    panel.highlightsJa !== undefined
  )
}

/**
 * 危険度バッジ（色 ＋ 記号 ＋ ラベルの 3 重）。ラベルはサーバが決めたもの（警報のカードは「警戒レベル3相当」「注意報あり」
 * 「発表なし」「未確認」）があればそれ、無ければ危険度のラベル。
 */
function LevelBadge({ panel }: { panel: HazardCardPanel }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: HAZARD_LEVEL_COLORS[panel.level] }}
    >
      <span aria-hidden>{HAZARD_LEVEL_ICONS[panel.level]}</span>
      {panel.levelLabelJa ?? HAZARD_LEVEL_LABELS_JA[panel.level]}
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

/** 公式凡例の色見本（未確定の色は出さない）。 */
function Swatch({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="mt-1 size-3 shrink-0 rounded-sm ring-1 ring-slate-300"
      style={color === null ? undefined : { backgroundColor: color }}
    />
  )
}

/** 括弧で添える危険度の語（サーバが決める。警報の行は null＝添えない）。無ければ危険度のラベル。 */
function levelWordJa(item: HazardItem): string | null {
  return item.levelLabelJa === undefined ? HAZARD_LEVEL_LABELS_JA[item.level] : item.levelLabelJa
}

/** 見出し・結論・確からしさ・避難の目安（どちらの描き方でも同じ）。 */
function CardHead({
  panel,
  certaintyNote,
}: {
  panel: HazardCardPanel
  certaintyNote: string | null
}) {
  const compact = panel.size === 'compact'
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn('font-bold text-slate-900', compact ? 'text-base' : 'text-lg')}>
          {panel.placeJa}
        </h2>
        <LevelBadge panel={panel} />
      </div>

      <p className="mt-2 text-sm font-medium text-slate-800">
        <Emphasis text={panel.headlineJa} />
      </p>

      {certaintyNote !== null && <p className="mt-1 text-xs text-amber-700">ⓘ {certaintyNote}</p>}

      {panel.evacuation !== null && (
        <p className="mt-1 text-sm font-semibold text-slate-900">
          → {EVACUATION_LABELS_JA[panel.evacuation]}
        </p>
      )}
    </>
  )
}

// --- 地点のカード（種類ごとの状態がある） ----------------------------------------------------

/**
 * 出所の札が要るか。**地図と同じ（公式タイルの画素）なら言わなくても分かる**——浸水ナビの実測（m まで言える）と
 * 250m メッシュ（区間でしか言えない）は、同じ「3〜5m 未満」でも意味が違うので札で見分ける。
 */
function needsSourceTag(item: HazardItem): boolean {
  return item.source !== 'tile'
}

/** 該当 1 件を 2 段で（名前と出所の札／記号・値・意味）。危険度の語は読み上げにだけ残す。 */
function ItemRow({ item }: { item: HazardItem }) {
  const levelWord = levelWordJa(item)
  return (
    <li className="flex items-start gap-2 py-1">
      <Swatch color={item.color} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
          {item.labelJa}
          {needsSourceTag(item) && <SourceBadge item={item} />}
        </p>
        <p className="text-sm text-slate-900">
          <span aria-hidden className="mr-1">
            {HAZARD_LEVEL_ICONS[item.level]}
          </span>
          <span className="font-medium">{item.valueJa}</span>
          {levelWord !== null && <span className="sr-only">（{levelWord}）</span>}
          {item.meaningJa !== null && (
            <span className="text-xs text-slate-500"> — {item.meaningJa}</span>
          )}
        </p>
      </div>
    </li>
  )
}

/**
 * 状態の行の調子。該当なしは地の色、**それ以外は注意の色**にする——すぐ近くに区域・想定区域図なし・未確認は、
 * その場所にしか無い注意である（亀有の「土砂災害：この地域には想定区域図がありません」が、一般論の 6 行に
 * 埋もれていた・`docs/261110_fix_PLAN.md` §1.4）。該当の種類は行にしない（該当の行が値つきで言う）。
 */
const LINE_TONE: Readonly<Record<HazardGroupStateKind, string>> = {
  hit: 'text-slate-700',
  nearby: 'text-amber-800',
  uncovered: 'text-amber-800',
  unknown: 'text-amber-800',
  none: 'text-slate-600',
}

/** 該当しなかった種類の行と、それを安全と読ませない 1 文（**畳まない**・文節で折り返す）。 */
function StateLines({
  lines,
  keyNotesJa,
}: {
  lines: readonly GroupStateLine[]
  keyNotesJa: readonly string[]
}) {
  if (lines.length === 0 && keyNotesJa.length === 0) return null
  return (
    <div className={cn('mt-3 space-y-0.5 text-xs leading-snug', PHRASE_WRAP_CLASS)}>
      {lines.map((line) => (
        <p key={line.state} className={LINE_TONE[line.state]}>
          <span className="font-semibold">{line.stateJa}</span>：{line.groupsJa}
        </p>
      ))}
      {keyNotesJa.map((note) => (
        <p key={note} className="font-medium text-slate-800">
          ※ {note}
        </p>
      ))}
    </div>
  )
}

/** 畳む中身（規則ごとの根拠と、一般論・メッシュの注記・取れなかったもの）。押すと全部読める。 */
function Details({
  reasonsJa,
  notesJa,
}: {
  reasonsJa: readonly string[]
  notesJa: readonly string[]
}) {
  const count = reasonsJa.length + notesJa.length
  if (count === 0) return null
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
        {hazardDetailsSummaryJa(count)}
      </summary>
      {reasonsJa.length > 0 && (
        <ul
          aria-label={HAZARD_REASONS_TITLE_JA}
          className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600"
        >
          {reasonsJa.map((reason, index) => (
            <li key={`${index}-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}
      {notesJa.length > 0 && (
        <ul
          aria-label={HAZARD_NOTES_TITLE_JA}
          className="mt-1.5 space-y-1 rounded-lg bg-amber-50 p-2 text-amber-800"
        >
          {notesJa.map((note, index) => (
            <li key={`${index}-${note}`}>
              <Emphasis text={note} />
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/** 地点のカードの本体：該当の行 → 川の到達・継続 → 種類ごとの状態と 1 文 → 根拠と注意（畳む）。 */
function GroupedBody({ panel }: { panel: GroupedHazardCardPanel }) {
  return (
    <>
      {panel.items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {panel.items.map((item) => (
            <ItemRow key={item.layerKey} item={item} />
          ))}
        </ul>
      )}
      {/* その場所にしか無い事実（浸水ナビの「何分後に・何日続く」）。行のすぐ下に、畳まずに。 */}
      {panel.highlightsJa.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
          {panel.highlightsJa.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      <StateLines lines={groupStateLines(panel.groupStates)} keyNotesJa={panel.keyNotesJa} />
      <Details
        reasonsJa={reasonsBesideHighlightsJa(panel.reasonsJa, panel.highlightsJa)}
        notesJa={panel.coverageNotesJa}
      />
    </>
  )
}

// --- 今までの描き方（警報のカード・古い応答） -----------------------------------------------

/** 該当ハザード 1 件（公式凡例の色見本＋レイヤ名＋階級＋意味＋出所）。 */
function LegacyRow({ item }: { item: HazardItem }) {
  const levelWord = levelWordJa(item)
  return (
    <li className="flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-b-0">
      <Swatch color={item.color} />
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
          {levelWord !== null && (
            <span className="ml-1 text-xs font-normal text-slate-400">（{levelWord}）</span>
          )}
        </p>
        {item.meaningJa !== null && <p className="text-xs text-slate-500">{item.meaningJa}</p>}
      </div>
    </li>
  )
}

function LegacyBody({ panel }: { panel: HazardCardPanel }) {
  return (
    <>
      {panel.items.length > 0 && (
        <ul className="mt-3">
          {panel.items.map((item) => (
            <LegacyRow key={item.layerKey} item={item} />
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
    </>
  )
}

export function HazardCard({ panel }: { panel: HazardCardPanel }) {
  const compact = panel.size === 'compact'
  const grouped = isGrouped(panel)
  // 文言は domain が持つ（AI も同じことを言える・CLAUDE.md §2）。
  const certaintyNote = grouped
    ? cardCertaintyNoteJa(panel.certainty, panel.headlineJa)
    : certaintyNoteJa(panel.certainty)

  return (
    <section className={cn('rounded-xl bg-white', compact ? 'p-3' : 'px-1 py-1')}>
      <CardHead panel={panel} certaintyNote={certaintyNote} />
      {grouped ? <GroupedBody panel={panel} /> : <LegacyBody panel={panel} />}
      <SourceList sources={panel.sources} className={grouped ? 'mt-2' : 'mt-3'} />
      <HazardDisclaimer textJa={panel.disclaimerJa} />
    </section>
  )
}
