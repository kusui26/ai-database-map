/**
 * チャット応答の Panel[] を「効果グループ」に束ね、⤢ 昇格のパラメータを導出する（純関数）。
 *
 * assemble は効果（駅詳細／ランキング／散布）順にパネルを並べる：
 *   駅詳細 = stationCard ＋ 本文（trendChart/statTable/barChart）／ランキング = rankingTable ／散布 = scatter。
 * ここではその境界を復元し、各グループの昇格先（ドロワー/モーダル）に渡す実パラメータを、
 * **ツール呼び出しの入力**（metric・都道府県・x/y キー等）と内容照合して復元する（protocol は無改変）。
 * 照合に使うのは、パネルを生みうる呼び出しだけ（失敗したものは除く＝`toolCallsOf`）。
 */

import { type Panel } from '@/shared/protocol'
import { getEntry } from '@/shared/catalog'
import { CATEGORIES, type Category } from '@/shared/constants'
import { type Order } from '@/shared/api'
import { type Promotion } from '@/stores/chatStore'

/**
 * 1 メッセージ内のツール呼び出し（useChat の tool パートから抽出）。
 *
 * `output` も持つ理由：LLM は指標を**ファミリ名**で渡してよい仕様なので
 * （system-prompt「指標はファミリ名＋半径で指定してよい」）、`input.x` は
 * `pop_gr` のようにカタログキーでないことがある。ツールは解決後のキーを
 * `resolvedMetric` / `resolvedMetrics` として返すので、**出力を正**として照合する（260802）。
 */
export type ToolCall = {
  readonly name: string
  readonly input: Record<string, unknown>
  readonly output: Record<string, unknown>
}

/** 駅詳細昇格（ドロワーを grp＋焦点カテゴリで開く）。 */
export type DetailPromotion = {
  readonly kind: 'detail'
  readonly grp: string
  readonly category: Category | null
}

/** グループの昇格先（ドロワー or ランキング/散布モーダル）。 */
export type GroupPromotion = Promotion | DetailPromotion

export type PanelGroup = {
  readonly panels: readonly Panel[]
  readonly promotion: GroupPromotion | null
}

// --- 入力フィールドの安全な読み出し（any/as を使わない） ------------------
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}
function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
    : []
}
function readBool(value: unknown): boolean {
  return value === true
}
function readOrder(value: unknown): Order {
  return value === 'asc' ? 'asc' : 'desc'
}
function readCategory(value: unknown): Category | null {
  return CATEGORIES.find((category) => category === value) ?? null
}

/** 駅詳細グループの昇格（先頭 stationCard の grp＋getStationDetail 呼び出しの category）。 */
function detailPromotion(
  panels: readonly Panel[],
  toolCalls: readonly ToolCall[],
): DetailPromotion | null {
  const card = panels.find((panel) => panel.type === 'stationCard')
  if (card === undefined || card.type !== 'stationCard') return null
  const call = toolCalls.find(
    (candidate) =>
      candidate.name === 'getStationDetail' && readString(candidate.input.grp) === card.grp,
  )
  return { kind: 'detail', grp: card.grp, category: readCategory(call?.input.category) }
}

/** 出力にあれば出力を、無ければ入力を採る（出力は正規化済み＝都道府県名や会社名が整っている）。 */
function preferOutput(
  output: Record<string, unknown>,
  input: Record<string, unknown>,
  key: string,
): string[] {
  const fromOutput = readStringArray(output[key])
  return fromOutput.length > 0 ? fromOutput : readStringArray(input[key])
}

/** ランキング昇格（panel.metricKey と一致する rankStations 呼び出しの条件を復元）。 */
function rankingPromotion(panel: Panel, toolCalls: readonly ToolCall[]): Promotion | null {
  if (panel.type !== 'rankingTable') return null
  const call = toolCalls.find(
    (candidate) =>
      candidate.name === 'rankStations' &&
      // 解決後のキーで照合する（入力はファミリ名のことがある）。
      (readString(candidate.output.resolvedMetric) === panel.metricKey ||
        readString(candidate.input.metric) === panel.metricKey),
  )
  const input = call?.input ?? {}
  const output = call?.output ?? {}
  return {
    kind: 'ranking',
    metricKey: panel.metricKey,
    prefectures: preferOutput(output, input, 'prefectures'),
    operators: preferOutput(output, input, 'operators'),
    routes: preferOutput(output, input, 'routes'),
    // routeTypes の出力は表示名（「新幹線」）なので、コードを持つ入力だけを使う。
    routeTypes: readNumberArray(input.routeTypes),
    order: readOrder(output.order ?? input.order),
    excludeLowN: readBool(input.excludeLowN),
  }
}

/** compareGrowth 呼び出しから x/y のカタログキーを取り出す（解決後の出力を優先）。 */
function scatterKeys(call: ToolCall): { x: string | undefined; y: string | undefined } {
  const resolved = asRecord(call.output.resolvedMetrics)
  return {
    x: readString(resolved.x) ?? readString(call.input.x),
    y: readString(resolved.y) ?? readString(call.input.y),
  }
}

/** 散布昇格（panel の x/y ラベルと一致する compareGrowth 呼び出しから x/y キーを復元）。 */
function scatterPromotion(panel: Panel, toolCalls: readonly ToolCall[]): Promotion | null {
  if (panel.type !== 'scatter') return null
  const call = toolCalls.find((candidate) => {
    if (candidate.name !== 'compareGrowth') return false
    const { x, y } = scatterKeys(candidate)
    return (
      getEntry(x ?? '')?.labelJa === panel.xLabel && getEntry(y ?? '')?.labelJa === panel.yLabel
    )
  })
  if (call === undefined) return null // キー不明なら昇格しない
  const { x: xKey, y: yKey } = scatterKeys(call)
  if (xKey === undefined || yKey === undefined) return null
  return {
    kind: 'scatter',
    xKey,
    yKey,
    prefectures: preferOutput(call.output, call.input, 'prefectures'),
    operators: preferOutput(call.output, call.input, 'operators'),
    routes: preferOutput(call.output, call.input, 'routes'),
    // routeTypes の出力は表示名なので、コードを持つ入力だけを使う。
    routeTypes: readNumberArray(call.input.routeTypes),
    excludeLowN: readBool(call.input.excludeLowN),
  }
}

/** Panel[]（＋ツール呼び出し）を効果グループへ束ね、昇格パラメータを付す。 */
export function buildPanelGroups(
  panels: readonly Panel[],
  toolCalls: readonly ToolCall[],
): PanelGroup[] {
  const groups: PanelGroup[] = []
  let detail: Panel[] | null = null

  const flushDetail = (): void => {
    if (detail !== null && detail.length > 0) {
      groups.push({ panels: detail, promotion: detailPromotion(detail, toolCalls) })
    }
    detail = null
  }

  for (const panel of panels) {
    if (panel.type === 'stationCard') {
      flushDetail()
      detail = [panel]
    } else if (panel.type === 'rankingTable') {
      flushDetail()
      groups.push({ panels: [panel], promotion: rankingPromotion(panel, toolCalls) })
    } else if (panel.type === 'scatter') {
      flushDetail()
      groups.push({ panels: [panel], promotion: scatterPromotion(panel, toolCalls) })
    } else if (detail !== null) {
      detail.push(panel) // 直前の駅詳細グループの本文
    } else {
      groups.push({ panels: [panel], promotion: null }) // 単独（markdown 等）
    }
  }
  flushDetail()
  return groups
}

/** パネルを生まずに終わった呼び出しの状態（SDK が弾いた・実行が投げた／承認されなかった）。 */
const FAILED_STATES: ReadonlySet<string> = new Set(['output-error', 'output-denied'])

/**
 * パネルを生まなかった呼び出しか。どれも副産物（パネル）を生まないのに、照合に残すと、同じキーで
 * 後から成功した呼び出しより**先に**拾われ、⤢ もキャンバスも失敗した方の引数で開いてしまう。
 *
 * - 出力に `error`：ツールが失敗を結果として返した（`tool-specs.ts` の `{ error, hint }`）。
 *   **実際に起きるのはこれ**——例：存在しない都道府県名（「千葉市」）で失敗し、「千葉県」で呼び直して
 *   図が出ても、⤢ もキャンバスも「千葉市」で開いていた（状態は `output-available`、`input` もある）
 * - `output-error`：実行が投げた（`input` を持ったまま）。SDK が弾いた形の合わない引数もこの状態だが、
 *   そのとき引数は `rawInput` に入り `input` は空なので、照合には元から当たらない
 * - `output-denied`：承認されず、実行されなかった
 *
 * 「該当 0 件」は失敗ではない（空の図を生み、出力は `note` で伝える）ので除かない。
 */
function hasFailed(record: Record<string, unknown>): boolean {
  const state = readString(record.state)
  if (state !== undefined && FAILED_STATES.has(state)) return true
  return typeof asRecord(record.output).error === 'string'
}

/** ツールのパーツなら呼び出した名前（`tool-<name>` か `dynamic-tool` の toolName）。 */
function toolNameOf(type: string, record: Record<string, unknown>): string | undefined {
  if (type.startsWith('tool-')) return type.slice('tool-'.length)
  return type === 'dynamic-tool' ? readString(record.toolName) : undefined
}

/**
 * useChat のメッセージ parts から、**パネルを生みうる**ツール呼び出し（名前＋入力＋出力）を抽出する。
 * 失敗した呼び出しは除く（`hasFailed`）。実行中のものは残す——パネル（data-map）は出力より先に届くので、
 * その間の照合はこの呼び出しの入力に頼る。
 */
export function toolCallsOf(parts: readonly { type: string }[]): ToolCall[] {
  return parts.flatMap((part) => {
    const record = asRecord(part)
    const name = toolNameOf(part.type, record)
    if (name === undefined || hasFailed(record)) return []
    return [{ name, input: asRecord(record.input), output: asRecord(record.output) }]
  })
}
