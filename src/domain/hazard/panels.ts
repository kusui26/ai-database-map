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
  HazardGroupState,
  HazardGroupStateKind,
  HazardItem,
  PanelSize,
  SourceRef,
} from '@/shared/protocol'
import { ALERT_LEVEL_LABELS_JA, type HazardGroup } from '@/shared/constants'
import { evacuationDisasterLabelJa, type EvacuationDisasterKey } from '@/shared/evacuation'
import { getHazardLayer } from '@/shared/hazard'
import { type JmaWarningKind } from '@/shared/jma'
import { jstDateTimeJa, parseIso } from '@/shared/time'
import { escapeDirectionAvailable } from './escape'
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
    // 種類ごとの状態・畳まない注意・固有の事実（261110 §8.4）。古い応答（キャッシュ）には無く、
    // そのときは 3 つとも undefined のまま渡る——描く側は「無ければ今の描き方」にする。
    groupStates: point.groupStates,
    keyNotesJa: point.keyNotesJa,
    highlightsJa: point.highlightsJa,
    sources: point.sources,
    disclaimerJa: point.disclaimerJa,
    size,
  }
}

// --- 地点のカード：固有の注意を見せ、一般論は畳む（`docs/261110_fix_PLAN.md` §8.3） ---------

/** 該当しなかった種類の 1 行（「該当なし：内水（雨水出水）・津波」）。 */
export type GroupStateLine = {
  readonly state: HazardGroupStateKind
  readonly stateJa: string
  /** 種類の名前を「・」でつないだもの。すぐ近くのときは距離感を括弧で添える（「洪水（隣の 250m メッシュ）」）。 */
  readonly groupsJa: string
}

/**
 * 行にする順（すぐ近く → 該当なし → 図なし → 未確認）。**該当の種類は行にしない**——該当の行（`items`）が
 * 値つきで言っている。5 種類はどれも、該当の行かここの行のどちらかに必ず出る。
 */
const GROUP_LINE_ORDER: readonly HazardGroupStateKind[] = ['nearby', 'none', 'uncovered', 'unknown']

function groupNameJa(state: HazardGroupState): string {
  return state.proximityJa === null ? state.labelJa : `${state.labelJa}（${state.proximityJa}）`
}

/** 種類ごとの状態 → 状態ごとの 1 行（言い方はサーバの `stateJa`・`labelJa`・`proximityJa` をつなぐだけ）。 */
export function groupStateLines(states: readonly HazardGroupState[]): readonly GroupStateLine[] {
  return GROUP_LINE_ORDER.flatMap((kind) => {
    const members = states.filter((each) => each.state === kind)
    const [first] = members
    if (first === undefined) return []
    return [{ state: kind, stateJa: first.stateJa, groupsJa: members.map(groupNameJa).join('・') }]
  })
}

/**
 * 畳む中身の見出し。押すと、規則ごとの根拠と、レイヤごとの一般論・メッシュの注記・取れなかったものが開く
 * （`docs/260824_flood.md` §7.5-2 の 2026-11-11 追記）。**1 行も捨てない**——数も見出しに出す。
 */
export const HAZARD_DETAILS_TITLE_JA = '根拠と注意'
export const HAZARD_REASONS_TITLE_JA = '根拠'
export const HAZARD_NOTES_TITLE_JA = '注意'

export function hazardDetailsSummaryJa(count: number): string {
  return `${HAZARD_DETAILS_TITLE_JA}（${count}）`
}

/**
 * 畳む根拠。川の到達・継続（`highlightsJa`）は該当の行のすぐ下に見せるので、ここからは外す——同じ文を 2 回言わない。
 * `highlightsJa` は根拠の末尾と**同じ文**として作っている（`domain/hazard/point.ts` の `groupFieldsOf`）。
 */
export function reasonsBesideHighlightsJa(
  reasonsJa: readonly string[],
  highlightsJa: readonly string[],
): readonly string[] {
  const shown = new Set(highlightsJa)
  return reasonsJa.filter((reason) => !shown.has(reason))
}

/**
 * 駅の災害の値（駅の代表点 1 点の照会）に必ず添える限界。駅詳細の災害タブの末尾と、会話の駅プロフィール
 * （`domain/profile/hazard.ts`）が同じ定数を読む（以前はヘッダのバッジの下・2026-11-11 にバッジを外した）。
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
 * 駅詳細の災害タブの見出しも、会話の駅プロフィールも**この定数を使う**——別々に書くと必ずずれる。
 *
 * 「いま」の段には注記を付けない（2026-11-11・`docs/261110_fix_PLAN.md` §8.2）——すぐ下の 1 行が
 * 「気象庁 ◯月◯日 ◯:◯ 発表」と言うので、「気象庁がいま発表しているもの」は同じことの 2 回目になる。
 */
export const HAZARD_TENSE_NOW_JA = 'いま'
export const HAZARD_TENSE_ASSUMED_JA = 'もし起きたら'
export const HAZARD_TENSE_ASSUMED_NOTE_JA =
  '想定される最大級の被害。いま起きていることではありません。'

/**
 * 平時の「いま」の限界の短い形（`docs/261110_fix_PLAN.md` §8.3 の注）。
 * 応答の `limitationsJa`（`ALERT_LIMITATION_JA`・AI にも渡る長い文）は変えない——画面の 1 行に収めるための言い方で、
 * 言うことは同じ（避難情報を出すのは市町村で、ここでは分からない）。**消さずに短くする。**
 */
export const ALERT_LIMITATION_SHORT_JA =
  '避難情報（避難指示など）は市町村が出します。ここでは分かりません。'

/**
 * 平時の「いま」の 2 行目（発表の時刻と、限界の短い形）。
 * 時刻が無い（気象庁の発表を確かめられなかった）ときも、限界は言う。**10 分前の情報を「今」と言わない**ため、
 * 時刻は日本時間で必ず出す（`reportedAtJa` と同じ規則）。
 */
export function calmNowNoteJa(reportedAt: string | null): string {
  const epochMs = reportedAt === null ? null : parseIso(reportedAt)
  const reported = epochMs === null ? null : `気象庁 ${jstDateTimeJa(epochMs)} 発表`
  return [reported, ALERT_LIMITATION_SHORT_JA]
    .filter((part): part is string => part !== null)
    .join(' ／ ')
}

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
 * （`hazards` は重い順）。
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
export const HAZARD_ESCAPE_CLOSE_JA = '閉じる'

/**
 * 「逃げる」のボタン。**どの災害の話かをボタンに書く**（種別を黙って選ばない・`docs/261110_fix_PLAN.md` §8.3）
 * ——以前は段の注記（「いちばん重い想定（洪水）に対応した…押したときだけ調べます。」）が言っていた。
 * 区域の外へ出る向きはメッシュを持つ災害（洪水・内水）でしか出せないので、**出せないものは約束しない**。
 */
export function hazardEscapeOpenJa(disaster: EvacuationDisasterKey): string {
  const labelJa = evacuationDisasterLabelJa(disaster)
  return escapeDirectionAvailable(disaster)
    ? `${labelJa}の避難先と、区域の外へ出る向きを調べる`
    : `${labelJa}の避難先を調べる`
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
    // 値に警戒レベル相当が入っている（平時の「想定区域外」「警戒」を括弧で添えない・2026-10-15）
    levelLabelJa: null,
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
    levelLabelJa: null,
    color: null,
    source: 'jma',
    coverage: null,
    certainty: 'exact',
  }
}

/** 発表を確かめられなかったときのバッジ（「発表なし」と読ませない）。 */
export const ALERT_UNCONFIRMED_LABEL_JA = '未確認'

/** 警戒レベルの体系の外の発表（暴風警報・雷注意報など）の言い方。重い種別から順に見る。 */
const OUT_OF_SCALE_BADGES_JA: readonly (readonly [JmaWarningKind, string])[] = [
  ['特別警報', '特別警報あり'],
  ['警報', '警報あり'],
  ['注意報', '注意報あり'],
]

/** 警戒レベル相当が付かない発表があるときのバッジ（いちばん重い種別・種別の分からない発表は「発表あり」）。 */
function outOfScaleBadgeJa(warnings: readonly HazardAlertWarning[]): string | null {
  if (warnings.length === 0) return null
  const found = OUT_OF_SCALE_BADGES_JA.find(([kind]) => warnings.some((w) => w.kindJa === kind))
  return found === undefined ? '発表あり' : found[1]
}

/**
 * 警報のカードのバッジ（2026-10-15）。**警戒バナーと同じ言い方**（「警戒レベル3相当」）にする——平時のハザードマップの
 * 言い方（「想定区域外」）は警報に当たらない。
 *
 * - 警戒レベル相当がある →「警戒レベル◯相当」（**分かっている重い発表は、時刻が無くても先に出す**——「未確認」で隠さない）
 * - 発表時刻が無い：気象庁の発表を確かめられなかった（区域が決まらない・表が取れない・名前で場所を決められない）→「未確認」
 * - 警戒レベルの体系の外の発表だけ（暴風警報・雷注意報）→「警報あり」「注意報あり」——**レベル 0 を「発表なし」と言わない**
 *   （暴風警報が出ていても「発表なし」と読める）
 * - 何も出ていない →「発表なし」
 */
export function alertBadgeJa(alerts: HazardAlertsResponse): string {
  if (alerts.alertLevel > 0) return ALERT_LEVEL_LABELS_JA[alerts.alertLevel]
  if (alerts.reportedAt === null) return ALERT_UNCONFIRMED_LABEL_JA
  return outOfScaleBadgeJa(alerts.warnings) ?? ALERT_LEVEL_LABELS_JA[0]
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
    placeJa: alerts.placeJa,
    level: alerts.level,
    levelLabelJa: alertBadgeJa(alerts),
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

// --- 出典の束ね方（`docs/260828_fix_flood.md` §11・案 C） -------------------

/**
 * 表示用に束ねた出典の 1 行。
 *
 * - `url` が付くのは**束ねる相手がいない従来どおりの 1 行**（ラベル自身がリンク）
 * - 束ねたときは `url` を `null` にし、`links` に**名前つきリンク**を並べる
 *   （名前は `SourceRef.forJa`。例「洪水」「高潮」）
 */
export type BundledSource = {
  readonly labelJa: string
  readonly url: string | null
  readonly links: readonly { readonly textJa: string; readonly url: string }[]
}

/**
 * 出典の一覧 → 表示の行（**`labelJa` で束ねる**）。
 *
 * 出典の 1 件は「法的な出典表示」と「凡例へのリンク」の 2 つの仕事をしていて、
 * 後者のために前者を繰り返すのが §11 の不具合だった。ここで文を 1 回に畳み、
 * **リンクは 1 本も落とさない**（`source` と `legendUrl` が 1:1 なので束ねても失われない）。
 *
 * 束ねたあとのラベルは重複しえないので、**React の key にそのまま使える**
 * （3 パネルが同じ `<li key={labelJa}>` を書き写して同じ壊れ方をしていた・§11.5）。
 */
export function bundledSources(sources: readonly SourceRef[]): readonly BundledSource[] {
  const byLabel = new Map<string, SourceRef[]>()
  for (const source of sources) {
    const rows = byLabel.get(source.labelJa) ?? []
    // 完全に同じ（URL も名前も同じ）行だけ畳む。URL が違えば別のリンクなので残す。
    if (!rows.some((row) => row.url === source.url && row.forJa === source.forJa)) {
      rows.push(source)
    }
    byLabel.set(source.labelJa, rows)
  }
  return [...byLabel.entries()].map(([labelJa, rows]) => {
    const single = rows.length === 1 ? rows[0] : undefined
    if (single !== undefined && single.forJa === null) {
      return { labelJa, url: single.url, links: [] }
    }
    return {
      labelJa,
      url: null,
      links: rows.flatMap((row) =>
        row.url === null
          ? []
          : // `forJa` の無い行が束に混ざるのは今のデータでは起きない（層由来は必ず持ち、
            // API 由来はラベルが一意）。起きても黙って落とさないための受け皿。
            [{ textJa: row.forJa ?? '詳細', url: row.url }],
      ),
    }
  })
}
