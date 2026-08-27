'use client'

/**
 * 見ている場所のまわりのメッシュを**先に端末へ落としておく**（`docs/260824_flood.md` §8.3）。
 *
 * オフラインで効かせるには、**オフラインになる前に**取っておくしかない。
 * その 1 次メッシュと周囲 8 枚（3×3・約 240km 四方）を静かに取得する。
 * Service Worker がキャッシュ優先で拾うので、以後は通信が切れても答えられる。
 *
 * ## いつ・どれだけ落とすか
 *
 * 当初は「現在地を使い始めたとき」に **3×3 の 9 枚**だけだった。しかし
 * **警戒レベル3相当以上が出ている地域を見ているとき**こそ、これから通信が切れる可能性が高い
 * （§11 リスク 4）。位置情報を許可していない人は何も落とせないままなので、警戒中も落とす。
 *
 * ただし**同じ量は落とさない**。実測（2026-08-28）で 3×3 は **0.57〜1.49MB** ある。
 * 発災時の混んだ回線で、頼まれてもいないのに 1.5MB 引くのは乱暴である。
 *
 * | 合図 | 落とす範囲 | 実測 |
 * |---|---|---|
 * | **警戒中の地図の中心** | **その 1 枚だけ** | 中央値 25KB・最大 261KB |
 * | 現在地を使い始めた | 3×3 の 9 枚（移動する前提） | 0.57〜1.49MB |
 *
 * 1 枚あれば、地点の判定も脱出方向も**たいてい足りる**（区域は 80km も続かない）。
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

/** 落とす範囲。`home`＝その 1 枚だけ／`around`＝周囲 9 枚。 */
export type WarmScope = 'home' | 'around'

function primariesFor(lon: number, lat: number, scope: WarmScope): readonly string[] {
  return scope === 'home'
    ? [primaryMeshOf(meshCodeFromLonLat(lon, lat))]
    : surroundingPrimaries(lon, lat)
}

/** 配布ファイルの URL（索引に載っているものだけ）。 */
async function tileUrls(
  lon: number,
  lat: number,
  scope: WarmScope,
): Promise<readonly string[]> {
  const index = await hazardMeshIndex()
  return primariesFor(lon, lat, scope).flatMap((primary) => {
    const layers = Object.keys(index.layers).flatMap((key) => {
      const path = tilePath(index, key, primary)
      return path === null ? [] : [path]
    })
    const elevation = elevationTilePath(index, primary)
    return [...layers, ...(elevation === null ? [] : [elevation])].map((path) => `/hazard/${path}`)
  })
}

/** 取りに行く（失敗しても黙って諦める＝オンラインの体験を損なわない）。 */
async function warmCache(lon: number, lat: number, scope: WarmScope): Promise<void> {
  try {
    const urls = await tileUrls(lon, lat, scope)
    await Promise.allSettled(urls.map((url) => fetch(url)))
  } catch (error) {
    console.error('オフライン用のメッシュを先読みできませんでした', error)
  }
}

/** 先読みの対象（現在地、または警戒中に見ている場所）。 */
export type OfflineCacheTarget = {
  readonly lon: number
  readonly lat: number
}

/**
 * 現在地が最初に取れたとき（と 1 次メッシュをまたいだとき）に先読みする。
 * `alsoWarn` を渡すと、そこも同じ規則で先読みする（警戒中の地図の中心）。
 * **同じ 1 次メッシュでは 1 回しか走らない。**
 */
export function useOfflineHazardCache(
  position: CurrentPosition | null,
  alsoWarm: OfflineCacheTarget | null = null,
): void {
  // `範囲:1次メッシュ` で覚える。同じ枠を 2 度取りに行かないが、
  // `home` だけ済んだ枠に現在地が来たら `around` は改めて落とす。
  const warmed = useRef<Set<string>>(new Set())

  useEffect(() => {
    void registerServiceWorker()
  }, [])

  useEffect(() => {
    const jobs: readonly { target: OfflineCacheTarget; scope: WarmScope }[] = [
      ...(position === null ? [] : [{ target: position, scope: 'around' as const }]),
      ...(alsoWarm === null ? [] : [{ target: alsoWarm, scope: 'home' as const }]),
    ]
    for (const job of jobs) {
      const key = `${job.scope}:${primaryMeshOf(meshCodeFromLonLat(job.target.lon, job.target.lat))}`
      if (warmed.current.has(key)) continue
      warmed.current.add(key)
      void warmCache(job.target.lon, job.target.lat, job.scope)
    }
  }, [position, alsoWarm])
}
