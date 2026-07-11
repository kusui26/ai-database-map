/**
 * P8a 受け入れ：/api/chat の 5 問 SSE 疎通（実 Gemini＋Supabase・オンデマンド）。
 *
 * 通常の `pnpm test` では **スキップ**（LLM/DB/課金に依存するため）。実行は：
 *   1) 別端末で dev サーバ起動：`pnpm dev`（.env に GEMINI_API_KEY・SUPABASE_* が必要）
 *   2) `CHAT_SMOKE=1 pnpm exec vitest run tests/chat-smoke.test.ts`
 *      （ポート変更時は `CHAT_BASE_URL=http://localhost:PORT` を付す）
 *
 * 検証：正しいツール列が呼ばれ、SSE の data-map が **mapResponseSchema を 100% 通る** こと。
 * （サーバは送信前に parse 済みだが、クライアント側でも再検証して二重に担保する。）
 */

import { describe, expect, it } from 'vitest'
import { mapResponseSchema, type MapResponse } from '@/shared/protocol'

const ENABLED = process.env.CHAT_SMOKE === '1'
const BASE_URL = process.env.CHAT_BASE_URL ?? 'http://localhost:3000'
const REQUEST_TIMEOUT_MS = 60_000
/**
 * クエリ間スロットル。Gemini 無料枠は 5 リクエスト/分（モデル）で、1 クエリが多段ツールで
 * 3〜5 回モデルを呼ぶため、連投すると 429 になる。各クエリを新しい分窓に落とすため間隔を空ける。
 * `CHAT_THROTTLE_MS=0` で無効化（有料枠・高 RPM の場合）。
 */
const THROTTLE_MS = Number(process.env.CHAT_THROTTLE_MS ?? '63000')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
let firstAsk = true

type ChatResult = {
  toolNames: string[]
  panelTypes: string[]
  actionTypes: string[]
  text: string
  mapResponse: MapResponse | null
  errorText: string | null
}

/** SSE（UI message stream）を読み、ツール列・data-map・本文を収集する。 */
async function ask(text: string): Promise<ChatResult> {
  if (!firstAsk && THROTTLE_MS > 0) await sleep(THROTTLE_MS) // 無料枠 RPM 回避（分窓を分ける）
  firstAsk = false
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text }] }] }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.body === null) throw new Error(`no response body (status ${response.status})`)

  const result: ChatResult = {
    toolNames: [],
    panelTypes: [],
    actionTypes: [],
    text: '',
    mapResponse: null,
    errorText: null,
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload.length === 0 || payload === '[DONE]') continue
        handleChunk(JSON.parse(payload), result)
      }
    }
  }
  return result
}

/** 1 チャンク（UIMessageChunk）を種別ごとに集約。 */
function handleChunk(chunk: unknown, result: ChatResult): void {
  if (typeof chunk !== 'object' || chunk === null || !('type' in chunk)) return
  const record: Record<string, unknown> = { ...chunk }
  const type = record.type
  if (typeof type !== 'string') return

  if (type === 'data-map') {
    const parsed = mapResponseSchema.parse(record.data)
    result.mapResponse = parsed
    result.panelTypes = parsed.panels.map((panel) => panel.type)
    result.actionTypes = parsed.mapActions.map((action) => action.type)
    return
  }
  if (type.startsWith('tool-') && typeof record.toolName === 'string') {
    if (!result.toolNames.includes(record.toolName)) result.toolNames.push(record.toolName)
    return
  }
  if (type === 'text-delta' && typeof record.delta === 'string') {
    result.text += record.delta
    return
  }
  if (type === 'error' && typeof record.errorText === 'string') {
    result.errorText = record.errorText
  }
}

describe.skipIf(!ENABLED)('POST /api/chat — 5 問 SSE 疎通（実サーバ）', () => {
  it('① 東京駅の人口推移：searchStations→getStationDetail、人口チャートが出る', async () => {
    const r = await ask('東京駅の人口推移を見せて')
    expect(r.errorText).toBeNull()
    expect(r.mapResponse).not.toBeNull()
    expect(mapResponseSchema.safeParse(r.mapResponse).success).toBe(true)
    expect(r.toolNames).toContain('getStationDetail')
    expect(r.panelTypes).toContain('trendChart')
    expect(r.actionTypes).toContain('selectStation')
    console.log('① tools=', r.toolNames, 'panels=', r.panelTypes, 'text=', r.text.slice(0, 80))
  }, 150_000)

  it('② 神奈川県で乗降客の回復が大きい駅 Top5：rankStations、ランキング表が出る', async () => {
    const r = await ask('神奈川県で乗降客の回復が大きい駅トップ5を教えて')
    expect(r.errorText).toBeNull()
    expect(mapResponseSchema.safeParse(r.mapResponse).success).toBe(true)
    expect(r.toolNames).toContain('rankStations')
    expect(r.panelTypes).toContain('rankingTable')
    console.log('② tools=', r.toolNames, 'panels=', r.panelTypes, 'text=', r.text.slice(0, 80))
  }, 150_000)

  it('③ 曖昧駅名（尼崎）：searchStations で候補提示、data-map は妥当', async () => {
    const r = await ask('尼崎駅について教えて')
    expect(r.errorText).toBeNull()
    expect(mapResponseSchema.safeParse(r.mapResponse).success).toBe(true)
    expect(r.toolNames).toContain('searchStations')
    console.log('③ tools=', r.toolNames, 'panels=', r.panelTypes, 'text=', r.text.slice(0, 120))
  }, 150_000)

  it('④ 2 駅比較（東京・新宿）：getStationDetail を複数回、data-map は妥当', async () => {
    const r = await ask('東京駅と新宿駅の人口を比べて')
    expect(r.errorText).toBeNull()
    expect(mapResponseSchema.safeParse(r.mapResponse).success).toBe(true)
    expect(r.toolNames).toContain('getStationDetail')
    console.log('④ tools=', r.toolNames, 'panels=', r.panelTypes, 'text=', r.text.slice(0, 120))
  }, 150_000)

  it('⑤ データ外質問（天気）：丁寧に拒否し、データパネルは出さない', async () => {
    const r = await ask('明日の東京の天気を教えて')
    expect(r.errorText).toBeNull()
    expect(mapResponseSchema.safeParse(r.mapResponse).success).toBe(true)
    expect(r.text.length).toBeGreaterThan(0)
    // 収録データ外なので、ランキング/散布などのデータパネルは出ないはず
    expect(r.panelTypes).not.toContain('rankingTable')
    expect(r.panelTypes).not.toContain('scatter')
    console.log('⑤ tools=', r.toolNames, 'panels=', r.panelTypes, 'text=', r.text.slice(0, 120))
  }, 150_000)
})
