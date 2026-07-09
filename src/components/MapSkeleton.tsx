/**
 * アプリシェルのスケルトン（P7a）。サーバ描画される：
 * page.tsx の Suspense フォールバック（nuqs の useSearchParams は静的ページを CSR に退避させるため、
 * ここが実体 HTML＝main ランドマーク＋即時の意味ある描画）と loading.tsx で共用。
 */
export function MapSkeleton() {
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-100">
      <div className="absolute inset-x-0 top-0 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="h-11 w-full animate-pulse rounded-xl bg-white/80 shadow ring-1 ring-slate-200 sm:w-72" />
          <div className="h-9 w-40 animate-pulse rounded-lg bg-white/70 ring-1 ring-slate-200 sm:ml-auto" />
        </div>
      </div>
      <div className="grid h-full place-items-center text-sm text-slate-400">地図を読み込み中…</div>
    </main>
  )
}
