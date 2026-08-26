'use client'

/**
 * 現在地のまわりのメッシュを**先に端末へ落としておく**（`docs/260824_flood.md` §8.3）。
 *
 * オフラインで効かせるには、**オフラインになる前に**取っておくしかない。
 * 現在地を使い始めた時点で、その 1 次メッシュと周囲 8 枚（3×3・約 240km 四方）を
 * 静かに取得する。Service Worker がキャッシュ優先で拾うので、以後は通信が切れても答えられる。
 *
 * 取りに行くのは**索引に載っている組み合わせだけ**（無い区画に 404 を撃たない）。
 */

import { useEffect, useRef } from 'react'
import { elevationTilePath, tilePath } from '@/shared/hazard-mesh'
import { meshCodeFromLonLat, primaryMeshOf, surroundingPrimaries } from '@/shared/mesh'
import { hazardMeshIndex } from '@/lib/hazard/meshTiles'
import type { CurrentPosition } from '@/stores/geoStore'

const SERVICE_WORKER_PATH = '/sw.js'

/** Service Worker を登録する（未対応のブラウザでは何もしない＝オンラインでは普通に動く）。 */
async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) return
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH)
  } catch (error) {
    // 登録できなくても、オンラインなら共通API で答えられる。原因だけ残して諦める。
    console.error('Service Worker を登録できませんでした（オフライン表示は使えません）', error)
  }
}

/** 周囲 9 枚ぶんの配布ファイルの URL（索引に載っているものだけ）。 */
async function tileUrls(lon: number, lat: number): Promise<readonly string[]> {
  const index = await hazardMeshIndex()
  return surroundingPrimaries(lon, lat).flatMap((primary) => {
    const layers = Object.keys(index.layers).flatMap((key) => {
      const path = tilePath(index, key, primary)
      return path === null ? [] : [path]
    })
    const elevation = elevationTilePath(index, primary)
    return [...layers, ...(elevation === null ? [] : [elevation])].map((path) => `/hazard/${path}`)
  })
}

/** 取りに行く（失敗しても黙って諦める＝オンラインの体験を損なわない）。 */
async function warmCache(lon: number, lat: number): Promise<void> {
  try {
    const urls = await tileUrls(lon, lat)
    await Promise.allSettled(urls.map((url) => fetch(url)))
  } catch (error) {
    console.error('オフライン用のメッシュを先読みできませんでした', error)
  }
}

/**
 * 現在地が最初に取れたとき（と 1 次メッシュをまたいだとき）に先読みする。
 * 同じ枠では 1 回しか走らない。
 */
export function useOfflineHazardCache(position: CurrentPosition | null): void {
  const warmed = useRef<Set<string>>(new Set())

  useEffect(() => {
    void registerServiceWorker()
  }, [])

  useEffect(() => {
    if (position === null) return
    const primary = primaryMeshOf(meshCodeFromLonLat(position.lon, position.lat))
    if (warmed.current.has(primary)) return
    warmed.current.add(primary)
    void warmCache(position.lon, position.lat)
  }, [position])
}
