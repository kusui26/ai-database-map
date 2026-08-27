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
import { jmaMunicipality, type JmaMunicipality } from '@/shared/jma'
import type { HazardAlertsResponse, HazardAlertArea } from '@/shared/api'
import type { SourceRef } from '@/shared/protocol'
import {
  ALERT_LIMITATION_JA,
  alertHeadlineJa,
  alertReasonsJa,
  hazardLevelOfAlert,
  heaviestAlertLevel,
  toAlertWarning,
  type AlertWarning,
} from '@/domain/hazard/level'
import { jmaWarningMap, municipalityCodeAt, type WarningMap } from './jma'

/** 呼び名の既定。 */
export const DEFAULT_PLACE_JA = 'この地点'

const SOURCES: readonly SourceRef[] = [
  {
    labelJa: '出典：気象庁 気象警報・注意報',
    url: 'https://www.jma.go.jp/bosai/warning/',
    license: '気象庁 公共データ利用規約（第1.0版）',
  },
  {
    labelJa: '出典：国土地理院 逆ジオコーディング',
    url: 'https://maps.gsi.go.jp/',
    license: '国土地理院コンテンツ利用規約',
  },
]

export type HazardAlertRequest = {
  readonly lon: number
  readonly lat: number
  readonly placeJa?: string
  /** 60 秒キャッシュの窓に使う現在時刻（テストで固定できるように引数で受ける）。 */
  readonly now: number
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

/** 発表時刻（複数区域なら最初に見つかったもの。同じ官署なので実質 1 つ）。 */
function reportedAtOf(municipality: JmaMunicipality, map: WarningMap): string | null {
  return (
    municipality.areas.map((area) => map.get(area.code)?.reportedAt).find((at) => at != null) ??
    null
  )
}

/** 市区町村が決まらなかったとき（海上・国外）の応答。**沈黙させない**。 */
function unresolved(
  request: HazardAlertRequest,
  placeJa: string,
  noteJa: string,
): HazardAlertsResponse {
  return {
    point: { lon: request.lon, lat: request.lat, placeJa },
    area: null,
    alertLevel: 0,
    level: 'none',
    headlineJa: `${placeJa}は、気象庁の発表区域を特定できませんでした。`,
    warnings: [],
    reasonsJa: [],
    reportedAt: null,
    limitationsJa: [ALERT_LIMITATION_JA],
    sources: [...SOURCES],
    notesJa: [noteJa],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}

/** その地点の「今」。**警戒レベル相当までしか言わない**（避難情報は市町村が出すもの・§7.4）。 */
export async function hazardAlertsAt(request: HazardAlertRequest): Promise<HazardAlertsResponse> {
  const placeJa = request.placeJa ?? DEFAULT_PLACE_JA
  const [code, map] = await Promise.all([
    municipalityCodeAt(request.lon, request.lat).catch(() => null),
    jmaWarningMap(request.now).catch(() => null),
  ])
  if (code === null)
    return unresolved(
      request,
      placeJa,
      '市区町村を特定できませんでした（海上・国外の可能性があります）',
    )
  const municipality = jmaMunicipality(code)
  if (municipality === undefined) {
    return unresolved(request, placeJa, `気象庁の発表区域に対応がない市区町村です（${code}）`)
  }
  if (map === null) {
    const noArea = unresolved(request, placeJa, '気象庁の警報・注意報を取得できませんでした')
    return { ...noArea, area: toArea(code, municipality) }
  }
  const warnings = warningsFor(municipality, map)
  const alertLevel = heaviestAlertLevel(warnings)
  return {
    point: { lon: request.lon, lat: request.lat, placeJa },
    area: toArea(code, municipality),
    alertLevel,
    level: hazardLevelOfAlert(alertLevel),
    headlineJa: alertHeadlineJa(areaLabelJa(municipality), warnings),
    warnings: [...warnings],
    reasonsJa: [...alertReasonsJa(warnings)],
    reportedAt: reportedAtOf(municipality, map),
    limitationsJa: [ALERT_LIMITATION_JA],
    sources: [...SOURCES],
    notesJa: [],
    disclaimerJa: HAZARD_DISCLAIMER_JA,
  }
}
