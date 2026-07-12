'use client'

/**
 * アシスタント本文の軽量リッチテキスト描画（P8b 改善）。
 * LLM が出す簡易 markdown（見出し `#`・箇条書き `* / -`・強調 `**…**`）を読める形に整え、
 * **本文中の既知駅名をクリック可能チップ**にする（plan_fable §2.4 ルール④・name→grp が確実な範囲に限定）。
 * 重い markdown ライブラリは使わない（依存とバンドルを増やさない）。
 */

import { Fragment, type ReactNode } from 'react'

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 素のテキスト片の中の既知駅名をチップ化する。 */
function linkify(
  text: string,
  nameToGrp: ReadonlyMap<string, string>,
  onSelect: (grp: string) => void,
  keyPrefix: string,
): ReactNode[] {
  const names = [...nameToGrp.keys()]
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length)
  if (names.length === 0) return [text]
  const pattern = new RegExp(`(${names.map(escapeRe).join('|')})`, 'g')
  return text.split(pattern).map((segment, index) => {
    const grp = nameToGrp.get(segment)
    if (grp === undefined) return <Fragment key={`${keyPrefix}-${index}`}>{segment}</Fragment>
    return (
      <button
        key={`${keyPrefix}-${index}`}
        type="button"
        onClick={() => onSelect(grp)}
        className="rounded bg-indigo-50 px-1 font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 transition-colors hover:bg-indigo-100"
      >
        {segment}
      </button>
    )
  })
}

/** 1 行分のインライン（**強調** ＋ 駅名リンク）を描画する。 */
function renderInline(
  text: string,
  nameToGrp: ReadonlyMap<string, string>,
  onSelect: (grp: string) => void,
  keyPrefix: string,
): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap<ReactNode>((part, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    if (bold !== null) {
      return [
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-slate-900">
          {linkify(bold[1] ?? '', nameToGrp, onSelect, `${keyPrefix}-b${index}`)}
        </strong>,
      ]
    }
    return linkify(part, nameToGrp, onSelect, `${keyPrefix}-t${index}`)
  })
}

export function RichText({
  text,
  nameToGrp,
  onSelect,
}: {
  text: string
  nameToGrp: ReadonlyMap<string, string>
  onSelect: (grp: string) => void
}) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1">
      {lines.flatMap((line, index) => {
        const trimmed = line.trim()
        if (trimmed === '') return []
        const key = `l${index}`

        const heading = /^#{1,6}\s+(.*)$/.exec(trimmed)
        if (heading !== null) {
          return [
            <p key={key} className="mt-1 font-semibold text-slate-900">
              {renderInline(heading[1] ?? '', nameToGrp, onSelect, key)}
            </p>,
          ]
        }

        // 箇条書き（`* item` / `- item`。`**bold**` は空白が続かないので誤マッチしない）
        const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
        if (bullet !== null) {
          return [
            <div key={key} className="flex gap-1.5">
              <span className="mt-px shrink-0 text-slate-400" aria-hidden>
                •
              </span>
              <span>{renderInline(bullet[1] ?? '', nameToGrp, onSelect, key)}</span>
            </div>,
          ]
        }

        return [<p key={key}>{renderInline(trimmed, nameToGrp, onSelect, key)}</p>]
      })}
    </div>
  )
}
