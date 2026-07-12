/**
 * AI ツール表面（Step2・サーバ専用）＝ 共通API（domain）の薄いアダプタ。
 *
 * LLM の function calling ツールは **既存の db クエリ＋domain プレゼンタ**をそのまま呼ぶ
 * （HTTP を挟まない＝人間UIと同じロジック）。各ツールは domain 結果を EffectCollector に記録し、
 * assemble.ts が決定的にパネル/地図操作へ変換する。LLM へは数値の要約のみ返す（幻覚を防ぐ）。
 * 指標キーはカタログ（単一の真実）で検証＝生カラムのパススルー禁止（architecture.md §6）。
 */

import { tool, type InferUITools, type UIMessage } from 'ai'
import { z } from 'zod'
import { categorySchema, isRankableKey, requireEntry } from '@/shared/catalog'
import { PREFECTURES, RADII_M, type RadiusM } from '@/shared/constants'
import { type MapResponse } from '@/shared/protocol'
import {
  rankByColumn,
  searchStations,
  stationBundle,
  stationByGrp,
  valuesForColumns,
} from '@/db/queries'
import { buildStationDetail } from '@/domain/stations/presenter'
import { buildRanking } from '@/domain/ranking/presenter'
import { buildGrowth } from '@/domain/growth/presenter'
import { type EffectCollector } from './types'
import { panelsForStationDetail, summarizePanels } from './assemble'
import { metricsCatalogDigest, suggestMetricKeys } from './catalog-digest'

/** 既定の集約半径（1km＝アプリ既定）。 */
const DEFAULT_RADIUS_M: RadiusM = 1000
/** ランキング既定件数。 */
const DEFAULT_RANK_LIMIT = 20
/** ランキング最大件数（チャット内は上位に絞る）。 */
const MAX_RANK_LIMIT = 50

/** 入力の半径を有効な集約半径に解決（未知は既定 1km）。 */
function resolveRadius(input: number | undefined): RadiusM {
  const found = RADII_M.find((radius) => radius === input)
  return found ?? DEFAULT_RADIUS_M
}

/**
 * 都道府県名を正規化する。厳密一致か「接尾辞（都/道/府/県）抜き」の一致のみ採用し（"神奈川"→"神奈川県"）、
 * それ以外は unknown に集める（曖昧な部分一致で誤県に寄せない＝素通しして 0 件になる混乱を防ぐ）。
 */
function normalizePrefectures(input: readonly string[]): { names: string[]; unknown: string[] } {
  const names: string[] = []
  const unknown: string[] = []
  for (const raw of input) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const exact = PREFECTURES.find((pref) => pref.name === trimmed)
    if (exact !== undefined) {
      names.push(exact.name)
      continue
    }
    const stripped = PREFECTURES.find((pref) => pref.name.replace(/[都道府県]$/, '') === trimmed)
    if (stripped !== undefined) {
      names.push(stripped.name)
      continue
    }
    unknown.push(trimmed)
  }
  return { names, unknown }
}

/** 未知の都道府県に対する構造化エラー（LLM に正式名で再指定させる）。 */
function unknownPrefectures(unknown: readonly string[]): { error: string; hint: string } {
  return {
    error: `未知の都道府県: ${unknown.join('・')}`,
    hint: '都道府県は正式名（例「神奈川県」「東京都」）で指定してください。',
  }
}

/** 未知の指標キーに対する構造化エラー（LLM が getMetricsCatalog で再解決するための手掛かり）。 */
function unknownMetric(key: string): { error: string; hint: string; didYouMean: string[] } {
  return {
    error: `未知またはランキング不可の指標キー: ${key}`,
    hint: 'getMetricsCatalog で category / baseMetric を指定し、正確なキーを取得してください。',
    didYouMean: suggestMetricKeys(key),
  }
}

/**
 * リクエストごとにツール群を生成する（collector をクロージャで束ねる）。
 * ツール記述はカタログ由来のダイジェスト（system-prompt.ts）と合わせて LLM を誘導する。
 */
export function createTools(collector: EffectCollector) {
  return {
    /** 駅名 → 候補駅（grp を得る起点）。 */
    searchStations: tool({
      description:
        '駅名（漢字・一部かな可）から駅を検索し候補を返す。駅を特定する最初の一歩。返る grp を getStationDetail に渡す。',
      inputSchema: z.object({
        query: z.string().min(1).describe('駅名。例: 東京、しんじゅく、尼崎'),
      }),
      execute: async ({ query }) => {
        try {
          const results = await searchStations(query)
          // LLM は grp を選ぶだけ（座標・詳細は getStationDetail 側で取得）＝返却は最小限に。
          return {
            count: results.length,
            candidates: results.slice(0, 8).map((station) => ({
              grp: station.grp,
              name: station.searchLabel ?? station.label,
              prefecture: station.prefecture,
              paxLatest: station.paxLatest,
            })),
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : '検索に失敗しました' }
        }
      },
    }),

    /** 駅の詳細（焦点カテゴリのチャート）を表示。grp は searchStations で得る。 */
    getStationDetail: tool({
      description:
        '駅（grp）の詳細を地図とチャートで表示する。category で焦点タブ（人口/地価/バス/事業所/従業者/乗降）を、radiusM で集約半径を指定。数値の要約を返す。',
      inputSchema: z.object({
        grp: z.string().describe('searchStations が返した駅 grp'),
        category: categorySchema.optional().describe('焦点カテゴリ。省略時は乗降客の概要'),
        radiusM: z
          .number()
          .optional()
          .describe('集約半径(m): 500/1000/2000/5000/10000/20000。省略時 1000'),
      }),
      execute: async ({ grp, category, radiusM }) => {
        try {
          const station = await stationByGrp(grp)
          if (station === null) return { error: `駅が見つかりません: ${grp}` }
          const values = await stationBundle(grp)
          const detail = buildStationDetail(station, values)
          const resolved = resolveRadius(radiusM)
          const effect = {
            kind: 'stationDetail' as const,
            detail,
            category: category ?? null,
            radiusM: resolved,
          }
          collector.push(effect)
          return {
            grp: station.grp,
            name: station.label,
            prefecture: station.prefecture,
            operators: station.operators,
            radius: resolved,
            category: category ?? 'passenger',
            summary: summarizePanels(panelsForStationDetail(effect)),
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : '駅詳細の取得に失敗しました' }
        }
      },
    }),

    /** 都道府県×指標のランキング（上位/下位）。指標は正確なカタログキーで。 */
    rankStations: tool({
      description:
        '指標（正確なカタログキー）で駅を並べ替え上位/下位を返す。キーが不明なら先に getMetricsCatalog。prefectures 未指定は全国。',
      inputSchema: z.object({
        metric: z.string().describe('カタログキー。例: pop_gr_2020_2015_1km, rate_covid'),
        prefectures: z
          .array(z.string())
          .optional()
          .describe('都道府県名の配列。例: ["神奈川県"]。省略で全国'),
        order: z.enum(['asc', 'desc']).optional().describe('desc=上位(既定)/asc=下位'),
        limit: z
          .number()
          .int()
          .optional()
          .describe(`件数(1-${MAX_RANK_LIMIT}・既定 ${DEFAULT_RANK_LIMIT})`),
        excludeLowN: z.boolean().optional().describe('母数の小さい駅(⚠)を除外'),
      }),
      execute: async ({ metric, prefectures, order, limit, excludeLowN }) => {
        try {
          if (!isRankableKey(metric)) return unknownMetric(metric)
          const { names: prefs, unknown } = normalizePrefectures(prefectures ?? [])
          if (unknown.length > 0) return unknownPrefectures(unknown)
          const dir = order ?? 'desc'
          const lim = Math.min(Math.max(limit ?? DEFAULT_RANK_LIMIT, 1), MAX_RANK_LIMIT)
          const exclude = excludeLowN ?? false
          const { rows, total } = await rankByColumn(metric, prefs, dir, lim, 0, exclude)
          const response = buildRanking(metric, prefs, dir, rows, total, 0)
          collector.push({ kind: 'ranking', response })
          return {
            metric: response.metric.labelJa,
            unit: response.metric.unit,
            prefectures: response.prefectures,
            order: dir,
            total: response.total,
            rows: response.rows.slice(0, 10).map((row) => ({
              rank: row.rank,
              name: row.name,
              prefecture: row.prefecture,
              value: row.formatted,
              flagged: row.flagged,
            })),
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'ランキングに失敗しました' }
        }
      },
    }),

    /** 2 指標の増減率散布＋クラスタ（決定的 k-means）。 */
    compareGrowth: tool({
      description:
        '2 つの指標(x,y・正確なカタログキー)で駅を散布しクラスタ化する。増減率どうしの相関を見るのに使う。prefectures 未指定は全国。',
      inputSchema: z.object({
        x: z.string().describe('x 軸のカタログキー。例: pop_gr_2020_2015_2km'),
        y: z.string().describe('y 軸のカタログキー。例: rate_covid'),
        prefectures: z.array(z.string()).optional().describe('都道府県名の配列。省略で全国'),
        excludeLowN: z.boolean().optional().describe('母数の小さい駅(⚠)を除外'),
      }),
      execute: async ({ x, y, prefectures, excludeLowN }) => {
        try {
          if (!isRankableKey(x)) return unknownMetric(x)
          if (!isRankableKey(y)) return unknownMetric(y)
          const { names: prefs, unknown } = normalizePrefectures(prefectures ?? [])
          if (unknown.length > 0) return unknownPrefectures(unknown)
          const exclude = excludeLowN ?? false
          const keys = [x, y]
          if (exclude) {
            for (const entry of [requireEntry(x), requireEntry(y)]) {
              if (entry.reliabilityFlagKey !== null) keys.push(entry.reliabilityFlagKey)
            }
          }
          const valueRows = await valuesForColumns(keys, prefs)
          const response = buildGrowth(valueRows, x, y, {
            excludeLowN: exclude,
            prefectures: prefs,
          })
          collector.push({ kind: 'growth', response })
          return {
            x: response.x.labelJa,
            y: response.y.labelJa,
            prefectures: response.prefectures,
            pointCount: response.points.length,
            clusterCount: response.clusterCount,
            excludedLowN: response.excludedLowN,
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : '散布の集計に失敗しました' }
        }
      },
    }),

    /** 利用可能な指標カタログの照会（正確なキーの発見）。 */
    getMetricsCatalog: tool({
      description:
        '利用可能な指標カタログを照会する。category や baseMetric で絞り込み、rankStations/compareGrowth に渡す正確なキーを得る。',
      inputSchema: z.object({
        category: categorySchema.optional().describe('カテゴリで絞り込み'),
        baseMetric: z
          .string()
          .optional()
          .describe('指標ファミリで絞り込み。例: pop_gr, lp_med, bus_n'),
      }),
      execute: async ({ category, baseMetric }) => metricsCatalogDigest({ category, baseMetric }),
    }),
  }
}

/** チャットのカスタムデータパート（最終 MapResponse を data-map で送出）。 */
export type ChatDataParts = { map: MapResponse }

/** ツール群の型（UI メッセージのツールパート推論に使う）。 */
export type ChatTools = ReturnType<typeof createTools>

/** チャットの UI メッセージ型（P8b の useChat と共有）。 */
export type ChatUIMessage = UIMessage<unknown, ChatDataParts, InferUITools<ChatTools>>
