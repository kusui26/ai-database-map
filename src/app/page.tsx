import { Suspense } from 'react'
import { MapShell } from '@/components/MapShell'

export default function Home() {
  // MapShell は nuqs（useSearchParams）を使うため Suspense 境界で包む
  return (
    <Suspense>
      <MapShell />
    </Suspense>
  )
}
