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
 */

import { bundledSources } from '@/domain/hazard/panels'
import type { SourceRef } from '@/shared/protocol'
import { cn } from '@/lib/utils'

const LINK_CLASS = 'underline underline-offset-2 hover:text-slate-600'

export function SourceList({
  sources,
  className,
}: {
  sources: readonly SourceRef[]
  className?: string
}) {
  if (sources.length === 0) return null
  return (
    <ul className={cn('space-y-0.5 text-[11px] text-slate-400', className)}>
      {bundledSources(sources).map((row) => (
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
