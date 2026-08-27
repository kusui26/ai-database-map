'use client'

/**
 * 通信できているか（`navigator.onLine` の監視）。
 *
 * 通信断の扱いは 2 か所で要る——通信断のピル（`OfflineBanner`）と、警戒バナーの
 * 「更新されていません」の注記（`docs/260824_flood.md` §7.4）。同じ監視を 2 度書くと、
 * 片方だけ直して**表示が食い違う**ので 1 本にまとめる。
 *
 * サーバ描画では**必ずオンライン扱い**にする（`navigator` が無い）。切断中の見た目で
 * ハイドレートしてから online に戻ると、一瞬だけ嘘のピルが出る。
 */

import { useEffect, useState } from 'react'

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}
