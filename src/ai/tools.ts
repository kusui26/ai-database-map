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
import { categorySchema, requireEntry } from '@/shared/catalog'
import { PREFECTURES, RADII_M, type RadiusM, ROUTE_TYPES, routeTypeLabel } from '@/shared/constants'
import { type MapResponse } from '@/shared/protocol'
import {
  rankByColumn,
  searchStations,
  stationBundle,
  stationByGrp,
  scatterPoints,
} from '@/db/queries'
import { buildStationDetail } from '@/domain/stations/presenter'
import { buildRanking } from '@/domain/ranking/presenter'
import { buildGrowth } from '@/domain/growth/presenter'
import { type EffectCollector } from './types'
import { panelsForStationDetail, summarizePanels } from './assemble'
import { metricsCatalogDigest } from './catalog-digest'
import { resolveMetricKey, type MetricResolution } from './metric-resolver'

/** 既定の集約半径（1km＝アプリ既定）。 */
const DEFAULT_RADIUS_M: RadiusM = 1000
/** ランキング既定件数。 */
const DEFAULT_RANK_LIMIT = 20
/** ランキング最大件数（チャット内は上位に絞る）。 */
const MAX_RANK_LIMIT = 50

/** 事業者種別コードの説明（ツール定義に埋め込む・表示名は constants の単一定義から生成）。 */
const ROUTE_TYPE_HINT = ROUTE_TYPES.map((type) => `${type}:${routeTypeLabel(type)}`).join(' ')

/** 名前配列の前後空白を落とし、空文字を除く（会社名・路線名の共通前処理）。 */
function nonEmptyNames(input: readonly string[] | undefined): string[] {
  return (input ?? []).map((name) => name.trim()).filter((name) => name.length > 0)
}

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

/** 指標の解決失敗 → LLM 向けの構造化エラー（次の一手を hint で示す）。 */
function metricError(resolution: Extract<MetricResolution, { ok: false }>): {
  error: string
  hint: string
  didYouMean: readonly string[]
} {
  return { error: resolution.error, hint: resolution.hint, didYouMean: resolution.didYouMean }
}

/** 解決時の補正・既定の説明をまとめる（無ければ undefined＝返却に含めない）。 */
function resolutionNote(...notes: readonly (string | null)[]): string | undefined {
  const merged = notes.filter((note): note is string => note !== null && note.length > 0)
  return merged.length > 0 ? merged.join('・') : undefined
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

    /** 都道府県×指標のランキング（上位/下位）。指標はキーでもファミリ名でもよい。 */
    rankStations: tool({
      description:
        '指標で駅を並べ替え上位/下位を返す。metric はカタログキー（pop_gr_2020_2015_1km）でも指標ファミリ（pop_gr）でもよく、ファミリなら radiusM / year で確定する（未指定は 1km・直近5年）。prefectures 未指定は全国、operators 未指定は全社、routes/routeTypes 未指定は全路線。',
      inputSchema: z.object({
        metric: z
          .string()
          .describe(
            'カタログキー（例 pop_gr_2020_2015_1km）または指標ファミリ（例 pop_gr, lp_gr）',
          ),
        radiusM: z
          .number()
          .optional()
          .describe(
            '集約半径(m): 500/1000/2000/5000/10000/20000。省略時 1000。半径非依存の指標では無視',
          ),
        year: z.number().optional().describe('対象年（増減率では新しい方の年）。省略時は直近'),
        yearBase: z.number().optional().describe('増減率の基準年（古い方の年）'),
        prefectures: z
          .array(z.string())
          .optional()
          .describe('都道府県名の配列。例: ["神奈川県"]。省略で全国'),
        operators: z
          .array(z.string())
          .optional()
          .describe(
            '運営会社名の配列（正式名称・例 ["東日本旅客鉄道"]。JR東日本ではない）。どれか1社でも運営する駅が対象。省略で全社',
          ),
        routes: z
          .array(z.string())
          .optional()
          .describe('路線名の配列（例 ["東海道新幹線"]）。省略で全路線'),
        routeTypes: z
          .array(z.number().int())
          .optional()
          .describe(
            `事業者種別の配列（${ROUTE_TYPE_HINT}）。「新幹線の駅だけ」は [1]。routes とは OR。省略で全種別`,
          ),
        order: z.enum(['asc', 'desc']).optional().describe('desc=上位(既定)/asc=下位'),
        limit: z
          .number()
          .int()
          .optional()
          .describe(`件数(1-${MAX_RANK_LIMIT}・既定 ${DEFAULT_RANK_LIMIT})`),
        excludeLowN: z
          .boolean()
          .optional()
          .describe('信頼性の低い値(⚠：母数が小さい・極端値)の駅を除外'),
      }),
      execute: async ({
        metric,
        radiusM,
        year,
        yearBase,
        prefectures,
        operators,
        routes,
        routeTypes,
        order,
        limit,
        excludeLowN,
      }) => {
        try {
          const resolved = resolveMetricKey({ metric, radiusM, year, yearBase })
          if (!resolved.ok) return metricError(resolved)
          const { names: prefs, unknown } = normalizePrefectures(prefectures ?? [])
          if (unknown.length > 0) return unknownPrefectures(unknown)
          const dir = order ?? 'desc'
          const lim = Math.min(Math.max(limit ?? DEFAULT_RANK_LIMIT, 1), MAX_RANK_LIMIT)
          const exclude = excludeLowN ?? false
          const ops = nonEmptyNames(operators)
          const lines = nonEmptyNames(routes)
          const types = (routeTypes ?? []).filter((type) => ROUTE_TYPES.some((t) => t === type))
          const { rows, total } = await rankByColumn(
            resolved.key,
            prefs,
            dir,
            lim,
            0,
            exclude,
            ops,
            lines,
            types,
          )
          const response = buildRanking(resolved.key, prefs, dir, rows, total, 0, {
            operators: ops,
            routes: lines,
            routeTypes: types,
          })
          collector.push({ kind: 'ranking', response })
          // 路線名の綴り違いや、会社と路線の食い違いは 0 件になるだけで区別がつかない。
          // LLM が「無い」と誤断定しないよう理由を添える（compareGrowth と同じ扱い）。
          const emptyNote =
            total === 0 && (lines.length > 0 || types.length > 0)
              ? '該当が 0 件でした。路線名は正式名称（例「東海道新幹線」）で指定し、会社と路線が同じ事業者のものか確認してください。'
              : null
          return {
            metric: response.metric.labelJa,
            resolvedMetric: resolved.key,
            note: resolutionNote(resolved.note, emptyNote),
            unit: response.metric.unit,
            prefectures: response.prefectures,
            operators: response.operators,
            routes: response.routes,
            routeTypes: response.routeTypes.map(routeTypeLabel),
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
        '2 つの指標(x,y)で駅を散布しクラスタ化する。x/y はカタログキーでも指標ファミリ（pop_gr, lp_gr, rate_covid …）でもよく、radiusM を添えれば半径依存の指標がそれで確定する（未指定は 1km・直近5年）。prefectures 未指定は全国、operators 未指定は全社、routes/routeTypes 未指定は全路線。',
      inputSchema: z.object({
        x: z
          .string()
          .describe('x 軸のカタログキーまたは指標ファミリ。例: pop_gr, pop_gr_2020_2015_2km'),
        y: z.string().describe('y 軸のカタログキーまたは指標ファミリ。例: rate_covid, lp_gr'),
        radiusM: z
          .number()
          .optional()
          .describe('集約半径(m): 500/1000/2000/5000/10000/20000。x/y の半径依存の指標に適用'),
        prefectures: z.array(z.string()).optional().describe('都道府県名の配列。省略で全国'),
        operators: z
          .array(z.string())
          .optional()
          .describe(
            '運営会社名の配列（正式名称・例 ["東日本旅客鉄道"]。JR東日本ではない）。どれか1社でも運営する駅が対象。省略で全社',
          ),
        routes: z
          .array(z.string())
          .optional()
          .describe('路線名の配列（例 ["東海道新幹線"]）。省略で全路線'),
        routeTypes: z
          .array(z.number().int())
          .optional()
          .describe(
            `事業者種別の配列（${ROUTE_TYPE_HINT}）。「新幹線の駅だけ」は [1]。routes とは OR。省略で全種別`,
          ),
        excludeLowN: z
          .boolean()
          .optional()
          .describe('信頼性の低い値(⚠：母数が小さい・極端値)の駅を除外'),
      }),
      execute: async ({
        x,
        y,
        radiusM,
        prefectures,
        operators,
        routes,
        routeTypes,
        excludeLowN,
      }) => {
        try {
          const xResolved = resolveMetricKey({ metric: x, radiusM })
          if (!xResolved.ok) return metricError(xResolved)
          const yResolved = resolveMetricKey({ metric: y, radiusM })
          if (!yResolved.ok) return metricError(yResolved)
          const { names: prefs, unknown } = normalizePrefectures(prefectures ?? [])
          if (unknown.length > 0) return unknownPrefectures(unknown)
          const exclude = excludeLowN ?? false
          // 信頼性フラグは除外するときだけ引く（引かなければ DB 側の集計も軽い）。
          const flags = exclude
            ? [
                requireEntry(xResolved.key).reliabilityFlagKey,
                requireEntry(yResolved.key).reliabilityFlagKey,
              ]
            : [null, null]
          const ops = nonEmptyNames(operators)
          const lines = nonEmptyNames(routes)
          const types = (routeTypes ?? []).filter((type) => ROUTE_TYPES.some((t) => t === type))
          const valueRows = await scatterPoints(
            xResolved.key,
            yResolved.key,
            flags[0] ?? null,
            flags[1] ?? null,
            { prefectures: prefs, operators: ops, routes: lines, routeTypes: types },
          )
          const response = buildGrowth(valueRows, xResolved.key, yResolved.key, {
            excludeLowN: exclude,
            prefectures: prefs,
            operators: ops,
            routes: lines,
            routeTypes: types,
          })
          collector.push({ kind: 'growth', response })
          // 路線名の綴り違いや、会社と路線の食い違い（例 東海旅客鉄道 × 東北新幹線）は
          // 0 件になるだけで区別がつかない。LLM が「無い」と誤断定しないよう理由を添える。
          const emptyNote =
            response.points.length === 0 && (lines.length > 0 || types.length > 0)
              ? '該当が 0 件でした。路線名は正式名称（例「東海道新幹線」）で指定し、会社と路線が同じ事業者のものか確認してください。'
              : null
          return {
            x: response.x.labelJa,
            y: response.y.labelJa,
            resolvedMetrics: { x: xResolved.key, y: yResolved.key },
            note: resolutionNote(xResolved.note, yResolved.note, emptyNote),
            prefectures: response.prefectures,
            operators: response.operators,
            routes: response.routes,
            routeTypes: response.routeTypes.map(routeTypeLabel),
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
