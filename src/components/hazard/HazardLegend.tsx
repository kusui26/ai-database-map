'use client'

/**
 * 表示中ハザードの凡例（カタログ駆動）。
 *
 * 色・ラベル・意味・年度・出典・網羅性の注記はすべてドメインが組み立てた
 * `HazardLegendSection` から描く。**凡例テキストをここに直書きしない**——書いた瞬間に
 * 「UI では説明されるが AI は知らない」というズレが生まれる（.claude/CLAUDE.md §2）。
 *
 * この凡例が守る不変条件（docs/260824_flood.md §7.5）：
 *  - 白は「想定なし」であって「安全」ではない（末尾に常設の注記）
 *  - レイヤごとの網羅性の注記を必ず出す
 *  - 年度と出典を常時表示する
 *  - **白い場所を補える地形レイヤを、押せる形で出す**（§3.7・PR-4e）
 */

import { type HazardLegendSection } from '@/domain/hazard/catalog'
import { Emphasis } from '@/components/panels/Emphasis'

/** 色見本（未確定の階級は枠だけ出して、色を主張しない）。 */
function Swatch({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 size-3 shrink-0 rounded-sm ring-1 ring-slate-300"
      style={color === null ? undefined : { backgroundColor: color }}
    />
  )
}

/**
 * 白い場所を補う導線（§3.7）。
 *
 * 内水は 47 都道府県中 22 でしか整備されていない。**「レイヤを OFF にしているのか、
 * 地図が無いのか」が見分けられない**のがいちばん危ないので、注記のすぐ下に
 * **押せる形**で地形レイヤを出す。カタログの `fallbackLayerKeys` が唯一の真実で、
 * ここには 1 つも名前を書かない。
 */
function Fallbacks({
  section,
  onAdd,
}: {
  section: HazardLegendSection
  onAdd: (layerKey: string) => void
}) {
  if (section.fallbacks.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-slate-500">白い場所は地形で補えます:</span>
      {section.fallbacks.map((fallback) => (
        <button
          key={fallback.key}
          type="button"
          onClick={() => onAdd(fallback.key)}
          className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100"
        >
          ＋{fallback.labelJa}
        </button>
      ))}
    </div>
  )
}

function LegendSection({
  section,
  onAdd,
}: {
  section: HazardLegendSection
  onAdd: (layerKey: string) => void
}) {
  return (
    <section className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-semibold text-slate-700">
        {section.labelJa}
        {section.vintageJa !== null && (
          <span className="ml-1 font-normal text-slate-400">（{section.vintageJa}）</span>
        )}
      </h4>

      {section.rows.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {section.rows.map((row) => (
            <li key={row.order} className="flex items-start gap-1.5">
              <Swatch color={row.color} />
              <span className="min-w-0 text-[11px] leading-4 text-slate-600">
                <span className="font-medium text-slate-800">{row.labelJa}</span>
                <span className="text-slate-500"> — {row.meaningJa}</span>
                {row.colorUncertain && (
                  <span
                    className="text-slate-400"
                    title="配色は配信タイルの実測で、対応づけに推定を含みます"
                  >
                    {' '}
                    ※
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          {section.summaryJa}
          {section.legendUrl !== null && (
            <>
              {' '}
              <a
                href={section.legendUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-slate-700"
              >
                公式凡例
              </a>
            </>
          )}
        </p>
      )}

      {section.coverageNoteJa !== null && (
        <p className="mt-1 rounded-md bg-amber-50 px-1.5 py-1 text-[11px] leading-4 text-amber-800">
          <Emphasis text={section.coverageNoteJa} />
        </p>
      )}
      <Fallbacks section={section} onAdd={onAdd} />
      <p className="mt-1 text-[10px] leading-4 text-slate-400">出典: {section.sourceJa}</p>
    </section>
  )
}

export function HazardLegend({
  sections,
  onAddLayer,
}: {
  sections: readonly HazardLegendSection[]
  /** 参考レイヤを足す（レイヤ制御のトグルと同じ経路を通す）。 */
  onAddLayer: (layerKey: string) => void
}) {
  if (sections.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-500">凡例</h3>
      {sections.map((section) => (
        <LegendSection key={section.layerKey} section={section} onAdd={onAddLayer} />
      ))}
      {/* §7.5-1：白は「想定なし」であって「安全」ではない。凡例の一番下に常設する。 */}
      <p className="rounded-md bg-slate-100 px-1.5 py-1 text-[11px] leading-4 text-slate-600">
        色が塗られていない場所は「想定区域が指定されていない」という意味で、
        <span className="font-semibold">「安全」という意味ではありません。</span>
      </p>
    </div>
  )
}
