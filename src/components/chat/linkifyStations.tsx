'use client'

/**
 * 本文中の「既知の駅名」をクリック可能チップにする（plan_fable §2.4 ルール④）。
 * 既知＝この応答の data-map（stationCard/ranking/scatter）に出た駅名のみ＝name→grp が確実な範囲に限定。
 * タップで駅選択（flyTo＋詳細）。安全のため 2 文字以上・長い名前優先で一度だけ分割する。
 */

import { type ReactNode } from 'react'

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function linkifyStations(
  text: string,
  nameToGrp: ReadonlyMap<string, string>,
  onSelect: (grp: string) => void,
): ReactNode[] {
  const names = [...nameToGrp.keys()]
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length)
  if (names.length === 0) return [text]

  const pattern = new RegExp(`(${names.map(escapeRe).join('|')})`, 'g')
  return text.split(pattern).map((part, index) => {
    const grp = nameToGrp.get(part)
    if (grp === undefined) return <span key={index}>{part}</span>
    return (
      <button
        key={index}
        type="button"
        onClick={() => onSelect(grp)}
        className="mx-0.5 rounded bg-indigo-50 px-1 font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 transition-colors hover:bg-indigo-100"
      >
        {part}
      </button>
    )
  })
}
