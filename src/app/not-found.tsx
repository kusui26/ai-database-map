import Link from 'next/link'

/** 404（P7a）。 */
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-lg ring-1 ring-slate-200">
        <p className="text-4xl font-bold text-indigo-600">404</p>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">ページが見つかりません</h1>
        <p className="mt-1 text-sm text-slate-600">
          URL が変更されたか、削除された可能性があります。
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          地図に戻る
        </Link>
      </div>
    </div>
  )
}
