/**
 * 路線（運行系統・駅データ.jp）の名前の解決のテスト用の一覧（2026-10-08 L3）。
 *
 * 本物の一覧（`/api/lines`・2026-10-08）から、問いに要る路線だけを写した。名前・正式名・事業者名・略称・
 * S12 の会社名・駅数・都道府県は実データのまま。地図の範囲は、本物の駅の座標で確かめた「首都圏・大阪・名古屋の
 * 初期表示（ズーム 9）に駅があるか」を手で写したもの（`REGIONS`）。
 */

import { type LineRow } from '@/db/queries'
import { type NameResolveDeps } from '@/ai/routes/resolve'
import { buildNameIndex } from '@/ai/routes/match'
import { type CatalogLegalRoute, type CatalogLine, type CatalogOperator } from '@/ai/routes/names'
import { sameViewport, type Viewport } from '@/shared/viewport'

type Company = Pick<CatalogLine, 'companyName' | 'companyShort' | 'operator'>

const JR_EAST: Company = {
  companyName: 'JR東日本',
  companyShort: 'JR東日本',
  operator: '東日本旅客鉄道',
}
const JR_CENTRAL: Company = {
  companyName: 'JR東海',
  companyShort: 'JR東海',
  operator: '東海旅客鉄道',
}
const JR_WEST: Company = {
  companyName: 'JR西日本',
  companyShort: 'JR西日本',
  operator: '西日本旅客鉄道',
}
const TOKYO_METRO: Company = {
  companyName: '東京メトロ',
  companyShort: '東京メトロ',
  operator: '東京地下鉄',
}
const TOEI: Company = {
  companyName: '東京都交通局',
  companyShort: '東京都交通局',
  operator: '東京都',
}
const SEIBU: Company = { companyName: '西武鉄道', companyShort: '西武', operator: '西武鉄道' }
const TOKYU: Company = { companyName: '東急電鉄', companyShort: '東急', operator: '東急電鉄' }
const TOBU: Company = { companyName: '東武鉄道', companyShort: '東武', operator: '東武鉄道' }
const KEIO: Company = { companyName: '京王電鉄', companyShort: '京王', operator: '京王電鉄' }
const ODAKYU: Company = {
  companyName: '小田急電鉄',
  companyShort: '小田急',
  operator: '小田急電鉄',
}
const KEIKYU: Company = { companyName: '京急電鉄', companyShort: '京急', operator: '京浜急行電鉄' }
const OSAKA_METRO: Company = {
  companyName: 'Osaka Metro',
  companyShort: '大阪メトロ',
  operator: '大阪市高速電気軌道',
}
const KOBE_CITY: Company = {
  companyName: '神戸市交通局',
  companyShort: '神戸市交通局',
  operator: '神戸市',
}
const KOBE_RAPID: Company = {
  companyName: '神戸高速鉄道',
  companyShort: '神戸高速',
  operator: null,
}

function line(
  lineCd: number,
  name: string,
  company: Company,
  stationCount: number,
  prefectures: readonly string[],
  formalName: string = name,
): CatalogLine {
  return { lineCd, name, formalName, ...company, stationCount, prefectures }
}

export const LINES: readonly CatalogLine[] = [
  line(11302, 'JR山手線', JR_EAST, 30, ['東京都']),
  line(99646, '神戸市営地下鉄山手線', KOBE_CITY, 8, ['兵庫県']),
  line(11312, 'JR中央線(快速)', JR_EAST, 24, ['東京都']),
  line(11311, 'JR中央本線(東京～塩尻)', JR_EAST, 53, ['山梨県', '長野県', '東京都', '神奈川県']),
  line(11411, 'JR中央本線(名古屋～塩尻)', JR_CENTRAL, 40, ['長野県', '岐阜県', '愛知県']),
  line(99621, '大阪メトロ中央線', OSAKA_METRO, 15, ['大阪府'], '高速電気軌道第4号線'),
  line(28004, '東京メトロ東西線', TOKYO_METRO, 23, ['東京都', '千葉県']),
  line(
    99101,
    '札幌市営地下鉄東西線',
    { companyName: '札幌市交通局', companyShort: '札幌市交通局', operator: '札幌市' },
    19,
    ['北海道'],
  ),
  line(
    99218,
    '仙台市営地下鉄東西線',
    { companyName: '仙台市交通局', companyShort: '仙台市交通局', operator: '仙台市' },
    13,
    ['宮城県'],
  ),
  line(
    99611,
    '京都市営地下鉄東西線',
    { companyName: '京都市交通局', companyShort: '京都市交通局', operator: '京都市' },
    17,
    ['京都府'],
  ),
  line(11625, 'JR東西線', JR_WEST, 9, ['大阪府', '兵庫県']),
  line(99630, '神戸高速東西線', KOBE_RAPID, 9, ['兵庫県']),
  line(28009, '東京メトロ南北線', TOKYO_METRO, 19, ['東京都']),
  line(99631, '神戸高速南北線', KOBE_RAPID, 2, ['兵庫県']),
  line(
    99614,
    '北大阪急行電鉄',
    { companyName: '北大阪急行電鉄', companyShort: '北急', operator: '北大阪急行電鉄' },
    6,
    ['大阪府'],
  ),
  line(99304, '都営新宿線', TOEI, 21, ['東京都', '千葉県']),
  line(22007, '西武新宿線', SEIBU, 29, ['東京都', '埼玉県']),
  line(99303, '都営三田線', TOEI, 27, ['東京都']),
  line(
    99633,
    '三田線',
    { companyName: '神戸電鉄', companyShort: '神鉄', operator: '神戸電鉄' },
    10,
    ['兵庫県'],
    '神鉄三田線',
  ),
  line(99302, '都営浅草線', TOEI, 20, ['東京都']),
  line(99305, '東京さくらトラム（都電荒川線）', TOEI, 30, ['東京都'], '都営都電荒川線'),
  line(28006, '東京メトロ有楽町線', TOKYO_METRO, 24, ['東京都', '埼玉県']),
  line(22003, '西武有楽町線', SEIBU, 3, ['東京都']),
  line(28002, '東京メトロ丸ノ内線', TOKYO_METRO, 28, ['東京都']),
  line(28010, '東京メトロ副都心線', TOKYO_METRO, 16, ['東京都', '埼玉県']),
  line(26001, '東急東横線', TOKYU, 21, ['神奈川県', '東京都']),
  line(26006, '東急多摩川線', TOKYU, 7, ['東京都']),
  line(22012, '西武多摩川線', SEIBU, 6, ['東京都']),
  line(11319, '宇都宮線', JR_EAST, 34, ['栃木県', '埼玉県', '東京都', '茨城県'], 'JR東北本線'),
  line(11231, 'JR東北本線(黒磯～利府・盛岡)', JR_EAST, 85, [
    '宮城県',
    '福島県',
    '岩手県',
    '栃木県',
  ]),
  line(21008, '東武宇都宮線', TOBU, 12, ['栃木県']),
  line(21002, '東武伊勢崎線', TOBU, 55, ['埼玉県', '東京都', '群馬県', '栃木県']),
  line(21004, '東武野田線', TOBU, 35, ['千葉県', '埼玉県']),
  line(11301, 'JR東海道本線(東京～熱海)', JR_EAST, 21, ['神奈川県', '東京都', '静岡県']),
  line(11501, 'JR東海道本線(熱海～浜松)', JR_CENTRAL, 35, ['静岡県']),
  line(11601, '琵琶湖線', JR_WEST, 20, ['滋賀県', '京都府'], 'JR東海道本線(米原～京都)'),
  line(11602, 'JR京都線', JR_WEST, 17, ['大阪府', '京都府'], 'JR東海道本線(京都～大阪)'),
  line(
    11603,
    'JR神戸線(大阪～神戸)',
    JR_WEST,
    17,
    ['兵庫県', '大阪府'],
    'JR東海道本線(大阪～神戸)',
  ),
  line(11608, 'JR神戸線(神戸～姫路)', JR_WEST, 23, ['兵庫県'], 'JR山陽本線(神戸～姫路)'),
  line(11609, 'JR山陽本線(姫路～岡山)', JR_WEST, 19, ['岡山県', '兵庫県']),
  line(11623, '大阪環状線', JR_WEST, 19, ['大阪府']),
  line(1002, '東海道新幹線', JR_CENTRAL, 17, [
    '静岡県',
    '愛知県',
    '東京都',
    '神奈川県',
    '京都府',
    '大阪府',
  ]),
  line(11313, 'JR中央・総武線', JR_EAST, 39, ['東京都', '千葉県'], 'JR中央・総武緩行線'),
  line(11314, 'JR総武本線', JR_EAST, 31, ['千葉県', '東京都']),
  line(
    34001,
    '阪急神戸本線',
    { companyName: '阪急電鉄', companyShort: '阪急', operator: '阪急電鉄' },
    16,
    ['兵庫県', '大阪府'],
  ),
  line(24001, '京王線', KEIO, 32, ['東京都']),
  line(24006, '京王井の頭線', KEIO, 17, ['東京都']),
  line(24002, '京王相模原線', KEIO, 12, ['東京都', '神奈川県']),
  line(25001, '小田急線', ODAKYU, 47, ['神奈川県', '東京都'], '小田急小田原線'),
  line(25002, '小田急江ノ島線', ODAKYU, 17, ['神奈川県']),
  line(27001, '京急本線', KEIKYU, 50, ['神奈川県', '東京都']),
  line(27002, '京急空港線', KEIKYU, 7, ['東京都']),
  line(
    99808,
    '伊予鉄道環状線（１系統）',
    { companyName: '伊予鉄道', companyShort: '伊予鉄', operator: '伊予鉄道' },
    21,
    ['愛媛県'],
    '伊予鉄道１系統',
  ),
  line(
    99809,
    '伊予鉄道環状線（２系統）',
    { companyName: '伊予鉄道', companyShort: '伊予鉄', operator: '伊予鉄道' },
    21,
    ['愛媛県'],
    '伊予鉄道２系統',
  ),
  line(
    30001,
    '名鉄名古屋本線',
    { companyName: '名古屋鉄道', companyShort: '名鉄', operator: '名古屋鉄道' },
    60,
    ['愛知県', '岐阜県'],
  ),
  line(
    31027,
    '近鉄名古屋線',
    { companyName: '近畿日本鉄道', companyShort: '近鉄', operator: '近畿日本鉄道' },
    44,
    ['三重県', '愛知県'],
  ),
]

/** S12 の会社の一覧（名前だけ使う）。 */
export const OPERATORS: readonly CatalogOperator[] = [
  ...new Set(LINES.flatMap((row) => (row.operator === null ? [] : [row.operator]))),
].map((name) => ({ name, stationCount: 10, prefectures: [] }))

/**
 * 法令上の路線（S12）。会社名を含むのが正式名の路線（西武有楽町線・東急多摩川線・JR東西線）と、
 * 含まない路線（西武の「多摩川線」「新宿線」・東急の「東横線」）。
 */
export const LEGAL_ROUTES: readonly CatalogLegalRoute[] = [
  { route: '西武有楽町線', operators: ['西武鉄道'] },
  { route: '多摩川線', operators: ['西武鉄道'] },
  { route: '新宿線', operators: ['西武鉄道'] },
  { route: '東急多摩川線', operators: ['東急電鉄'] },
  { route: '東横線', operators: ['東急電鉄'] },
  { route: 'JR東西線', operators: ['西日本旅客鉄道'] },
  { route: '東西線', operators: ['京都市', '仙台市', '札幌市'] },
  { route: '5号線東西線', operators: ['東京地下鉄'] },
]

export const INDEX = buildNameIndex({
  lines: LINES,
  operators: OPERATORS,
  legalRoutes: LEGAL_ROUTES,
})

/** 地図の初期表示（ズーム 9・幅 1440px）の範囲（`shared/viewport.ts` と同じく外向きに丸めた値）。 */
export const VIEW = {
  tokyo: { west: 138.78, south: 35.21, east: 140.76, north: 36.15 },
  osaka: { west: 134.51, south: 34.23, east: 136.48, north: 35.18 },
  nagoya: { west: 135.89, south: 34.7, east: 137.87, north: 35.64 },
} as const satisfies Readonly<Record<string, Viewport>>

type Region = keyof typeof VIEW
const REGION_NAMES: readonly Region[] = ['tokyo', 'osaka', 'nagoya']

/** 路線ごとに、駅のある表示範囲（本物の駅の座標で確かめたもの）。 */
const REGIONS: Readonly<Record<number, readonly Region[]>> = {
  11302: ['tokyo'],
  99646: ['osaka'],
  11312: ['tokyo'],
  11311: ['tokyo'],
  11411: ['nagoya'],
  99621: ['osaka'],
  28004: ['tokyo'],
  99611: ['osaka'],
  11625: ['osaka'],
  99630: ['osaka'],
  28009: ['tokyo'],
  99631: ['osaka'],
  99614: ['osaka'],
  99304: ['tokyo'],
  22007: ['tokyo'],
  99303: ['tokyo'],
  99633: ['osaka'],
  99302: ['tokyo'],
  99305: ['tokyo'],
  28006: ['tokyo'],
  22003: ['tokyo'],
  28002: ['tokyo'],
  28010: ['tokyo'],
  26001: ['tokyo'],
  26006: ['tokyo'],
  22012: ['tokyo'],
  11319: ['tokyo'],
  21002: ['tokyo'],
  21004: ['tokyo'],
  11301: ['tokyo'],
  11501: ['nagoya'],
  11601: ['osaka', 'nagoya'],
  11602: ['osaka'],
  11603: ['osaka'],
  11608: ['osaka'],
  11609: ['osaka'],
  11623: ['osaka'],
  1002: ['tokyo', 'osaka', 'nagoya'],
  11313: ['tokyo'],
  11314: ['tokyo'],
  34001: ['osaka'],
  24001: ['tokyo'],
  24006: ['tokyo'],
  24002: ['tokyo'],
  25001: ['tokyo'],
  25002: ['tokyo'],
  27001: ['tokyo'],
  27002: ['tokyo'],
  30001: ['nagoya'],
  31027: ['nagoya'],
}

function regionOf(viewport: Viewport): Region | null {
  return REGION_NAMES.find((name) => sameViewport(VIEW[name], viewport)) ?? null
}

const BY_CODE: ReadonlyMap<number, CatalogLine> = new Map(LINES.map((row) => [row.lineCd, row]))

/** 路線（束ね）の駅が範囲の中にあるか（`REGIONS` から・知らない範囲は「無い」）。 */
export function hasStationsInView(codes: readonly number[], viewport: Viewport): boolean {
  const region = regionOf(viewport)
  return region !== null && codes.some((code) => (REGIONS[code] ?? []).includes(region))
}

/** 路線（束ね）の駅の数。区間の境の駅は 1 つと数える（束ねた本数 − 1 を引く）。 */
export function stationCountOf(codes: readonly number[]): number {
  const total = codes.reduce((sum, code) => sum + (BY_CODE.get(code)?.stationCount ?? 0), 0)
  return total - Math.max(codes.length - 1, 0)
}

/** 本番の依存の代わり（呼ばれた回数つき）。 */
export function fakeDeps(): NameResolveDeps & {
  readonly calls: { index: number; count: number; inView: number }
} {
  const calls = { index: 0, count: 0, inView: 0 }
  return {
    calls,
    index: async () => {
      calls.index += 1
      return INDEX
    },
    countStations: async (codes) => {
      calls.count += 1
      return stationCountOf(codes)
    },
    hasStationsIn: async (codes, viewport) => {
      calls.inView += 1
      return hasStationsInView(codes, viewport)
    },
  }
}

/** `line_names()` の行（DB の形・照合に使わない列は既定値）。ツールのテストで DB を差し替えるのに使う。 */
export function lineRows(): LineRow[] {
  return LINES.map((row) => ({
    ...row,
    color: null,
    colorName: null,
    lineType: 2,
    isLoop: false,
    source: '駅データ.jp 2024-04-26',
  }))
}
