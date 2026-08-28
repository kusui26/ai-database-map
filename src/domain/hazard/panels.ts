/**
 * ドメイン：地点のハザード → **GUI Chat Protocol のパネル**（`docs/260824_flood.md` §6.4）。
 *
 * UI もチャットも**同じ 1 枚のカード**を描く。ここで組み立てておけば、
 * Phase 4 の AI ツール（`getHazardAtPoint`）はこの関数を呼ぶだけで済み、
 * 「画面には出るが AI は説明できない」というズレが構造的に起きない（.claude/CLAUDE.md §2）。
 */

import type {
  HazardAlertsResponse,
  HazardAlertWarning,
  HazardEscapeResponse,
  HazardEvacuationResponse,
  HazardFloodForecast,
  HazardPointResponse,
} from '@/shared/api'
import type {
  EscapeDirectionPanel,
  EvacuationListPanel,
  HazardCardPanel,
  HazardItem,
  PanelSize,
} from '@/shared/protocol'
import { ALERT_LEVEL_LABELS_JA, HAZARD_GROUP_LABELS_JA, type HazardGroup } from '@/shared/constants'
import { evacuationDisasterLabelJa, type EvacuationDisasterKey } from '@/shared/evacuation'
import { getHazardLayer } from '@/shared/hazard'
import { jstDateTimeJa, parseIso } from '@/shared/time'
import { hazardLevelOfAlert } from './level'

/**
 * 地点の応答 → `hazardCard`。**意味づけは足さない**——応答が持っている文字列を並べ替えるだけ。
 * ここで新しい判断（危険度・行動・言い回し）を作ると、API と UI で答えが分かれる。
 */
export function hazardCardPanel(point: HazardPointResponse, size?: PanelSize): HazardCardPanel {
  return {
    type: 'hazardCard',
    placeJa: point.point.placeJa,
    level: point.verdict.level,
    headlineJa: point.verdict.headlineJa,
    evacuation: point.verdict.evacuation,
    certainty: point.certainty,
    items: point.hazards,
    reasonsJa: point.verdict.reasonsJa,
    // 取得できなかったものの説明も、網羅性の注記と同じ場所に出す——
    // 「河川情報が無い」ことを黙っていると、**無いのか、取れなかったのか**が分からない。
    coverageNotesJa: [...point.notesJa, ...point.coverageNotesJa],
    sources: point.sources,
    disclaimerJa: point.disclaimerJa,
    size,
  }
}

/**
 * 駅カードに 1 行で添える災害バッジの文言（`docs/260824_flood.md` §7.2）。
 *
 * **駅詳細のタブは増やさない**（8 タブ 516px で既にパネル幅を超えている）ので、
 * 1 行に収まる長さにする。レイヤ名は長いので**グループ名**で言う
 * （「洪水浸水想定区域（想定最大規模）」→「洪水」）。
 *
 * 該当が無いときも**「安全」とは言わない**（§7.5）。言えるのは「該当なし」までである。
 */
export function hazardBadgeJa(point: HazardPointResponse): string {
  const worst = point.hazards[0]
  if (worst === undefined) return '指定区域の該当なし'
  const group = getHazardLayer(worst.layerKey)?.group
  const groupJa = group === undefined ? '' : `${HAZARD_GROUP_LABELS_JA[group]} `
  const others = new Set(
    point.hazards.slice(1).map((item) => getHazardLayer(item.layerKey)?.group ?? item.layerKey),
  )
  others.delete(group ?? '')
  const more = others.size === 0 ? '' : `・ほか ${others.size} 種`
  return `${groupJa}${worst.valueJa}${more}`
}

/**
 * 駅バッジに必ず添える限界（§7.2）。
 * **駅の代表点 1 点の話**であって、駅前広場の反対側は違うことがある。
 */
export const STATION_HAZARD_CAVEAT_JA =
  '駅の代表点 1 点の値です。駅前の反対側では異なることがあります。'

/**
 * 時制の見出し（`docs/260828_fix_flood.md` §4.3・§4.4 決定 3）。
 *
 * **「いま」と「もし起きたら」は、並べて初めて違いが伝わる。** 片方だけ出していたとき、
 * 静的な危険度（`HAZARD_LEVEL_LABELS_JA`：想定区域外／注意／警戒／危険／極めて危険）が
 * 気象庁キキクル（**いま**の危険度分布：注意／警戒／非常に危険／極めて危険）と
 * **5 段中 3 段で同じ語**なので、**いまの災害情報だと読まれた**（利用者からの報告・2026-08-28）。
 *
 * だから語を変えるのではなく、**時制の主語を先に置く**。
 * バッジもタブの見出しも**この定数を使う**——別々に書くと必ずずれる。
 */
export const HAZARD_TENSE_NOW_JA = 'いま'
export const HAZARD_TENSE_NOW_NOTE_JA = '気象庁がいま発表しているもの。'
export const HAZARD_TENSE_ASSUMED_JA = 'もし起きたら'
export const HAZARD_TENSE_ASSUMED_NOTE_JA =
  '想定される最大級の被害。いま起きていることではありません。'

// --- 逃げる（駅タブの③・260828 PR-3） -------------------------------------

/**
 * 静的ハザードのグループ → 指定緊急避難場所の災害種別（`skhb01`〜`skhb08` のどれを見るか）。
 *
 * 発表から決める対応表（`warning-mode.ts` の `EVACUATION_BY_PHENOMENON`）の**想定区域版**である。
 * こちらは名前がほぼ 1 対 1 に揃っているが、**表を省いて文字列を写してはいけない**——
 * 種別を取り違えると、その災害に対応していない場所を出す（§11 リスク 10 ＝人命）。
 *
 * 地形は参考情報、リアルタイムは「いま」の話——どちらも「逃げる先の種別」を持たない
 * （地点カードにもそもそも出ない）。
 */
const EVACUATION_DISASTER_BY_GROUP: Readonly<Record<HazardGroup, EvacuationDisasterKey | null>> = {
  flood: 'flood',
  inland_flood: 'inland_flood',
  storm_surge: 'storm_surge',
  tsunami: 'tsunami',
  landslide: 'landslide',
  terrain: null,
  realtime: null,
}

/**
 * その地点の「逃げる」で扱う災害種別。**いちばん重い静的ハザード**から決める
 * （`hazards` は重い順・`hazardBadgeJa` と同じ前提）。
 *
 * `null` ＝ 指定区域の該当が無い。**そのときは種別を勝手に選ばない**——
 * 根拠なく選んだ種別の避難場所を出すくらいなら、段ごと出さない方が誠実である。
 */
export function evacuationDisasterForPoint(point: {
  readonly hazards: readonly { readonly layerKey: string }[]
}): EvacuationDisasterKey | null {
  const disasters = point.hazards.map((item) => {
    const group = getHazardLayer(item.layerKey)?.group
    return group === undefined ? null : EVACUATION_DISASTER_BY_GROUP[group]
  })
  return disasters.find((disaster) => disaster !== null) ?? null
}

/**
 * 「逃げる」の段の文言（`docs/260828_fix_flood.md` §4.3 の③）。
 *
 * ボタンに**「安全」という語を使わない**（§7.5-5）——指定緊急避難場所は
 * 「指定されている」だけで、いま開設されているかも、安全かどうかも言えない。
 * 警戒バナーの CTA（警戒中の文脈がある）とは、あえて言い方を変えている。
 */
export const HAZARD_ESCAPE_TITLE_JA = '逃げる'
export const HAZARD_ESCAPE_OPEN_JA = '避難先と向きを調べる'
export const HAZARD_ESCAPE_CLOSE_JA = '閉じる'

/** 段の注記。**どの災害の話か**を主語として必ず言う（種別を黙って選ばない）。 */
export function hazardEscapeNoteJa(disaster: EvacuationDisasterKey): string {
  return `いちばん重い想定（${evacuationDisasterLabelJa(disaster)}）に対応した避難先と、区域の外へ出る向き。押したときだけ調べます。`
}

/**
 * 避難場所を出せないときの言い方（警戒バナーの引き出しと**同じ文**を使う）。
 *
 * **オフラインで「取得できませんでした」だけ出すのは不親切**——なぜ出ないのか、
 * 代わりに何が見られるのかを言う。方向（`escapeDirection`）は端末の中だけで出せる。
 */
export function evacuationUnavailableJa(online: boolean, loading: boolean): string {
  if (!online) {
    return (
      'オフラインのため、避難場所の一覧は出せません（端末に保存していないデータです）。' +
      '「区域の外へ出る向き」は、保存した 250m メッシュだけで出しています。'
    )
  }
  return loading ? '避難場所を探しています…' : '避難場所を取得できませんでした。'
}

// --- アラート（いまの警戒状況・Phase 3） ----------------------------------

/**
 * 発表時刻の表示（**10 分前の情報を「今」と言わない**ため必ず出す・§7.4）。
 *
 * **必ず日本時間で書く。** `getHours()` など実行環境のタイムゾーンに従う関数を使うと、
 * 同じ発表が Vercel（UTC）では 9 時間前に見える——時刻がずれると、
 * 「その情報が古いかどうか」という判断そのものが壊れる。
 */
export function reportedAtJa(iso: string | null): string | null {
  const epochMs = iso === null ? null : parseIso(iso)
  return epochMs === null ? null : `気象庁の発表時刻：${jstDateTimeJa(epochMs)}`
}

/** 発表 1 件 → カードの 1 行。 */
function alertItem(warning: HazardAlertWarning): HazardItem {
  const levelJa = ALERT_LEVEL_LABELS_JA[warning.alertLevel]
  return {
    // 同じ種別が複数区域で出ることがあるので、区域名を混ぜて一意にする。
    layerKey: `jma-${warning.areaJa}-${warning.code}`,
    labelJa: warning.nameJa,
    valueJa: warning.alertLevel === 0 ? warning.statusJa : `${levelJa}・${warning.statusJa}`,
    // 補足の文（「２７日８時から１３時まで、警戒レベル４相当」）があればそちらを出す。
    meaningJa: warning.detailJa ?? warning.areaJa,
    level: hazardLevelOfAlert(warning.alertLevel),
    color: null,
    source: 'jma',
    coverage: null,
    certainty: 'exact',
  }
}

/** 指定河川洪水予報 1 件 → カードの 1 行（**河川名を主語にする**）。 */
function floodItem(forecast: HazardFloodForecast): HazardItem {
  return {
    layerKey: `jma-river-${forecast.riverNameJa}-${forecast.nameJa}`,
    labelJa: `${forecast.riverNameJa}（指定河川洪水予報）`,
    valueJa: `${forecast.nameJa}・${ALERT_LEVEL_LABELS_JA[forecast.alertLevel]}`,
    meaningJa: null,
    level: hazardLevelOfAlert(forecast.alertLevel),
    color: null,
    source: 'jma',
    coverage: null,
    certainty: 'exact',
  }
}

/**
 * いまの警戒状況 → `hazardCard`。**平時のカード（`hazardCardPanel`）と同じ型**にするので、
 * UI もチャットも描き分けが要らない（§6.4）。
 *
 * **`evacuation` は必ず null。** 避難の要否を出すのは市町村で、こちらは知り得ない（§7.4）。
 */
export function hazardAlertCardPanel(
  alerts: HazardAlertsResponse,
  size?: PanelSize,
): HazardCardPanel {
  const reported = reportedAtJa(alerts.reportedAt)
  return {
    type: 'hazardCard',
    placeJa: alerts.point.placeJa,
    level: alerts.level,
    headlineJa: alerts.headlineJa,
    evacuation: null,
    certainty: 'exact',
    // 河川の予報を先に置く（名指しの河川がいちばん具体的なので）。
    items: [...alerts.floodForecasts.map(floodItem), ...alerts.warnings.map(alertItem)],
    reasonsJa: alerts.reasonsJa,
    // 時刻・限界・取れなかったものを 1 か所にまとめる（UI が出し忘れられない形）。
    coverageNotesJa: [
      ...(reported === null ? [] : [reported]),
      ...alerts.limitationsJa,
      ...alerts.notesJa,
    ],
    sources: alerts.sources,
    disclaimerJa: alerts.disclaimerJa,
    size,
  }
}

// --- 避難先（どこへ行くか・Phase 4 後半） ---------------------------------

/**
 * 避難先の一覧 → `evacuationList`。**ここでも意味づけは足さない**——
 * 距離も方角も「区域にかかるか」も、応答が日本語まで作って持っている。
 *
 * 限界（`limitationsJa`）を**畳まずに全部載せる**のがこのパネルの肝である。
 * 「開設されているとは限らない」「直線距離である」「指定避難所ではない」の 3 つは、
 * どれか 1 つ落ちるだけで誤解の余地が生まれる（§11 リスク 10）。
 */
export function evacuationListPanel(
  evacuation: HazardEvacuationResponse,
  size?: PanelSize,
): EvacuationListPanel {
  return {
    type: 'evacuationList',
    forDisasterJa: evacuation.forDisasterJa,
    siteKindJa: evacuation.siteKindJa,
    placeJa: evacuation.point.placeJa,
    headlineJa: evacuation.headlineJa,
    items: evacuation.sites,
    limitationsJa: evacuation.limitationsJa,
    notesJa: evacuation.notesJa,
    sources: evacuation.sources,
    disclaimerJa: evacuation.disclaimerJa,
    size,
  }
}

/**
 * 脱出方向 → `escapeDirection`。ここでも意味づけは足さない。
 *
 * **限界（`limitationsJa`）を畳まずに全部載せる**のがこのパネルの肝である。
 * 方向と距離だけが独り歩きすると、**経路案内**だと読まれる（§0.4・§8.6）。
 */
export function escapeDirectionPanel(
  escape: HazardEscapeResponse,
  size?: PanelSize,
): EscapeDirectionPanel {
  return {
    type: 'escapeDirection',
    placeJa: escape.point.placeJa,
    forDisasterJa: escape.forDisasterJa,
    headlineJa: escape.headlineJa,
    direction: escape.direction,
    limitationsJa: escape.limitationsJa,
    notesJa: escape.notesJa,
    sources: escape.sources,
    disclaimerJa: escape.disclaimerJa,
    size,
  }
}
