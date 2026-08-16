/**
 * ツール副産物 → GUI Chat Protocol（MapResponse）への組立（Step2・純関数）。
 *
 * パネル・地図操作は **既存の domain Panel ビルダ**（P5/P6 とクリックUIで共用）で決定的に作る。
 * LLM はどのツールを呼ぶか／文章だけを担い、数値やパネルは生成しない（幻覚しない・Zod 100% 通過）。
 * → 「クリックでも会話でも、同じ場所に同じ物が出る」（.claude/CLAUDE.md §2・architecture.md §4）。
 */

import { type Category } from '@/shared/constants'
import { formatNumber, type MetricFormat } from '@/shared/format'
import { type MapAction, type MapResponse, type Panel } from '@/shared/protocol'
import {
  busPanels,
  employeePanels,
  establishmentPanels,
  incomePanels,
  landPricePanels,
  paxTrendPanel,
  populationPanels,
  salesPanels,
  stationCardPanel,
} from '@/domain/stations/panels'
import { rankingPanel } from '@/domain/ranking/panel'
import { scatterPanel } from '@/domain/growth/panel'
import {
  type GrowthEffect,
  type RankingEffect,
  type StationDetailEffect,
  type ToolEffect,
} from './types'

/** 地図ラベルが出るズーム（P4a と揃える）。 */
const DETAIL_ZOOM = 12

/** パネルにチャット内インライン表示のヒントを付す（⤢ で drawer/modal へ昇格・§2.4）。 */
function inline(panel: Panel): Panel {
  return { ...panel, placement: 'inline' }
}

/** 焦点カテゴリ → 本文パネル（駅カードを除く）。population_forecast は人口タブに含む。 */
function categoryPanels(effect: StationDetailEffect): Panel[] {
  const { detail, category, radiusM } = effect
  const focus: Category | null = category
  switch (focus) {
    case null:
    case 'passenger':
      return [paxTrendPanel(detail, 'compact')]
    case 'population':
    case 'population_forecast':
      return populationPanels(detail, radiusM, 'compact')
    case 'income':
      return incomePanels(detail, radiusM, 'compact')
    case 'sales':
      return salesPanels(detail, radiusM, 'compact')
    case 'land_price':
      return landPricePanels(detail, radiusM, 'compact')
    case 'bus':
      return busPanels(detail, radiusM, 'compact')
    case 'establishment':
      return establishmentPanels(detail, radiusM, 'compact')
    case 'employee':
      return employeePanels(detail, radiusM, 'compact')
  }
}

/** 駅詳細ツール → パネル（駅カード → 焦点カテゴリのチャート・すべて compact/inline）。 */
export function panelsForStationDetail(effect: StationDetailEffect): Panel[] {
  return [stationCardPanel(effect.detail, 'compact'), ...categoryPanels(effect)].map(inline)
}

/** ランキングツール → パネル（rankingTable・compact/inline）。 */
export function panelsForRanking(effect: RankingEffect): Panel[] {
  return [inline(rankingPanel(effect.response, 'compact'))]
}

/** 散布ツール → パネル（scatter・compact/inline）。 */
export function panelsForGrowth(effect: GrowthEffect): Panel[] {
  return [inline(scatterPanel(effect.response, 'compact'))]
}

/** 副産物 → パネル。 */
function panelsFor(effect: ToolEffect): Panel[] {
  switch (effect.kind) {
    case 'stationDetail':
      return panelsForStationDetail(effect)
    case 'ranking':
      return panelsForRanking(effect)
    case 'growth':
      return panelsForGrowth(effect)
  }
}

/** 副産物 → 地図操作（詳細＝flyTo＋選択／ランキング＝上位をハイライト）。 */
export function mapActionsForEffect(effect: ToolEffect): MapAction[] {
  switch (effect.kind) {
    case 'stationDetail': {
      const s = effect.detail.station
      return [
        { type: 'flyTo', lon: s.lon, lat: s.lat, zoom: DETAIL_ZOOM },
        { type: 'selectStation', grp: s.grp, radiusM: effect.radiusM },
      ]
    }
    case 'ranking': {
      const grps = effect.response.rows.map((row) => row.grp)
      return grps.length > 0 ? [{ type: 'highlightStations', grps }] : []
    }
    case 'growth':
      return []
  }
}

/** ターンの終わり方（本文が空のときの言い換えを決める）。 */
export type ChatOutcome = 'ok' | 'aborted' | 'failed'

/** 本文が空のまま終わったときの代替文（純関数）。 */
const FALLBACK_TEXT: Readonly<Record<ChatOutcome, { withPanels: string; withoutPanels: string }>> =
  {
    ok: {
      withPanels: '地図とグラフを表示しました。',
      withoutPanels: 'うまく取得できませんでした。指標や地域を変えて、もう一度お試しください。',
    },
    aborted: {
      withPanels: '地図とグラフを表示しました（説明の生成は時間内に終わりませんでした）。',
      withoutPanels: '時間内に取得できませんでした。もう一度お試しください。',
    },
    failed: {
      withPanels: '地図とグラフを表示しました（説明の生成に失敗しました）。',
      withoutPanels: 'うまく取得できませんでした。時間をおいて再度お試しください。',
    },
  }

/**
 * LLM 本文が空でも「無言の応答」にしないための文を決める（純関数）。
 *
 * 中断（45s abort）・エラー（429 等）・ステップ上限のいずれで終わっても、
 * ユーザーには必ず状況が伝わるようにする（同上ドキュメント フェーズ1）。
 */
export function textOrFallback(
  text: string,
  panelCount: number,
  outcome: ChatOutcome = 'ok',
): string {
  const trimmed = text.trim()
  if (trimmed.length > 0) return trimmed
  const fallback = FALLBACK_TEXT[outcome]
  return panelCount > 0 ? fallback.withPanels : fallback.withoutPanels
}

/**
 * ツール副産物と LLM 本文から MapResponse を組み立てる（Zod で 100% 通過する構造）。
 * ツールを 1 つも呼ばなかった場合でも、本文だけの妥当な応答になる。
 */
export function assemble(effects: readonly ToolEffect[], text: string): MapResponse {
  const panels: Panel[] = []
  const mapActions: MapAction[] = []
  for (const effect of effects) {
    panels.push(...panelsFor(effect))
    mapActions.push(...mapActionsForEffect(effect))
  }
  const trimmed = text.trim()
  const messages = trimmed.length > 0 ? [{ role: 'assistant' as const, text: trimmed }] : []
  return { messages, mapActions, panels }
}

// --- LLM 向けの要約（パネルと同じ数値を投影＝文章とパネルがズレない） ------

/** 折れ線の端点（最初と最後の有効値）を「年 値」に整形。 */
function endpoints(
  points: readonly { x: number; y: number | null }[],
  format: MetricFormat | null,
): string {
  const valid = points.filter((point): point is { x: number; y: number } => point.y !== null)
  const first = valid[0]
  const last = valid.at(-1)
  if (first === undefined || last === undefined) return '—'
  const head = `${first.x}年 ${formatNumber(first.y, format)}`
  if (last.x === first.x) return head
  return `${head} → ${last.x}年 ${formatNumber(last.y, format)}`
}

/** 1 パネル → 1 行のコンパクト要約（数値はパネルと同一）。 */
function summarizePanel(panel: Panel): string {
  switch (panel.type) {
    case 'stationCard': {
      const ops = panel.operators === null ? '' : `／${panel.operators}`
      const pax = panel.paxLatest === null ? '—' : `${formatNumber(panel.paxLatest, 'int')}人/日`
      return `駅: ${panel.stationName}（${panel.prefecture}${ops}）最新乗降 ${pax}`
    }
    case 'trendChart': {
      const series = panel.series[0]
      const body = series === undefined ? '—' : endpoints(series.points, panel.format)
      const stats = panel.stats?.map((stat) => `${stat.label} ${stat.value}`).join('・') ?? ''
      const flags = panel.flags.map((flag) => `⚠${flag.label}`).join('・')
      return [`${panel.title}: ${body}`, stats, flags]
        .filter((part) => part.length > 0)
        .join(' ｜ ')
    }
    case 'statTable': {
      const rows = panel.rows.map((row) => `${row.label} ${row.value}`).join('・')
      return `${panel.title}: ${rows.length > 0 ? rows : '—'}`
    }
    case 'barChart': {
      const bars = panel.bars.map((bar) => `${bar.label} ${bar.formatted}`).join('・')
      return `${panel.title}: ${bars.length > 0 ? bars : '—'}`
    }
    case 'rankingTable': {
      const top = panel.rows
        .slice(0, 5)
        .map((row) => `${row.rank}位 ${row.name} ${row.formatted}${row.flagged ? '⚠' : ''}`)
        .join('、')
      return `${panel.title}: ${top}`
    }
    case 'scatter':
      return `${panel.title}: ${panel.points.length}駅・${panel.clusterCount}クラスタ（${panel.xLabel}×${panel.yLabel}）`
    case 'markdown':
      return panel.body
  }
}

/** パネル群 → LLM 向けのコンパクト要約（ツール結果の本文）。 */
export function summarizePanels(panels: readonly Panel[]): string {
  return panels.map(summarizePanel).join('\n')
}
