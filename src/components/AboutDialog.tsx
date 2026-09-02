'use client'

/**
 * About / データ出典ダイアログ（P7a）。アプリ説明＋出典表（catalog の source/license から
 * `dataSources()` で自動生成）＋**災害データの出典**＋地図クレジット。⚠ は商用制限のある出典。
 *
 * 災害データ（`hazardDataSources()`）も**手で書かない**——レイヤや API を足したら自動で増える。
 * 出典の表示は利用条件なので、増えないと「使っているのに出典が無い」状態が生まれる。
 */

import * as Dialog from '@radix-ui/react-dialog'
import { dataSources } from '@/domain/sources'
import { hazardDataSources } from '@/domain/hazard/sources'
import { cn } from '@/lib/utils'

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const sources = dataSources()
  const hazardSources = hazardDataSources()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <Dialog.Title className="font-semibold text-slate-900">
              このアプリ・データ出典
            </Dialog.Title>
            <Dialog.Close
              aria-label="閉じる"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm text-slate-700">
            <section className="space-y-2">
              <p>
                <span className="font-semibold text-slate-900">AI Database Map</span>{' '}
                は、公的オープンデータ（乗降客数・人口・地価・バス・事業所・従業者）を
                <span className="font-medium">駅からの半径</span>
                で集約し、地図とAIで誰でも扱えるようにする実験的な Web アプリです。
                <span className="font-medium">洪水・内水・高潮・津波・土砂災害</span>
                のハザードマップ、いまの警報、近くの
                <span className="font-medium">指定緊急避難場所</span>も扱えます。
              </p>
              <p className="text-slate-500">
                数値は各公的統計の二次加工であり、原典の定義・年次・集計単位に依存します。母数が小さい・一部の運営会社しかデータが無いなど、注意すべき値には
                ⚠ を付しています。
              </p>
              <p>
                <a
                  href="/ai"
                  className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
                >
                  あなたの Claude（Claude Code / Claude.ai）からこのデータを使う →
                </a>
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-slate-900">データ出典</h3>
              <p className="text-xs text-slate-500">
                下表は指標カタログから自動生成しています。多くは出典明記で商用利用可（政府統計・国土数値情報
                利用約款）ですが、<span className="font-medium text-amber-700">⚠</span>{' '}
                の付いた出典は商用利用に制限があります。ご利用の際は各原典の利用規約をご確認ください。
              </p>
              <ul className="space-y-2">
                {sources.map((s) => (
                  <li
                    key={s.source}
                    className={cn(
                      'rounded-xl border p-3',
                      s.nonCommercial
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50/60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-slate-900">
                        {s.nonCommercial && <span aria-hidden>⚠ </span>}
                        {s.source}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                        {s.metricCount} 指標
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.categoryLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    <p
                      className={cn(
                        'mt-1.5 text-xs',
                        s.nonCommercial ? 'text-amber-700' : 'text-slate-500',
                      )}
                    >
                      {s.license}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-slate-900">災害データの出典</h3>
              <p className="text-xs text-slate-500">
                ハザード・カタログと、参照している API から自動生成しています。
                <span className="font-medium">
                  この地図は災害リスクの目安を示すもので、実際の避難は市町村が発表する避難情報に従ってください。
                </span>
              </p>
              <ul className="space-y-2">
                {hazardSources.map((s) => (
                  <li
                    key={`${s.source}-${s.license}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
                  >
                    <span className="font-medium text-slate-900">{s.source}</span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.usedForJa.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                    {s.license !== null && (
                      <p className="mt-1.5 text-xs text-slate-500">{s.license}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-1">
              <h3 className="font-semibold text-slate-900">地図</h3>
              <p className="text-xs text-slate-500">
                地図：{' '}
                <a
                  href="https://www.gsi.go.jp/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
                >
                  国土地理院 最適化ベクトルタイル
                </a>
                （淡色）。
              </p>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
