import { Suspense } from 'react'
import { MapShell } from '@/components/MapShell'
import { MapSkeleton } from '@/components/MapSkeleton'

export default function Home() {
  // MapShell は nuqs（useSearchParams）を使うため Suspense 境界で包む。
  // 静的ページでは useSearchParams が境界を CSR に退避させるので、fallback を
  // 実体シェル（main ランドマーク＋スケルトン）にしてサーバ描画させる（LCP/a11y）。
  return (
    <Suspense fallback={<MapSkeleton />}>
      <MapShell />
    </Suspense>
  )
}
