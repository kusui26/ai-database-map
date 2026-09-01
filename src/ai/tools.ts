/**
 * AI ツール表面（Step2・サーバ専用）＝ 共通API（domain）の薄いアダプタ。
 *
 * 定義の本体（名前・説明・スキーマ・実行）は `tool-specs.ts` の **ToolSpec** にある
 * （`docs/260828_research_claude_auth.md` §4.2 PR-1・MCP と共有する単一の真実）。
 * ここは Spec を AI SDK の `tool()` に包むだけ：`run` が返した副産物（Effect）を
 * EffectCollector へ記録し、LLM へは要約（`forLlm`）だけを返す（幻覚を防ぐ）。
 * assemble.ts が Effect を決定的にパネル/地図操作へ変換するのは従来どおり。
 *
 * `tool()` はツールごとに**具象スキーマのまま**呼ぶ（9 個の列挙）。ジェネリック越しに
 * 渡すと zod スキーマの入力型推論が壊れる（`InferUITools` がツール名ごとの型を失う）。
 */

import { tool, type InferUITools, type UIMessage } from 'ai'
import { type MapResponse } from '@/shared/protocol'
import { type EffectCollector } from './types'
import { TOOL_SPECS, type ToolRunContext, type ToolRunResult } from './tool-specs'

/** `executeFromSpec` が要る最小の形（スキーマには触れない＝推論を壊さない）。 */
type RunnableSpec<In, Out> = {
  readonly errorFallbackJa: string | null
  readonly run: (input: In, ctx: ToolRunContext) => Promise<ToolRunResult<Out>>
}

/**
 * Spec の実行部 → AI SDK の execute。
 *
 * - 成功：副産物を**順序どおり**収集器へ押し込み、`forLlm` を返す
 * - 例外：`errorFallbackJa` を言い訳に `{ error }` を返す（LLM が謝って言い直せる形）。
 *   `null` の Spec（純粋な照会）は捕捉しない——分離前の挙動をそのまま保つ
 */
export function executeFromSpec<In, Out>(
  spec: RunnableSpec<In, Out>,
  collector: EffectCollector,
  origin: string,
): (input: In) => Promise<Out | { error: string }> {
  return async (input) => {
    const runOnce = async (): Promise<Out> => {
      const { effects, forLlm } = await spec.run(input, { origin })
      for (const effect of effects) collector.push(effect)
      return forLlm
    }
    if (spec.errorFallbackJa === null) return runOnce()
    try {
      return await runOnce()
    } catch (error) {
      return { error: error instanceof Error ? error.message : spec.errorFallbackJa }
    }
  }
}

/**
 * リクエストごとにツール群を生成する（collector をクロージャで束ねる）。
 * ツール記述はカタログ由来のダイジェスト（system-prompt.ts）と合わせて LLM を誘導する。
 */
export function createTools(collector: EffectCollector, origin: string) {
  const s = TOOL_SPECS
  return {
    searchStations: tool({
      description: s.searchStations.description,
      inputSchema: s.searchStations.inputSchema,
      execute: executeFromSpec(s.searchStations, collector, origin),
    }),
    getStationDetail: tool({
      description: s.getStationDetail.description,
      inputSchema: s.getStationDetail.inputSchema,
      execute: executeFromSpec(s.getStationDetail, collector, origin),
    }),
    rankStations: tool({
      description: s.rankStations.description,
      inputSchema: s.rankStations.inputSchema,
      execute: executeFromSpec(s.rankStations, collector, origin),
    }),
    compareGrowth: tool({
      description: s.compareGrowth.description,
      inputSchema: s.compareGrowth.inputSchema,
      execute: executeFromSpec(s.compareGrowth, collector, origin),
    }),
    getHazardAtPoint: tool({
      description: s.getHazardAtPoint.description,
      inputSchema: s.getHazardAtPoint.inputSchema,
      execute: executeFromSpec(s.getHazardAtPoint, collector, origin),
    }),
    getHazardAlerts: tool({
      description: s.getHazardAlerts.description,
      inputSchema: s.getHazardAlerts.inputSchema,
      execute: executeFromSpec(s.getHazardAlerts, collector, origin),
    }),
    findEvacuationSites: tool({
      description: s.findEvacuationSites.description,
      inputSchema: s.findEvacuationSites.inputSchema,
      execute: executeFromSpec(s.findEvacuationSites, collector, origin),
    }),
    findEscapeDirection: tool({
      description: s.findEscapeDirection.description,
      inputSchema: s.findEscapeDirection.inputSchema,
      execute: executeFromSpec(s.findEscapeDirection, collector, origin),
    }),
    getMetricsCatalog: tool({
      description: s.getMetricsCatalog.description,
      inputSchema: s.getMetricsCatalog.inputSchema,
      execute: executeFromSpec(s.getMetricsCatalog, collector, origin),
    }),
  }
}

/** チャットのカスタムデータパート（最終 MapResponse を data-map で送出）。 */
export type ChatDataParts = { map: MapResponse }

/** ツール群の型（UI メッセージのツールパート推論に使う）。 */
export type ChatTools = ReturnType<typeof createTools>

/** チャットの UI メッセージ型（P8b の useChat と共有）。 */
export type ChatUIMessage = UIMessage<unknown, ChatDataParts, InferUITools<ChatTools>>
