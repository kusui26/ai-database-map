/**
 * 「いま、その地点はどうなっているか」を組み立てる（**サーバ専用**・`docs/260824_flood.md` §8.4）。
 *
 * `GET /api/hazard/alerts` と **AI ツール `getHazardAlerts` の両方がここを通る**
 * （`point-source.ts` と同じ流儀。人間UIと AI が同じ答えに辿り着くことを型で保証する）。
 *
 * **判定は警報 JSON を正とする**（決定 5）。キキクルのタイルは表示専用で、色から判定しない（§9.1）。
 * 取れなかったものは黙って捨てず、`notesJa` に理由を書いて**部分的にでも答える**（§6.3）。
 */

import { HAZARD_DISCLAIMER_JA } from '@/shared/hazard'
import { jmaMunicipality, type JmaAreaRef, type JmaMunicipality } from '@/shared/jma'
import type { HazardAlertsResponse, HazardAlertArea } from '@/shared/api'
import type { SourceRef } from '@/shared/protocol'
import { GSI_REVERSE_GEOCODER_SOURCE, JMA_WARNING_SOURCE } from '@/domain/hazard/sources'
import {
  ALERT_LIMITATION_JA,
  alertHeadlineJa,
  alertLevelOfFloodName,
  alertReasonsJa,
  hazardLevelOfAlert,
  heaviestAlertLevel,
  toAlertWarning,
  type AlertWarning,
  type FloodForecastWarning,
} from '@/domain/hazard/level'
import {
  jmaFloodForecasts,
  jmaWarningMap,
  municipalityCodeAt,
  type FloodForecast,
  type WarningMap,
} from './jma'

/** 呼び名の既定。 */
export const DEFAULT_PLACE_JA = 'この地点'

/** 出典は `domain/hazard/sources` が唯一の真実（About と同じものを読む）。 */
const POINT_SOURCES: readonly SourceRef[] = [JMA_WARNING_SOURCE, GSI_REVERSE_GEOCODER_SOURCE]
/** 市区町村の名前で引くときは逆ジオを使わない（出典に載せない）。 */
const NAMED_SOURCES: readonly SourceRef[] = [JMA_WARNING_SOURCE]

export type HazardAlertRequest = {
  readonly lon: number
  readonly lat: number
  readonly placeJa?: string
  /** 60 秒キャッシュの窓に使う現在時刻（テストで固定できるように引数で受ける）。 */
  readonly now: number
}

/**
 * 市区町村コードで引くとき（AI の道具が名前で引く・2026-10-15）。`placeJa` は決めた場所の呼び名（「横浜市港北区」「関内駅」）。
 * 駅の名前で引いたときは、駅の市区町村コードと駅の位置（`point`・地図の印）を渡す——逆ジオを通さない。
 */
export type HazardAlertMunicipalityRequest = {
  readonly code: string
  readonly placeJa: string
  readonly now: number
  readonly point?: { readonly lon: number; readonly lat: number }
}

/**
 * どこの答えか（主語の呼び名と、地点で引いたときの地点）。名前で引いたときは地点を持たない——警報は区域に出るもので、
 * 名前から 1 点を作ると「その点の話」に読める。調べたものだけを出典に載せる。
 */
type AlertWhere = {
  readonly placeJa: string
  readonly point: HazardAlertsResponse['point']
  readonly sources: readonly SourceRef[]
}

function pointWhere(request: HazardAlertRequest): AlertWhere {
  const placeJa = request.placeJa ?? DEFAULT_PLACE_JA
  return { placeJa, point: { lon: request.lon, lat: request.lat, placeJa }, sources: POINT_SOURCES }
}

/** 市区町村 → 応答に載せる形。 */
function toArea(code: string, municipality: JmaMunicipality): HazardAlertArea {
  return {
    municipalityCode: code,
    municipalityJa: municipality.nameJa,
    prefectureJa: municipality.prefectureJa,
    areas: municipality.areas.map((area) => ({ code: area.code, nameJa: area.nameJa })),
  }
}

/**
 * その市区町村を覆う**すべての**二次細分区域の発表を集める。
 * 分割されている市（横浜市北部／南部など）は、どちら側にいるか分からないので**両方**見る
 * ——安全側に倒すのが正しい（§8.4）。
 */
function warningsFor(municipality: JmaMunicipality, map: WarningMap): readonly AlertWarning[] {
  return municipality.areas.flatMap((area) => {
    const found = map.get(area.code)
    if (found === undefined) return []
    return found.warnings.flatMap((row) => {
      const warning = toAlertWarning(row, area.nameJa)
      return warning === null ? [] : [warning]
    })
  })
}

/**
 * 見出しに使う呼び名。**市区町村名ではなく発表区域名**を使う。
 * 警報が出るのは「札幌市」であって「札幌市 中央区」ではないので、区名で言うと発表の主語がずれる。
 */
function areaLabelJa(municipality: JmaMunicipality): string {
  return municipality.areas.map((area) => area.nameJa).join('・')
}

/**
 * 対応表の区域のうち、気象庁の発表（`r8/map.json`）に見当たらないもの。r8 は発表の無い区域も「発表警報・注意報はなし」
 * で並べるので、見当たらないのは**表が古い**ときである（2026-10-15、横浜市など 8 市の区域コードが変わっていて、
 * 1 件も引けないまま「発表なし」と答えていた・`pipeline/build_jma_areas.py`）。
 */
function missingAreas(municipality: JmaMunicipality, map: WarningMap): readonly JmaAreaRef[] {
  return municipality.areas.filter((area) => !map.has(area.code))
}

/** 見当たらない区域の注記。**確かめていない区域を「発表なし」に数えない。** */
function missingNoteJa(missing: readonly JmaAreaRef[]): string {
  const names = missing.map((area) => area.nameJa).join('・')
  return `${names}の発表を気象庁の情報から見つけられず、確かめられていません（区域の対応表が古い可能性があります）。`
}

/** 表が古いことを運用に知らせる（答えは注記で正直に返すが、直すのはデータ）。 */
function reportMissingAreas(code: string, missing: readonly JmaAreaRef[]): void {
  const codes = missing.map((area) => area.code).join(',')
  console.error(
    `気象庁の発表に区域が見当たりません（市区町村 ${code}・区域 ${codes}）。pipeline/build_jma_areas.py で対応表を作り直してください`,
  )
}

/** 発表時刻（複数区域なら最初に見つかったもの。同じ官署なので実質 1 つ）。 */
function reportedAtOf(municipality: JmaMunicipality, map: WarningMap): string | null {
  return (
    municipality.areas.map((area) => map.get(area.code)?.reportedAt).find((at) => at != null) ??
    null
  )
}

/**
 * その市区町村の区域を対象にした指定河川洪水予報。
 * `class20Codes` を持っているので、区域コードで素直に絞れる。
 */
function floodsFor(
  municipality: JmaMunicipality,
  forecasts: readonly FloodForecast[],
): readonly FloodForecastWarning[] {
  const areaCodes = new Set(municipality.areas.map((area) => area.code))
  return forecasts
    .filter((forecast) => forecast.areaCodes.some((code) => areaCodes.has(code)))
    .map((forecast) => ({
      riverNameJa: forecast.riverNameJa,
      nameJa: forecast.nameJa,
      alertLevel: alertLevelOfFloodName(forecast.nameJa),
      reportedAt: forecast.reportedAt,
    }))
}

/** 市区町村が決まらなかったとき（海上・国外）の応答。**沈黙させない**。 */
function unresolved(where: AlertWhere, noteJa: string): HazardAlertsResponse {
  return {
    placeJa: where.placeJa,
    point: where.point,
    area: null,
    alertLevel: 0,
    level: 'none',
    headlineJa: `${where.placeJa}は、気象庁の発表区域を特定できませんでした。`,
    warnings: [],
    floodForecasts: [],
    reasonsJa: [],
    reportedAt: null,
    limitationsJa: [ALERT_LIMITATION_JA],
    sources: [...where.sources],
    notesJa: [noteJa],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}

/**
 * 逆ジオの結果を**3 つに分ける**。「区域外」と「取れなかった」を混ぜない。
 *
 * 混ぜると、上流が一時的に届かなかっただけの地点に
 * 「海上・国外の可能性があります」と言うことになる（G6・2026-09-16 に本番で起きた）。
 * どちらも答えは出せないが、**利用者が次に取る行動が違う**——前者は諦める、後者は待つ。
 */
type MunicipalityLookup =
  | { readonly kind: 'found'; readonly code: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'failed' }

/**
 * 決まらなかったときの言い方。**知らないことを知っているように書かない。**
 *
 * ⚠ 上流は**海上・国外でも、壊れているときでも同じ `{}`** を返す（実測）。応答から区別が
 * つかない以上、`outside` で「海上・国外です」と断定してはいけない。一方 `failed` は
 * **取得に失敗したと分かっている**ので、そう書ける。
 */
const UNRESOLVED_NOTE_JA = {
  outside:
    '市区町村を特定できませんでした（海上・国外か、一時的に取得できなかった可能性があります）',
  failed: '市区町村を取得できませんでした（一時的な不調の可能性があります）',
} as const satisfies Record<'outside' | 'failed', string>

async function lookupMunicipality(lon: number, lat: number): Promise<MunicipalityLookup> {
  try {
    const code = await municipalityCodeAt(lon, lat)
    return code === null ? { kind: 'outside' } : { kind: 'found', code }
  } catch {
    return { kind: 'failed' }
  }
}

/** 区域が決まり、気象庁の発表も読めたときの「今」。 */
type AreaAlertsInput = {
  readonly where: AlertWhere
  readonly code: string
  readonly municipality: JmaMunicipality
  readonly map: WarningMap
  readonly forecasts: readonly FloodForecast[]
}

/**
 * 対応表の区域が発表に見当たらず、発表も 1 つも拾えなかったとき。**「発表なし」と言わない**——確かめていないだけで、
 * 警報が出ているかもしれない。発表時刻も空にする（「いつの情報で発表なし」とも読ませない）。
 */
function unconfirmed(input: AreaAlertsInput, missing: readonly JmaAreaRef[]): HazardAlertsResponse {
  const { where, code, municipality } = input
  return {
    ...unresolved(where, missingNoteJa(missing)),
    area: toArea(code, municipality),
    headlineJa: `${areaLabelJa(municipality)}の気象庁の発表を確かめられませんでした。`,
  }
}

/** 区域の発表から拾えたもの（見当たらなかった区域も持つ）。 */
type FoundAlerts = {
  readonly warnings: readonly AlertWarning[]
  readonly floods: readonly FloodForecastWarning[]
  readonly missing: readonly JmaAreaRef[]
}

/** 拾えた発表から「今」を組む。見当たらなかった区域があれば注記に書く（拾えた発表は出す）。 */
function reported(input: AreaAlertsInput, found: FoundAlerts): HazardAlertsResponse {
  const { where, code, municipality, map } = input
  const { warnings, floods, missing } = found
  // 河川の予報も同じ物差しで混ぜる（氾濫危険情報は警戒レベル4相当）。
  const alertLevel = heaviestAlertLevel([...warnings, ...floods])
  return {
    placeJa: where.placeJa,
    point: where.point,
    area: toArea(code, municipality),
    alertLevel,
    level: hazardLevelOfAlert(alertLevel),
    headlineJa: alertHeadlineJa(areaLabelJa(municipality), warnings, floods),
    warnings: [...warnings],
    floodForecasts: [...floods],
    reasonsJa: [...alertReasonsJa(warnings, floods)],
    reportedAt: reportedAtOf(municipality, map),
    limitationsJa: [ALERT_LIMITATION_JA],
    sources: [...where.sources],
    notesJa: missing.length === 0 ? [] : [missingNoteJa(missing)],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}

function areaAlerts(input: AreaAlertsInput): HazardAlertsResponse {
  const { code, municipality, map, forecasts } = input
  const warnings = warningsFor(municipality, map)
  const floods = floodsFor(municipality, forecasts)
  const missing = missingAreas(municipality, map)
  if (missing.length > 0) reportMissingAreas(code, missing)
  if (missing.length > 0 && warnings.length === 0 && floods.length === 0) {
    return unconfirmed(input, missing)
  }
  return reported(input, { warnings, floods, missing })
}

/** 気象庁の 2 つの表（警報・注意報と、指定河川洪水予報）。取れなかった警報は null（答えで「取得できない」と言う）。 */
type JmaFeeds = {
  readonly map: WarningMap | null
  readonly forecasts: readonly FloodForecast[]
}

async function jmaFeeds(now: number): Promise<JmaFeeds> {
  const [map, forecasts] = await Promise.all([
    jmaWarningMap(now).catch(() => null),
    jmaFloodForecasts(now).catch(() => []),
  ])
  return { map, forecasts }
}

/** 市区町村が決まったあとの「今」（地点で引いても、名前で引いても同じ道を通る）。 */
function municipalityAlerts(
  where: AlertWhere,
  code: string,
  feeds: JmaFeeds,
): HazardAlertsResponse {
  const municipality = jmaMunicipality(code)
  if (municipality === undefined) {
    return unresolved(where, `気象庁の発表区域に対応がない市区町村です（${code}）`)
  }
  if (feeds.map === null) {
    // 区域は決まっている。取れなかったのは発表のほう（「発表区域を特定できません」と言わない・2026-10-15）。
    return {
      ...unresolved(
        where,
        '気象庁の警報・注意報を取得できませんでした（一時的な不調の可能性があります）',
      ),
      area: toArea(code, municipality),
      headlineJa: `${areaLabelJa(municipality)}の気象庁の発表を取得できませんでした。`,
    }
  }
  return areaAlerts({ where, code, municipality, map: feeds.map, forecasts: feeds.forecasts })
}

/** その地点の「今」。**警戒レベル相当までしか言わない**（避難情報は市町村が出すもの・§7.4）。 */
export async function hazardAlertsAt(request: HazardAlertRequest): Promise<HazardAlertsResponse> {
  const where = pointWhere(request)
  const [lookup, feeds] = await Promise.all([
    lookupMunicipality(request.lon, request.lat),
    jmaFeeds(request.now),
  ])
  if (lookup.kind !== 'found') return unresolved(where, UNRESOLVED_NOTE_JA[lookup.kind])
  return municipalityAlerts(where, lookup.code, feeds)
}

/**
 * 市区町村コードで引いたときの「今」（AI の道具が名前で引く・2026-10-15）。逆ジオを通さず、決めた市区町村コードで直接引く
 * ——警報はもともと区域ごとに出るので、名前から 1 点を作るより正確（形のいびつな市で、隣の市の点を作らない）。
 * 国土地理院の逆ジオが遅いとき（打ち切り 6 秒）にも引ける。
 */
export async function hazardAlertsInMunicipality(
  request: HazardAlertMunicipalityRequest,
): Promise<HazardAlertsResponse> {
  const { point, placeJa } = request
  const where: AlertWhere = {
    placeJa,
    point: point === undefined ? null : { lon: point.lon, lat: point.lat, placeJa },
    sources: NAMED_SOURCES,
  }
  return municipalityAlerts(where, request.code, await jmaFeeds(request.now))
}

/**
 * 名前で場所を決められなかったときの「今」（AI の道具・2026-10-15）。**調べていないと言い**、警報の限界と注意書き
 * （避難は市町村の避難情報に従う）は必ず載せる——「避難した方がいい？」の答えの画面から、この 1 文を落とさない。
 */
export function unlocatedAlerts(placeJa: string, noteJa: string): HazardAlertsResponse {
  return {
    ...unresolved({ placeJa, point: null, sources: [] }, noteJa),
    headlineJa: `「${placeJa}」は場所を決められず、いまの発表を調べていません。`,
  }
}
