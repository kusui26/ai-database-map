'use client'

/** ルートのエラーバウンダリ（P7a）。詳細は表示せず、再試行とホーム導線のみ。 */

import Link from 'next/link'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-lg ring-1 ring-slate-200">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8v5" strokeLinecap="round" />
            <path d="M12 16.5h.01" strokeLinecap="round" />
            <path
              d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">問題が発生しました</h1>
        <p className="mt-1 text-sm text-slate-600">
          一時的なエラーの可能性があります。再読み込みをお試しください。
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            再試行
          </button>
          <Link
            href="/"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            地図に戻る
          </Link>
        </div>
      </div>
    </div>
  )
}
