export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
        <span className="size-2 rounded-full bg-indigo-600" aria-hidden />
        P0 · 足場構築
      </span>

      <h1 className="text-4xl font-bold tracking-tight text-slate-900">AI Database Map</h1>

      <p className="text-lg leading-relaxed text-slate-600">
        オープンデータ（乗降客数・人口・地価・バス・事業所…）を
        <span className="font-semibold text-slate-800">駅 × 半径</span>
        で集約し、地図とAIで誰でも使えるようにするWebアプリ。
      </p>

      <p className="text-sm text-slate-500">
        現在セットアップ中です。地図・駅名検索・駅詳細・ランキング・散布図を順次公開します。
      </p>

      <footer className="mt-8 text-xs text-slate-400">出典: 国土数値情報 / e-Stat ほか</footer>
    </main>
  )
}
