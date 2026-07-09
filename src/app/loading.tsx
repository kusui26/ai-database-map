import { MapSkeleton } from '@/components/MapSkeleton'

/** ルートの初期ロード表示（P7a）。Suspense fallback と同じシェルスケルトン。 */
export default function Loading() {
  return <MapSkeleton />
}
