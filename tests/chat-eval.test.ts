/**
 * 評価 runner：ゴールデン 62 問を実 /api/chat（SSE）に投げ、score.ts で採点する。
 *
 * 通常の `pnpm test` では **スキップ**（LLM/DB/課金に依存）。実行は：
 *   1) 別端末で dev サーバ起動：`pnpm dev`（.env に GEMINI_API_KEY・SUPABASE_* が必要）
 *   2) `EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts`
 *      （ポート変更時は `CHAT_BASE_URL=http://localhost:PORT`／閾値は `EVAL_PASS`／間隔は `EVAL_THROTTLE_MS`）
 *      失敗問だけの再実行は `EVAL_ONLY=id1,id2`（モデル側の遅延で落ちた問を全問流さず確認する）
 *      災害だけなら `EVAL_ONLY=$(node -e "…")` ——**id を手で並べない**（増えるたびに古くなる）。
 *      分野で絞りたいときは `EVAL_CATEGORY=災害`（`cases.ts` の `category` と一致するもの）。
 *      レポートを残すなら `EVAL_REPORT=path.md`、モデルを比べるなら `EVAL_LABEL=…`（名札）も付ける
 *      （手順は `docs/260926_chat_model_eval.md` §3）。
 *
 * Gemini 無料枠は 1 分あたりの回数に上限があり（Flash-Lite は 15 回）、1 問が多段ツールで数回
 * モデルを呼ぶため、問間にスロットルを入れ、quota で失敗した問は 1 度だけクールダウン再試行する。
 * 合格率・各問の内訳・所要時間・再試行に頼った問を出力する（集計は `src/ai/eval/report.ts`）。
 *
 * **1 問の失敗で評価全体を止めない**（2026-10-14）：打ち切り・サーバに届かない・ストリームが途中で切れる・
 * サーバがエラーの状態で返す、を「応答が得られない（理由）」として記録し、再試行のあと次の問へ進む。
 * レポートは 1 問ごとに書き直すので、終わる前に止まってもそこまでが残る（見出しに「途中で止まった」）。
 * 長い評価は `caffeinate -i` で流す（PC がスリープすると応答が止まる）。打ち切りと再試行の待ちは
 * `EVAL_REQUEST_TIMEOUT_MS`・`EVAL_RETRY_COOLDOWN_MS` で変えられる（壊れ方を再現して確かめるため・既定は 75 秒と 65 秒）。
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapResponseSchema } from '@/shared/protocol'
import { EVAL_CASES, type EvalCase } from '@/ai/eval/cases'
import { emptyFigureCount, scoreCase, type EvalObserved } from '@/ai/eval/score'
import { type EvalRun, renderReport, summarizeRuns } from '@/ai/eval/report'
import { httpErrorJa, requestErrorJa } from '@/ai/eval/request-error'

const ENABLED = process.env.EVAL === '1'
const BASE_URL = process.env.CHAT_BASE_URL ?? 'http://localhost:3000'
/**
 * 全体の合格数の下限。
 *
 * 実測（2026-08-28）で **37/37**。以前も 20/20（閾値 16）だったが、問が増えるたびに
 * 閾値を据え置いたので **67% まで緩んでいた**——12 問壊れても通る状態だった。
 * **数問の揺らぎ（無料枠の quota・多段ツールの遅延）だけを許す**線に引き直す。
 *
 * 2026-09-16：おすすめの引き渡しを 1 問足して 38 問。**許す揺らぎを 2 問のまま**にするため
 * 36 へ上げる（問を足して閾値を据え置くと、上と同じ緩み方をする）。
 *
 * 2026-10-07：会社・路線の名前を 3 問足して 41 問（B1）。同じ理由で 39 へ上げる。
 *
 * 2026-10-08：路線（運行系統）と地図の表示範囲の 4 問を足して 45 問（L3）。同じ理由で 43 へ上げる。
 *
 * 2026-10-08：市区町村・起点から N km の 3 問を足して 48 問（B2）。同じ理由で 46 へ上げる。
 *
 * 2026-10-09：地図の「このあたり」の 5 問を足して 53 問（B3）。同じ理由で 51 へ上げる。
 *
 * 2026-10-09：駅周辺のプロフィールの 3 問を足して 56 問（B4）。同じ理由で 54 へ上げる。
 *
 * 2026-10-11：エリアの全体（区域の値・比較・地図の色分け）の 6 問を足して 62 問（B5d）。同じ理由で 60 へ上げる。
 */
const PASS_THRESHOLD = Number(process.env.EVAL_PASS ?? '60')

/**
 * **1 問でも落としてはいけない分野。**
 *
 * 合格数の下限だけだと、**災害の禁止応答（「安全です」と言わない等）が壊れても
 * 全体では通ってしまう**。ここは人命に関わる不変条件（§6.5・§7.5）なので、別に見る。
 */
const CRITICAL_CATEGORIES: readonly string[] = ['災害', '拒否']
const THROTTLE_MS = Number(process.env.EVAL_THROTTLE_MS ?? '45000')
const REQUEST_TIMEOUT_MS = Number(process.env.EVAL_REQUEST_TIMEOUT_MS ?? '75000')
const REPORT_PATH = process.env.EVAL_REPORT ?? ''
/**
 * 何を測ったか（例「gemini-3.5-flash-lite / temperature 既定」）。**モデルは runner からは見えない**
 * （サーバの `GEMINI_MODEL` とコードの既定で決まる）ので、比べるときは流す側が名札を付ける。
 */
const LABEL = process.env.EVAL_LABEL ?? '（名札なし）'
/** 実行する問を id で絞る（空＝全問）。落ちた問だけを流し直すため。 */
const ONLY = (process.env.EVAL_ONLY ?? '').split(',').filter((id) => id.length > 0)
/** 分野で絞る（`災害` など）。**id を手で並べない**——問が増えるたびに古くなるため。 */
const CATEGORY = process.env.EVAL_CATEGORY ?? ''

/** 失敗した問を流し直す前の待ち（無料枠の 1 分窓をまたぐ）。 */
const RETRY_COOLDOWN_MS = Number(process.env.EVAL_RETRY_COOLDOWN_MS ?? '65000')

/** 流す問（id・分野で絞る）。打ち切りの長さを決めるので、テストの外で決める。 */
const SELECTED_CASES = EVAL_CASES.filter(
  (each) =>
    (ONLY.length === 0 || ONLY.includes(each.id)) &&
    (CATEGORY.length === 0 || each.category === CATEGORY),
)

/** 1 問の最悪の所要（間隔＋1 回目の打ち切り＋流し直しの待ち＋2 回目の打ち切り）。 */
const WORST_PER_CASE_MS = THROTTLE_MS + REQUEST_TIMEOUT_MS + RETRY_COOLDOWN_MS + REQUEST_TIMEOUT_MS

/**
 * テスト全体の打ち切り。**流す問の数から決める**——以前は 45 分の固定で、53 問（2026-10-09 B3）は 1 問 50 秒ほどの
 * ペースで 50 問目のところで打ち切られた。各リクエストには打ち切りがあるのでループは止まらずに進む。ここは
 * 「最悪でもこれまでに終わる」上限で、ふつうに進んでいる評価を途中で止めない。
 */
const RUN_TIMEOUT_MS = Math.max(SELECTED_CASES.length, 1) * WORST_PER_CASE_MS

/** 落ちた問のツールの入力（揺れか退行かを見分ける手がかり・1 行に収める）。 */
const FAILED_INPUT_MAX_CHARS = 600

function failedInputs(observed: AskResult): string {
  const calls = observed.toolCalls.map((call) => `${call.name}${JSON.stringify(call.input)}`)
  return calls.join(' ').slice(0, FAILED_INPUT_MAX_CHARS)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 1 問の観測。`errorJa` は応答が得られなかった理由（得られたなら null）。 */
type AskResult = EvalObserved & { errored: boolean; errorJa: string | null }

/** 応答が得られなかった問の観測（何も観測していない）。 */
function failedAsk(errorJa: string): AskResult {
  return {
    toolCalls: [],
    panelTypes: [],
    actionTypes: [],
    text: '',
    haystack: '',
    mapResponseValid: false,
    emptyFigureCount: 0,
    errored: true,
    errorJa,
  }
}

/**
 * 1 問を投げる。**例外は記録して返す**——打ち切り・サーバに届かない・ストリームが途中で切れる、で評価全体を
 * 止めない（2026-10-13 はスリープ中に止まった応答の打ち切りで、62 問の評価が 5 問目で止まり、レポートも残らなかった）。
 */
async function ask(testCase: EvalCase): Promise<AskResult> {
  try {
    return await askOnce(testCase)
  } catch (error) {
    return failedAsk(requestErrorJa(error, REQUEST_TIMEOUT_MS))
  }
}

/** エラーの本文（JSON として読めなければ null・理由に添えるだけなので、読めなくても止めない）。 */
async function errorBodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * 1 クエリを /api/chat に投げ、ツール列・パネル・本文を SSE から収集する。地図の文脈（選択駅・P8e と
 * 表示範囲・L3）は、問が持つときだけ同送する（画面の送信と同じ形・`components/chat/sendContext.ts`）。
 */
async function askOnce(testCase: EvalCase): Promise<AskResult> {
  const { query, selectedGrp, radiusM, bbox } = testCase
  const toolCalls: { name: string; input: Record<string, unknown> }[] = []
  let panelTypes: string[] = []
  let actionTypes: string[] = []
  let text = ''
  let mapResponse: unknown = null
  let mapResponseValid = false
  let emptyFigures = 0
  let errored = false
  let errorJa: string | null = null

  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: query }] }],
      ...(selectedGrp !== undefined ? { selectedGrp, radiusM } : {}),
      ...(bbox !== undefined ? { bbox } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) return failedAsk(httpErrorJa(response.status, await errorBodyOf(response)))
  if (response.body === null) return failedAsk(`応答に本文が無い（HTTP ${response.status}）`)

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
            emptyFigures = emptyFigureCount(parsed.data.panels)
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
          // サーバが画面に出す文（「AI（Gemini）が一時的に応答できない状態です」など）を、そのまま理由に残す
          errorJa =
            typeof chunk.errorText === 'string' ? `サーバの応答がエラー：${chunk.errorText}` : null
        }
      }
    }
  }
  const haystack = `${text} ${JSON.stringify(mapResponse)}`
  return {
    toolCalls,
    panelTypes,
    actionTypes,
    text,
    haystack,
    mapResponseValid,
    emptyFigureCount: emptyFigures,
    errored,
    errorJa,
  }
}

/** レポートを組み、`EVAL_REPORT` があればファイルに書く（予定より少なければ「途中で止まった」と書く）。 */
function writeReport(runs: readonly EvalRun[], planned: number): string {
  const report = renderReport(runs, summarizeRuns(runs, CRITICAL_CATEGORIES), {
    label: LABEL,
    baseUrl: BASE_URL,
    threshold: PASS_THRESHOLD,
    criticalCategories: CRITICAL_CATEGORIES,
    planned,
  })
  if (REPORT_PATH.length > 0) writeFileSync(REPORT_PATH, report)
  return report
}

/** 1 問を投げ、所要時間も測る（採点するのは、この 1 回の結果）。 */
async function timedAsk(
  testCase: EvalCase,
): Promise<{ readonly observed: AskResult; readonly elapsedMs: number }> {
  const startedAt = Date.now()
  const observed = await ask(testCase)
  return { observed, elapsedMs: Date.now() - startedAt }
}

describe.skipIf(!ENABLED)(`eval — ゴールデン ${EVAL_CASES.length} 問`, () => {
  it(
    '合格率を計測する',
    async () => {
      const cases = SELECTED_CASES
      const runs: EvalRun[] = []
      let firstAsk = true

      for (let index = 0; index < cases.length; index += 1) {
        const testCase = cases[index]
        if (testCase === undefined) continue
        if (!firstAsk) await sleep(THROTTLE_MS)
        firstAsk = false

        const first = await timedAsk(testCase)
        // quota/一時エラーで data-map が来なければ 1 度だけ長めに待って再試行。
        // **合格数はこれで隠れる**ので、再試行したことは記録に残す（そのモデルの安定性）。
        const retried = !first.observed.mapResponseValid || first.observed.errored
        if (retried) await sleep(RETRY_COOLDOWN_MS)
        const { observed, elapsedMs } = retried ? await timedAsk(testCase) : first

        const result = scoreCase(testCase.expect, observed)
        const failed = [
          ...(observed.errorJa === null ? [] : [`応答が得られない：${observed.errorJa}`]),
          ...result.checks.filter((check) => !check.ok).map((check) => check.name),
        ]
        runs.push({
          id: testCase.id,
          category: testCase.category,
          pass: result.pass,
          failedChecks: failed,
          elapsedMs,
          retried,
          toolCallCount: observed.toolCalls.length,
        })
        // 進捗ログ
        console.log(
          `[${index + 1}/${cases.length}] ${result.pass ? 'PASS' : 'FAIL'} ${testCase.id}` +
            `  ${(elapsedMs / 1000).toFixed(1)}s${retried ? ' ↻' : ''}` +
            `  tools=${observed.toolCalls.map((call) => call.name).join(',')}` +
            `  panels=${observed.panelTypes.join(',')}` +
            (failed.length > 0 ? `  ✗ ${failed.join('；')}  inputs=${failedInputs(observed)}` : ''),
        )
        // 1 問ごとに書き直す（終わる前に止まっても、そこまでのレポートが残る）
        writeReport(runs, cases.length)
      }

      const summary = summarizeRuns(runs, CRITICAL_CATEGORIES)
      console.log('\n' + writeReport(runs, cases.length))

      // **災害・拒否は 1 問も落とさない**（絞って流したときも当てる——ここが本題だから）。
      expect(summary.criticalFailures, '落としてはいけない分野で失敗した').toEqual([])
      // 一部だけ流したとき（id・分野で絞ったとき）は、全体の下限は当てない。
      const partial = ONLY.length > 0 || CATEGORY.length > 0
      expect(summary.passed).toBeGreaterThanOrEqual(partial ? 0 : PASS_THRESHOLD)
    },
    RUN_TIMEOUT_MS,
  )
})
