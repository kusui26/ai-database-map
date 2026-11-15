'use client'

import { useEffect, useRef } from 'react'

/**
 * 値が（最初の描画のあとに）替わったら `onChange` を呼ぶ。**最初の値では呼ばない**——
 * 開いた図が、開いた時点の地図の半径で自分の条件を上書きしないため（`metrics/useMetricChoice.ts`）。
 * `onChange` には安定した関数（`useCallback`）を渡す。
 */
export function useOnChange<T>(value: T, onChange: (next: T) => void): void {
  const seen = useRef(value)
  useEffect(() => {
    if (Object.is(seen.current, value)) return
    seen.current = value
    onChange(value)
  }, [value, onChange])
}
