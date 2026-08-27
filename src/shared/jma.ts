/**
 * 気象庁の語彙（警報・注意報の種別と、二次細分区域の対応表）。**単一の真実**。
 *
 * `docs/260824_flood.md` §3.3・§8.4。ここが持つのは 2 つ。
 *
 * 1. **警報・注意報の種別コード表**（下の `JMA_WARNING_KINDS`）
 * 2. **市区町村コード → 二次細分区域**（`jma-areas.json`・`pipeline/build_jma_areas.py` が生成）
 *
 * ## ⚠ どのエンドポイントを見るか
 *
 * **`warning/data/warning/map.json` は更新が止まっている。** 実測（2026-08-27）で
 * `last-modified` が **3 か月前**（2026-05-28）のまま、`cache-control: max-age=60` を返し続けていた
 * ——**生きているように見えて中身が凍っている**という、いちばん質の悪い壊れ方である。
 * 生きているのは **`warning/data/r8/map.json`**（`last-modified` が当日・最新の `reportDatetime` が 3 分前）。
 *
 * r8 はさらに**キキクル相当の警戒レベル**（下の危険度）と**土砂災害警戒情報**を含む。
 *
 * ## ⚠ コード表は「公開された定義ファイルが無い」ので自分で持つ
 *
 * 指標カタログやハザードカタログと違い、**気象庁はコード → 名称の定義を配っていない**
 * （`warningcode.json` 等を実測で 3 パス試したがすべて 404・2026-08-27）。
 * だからこの表が唯一の記録になる。**推測で埋めず、知らないコードは「知らない」と返す**
 * ——黙って落とすと、発表されている警報が画面から消える。
 */

import { z } from 'zod'
import areasJson from './hazard/jma-areas.json'
import { ALERT_LEVELS, type AlertLevel } from './constants'

// --- 警報・注意報の種別 ---------------------------------------------------

/** 種別の重さ。同じ現象なら 特別警報 ＞ 警報 ＞ 注意報。 */
export const jmaWarningKindSchema = z.enum(['特別警報', '警報', '注意報'])
export type JmaWarningKind = z.infer<typeof jmaWarningKindSchema>

/** 1 つの種別コードの意味。 */
export type JmaWarningDefinition = {
  readonly nameJa: string
  readonly kindJa: JmaWarningKind
  /**
   * この発表が示す**警戒レベル相当**（内閣府ガイドライン・§3.3(d)）。
   *
   * `0` は「警戒レベルの体系の外」という意味で、**軽いという意味ではない**——
   * 暴風警報や波浪警報は危険だが、水害・土砂災害の警戒レベルとは別の物差しである。
   */
  readonly alertLevel: AlertLevel
}

/**
 * 気象庁の警報・注意報の種別コード。
 *
 * **`alertLevel` は §3.3(d) の表と 1 対 1。** 変えたくなったらコードより先にプランを書き換える
 * （§6.2 の避難判定と同じ扱い——人命に関わる閾値は合意記録が正）。
 */
export const JMA_WARNING_KINDS: Readonly<Record<string, JmaWarningDefinition>> = {
  // --- 特別警報 ---
  '32': { nameJa: '暴風雪特別警報', kindJa: '特別警報', alertLevel: 0 },
  '33': { nameJa: '大雨特別警報', kindJa: '特別警報', alertLevel: 5 },
  '35': { nameJa: '暴風特別警報', kindJa: '特別警報', alertLevel: 0 },
  '36': { nameJa: '大雪特別警報', kindJa: '特別警報', alertLevel: 0 },
  '37': { nameJa: '波浪特別警報', kindJa: '特別警報', alertLevel: 0 },
  '38': { nameJa: '高潮特別警報', kindJa: '特別警報', alertLevel: 4 },
  // --- 警報 ---
  '02': { nameJa: '暴風雪警報', kindJa: '警報', alertLevel: 0 },
  '03': { nameJa: '大雨警報', kindJa: '警報', alertLevel: 3 },
  '04': { nameJa: '洪水警報', kindJa: '警報', alertLevel: 3 },
  '05': { nameJa: '暴風警報', kindJa: '警報', alertLevel: 0 },
  '06': { nameJa: '大雪警報', kindJa: '警報', alertLevel: 0 },
  '07': { nameJa: '波浪警報', kindJa: '警報', alertLevel: 0 },
  '08': { nameJa: '高潮警報', kindJa: '警報', alertLevel: 4 },
  // --- 注意報 ---
  '10': { nameJa: '大雨注意報', kindJa: '注意報', alertLevel: 2 },
  '12': { nameJa: '大雪注意報', kindJa: '注意報', alertLevel: 0 },
  '13': { nameJa: '風雪注意報', kindJa: '注意報', alertLevel: 0 },
  '14': { nameJa: '雷注意報', kindJa: '注意報', alertLevel: 0 },
  '15': { nameJa: '強風注意報', kindJa: '注意報', alertLevel: 0 },
  '16': { nameJa: '波浪注意報', kindJa: '注意報', alertLevel: 0 },
  '17': { nameJa: '融雪注意報', kindJa: '注意報', alertLevel: 0 },
  '18': { nameJa: '洪水注意報', kindJa: '注意報', alertLevel: 2 },
  '19': { nameJa: '高潮注意報', kindJa: '注意報', alertLevel: 2 },
  '20': { nameJa: '濃霧注意報', kindJa: '注意報', alertLevel: 0 },
  '21': { nameJa: '乾燥注意報', kindJa: '注意報', alertLevel: 0 },
  '22': { nameJa: 'なだれ注意報', kindJa: '注意報', alertLevel: 0 },
  '23': { nameJa: '低温注意報', kindJa: '注意報', alertLevel: 0 },
  '24': { nameJa: '霜注意報', kindJa: '注意報', alertLevel: 0 },
  '25': { nameJa: '着氷注意報', kindJa: '注意報', alertLevel: 0 },
  '26': { nameJa: '着雪注意報', kindJa: '注意報', alertLevel: 0 },
  '27': { nameJa: 'その他の注意報', kindJa: '注意報', alertLevel: 0 },
}

/** 種別コード → 意味（未知なら undefined。**呼び出し側は必ず「未知」を表に出す**）。 */
export function jmaWarningKind(code: string): JmaWarningDefinition | undefined {
  return JMA_WARNING_KINDS[code]
}

// --- 危険度（キキクル相当の警戒レベル）------------------------------------

/**
 * `r8/map.json` の `kinds[].properties[]` が運ぶ「危険度」。
 *
 * **気象庁自身が警戒レベル相当を書いている**ので、§3.3(d) の表を手で当てるより確実で、
 * かつ**タイルの色を読まずに済む**（決定 5・§9.1 を守れる）。
 *
 * ## レベルを持つものと持たないものの見分け方（実測・2026-08-27）
 *
 * `significancyPart.locals[].code` が **`X1` で終わるものだけ**が警戒レベル相当を運ぶ。
 *
 * | type | 観測された local | 意味 |
 * |---|---|---|
 * | 大雨浸水危険度 | 21 / 31 / 41 / 51 | **警戒レベル 2〜5 相当** |
 * | 土砂災害危険度 | 21 / 41 | **警戒レベル 2・4 相当**（41 は文にも「警戒レベル４相当」と明記） |
 * | 雷危険度・風危険度・波危険度・濃霧危険度・乾燥危険度 | **すべて 20** | 警戒レベルの体系外 |
 *
 * **許可リスト（大雨浸水・土砂災害だけ）にはしない。** 将来 `洪水危険度` が増えたときに
 * **静かに見落とす**からで、過小報告は防災アプリでいちばん危ない誤りである。
 */
const LEVEL_BEARING_LOCAL = /^([1-5])1$/

/** 危険度の local コード → 警戒レベル相当（レベルを運ばないものは null）。 */
export function alertLevelOfLocalCode(local: string | undefined): AlertLevel | null {
  const matched = local === undefined ? null : LEVEL_BEARING_LOCAL.exec(local)
  if (matched === null) return null
  const level = Number(matched[1])
  return ALERT_LEVELS.find((candidate) => candidate === level) ?? null
}

/**
 * 危険度の種別 → 読める名前。
 * **知らない種別はそのまま出す**（勝手な名前を付けない・捨てない）。
 */
const RISK_TYPE_LABELS_JA: Readonly<Record<string, string>> = {
  大雨浸水危険度: '浸水害の危険度',
  土砂災害危険度: '土砂災害の危険度',
  洪水危険度: '洪水の危険度',
}

export function riskTypeLabelJa(type: string): string {
  return RISK_TYPE_LABELS_JA[type] ?? type
}

// --- 市区町村 → 二次細分区域 ----------------------------------------------

const jmaAreaRefSchema = z.object({ code: z.string(), nameJa: z.string() })
export type JmaAreaRef = z.infer<typeof jmaAreaRefSchema>

const jmaMunicipalitySchema = z.object({
  nameJa: z.string(),
  prefectureJa: z.string(),
  /**
   * その市区町村を覆う二次細分区域。**複数になることがある**
   * （横浜市北部／南部、富山市平地／山間部…全国で 74 市町村）。
   * 複数のときは**最も重い発表を採る**——どちら側にいるかは市区町村コードからは分からないので、
   * 安全側に倒す（§8.4）。
   */
  areas: z.array(jmaAreaRefSchema).min(1),
})
export type JmaMunicipality = z.infer<typeof jmaMunicipalitySchema>

const jmaAreaTableSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  generatedFrom: z.string(),
  sourceJa: z.string(),
  municipalityCount: z.number().int(),
  municipalities: z.record(z.string(), jmaMunicipalitySchema),
})

/** 破損したらモジュール初期化で落とす（fail fast・`shared/hazard.ts` と同じ流儀）。 */
export const jmaAreaTable = jmaAreaTableSchema.parse(areasJson)

/** 5 桁の市区町村コード → 気象庁の区域（未収録は undefined）。 */
export function jmaMunicipality(code: string): JmaMunicipality | undefined {
  return jmaAreaTable.municipalities[code]
}
