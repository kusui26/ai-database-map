/**
 * 配布メッシュ（`/hazard/**`）とハザード・カタログをオフラインでも使えるようにする。
 * `docs/260824_flood.md` §8.3（Phase 2）。
 *
 * **この Service Worker は `/hazard/**` と `/api/hazard/catalog` しか横取りしない。**
 * アプリ全体をオフライン化すると、古い JS を配って静かに壊れる事故が起きやすい。
 * ここで欲しいのは 1 つだけ——**通信が切れても、現在地が危ないかを答えられること**。
 *
 * 中身は年 1 回しか変わらない静的な成果物なので、**キャッシュ優先**にする。
 * 版が上がったら `index.json` の `version` と一緒に `CACHE_NAME` を上げて捨てる。
 */

const CACHE_NAME = 'hazard-mesh-v2'
const CACHEABLE_PREFIXES = ['/hazard/', '/api/hazard/catalog']

self.addEventListener('install', (event) => {
  // 新しい版をすぐ使う（古いタイルを配り続けない）。
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/** キャッシュ優先。無ければ取りに行き、成功したものだけ保存する。 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const hit = await cache.match(request)
  if (hit !== undefined) return hit
  const response = await fetch(request)
  // 404（配布していない区画）は正常な答えなので保存してよい。エラーは保存しない。
  if (response.ok || response.status === 404) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (!CACHEABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return
  event.respondWith(cacheFirst(request))
})
