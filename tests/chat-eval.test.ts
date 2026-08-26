/**
 * 評価 runner：ゴールデン 30 問を実 /api/chat（SSE）に投げ、score.ts で採点する。
 *
 * 通常の `pnpm test` では **スキップ**（LLM/DB/課金に依存）。実行は：
 *   1) 別端末で dev サーバ起動：`pnpm dev`（.env に GEMINI_API_KEY・SUPABASE_* が必要）
 *   2) `EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts`
 *      （ポート変更時は `CHAT_BASE_URL=http://localhost:PORT`／閾値は `EVAL_PASS`／間隔は `EVAL_THROTTLE_MS`）
 *      失敗問だけの再実行は `EVAL_ONLY=id1,id2`（モデル側の遅延で落ちた問を全 30 問流さず確認する）
 *      災害の 6 問だけなら `EVAL_ONLY=hazard-station-risk,hazard-is-safe,hazard-depth,hazard-arrive-time,hazard-evacuate-where,hazard-shows-layer`
 *
 * Gemini 無料枠は 5 req/分・1 問が多段ツールで数回モデルを呼ぶため、問間にスロットルを入れ、
 * quota で失敗した問は 1 度だけクールダウン再試行する。合格率と各問の内訳を出力する。
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapResponseSchema } from '@/shared/protocol'
import { EVAL_CASES } from '@/ai/eval/cases'
import { scoreCase, type EvalObserved } from '@/ai/eval/score'

const ENABLED = process.env.EVAL === '1'
const BASE_URL = process.env.CHAT_BASE_URL ?? 'http://localhost:3000'
const PASS_THRESHOLD = Number(process.env.EVAL_PASS ?? '20')
const THROTTLE_MS = Number(process.env.EVAL_THROTTLE_MS ?? '45000')
const REQUEST_TIMEOUT_MS = 75_000
const REPORT_PATH = process.env.EVAL_REPORT ?? ''
/** 実行する問を id で絞る（空＝全問）。落ちた問だけを流し直すため。 */
const ONLY = (process.env.EVAL_ONLY ?? '').split(',').filter((id) => id.length > 0)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type AskResult = EvalObserved & { errored: boolean }

/** 1 クエリを /api/chat に投げ、ツール列・パネル・本文を SSE から収集する（P8e: 選択駅も同送）。 */
async function ask(query: string, selectedGrp?: string, radiusM?: number): Promise<AskResult> {
  const toolCalls: { name: string; input: Record<string, unknown> }[] = []
  let panelTypes: string[] = []
  let actionTypes: string[] = []
  let text = ''
  let mapResponse: unknown = null
  let mapResponseValid = false
  let errored = false

  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: query }] }],
      ...(selectedGrp !== undefined ? { selectedGrp, radiusM } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.body === null)
    return {
      toolCalls,
      panelTypes,
      actionTypes,
      text,
      haystack: '',
      mapResponseValid,
      errored: true,
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
        const chunk: Record<string, unknown> = { ...JSON.parse(payload) }
        const type = chunk.type
        if (type === 'data-map') {
          mapResponse = chunk.data
          const parsed = mapResponseSchema.safeParse(chunk.data)
          mapResponseValid = parsed.success
          if (parsed.success) {
            panelTypes = parsed.data.panels.map((panel) => panel.type)
            actionTypes = parsed.data.mapActions.map((action) => action.type)
          }
        } else if (typeof type === 'string' && type === 'tool-input-available') {
          const name = chunk.toolName
          if (typeof name === 'string') {
            const input = chunk.input
            toolCalls.push({
              name,
              input: typeof input === 'object' && input !== null ? { ...input } : {},
            })
          }
        } else if (type === 'text-delta' && typeof chunk.delta === 'string') {
          text += chunk.delta
        } else if (type === 'error') {
          errored = true
        }
      }
    }
  }
  const haystack = `${text} ${JSON.stringify(mapResponse)}`
  return { toolCalls, panelTypes, actionTypes, text, haystack, mapResponseValid, errored }
}

describe.skipIf(!ENABLED)('eval — ゴールデン 30 問', () => {
  it(
    '合格率を計測する',
    async () => {
      const cases = ONLY.length > 0 ? EVAL_CASES.filter((c) => ONLY.includes(c.id)) : EVAL_CASES
      const lines: string[] = ['# eval レポート', '', `対象: ${BASE_URL}`, '']
      const rows: string[] = ['| # | id | 分野 | 合否 | 失敗チェック |', '|---|---|---|---|---|']
      let passed = 0
      let firstAsk = true

      for (let index = 0; index < cases.length; index += 1) {
        const testCase = cases[index]
        if (testCase === undefined) continue
        if (!firstAsk) await sleep(THROTTLE_MS)
        firstAsk = false

        let observed = await ask(testCase.query, testCase.selectedGrp, testCase.radiusM)
        // quota/一時エラーで data-map が来なければ 1 度だけ長めに待って再試行
        if (!observed.mapResponseValid || observed.errored) {
          await sleep(65_000)
          observed = await ask(testCase.query, testCase.selectedGrp, testCase.radiusM)
        }

        const result = scoreCase(testCase.expect, observed)
        if (result.pass) passed += 1
        const failed = result.checks.filter((check) => !check.ok).map((check) => check.name)
        rows.push(
          `| ${index + 1} | ${testCase.id} | ${testCase.category} | ${result.pass ? '✅' : '❌'} | ${failed.join('；') || '—'} |`,
        )
        // 進捗ログ
        console.log(
          `[${index + 1}/${cases.length}] ${result.pass ? 'PASS' : 'FAIL'} ${testCase.id}` +
            `  tools=${observed.toolCalls.map((call) => call.name).join(',')}` +
            `  panels=${observed.panelTypes.join(',')}` +
            (failed.length > 0 ? `  ✗ ${failed.join('；')}` : ''),
        )
      }

      const rate = `${passed}/${cases.length}`
      lines.push(`**合格率: ${rate}（閾値 ${PASS_THRESHOLD}）**`, '', ...rows, '')
      const report = lines.join('\n')
      console.log('\n' + report)
      if (REPORT_PATH.length > 0) writeFileSync(REPORT_PATH, report)

      expect(passed).toBeGreaterThanOrEqual(ONLY.length > 0 ? 0 : PASS_THRESHOLD)
    },
    45 * 60 * 1000,
  )
})
