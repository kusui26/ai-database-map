'use client'

/**
 * 順位に**必ず添えるもの**（§13.4 の規範）——何を候補にしたか・どの方法で正規化したか・
 * 重みを振ったら並びが変わるか・何駅を外したか・限界・出典。
 *
 * 文言はサーバが作ったものをそのまま出す。画面で言い換えると、同じ計算の説明が
 * チャットと画面で食い違う（CLAUDE.md §2）。ここがするのは並べ方だけ。
 */

import type { RecommendResponse } from '@/shared/api'
import type { ResultAdvice } from './advice'
import { countsJa, exclusionsJa, flaggedRowCount } from './summary'

/**
 * 空振り（0 件・全除外）と、少なすぎる結果の言い方。
 * **「該当なし」で終わらせない**——理由はこちらが持っているのだから、次の一手まで出す。
 */
export function RecommendAdvice({ advice }: { advice: ResultAdvice }) {
  const empty = advice.tone === 'empty'
  return (
    <div
      className={
        empty
          ? 'mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200'
          : 'mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200'
      }
    >
      <p className="font-medium">{advice.headlineJa}</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {advice.hintsJa.map((hint) => (
          <li key={hint} className="flex gap-1.5">
            <span aria-hidden className="opacity-50">
              ・
            </span>
            <span>{hint}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * ⚠ が何を意味するかを、**印と同じ画面で**言う。
 * 件数も出す——出さないと、例外なのか常態なのかが分からない。
 */
export function RecommendFlaggedNote({ response }: { response: RecommendResponse }) {
  if (response.flagged === 'exclude') {
    const excluded = response.excludedCounts.flagged
    if (excluded === 0) return null
    return (
      <p className="mt-1.5 text-xs text-amber-700">
        ⚠（値が信用できない指標）が付いた {excluded} 駅を候補から外しています。
      </p>
    )
  }
  const marked = flaggedRowCount(response.rows)
  if (marked === 0) return null
  return (
    <p className="mt-1.5 text-xs text-amber-700">
      ⚠ は低分母などで値が信用できない指標がある駅です（表示中 {marked} 駅）。参考値として読み、
      外したいときは上の「⚠除外」を使ってください。
    </p>
  )
}

/** 表の上に出す帯。**候補の数を最初に**（候補が変われば順位も変わるため）。 */
export function RecommendSummaryBar({ response }: { response: RecommendResponse }) {
  const excluded = exclusionsJa(response.excludedCounts)
  return (
    <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <p>
        <span className="font-semibold text-slate-800">{countsJa(response)}</span>
        <span className="ml-2">{response.area.labelJa}</span>
        {excluded !== null && <span className="ml-2 text-slate-500">{excluded}</span>}
      </p>
      <p className="text-slate-500">
        {response.preset.labelJa}
        {response.preset.customized && <span className="text-indigo-600">（重みを変更）</span>}
        <span className="mx-1.5 text-slate-300">/</span>
        {response.methodJa}
        <span className="mx-1.5 text-slate-300">/</span>
        {response.hazard.labelJa}
      </p>
      {/* 順位そのものにかかる断り書きなので、**読む前に**出す（末尾では遅い）。 */}
      <p className="text-slate-500">{response.sensitivity.verdictJa}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-semibold text-slate-700">{title}</h4>
      {children}
    </section>
  )
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="space-y-0.5 text-xs text-slate-500">
      {lines.map((line) => (
        <li key={line} className="flex gap-1.5">
          <span aria-hidden className="text-slate-300">
            ・
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

/** 表の下。**限界と出典は畳まない**（§13.4-6「必ず末尾に」）。 */
export function RecommendFootnotes({ response }: { response: RecommendResponse }) {
  const excluded = exclusionsJa(response.excludedCounts)
  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      <Section title="重みを ±20% 振ったら">
        <p className="text-xs text-slate-500">{response.sensitivity.verdictJa}</p>
        {response.sensitivity.swaps.length > 0 && (
          <p className="text-xs text-slate-500">
            入れ替わり：
            {response.sensitivity.swaps.map((swap) => `${swap.a.name} ⇄ ${swap.b.name}`).join('、')}
          </p>
        )}
      </Section>

      {excluded !== null && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700">{excluded}</summary>
          <ul className="mt-1 space-y-0.5 text-slate-500">
            {response.excluded.map((entry) => (
              <li key={entry.grp}>
                <span className="font-medium text-slate-600">{entry.name}</span>：{entry.reasonJa}
              </li>
            ))}
          </ul>
        </details>
      )}

      {response.notesJa.length > 0 && (
        <Section title="計算の注記">
          <Lines lines={response.notesJa} />
        </Section>
      )}

      <Section title="この結果の限界">
        <Lines lines={response.limitationsJa} />
      </Section>

      <Section title="出典">
        <ul className="space-y-0.5 text-[11px] text-slate-400">
          {response.sources.map((source) => (
            <li key={`${source.source} ${source.license}`}>
              {source.source}（{source.license}）
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
