/**
 * 出典の一覧（`HazardCard` / `EvacuationList` / `EscapeDirection` 共通・
 * `docs/260828_fix_flood.md` §11 案 C）。
 *
 * 3 パネルが同じ `<li key={source.labelJa}>` を書き写していて、同じ文で URL だけ違う行が
 * 並ぶと**全員同じ壊れ方**（重複キー警告＋同じ 1 文の繰り返し）をした。束ね方はドメインの
 * `bundledSources` が持ち、ここは並べるだけ——**文言も鍵もここでは作らない**。
 *
 * 束ねた行は「文 1 回 ＋ 名前つきリンク（洪水・高潮…）」になる。リンクの下線が
 * 地の文との区別を担うので、名前の並びに新しい記号は足さない。
 *
 * `folded` のときは「出典（N）」の 1 行に畳み、押すと同じ一覧が開く（駅周辺のプロフィール・エリアの要約・
 * 2026-11-11・`docs/261110_fix_PLAN.md` §2.3）。出典の表示は利用条件なので、**消さずに畳む**——全件は About にもある。
 * 災害の 3 パネルは畳まない（1〜2 行と短く、年度と出典を常に見せる・`docs/260824_flood.md` §7.5）。
 */

import { bundledSources, type BundledSource } from '@/domain/hazard/panels'
import type { SourceRef } from '@/shared/protocol'
import { cn } from '@/lib/utils'

const LINK_CLASS = 'underline underline-offset-2 hover:text-slate-600'

export function SourceList({
  sources,
  className,
  folded = false,
}: {
  sources: readonly SourceRef[]
  className?: string
  /** 「出典（N）」の 1 行に畳む（押すと開く）。 */
  folded?: boolean
}) {
  if (sources.length === 0) return null
  const rows = bundledSources(sources)
  const list = <SourceRows rows={rows} className={folded ? 'mt-1' : className} />
  if (!folded) return list
  return (
    <details className={cn('text-[11px]', className)}>
      <summary className="cursor-pointer text-slate-500">出典（{rows.length}）</summary>
      {list}
    </details>
  )
}

function SourceRows({ rows, className }: { rows: readonly BundledSource[]; className?: string }) {
  return (
    <ul className={cn('space-y-0.5 text-[11px] text-slate-400', className)}>
      {rows.map((row) => (
        <li key={row.labelJa}>
          {row.url === null ? (
            row.labelJa
          ) : (
            <a href={row.url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
              {row.labelJa}
            </a>
          )}
          {row.links.map((link) => (
            <a
              key={`${link.url}#${link.textJa}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className={cn(LINK_CLASS, 'ml-1.5')}
            >
              {link.textJa}
            </a>
          ))}
        </li>
      ))}
    </ul>
  )
}
