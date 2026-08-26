/**
 * Step2（AIネイティブ化）: ツール実行の「副産物」を集める型（純データ）。
 *
 * ツール（tools.ts）は domain の結果（StationDetail / RankingResponse / GrowthResponse）を
 * この Effect として収集し、assemble.ts が **既存の Panel ビルダで決定的に** GUI Chat Protocol へ
 * 変換する。LLM はパネルや数値を生成しない（＝幻覚しない）。数値・意味づけは domain が持つ。
 */

import { type Category, type RadiusM } from '@/shared/constants'
import {
  type GrowthResponse,
  type HazardPointResponse,
  type RankingResponse,
  type StationDetail,
} from '@/shared/api'

/** 駅詳細ツールの副産物（焦点カテゴリ・集約半径つき）。 */
export type StationDetailEffect = {
  readonly kind: 'stationDetail'
  readonly detail: StationDetail
  /** 焦点タブ（null＝乗降客の概要）。 */
  readonly category: Category | null
  readonly radiusM: RadiusM
}

/** ランキングツールの副産物。 */
export type RankingEffect = {
  readonly kind: 'ranking'
  readonly response: RankingResponse
}

/** 散布（増減率比較）ツールの副産物。 */
export type GrowthEffect = {
  readonly kind: 'growth'
  readonly response: GrowthResponse
}

/**
 * 地点ハザードツールの副産物（`docs/260824_flood.md` §6.5）。
 * **意味づけ（危険度・行動・文言）はすべて応答が持っている**ので、ここは運ぶだけ。
 */
export type HazardPointEffect = {
  readonly kind: 'hazardPoint'
  readonly point: HazardPointResponse
}

/** ツールが記録しうる副産物（assemble がパネル/地図操作に変換）。 */
export type ToolEffect = StationDetailEffect | RankingEffect | GrowthEffect | HazardPointEffect

/** ツール実行順に副産物を集める収集器（1 リクエストにつき 1 個・クロージャで共有）。 */
export type EffectCollector = {
  push(effect: ToolEffect): void
  /** 収集した副産物を取り出す（読み取り専用のスナップショット）。 */
  drain(): readonly ToolEffect[]
}

/**
 * 空の収集器を生成する。
 *
 * `onPush` を渡すと、ツールが成果を記録するたびに**その時点の全副産物**を通知する。
 * これにより、後段（LLM の本文生成）が中断・失敗しても、成功済みのツールぶんの
 * パネル/地図操作を先に届けられる（docs/260728_chat_scatter_plot_timeout_mitigation.md フェーズ1）。
 */
export function createCollector(
  onPush?: (effects: readonly ToolEffect[]) => void,
): EffectCollector {
  const effects: ToolEffect[] = []
  return {
    push: (effect) => {
      effects.push(effect)
      onPush?.([...effects])
    },
    drain: () => effects,
  }
}
