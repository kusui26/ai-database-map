/**
 * 画面の路線の選択肢のテストに使う路線（`/api/lines` の本物の値を写したもの・2026-10-08 L4）。
 *
 * 選んだ理由：同じ事業者に複数（JR東日本・東京メトロ・東京都交通局）、名前と正式名が違う
 * （琵琶湖線・大阪メトロ中央線・森と水とロマンの鉄道）、会社の無い路線（神戸高速東西線）、
 * 多くの都道府県を通る路線（北陸新幹線）、東京と大阪の路線。
 */

import { type Line } from '@/shared/api'

type Row = Pick<
  Line,
  | 'lineCd'
  | 'name'
  | 'formalName'
  | 'companyName'
  | 'companyShort'
  | 'operator'
  | 'color'
  | 'lineType'
  | 'stationCount'
  | 'prefectures'
>

function line(row: Row): Line {
  return { ...row, colorName: null, lineTypeLabel: '一般', isLoop: false }
}

const JR_EAST = { companyName: 'JR東日本', companyShort: 'JR東日本', operator: '東日本旅客鉄道' }
const METRO = { companyName: '東京メトロ', companyShort: '東京メトロ', operator: '東京地下鉄' }
const TOEI = { companyName: '東京都交通局', companyShort: '東京都交通局', operator: '東京都' }

export const HOKURIKU = line({
  lineCd: 1009,
  name: '北陸新幹線',
  formalName: '北陸新幹線',
  ...JR_EAST,
  color: '#008000',
  lineType: 1,
  stationCount: 24,
  prefectures: ['長野県', '福井県', '埼玉県', '富山県', '石川県', '新潟県', '東京都', '群馬県'],
})
export const BANETSU_WEST = line({
  lineCd: 11226,
  name: '森と水とロマンの鉄道',
  formalName: 'JR磐越西線',
  ...JR_EAST,
  color: '#CB7B35',
  lineType: 2,
  stationCount: 28,
  prefectures: ['新潟県', '福島県'],
})
export const YAMANOTE = line({
  lineCd: 11302,
  name: 'JR山手線',
  formalName: 'JR山手線',
  ...JR_EAST,
  color: '#80C241',
  lineType: 2,
  stationCount: 30,
  prefectures: ['東京都'],
})
export const CHUO_RAPID = line({
  lineCd: 11312,
  name: 'JR中央線(快速)',
  formalName: 'JR中央線(快速)',
  ...JR_EAST,
  color: '#F15A22',
  lineType: 2,
  stationCount: 24,
  prefectures: ['東京都'],
})
export const BIWAKO = line({
  lineCd: 11601,
  name: '琵琶湖線',
  formalName: 'JR東海道本線(米原～京都)',
  companyName: 'JR西日本',
  companyShort: 'JR西日本',
  operator: '西日本旅客鉄道',
  color: '#0072BC',
  lineType: 2,
  stationCount: 20,
  prefectures: ['滋賀県', '京都府'],
})
export const SEIBU_SHINJUKU = line({
  lineCd: 22007,
  name: '西武新宿線',
  formalName: '西武新宿線',
  companyName: '西武鉄道',
  companyShort: '西武',
  operator: '西武鉄道',
  color: '#00A6C0',
  lineType: 2,
  stationCount: 29,
  prefectures: ['東京都', '埼玉県'],
})
export const GINZA = line({
  lineCd: 28001,
  name: '東京メトロ銀座線',
  formalName: '東京メトロ銀座線',
  ...METRO,
  color: '#F7931D',
  lineType: 3,
  stationCount: 19,
  prefectures: ['東京都'],
})
export const FUKUTOSHIN = line({
  lineCd: 28010,
  name: '東京メトロ副都心線',
  formalName: '東京メトロ副都心線',
  ...METRO,
  color: '#BB6633',
  lineType: 3,
  stationCount: 16,
  prefectures: ['東京都', '埼玉県'],
})
export const TOEI_SHINJUKU = line({
  lineCd: 99304,
  name: '都営新宿線',
  formalName: '都営新宿線',
  ...TOEI,
  color: '#6CBB5A',
  lineType: 3,
  stationCount: 21,
  prefectures: ['東京都', '千葉県'],
})
export const ARAKAWA = line({
  lineCd: 99305,
  name: '東京さくらトラム（都電荒川線）',
  formalName: '都営都電荒川線',
  ...TOEI,
  color: '#B6007A',
  lineType: 4,
  stationCount: 30,
  prefectures: ['東京都'],
})
export const OSAKA_CHUO = line({
  lineCd: 99621,
  name: '大阪メトロ中央線',
  formalName: '高速電気軌道第4号線',
  companyName: 'Osaka Metro',
  companyShort: '大阪メトロ',
  operator: '大阪市高速電気軌道',
  color: '#019A66',
  lineType: 3,
  stationCount: 15,
  prefectures: ['大阪府'],
})
export const KOBE_KOSOKU = line({
  lineCd: 99630,
  name: '神戸高速東西線',
  formalName: '神戸高速東西線',
  companyName: '神戸高速鉄道',
  companyShort: '神戸高速',
  operator: null,
  color: '#2560A8',
  lineType: 2,
  stationCount: 9,
  prefectures: ['兵庫県'],
})

/** `/api/lines` と同じ並び（路線コード順）。 */
export const PICKER_LINES: readonly Line[] = [
  HOKURIKU,
  BANETSU_WEST,
  YAMANOTE,
  CHUO_RAPID,
  BIWAKO,
  SEIBU_SHINJUKU,
  GINZA,
  FUKUTOSHIN,
  TOEI_SHINJUKU,
  ARAKAWA,
  OSAKA_CHUO,
  KOBE_KOSOKU,
]
