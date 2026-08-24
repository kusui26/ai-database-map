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
 */

import { type HazardLegendSection } from '@/domain/hazard/catalog'

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

function LegendSection({ section }: { section: HazardLegendSection }) {
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
          {section.coverageNoteJa}
        </p>
      )}
      <p className="mt-1 text-[10px] leading-4 text-slate-400">出典: {section.sourceJa}</p>
    </section>
  )
}

export function HazardLegend({ sections }: { sections: readonly HazardLegendSection[] }) {
  if (sections.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-500">凡例</h3>
      {sections.map((section) => (
        <LegendSection key={section.layerKey} section={section} />
      ))}
      {/* §7.5-1：白は「想定なし」であって「安全」ではない。凡例の一番下に常設する。 */}
      <p className="rounded-md bg-slate-100 px-1.5 py-1 text-[11px] leading-4 text-slate-600">
        色が塗られていない場所は「想定区域が指定されていない」という意味で、
        <span className="font-semibold">「安全」という意味ではありません。</span>
      </p>
    </div>
  )
}
