/**
 * 指定緊急避難場所の**災害種別**（`docs/260824_flood.md` §3.5・§8.5）。
 *
 * 国土地理院が災害種別ごとにレイヤ（`skhb01`〜`skhb08`）を分けて配信していて、
 * **この分け方こそが機能の本体**である。洪水に対応していない避難場所へ誘導したら本末転倒で、
 * §11 のリスク 10（「避難所に行けと言われて逆に危険な目に遭う」＝**人命**）そのものになる。
 *
 * だから種別の対応表はここ 1 か所だけに持ち、UI も AI も API もこれを通す。
 *
 * ## ⚠ 「指定緊急避難場所」と「指定避難所」は別物
 *
 * - **指定緊急避難場所**＝命を守るために**緊急的に逃げ込む**場所（災害種別ごとに指定）
 * - **指定避難所**＝災害後に**一定期間滞在する**場所（種別の区別は無い）
 *
 * このアプリが扱うのは**前者だけ**。混同すると「避難所に泊まれる」と読まれかねないので、
 * ラベル（`EVACUATION_SITE_KIND_JA`）で固定し、文言でも必ず言い分ける。
 *
 * ## 実測（2026-08-27・`skhb01` の z=10 タイル）
 *
 * | 地域 | 件数 | サイズ |
 * |---|---|---|
 * | 関東（909/402） | 1,140 | 288KB |
 * | 富山（901/399） | 358 | 99KB |
 *
 * `properties` は `name` / `address` / `remarks` と、**対応する種別のぶんだけ** `disaster1`〜`disaster8`
 * （値は `1`）。対応しない種別はキーごと無い。`skhb01` の全件が `disaster1: 1` を持つ
 * ——つまり**レイヤを選ぶこと自体が種別の絞り込み**である。
 */

import { z } from 'zod'

/** このアプリが扱う避難場所の種類。**滞在する「指定避難所」ではない。** */
export const EVACUATION_SITE_KIND_JA = '指定緊急避難場所'

/** 1 つの災害種別（国土地理院のレイヤと 1 対 1）。 */
export type EvacuationDisaster = {
  /** アプリ内のキー（API のクエリ・AI ツールの引数）。 */
  readonly key: EvacuationDisasterKey
  /** 国土地理院のレイヤ名（`skhb01` など）。 */
  readonly layer: string
  /** GeoJSON の properties で対応を示すキー（`disaster1` など）。 */
  readonly property: string
  /** 国土地理院の表記に合わせた名前。 */
  readonly labelJa: string
}

export const evacuationDisasterKeySchema = z.enum([
  'flood',
  'landslide',
  'storm_surge',
  'earthquake',
  'tsunami',
  'fire',
  'inland_flood',
  'volcano',
])
export type EvacuationDisasterKey = z.infer<typeof evacuationDisasterKeySchema>

/** 災害種別の一覧（国土地理院のレイヤ番号順）。 */
export const EVACUATION_DISASTERS: readonly EvacuationDisaster[] = [
  { key: 'flood', layer: 'skhb01', property: 'disaster1', labelJa: '洪水' },
  { key: 'landslide', layer: 'skhb02', property: 'disaster2', labelJa: '崖崩れ・土石流・地滑り' },
  { key: 'storm_surge', layer: 'skhb03', property: 'disaster3', labelJa: '高潮' },
  { key: 'earthquake', layer: 'skhb04', property: 'disaster4', labelJa: '地震' },
  { key: 'tsunami', layer: 'skhb05', property: 'disaster5', labelJa: '津波' },
  { key: 'fire', layer: 'skhb06', property: 'disaster6', labelJa: '大規模な火事' },
  { key: 'inland_flood', layer: 'skhb07', property: 'disaster7', labelJa: '内水氾濫' },
  { key: 'volcano', layer: 'skhb08', property: 'disaster8', labelJa: '火山現象' },
]

/** 種別キー → 定義（`z.enum` で検証済みなので必ず見つかる）。 */
export function evacuationDisaster(key: EvacuationDisasterKey): EvacuationDisaster {
  const found = EVACUATION_DISASTERS.find((disaster) => disaster.key === key)
  if (found === undefined) throw new Error(`未知の災害種別です（${key}）`)
  return found
}

/** 種別キー → 表示名。 */
export function evacuationDisasterLabelJa(key: EvacuationDisasterKey): string {
  return evacuationDisaster(key).labelJa
}

/**
 * 避難場所 1 件の生データ（国土地理院の GeoJSON）。
 *
 * `disaster1`〜`disaster8` は**対応する種別のぶんだけ**現れるので、すべて任意にする。
 * 未知のフィールドは Zod が落とすため、配信の形が増えても壊れない。
 */
export const evacuationFeatureSchema = z.object({
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z
    .object({
      name: z.string().nullish(),
      address: z.string().nullish(),
      remarks: z.string().nullish(),
    })
    .catchall(z.unknown()),
})
export type EvacuationFeature = z.infer<typeof evacuationFeatureSchema>

export const evacuationTileSchema = z.object({
  features: z.array(evacuationFeatureSchema),
})

/**
 * その地物が対応している災害種別（`disaster1: 1` が立っているものだけ）。
 * **推測しない**——キーが無ければ「対応していない」であって「不明」ではない。
 */
export function disastersOfFeature(feature: EvacuationFeature): readonly EvacuationDisaster[] {
  return EVACUATION_DISASTERS.filter((disaster) => feature.properties[disaster.property] === 1)
}

/**
 * 災害種別 → **その災害の「指定区域」を表すハザードレイヤ**（無い種別は空）。
 *
 * 避難場所が「その災害の区域にかかっているか」を答えるために読むレイヤの一覧である。
 *
 * ## なぜ聞かれた災害のレイヤだけを見るのか
 *
 * ⚠ 実測（2026-08-27・新宿駅）で、**すべてのレイヤを一括で見ると標高 25〜30m の避難場所まで
 * 「浸水想定区域の中」**になった——東京 23 区は内水の想定区域がほぼ全域を覆っているためである。
 * 洪水から逃げる人にとって、その場所に内水の溜まりがあるかは**別の問い**で、
 * 混ぜると「どこも区域の中」になって判断の役に立たない（警告の飽和）。
 *
 * ## なぜ「そのグループの全レイヤ」ではないのか
 *
 * 洪水グループは 5 枚あるが、**計画規模（`flood_l1`）は想定最大規模（`flood_l2`）の内側**
 * （定義上、計画規模の方が小さい）なので、区域の内外を問うだけなら読む意味が無い。
 * 一方**家屋倒壊等氾濫想定区域（河岸侵食）は浸水域の外に広がりうる**ので落とせない。
 *
 * ⚠ **浸水継続時間（`flood_duration`）は落とせない。** 当初は「l2 の内側」と考えて外していたが、
 * 実測（2026-08-27・亀有駅の東 3.2km）で、**`flood_l2` が 0 のセルで `flood_duration` が
 * 「ごく一部」**になった。別々に digitise されたデータセットなので、包含は定義されていない。
 * 外したままだと、地点カードが `caution` と言う場所を「区域にかからない」と答えてしまう。
 *
 * この包含関係はカタログには書いていない知識なので、ここに表として持ち、テストで固定する。
 * 地震・大規模な火事・火山現象は、対応するハザード面を当アプリが持っていないので空。
 */
export const EVACUATION_AREA_LAYERS: Readonly<Record<EvacuationDisasterKey, readonly string[]>> = {
  flood: ['flood_l2', 'flood_duration', 'flood_kaoku_hanran', 'flood_kaoku_kagan'],
  inland_flood: ['naisui'],
  landslide: ['dosekiryu', 'kyukeisha', 'jisuberi'],
  storm_surge: ['hightide_l2'],
  tsunami: ['tsunami_shinsui'],
  earthquake: [],
  fire: [],
  volcano: [],
}
