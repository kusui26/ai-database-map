/**
 * エリアの要約の固定データ（2026-10-10 B5b）。本物の DB の RPC（`area_rows`・`area_station_stats`・`station_metric_values`）の
 * 応答を写したもの——数は公表値と一致する（横浜市の 2025 年 3,750,952 人・川崎市 1,559,571 人・東急東横線の 1km の沿線は
 * 推計 2020 年 750,165 人 → 2050 年 787,122 人）。浜松市（2024 年の区の再編）・いわき市（浜通り）・紋別市（駅が無い）は
 * 無い値の理由を確かめるために入れてある。内訳の子（区）の値は、内訳が使う 4 つ（人口 2020・2025 と推計 2020・2050）に絞った。
 */

import { type AreaRow, type StationMetricValue, type StationStatRow } from '@/db/queries'
import { type StationRow } from '@/shared/api'

type AreaRowInput = Omit<AreaRow, 'values'> & { readonly values: Readonly<Record<string, number>> }

function areaRow(input: AreaRowInput): AreaRow {
  return { ...input, values: new Map(Object.entries(input.values)) }
}

/** `station_metric_values` の 1 行（grp・値〔無ければ null〕・⚠〔1〕）。 */
type MetricValueTuple = readonly [string, number | null, number]

function metricValues(tuples: readonly MetricValueTuple[]): StationMetricValue[] {
  return tuples.map(([grp, value, flag]) => ({ grp, value, flagged: flag === 1 }))
}

// prettier-ignore
/** 横浜市（政令市）と 18 の区（`area_rows([muni:14100], with_children)`）。 */
export const YOKOHAMA_ROWS: readonly AreaRow[] = [
  areaRow({ key: "muni:14100", kind: "city", code: "14100", lineCd: null, widthM: null, nameJa: "横浜市", labelJa: "神奈川県横浜市", prefecture: "神奈川県", parentKey: "pref:14", groupKey: null, areaKm2: 438.23, missing: [], stationCount: 137, values: { pop_1995: 3307136, pop_2000: 3426651, pop_2005: 3579628, pop_2010: 3688773, pop_2015: 3724844, pop_2020: 3777491, pop_2025: 3750952, emp_n_2012: 1428600, emp_n_2016: 1475974, emp_n_2021: 1527783, estab_n_2012: 114454, estab_n_2016: 114930, estab_n_2021: 116479, pop_pred_2024_2020: 3777490.9992, pop_pred_2024_2025: 3786701.9999, pop_pred_2024_2030: 3756159.0016, pop_pred_2024_2035: 3715508.003, pop_pred_2024_2040: 3664047.9976, pop_pred_2024_2045: 3603784.0002, pop_pred_2024_2050: 3537252.9986, pop_pred_2024_2055: 3458748.9987, pop_pred_2024_2060: 3367079.0034, pop_pred_2024_2065: 3261418.0003, pop_pred_2024_2070: 3150232.9995 } }),
  areaRow({ key: "muni:14101", kind: "ward", code: "14101", lineCd: null, widthM: null, nameJa: "横浜市鶴見区", labelJa: "神奈川県横浜市鶴見区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 33.21, missing: [], stationCount: 12, values: { pop_2020: 297437, pop_2025: 294720, pop_pred_2024_2020: 297436.9999, pop_pred_2024_2050: 304105.9999 } }),
  areaRow({ key: "muni:14102", kind: "ward", code: "14102", lineCd: null, widthM: null, nameJa: "横浜市神奈川区", labelJa: "神奈川県横浜市神奈川区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 23.73, missing: [], stationCount: 15, values: { pop_2020: 247267, pop_2025: 252260, pop_pred_2024_2020: 247267.0006, pop_pred_2024_2050: 249761.9994 } }),
  areaRow({ key: "muni:14103", kind: "ward", code: "14103", lineCd: null, widthM: null, nameJa: "横浜市西区", labelJa: "神奈川県横浜市西区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 7.03, missing: [], stationCount: 7, values: { pop_2020: 104935, pop_2025: 108145, pop_pred_2024_2020: 104935.0001, pop_pred_2024_2050: 114296.0001 } }),
  areaRow({ key: "muni:14104", kind: "ward", code: "14104", lineCd: null, widthM: null, nameJa: "横浜市中区", labelJa: "神奈川県横浜市中区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 22.01, missing: [], stationCount: 9, values: { pop_2020: 151388, pop_2025: 154681, pop_pred_2024_2020: 151388.0003, pop_pred_2024_2050: 149934.9995 } }),
  areaRow({ key: "muni:14105", kind: "ward", code: "14105", lineCd: null, widthM: null, nameJa: "横浜市南区", labelJa: "神奈川県横浜市南区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 12.65, missing: [], stationCount: 7, values: { pop_2020: 198157, pop_2025: 198470, pop_pred_2024_2020: 198156.9997, pop_pred_2024_2050: 176497 } }),
  areaRow({ key: "muni:14106", kind: "ward", code: "14106", lineCd: null, widthM: null, nameJa: "横浜市保土ケ谷区", labelJa: "神奈川県横浜市保土ケ谷区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 21.93, missing: [], stationCount: 6, values: { pop_2020: 207811, pop_2025: 203619, pop_pred_2024_2020: 207810.9998, pop_pred_2024_2050: 188739.0001 } }),
  areaRow({ key: "muni:14107", kind: "ward", code: "14107", lineCd: null, widthM: null, nameJa: "横浜市磯子区", labelJa: "神奈川県横浜市磯子区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 19.02, missing: [], stationCount: 6, values: { pop_2020: 166731, pop_2025: 163579, pop_pred_2024_2020: 166731.0006, pop_pred_2024_2050: 150822.9996 } }),
  areaRow({ key: "muni:14108", kind: "ward", code: "14108", lineCd: null, widthM: null, nameJa: "横浜市金沢区", labelJa: "神奈川県横浜市金沢区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 30.95, missing: [], stationCount: 17, values: { pop_2020: 198939, pop_2025: 192098, pop_pred_2024_2020: 198939.0003, pop_pred_2024_2050: 151903.0006 } }),
  areaRow({ key: "muni:14109", kind: "ward", code: "14109", lineCd: null, widthM: null, nameJa: "横浜市港北区", labelJa: "神奈川県横浜市港北区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 31.4, missing: [], stationCount: 13, values: { pop_2020: 358530, pop_2025: 363598, pop_pred_2024_2020: 358529.9998, pop_pred_2024_2050: 377644.0006 } }),
  areaRow({ key: "muni:14110", kind: "ward", code: "14110", lineCd: null, widthM: null, nameJa: "横浜市戸塚区", labelJa: "神奈川県横浜市戸塚区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 35.79, missing: [], stationCount: 3, values: { pop_2020: 283709, pop_2025: 280226, pop_pred_2024_2020: 283708.9989, pop_pred_2024_2050: 271987.9991 } }),
  areaRow({ key: "muni:14111", kind: "ward", code: "14111", lineCd: null, widthM: null, nameJa: "横浜市港南区", labelJa: "神奈川県横浜市港南区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 19.9, missing: [], stationCount: 5, values: { pop_2020: 215248, pop_2025: 209454, pop_pred_2024_2020: 215247.9989, pop_pred_2024_2050: 177351.0001 } }),
  areaRow({ key: "muni:14112", kind: "ward", code: "14112", lineCd: null, widthM: null, nameJa: "横浜市旭区", labelJa: "神奈川県横浜市旭区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 32.73, missing: [], stationCount: 4, values: { pop_2020: 245174, pop_2025: 239504, pop_pred_2024_2020: 245174, pop_pred_2024_2050: 209947.9997 } }),
  areaRow({ key: "muni:14113", kind: "ward", code: "14113", lineCd: null, widthM: null, nameJa: "横浜市緑区", labelJa: "神奈川県横浜市緑区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 25.51, missing: [], stationCount: 4, values: { pop_2020: 183082, pop_2025: 181166, pop_pred_2024_2020: 183081.9998, pop_pred_2024_2050: 175764.0002 } }),
  areaRow({ key: "muni:14114", kind: "ward", code: "14114", lineCd: null, widthM: null, nameJa: "横浜市瀬谷区", labelJa: "神奈川県横浜市瀬谷区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 17.17, missing: [], stationCount: 2, values: { pop_2020: 122623, pop_2025: 120301, pop_pred_2024_2020: 122622.9995, pop_pred_2024_2050: 97706.0008 } }),
  areaRow({ key: "muni:14115", kind: "ward", code: "14115", lineCd: null, widthM: null, nameJa: "横浜市栄区", labelJa: "神奈川県横浜市栄区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 18.52, missing: [], stationCount: 1, values: { pop_2020: 120194, pop_2025: 119093, pop_pred_2024_2020: 120193.9999, pop_pred_2024_2050: 100930.9999 } }),
  areaRow({ key: "muni:14116", kind: "ward", code: "14116", lineCd: null, widthM: null, nameJa: "横浜市泉区", labelJa: "神奈川県横浜市泉区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 23.58, missing: [], stationCount: 9, values: { pop_2020: 152378, pop_2025: 149430, pop_pred_2024_2020: 152378.0009, pop_pred_2024_2050: 129193.9988 } }),
  areaRow({ key: "muni:14117", kind: "ward", code: "14117", lineCd: null, widthM: null, nameJa: "横浜市青葉区", labelJa: "神奈川県横浜市青葉区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 35.22, missing: [], stationCount: 9, values: { pop_2020: 310756, pop_2025: 306583, pop_pred_2024_2020: 310755.9994, pop_pred_2024_2050: 291333.9993 } }),
  areaRow({ key: "muni:14118", kind: "ward", code: "14118", lineCd: null, widthM: null, nameJa: "横浜市都筑区", labelJa: "神奈川県横浜市都筑区", prefecture: "神奈川県", parentKey: "muni:14100", groupKey: null, areaKm2: 27.87, missing: [], stationCount: 8, values: { pop_2020: 213132, pop_2025: 214025, pop_pred_2024_2020: 213132.0008, pop_pred_2024_2050: 219332.0009 } }),
]

// prettier-ignore
/** 川崎市（子なし）。 */
export const KAWASAKI_ROWS: readonly AreaRow[] = [
  areaRow({ key: "muni:14130", kind: "city", code: "14130", lineCd: null, widthM: null, nameJa: "川崎市", labelJa: "神奈川県川崎市", prefecture: "神奈川県", parentKey: "pref:14", groupKey: null, areaKm2: 142.96, missing: [], stationCount: 53, values: { pop_1995: 1202820, pop_2000: 1249905, pop_2005: 1327011, pop_2010: 1425512, pop_2015: 1475213, pop_2020: 1538262, pop_2025: 1559571, emp_n_2012: 514781, emp_n_2016: 543812, emp_n_2021: 547471, estab_n_2012: 40916, estab_n_2016: 40934, estab_n_2021: 41223, pop_pred_2024_2020: 1538262.0002, pop_pred_2024_2025: 1535016.9993, pop_pred_2024_2030: 1567243.0006, pop_pred_2024_2035: 1592690.0012, pop_pred_2024_2040: 1607068.0005, pop_pred_2024_2045: 1610179.0009, pop_pred_2024_2050: 1605530.9996, pop_pred_2024_2055: 1594160.9995, pop_pred_2024_2060: 1577489.0003, pop_pred_2024_2065: 1554027.0011, pop_pred_2024_2070: 1525207.0009 } }),
]

// prettier-ignore
/** 東急東横線の沿線（駅から 1km・メッシュの按分）。 */
export const TOYOKO_ROWS: readonly AreaRow[] = [
  areaRow({ key: "line:26001@1000", kind: "line", code: null, lineCd: 26001, widthM: 1000, nameJa: "東急東横線", labelJa: "東急東横線の沿線（駅から 1km）", prefecture: null, parentKey: null, groupKey: null, areaKm2: 46.366, missing: [], stationCount: 21, values: { pop_2015: 721524.0908, pop_2020: 760068.8262, emp_n_2012: 587566.7616, emp_n_2016: 658281.4391, emp_n_2021: 727365.4491, estab_n_2012: 39574.9732, estab_n_2016: 44447.6529, estab_n_2021: 46927.9944, pop_pred_2024_2020: 750164.9524, pop_pred_2024_2025: 759056.0372, pop_pred_2024_2030: 772689.7218, pop_pred_2024_2035: 783109.3606, pop_pred_2024_2040: 789373.5317, pop_pred_2024_2045: 790496.0578, pop_pred_2024_2050: 787122.1639, pop_pred_2024_2055: 779398.3498, pop_pred_2024_2060: 768741.5299, pop_pred_2024_2065: 755169.0898, pop_pred_2024_2070: 739340.4777 } }),
]

// prettier-ignore
/** 浜松市と 3 つの区（中央区・浜名区は 2024 年の再編で生まれ、過去と推計と経済センサスの値が無い）。 */
export const HAMAMATSU_ROWS: readonly AreaRow[] = [
  areaRow({ key: "muni:22130", kind: "city", code: "22130", lineCd: null, widthM: null, nameJa: "浜松市", labelJa: "静岡県浜松市", prefecture: "静岡県", parentKey: "pref:22", groupKey: null, areaKm2: 1558.11, missing: [], stationCount: 54, values: { pop_1995: 766832, pop_2000: 786306, pop_2005: 804032, pop_2010: 800866, pop_2015: 797980, pop_2020: 790718, pop_2025: 765254, emp_n_2012: 369932, emp_n_2016: 367526, emp_n_2021: 382432, estab_n_2012: 36445, estab_n_2016: 35552, estab_n_2021: 33755, pop_pred_2024_2020: 790717.996, pop_pred_2024_2025: 772254.0003, pop_pred_2024_2030: 752174.0028, pop_pred_2024_2035: 730724.0043, pop_pred_2024_2040: 707668.999, pop_pred_2024_2045: 683036.0003, pop_pred_2024_2050: 657052.0017, pop_pred_2024_2055: 630255.0025, pop_pred_2024_2060: 602043.0014, pop_pred_2024_2065: 572822.999, pop_pred_2024_2070: 543649.0025 } }),
  areaRow({ key: "muni:22138", kind: "ward", code: "22138", lineCd: null, widthM: null, nameJa: "浜松市中央区", labelJa: "静岡県浜松市中央区", prefecture: "静岡県", parentKey: "muni:22130", groupKey: null, areaKm2: 268.42, missing: [{"keys": ["pop_1995", "pop_2000", "pop_2005", "pop_2010", "pop_2015"], "reasonJa": "2024 年 1 月の区の再編（浜松市 7 区 → 3 区）で生まれた区。2015 年以前の値は無い（2020 年は 2025 年の国勢調査が新しい区に組み替えて出している）"}, {"keys": ["pop_pred_2024_2020", "pop_pred_2024_2025", "pop_pred_2024_2030", "pop_pred_2024_2035", "pop_pred_2024_2040", "pop_pred_2024_2045", "pop_pred_2024_2050", "pop_pred_2024_2055", "pop_pred_2024_2060", "pop_pred_2024_2065", "pop_pred_2024_2070"], "reasonJa": "将来推計人口（R6）は再編前の浜松市の 7 区で作られている。浜松市全体の値はある"}, {"keys": ["estab_n_2012", "estab_n_2016", "estab_n_2021", "emp_n_2012", "emp_n_2016", "emp_n_2021"], "reasonJa": "経済センサスは再編前の浜松市の 7 区で集計されている。浜松市全体の値はある"}], stationCount: 16, values: { pop_2020: 607937, pop_2025: 591034 } }),
  areaRow({ key: "muni:22139", kind: "ward", code: "22139", lineCd: null, widthM: null, nameJa: "浜松市浜名区", labelJa: "静岡県浜松市浜名区", prefecture: "静岡県", parentKey: "muni:22130", groupKey: null, areaKm2: 345.85, missing: [{"keys": ["pop_1995", "pop_2000", "pop_2005", "pop_2010", "pop_2015"], "reasonJa": "2024 年 1 月の区の再編（浜松市 7 区 → 3 区）で生まれた区。2015 年以前の値は無い（2020 年は 2025 年の国勢調査が新しい区に組み替えて出している）"}, {"keys": ["pop_pred_2024_2020", "pop_pred_2024_2025", "pop_pred_2024_2030", "pop_pred_2024_2035", "pop_pred_2024_2040", "pop_pred_2024_2045", "pop_pred_2024_2050", "pop_pred_2024_2055", "pop_pred_2024_2060", "pop_pred_2024_2065", "pop_pred_2024_2070"], "reasonJa": "将来推計人口（R6）は再編前の浜松市の 7 区で作られている。浜松市全体の値はある"}, {"keys": ["estab_n_2012", "estab_n_2016", "estab_n_2021", "emp_n_2012", "emp_n_2016", "emp_n_2021"], "reasonJa": "経済センサスは再編前の浜松市の 7 区で集計されている。浜松市全体の値はある"}], stationCount: 22, values: { pop_2020: 156055, pop_2025: 150578 } }),
  areaRow({ key: "muni:22140", kind: "ward", code: "22140", lineCd: null, widthM: null, nameJa: "浜松市天竜区", labelJa: "静岡県浜松市天竜区", prefecture: "静岡県", parentKey: "muni:22130", groupKey: null, areaKm2: 943.85, missing: [{"keys": ["pop_1995", "pop_2000", "pop_2005"], "reasonJa": "その年はまだ区が無かった（政令市になる前、または区ができる前）。市全体の値はある"}], stationCount: 16, values: { pop_2020: 26726, pop_2025: 23642, pop_pred_2024_2020: 26725.9983, pop_pred_2024_2050: 11535.0013 } }),
]

// prettier-ignore
/** いわき市（浜通り：社人研の個別の推計が無い）。 */
export const IWAKI_ROWS: readonly AreaRow[] = [
  areaRow({ key: "muni:07204", kind: "municipality", code: "07204", lineCd: null, widthM: null, nameJa: "いわき市", labelJa: "福島県いわき市", prefecture: "福島県", parentKey: "pref:07", groupKey: null, areaKm2: 1232.51, missing: [{"keys": ["pop_pred_2024_2020", "pop_pred_2024_2025", "pop_pred_2024_2030", "pop_pred_2024_2035", "pop_pred_2024_2040", "pop_pred_2024_2045", "pop_pred_2024_2050", "pop_pred_2024_2055", "pop_pred_2024_2060", "pop_pred_2024_2065", "pop_pred_2024_2070"], "reasonJa": "社人研は福島県の浜通り 13 市町村の個別の推計を出していない（13 市町村をまとめた値だけ）"}], stationCount: 14, values: { pop_1995: 360598, pop_2000: 360138, pop_2005: 354492, pop_2010: 342249, pop_2015: 350237, pop_2020: 332931, pop_2025: 306165, emp_n_2012: 134457, emp_n_2016: 139554, emp_n_2021: 143648, estab_n_2012: 14090, estab_n_2016: 14280, estab_n_2021: 13868 } }),
]

// prettier-ignore
/** 紋別市（駅が無い）。 */
export const MONBETSU_ROWS: readonly AreaRow[] = [
  areaRow({ key: "muni:01219", kind: "municipality", code: "01219", lineCd: null, widthM: null, nameJa: "紋別市", labelJa: "北海道紋別市", prefecture: "北海道", parentKey: "pref:01", groupKey: null, areaKm2: 830.67, missing: [], stationCount: 0, values: { pop_1995: 30137, pop_2000: 28476, pop_2005: 26632, pop_2010: 24750, pop_2015: 23109, pop_2020: 21215, pop_2025: 19424, emp_n_2012: 9879, emp_n_2016: 9289, emp_n_2021: 9072, estab_n_2012: 1352, estab_n_2016: 1254, estab_n_2021: 1257, pop_pred_2024_2020: 21214.9998, pop_pred_2024_2025: 19510.0003, pop_pred_2024_2030: 17782.0006, pop_pred_2024_2035: 16079.0002, pop_pred_2024_2040: 14442.9998, pop_pred_2024_2045: 12866.9995, pop_pred_2024_2050: 11377, pop_pred_2024_2055: 10012.9998, pop_pred_2024_2060: 8780.9996, pop_pred_2024_2065: 7642.0001, pop_pred_2024_2070: 6622.9997 } }),
]

// prettier-ignore
/** 東京 23 区（特別区部）と 23 の区（`group_key` で束ねる）。 */
export const TOKYO23_ROWS: readonly AreaRow[] = [
  areaRow({ key: "muni:13100", kind: "special_wards", code: "13100", lineCd: null, widthM: null, nameJa: "東京23区", labelJa: "東京都の 23 区（特別区部）", prefecture: "東京都", parentKey: "pref:13", groupKey: null, areaKm2: 627.51, missing: [], stationCount: 489, values: { pop_1995: 7967614, pop_2000: 8134688, pop_2005: 8489653, pop_2010: 8945695, pop_2015: 9272740, pop_2020: 9733276, pop_2025: 9944109, emp_n_2012: 7211906, emp_n_2016: 7550364, emp_n_2021: 8114913, estab_n_2012: 498735, estab_n_2016: 494337, estab_n_2021: 503699, pop_pred_2024_2020: 9733275.9941, pop_pred_2024_2025: 9864810.999, pop_pred_2024_2030: 10030032.0037, pop_pred_2024_2035: 10167420.0039, pop_pred_2024_2040: 10257601.9989, pop_pred_2024_2045: 10285439.9936, pop_pred_2024_2050: 10260519.999, pop_pred_2024_2055: 10189943.9999, pop_pred_2024_2060: 10085283.0034, pop_pred_2024_2065: 9942149.0005, pop_pred_2024_2070: 9769762.9982 } }),
  areaRow({ key: "muni:13101", kind: "municipality", code: "13101", lineCd: null, widthM: null, nameJa: "千代田区", labelJa: "東京都千代田区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 11.66, missing: [], stationCount: 25, values: { pop_2020: 66680, pop_2025: 66270, pop_pred_2024_2020: 66680.0002, pop_pred_2024_2050: 79828 } }),
  areaRow({ key: "muni:13102", kind: "municipality", code: "13102", lineCd: null, widthM: null, nameJa: "中央区", labelJa: "東京都中央区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 10.21, missing: [], stationCount: 22, values: { pop_2020: 169179, pop_2025: 181841, pop_pred_2024_2020: 169179.0003, pop_pred_2024_2050: 210896.9998 } }),
  areaRow({ key: "muni:13103", kind: "municipality", code: "13103", lineCd: null, widthM: null, nameJa: "港区", labelJa: "東京都港区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 20.36, missing: [], stationCount: 36, values: { pop_2020: 260486, pop_2025: 272478, pop_pred_2024_2020: 260486.0003, pop_pred_2024_2050: 312556.0004 } }),
  areaRow({ key: "muni:13104", kind: "municipality", code: "13104", lineCd: null, widthM: null, nameJa: "新宿区", labelJa: "東京都新宿区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 18.22, missing: [], stationCount: 25, values: { pop_2020: 349385, pop_2025: 361357, pop_pred_2024_2020: 349384.9999, pop_pred_2024_2050: 364110.9997 } }),
  areaRow({ key: "muni:13105", kind: "municipality", code: "13105", lineCd: null, widthM: null, nameJa: "文京区", labelJa: "東京都文京区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 11.29, missing: [], stationCount: 14, values: { pop_2020: 240069, pop_2025: 249800, pop_pred_2024_2020: 240069.0001, pop_pred_2024_2050: 271625.9995 } }),
  areaRow({ key: "muni:13106", kind: "municipality", code: "13106", lineCd: null, widthM: null, nameJa: "台東区", labelJa: "東京都台東区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 10.11, missing: [], stationCount: 17, values: { pop_2020: 211444, pop_2025: 228046, pop_pred_2024_2020: 211443.9998, pop_pred_2024_2050: 244548.9992 } }),
  areaRow({ key: "muni:13107", kind: "municipality", code: "13107", lineCd: null, widthM: null, nameJa: "墨田区", labelJa: "東京都墨田区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 13.77, missing: [], stationCount: 13, values: { pop_2020: 272085, pop_2025: 285038, pop_pred_2024_2020: 272084.9992, pop_pred_2024_2050: 297077.0005 } }),
  areaRow({ key: "muni:13108", kind: "municipality", code: "13108", lineCd: null, widthM: null, nameJa: "江東区", labelJa: "東京都江東区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 42.99, missing: [], stationCount: 28, values: { pop_2020: 524310, pop_2025: 553502, pop_pred_2024_2020: 524309.9996, pop_pred_2024_2050: 592668.9996 } }),
  areaRow({ key: "muni:13109", kind: "municipality", code: "13109", lineCd: null, widthM: null, nameJa: "品川区", labelJa: "東京都品川区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 22.85, missing: [], stationCount: 26, values: { pop_2020: 422488, pop_2025: 426005, pop_pred_2024_2020: 422487.9991, pop_pred_2024_2050: 465173.9995 } }),
  areaRow({ key: "muni:13110", kind: "municipality", code: "13110", lineCd: null, widthM: null, nameJa: "目黒区", labelJa: "東京都目黒区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 14.67, missing: [], stationCount: 9, values: { pop_2020: 288088, pop_2025: 286082, pop_pred_2024_2020: 288088, pop_pred_2024_2050: 298596.0009 } }),
  areaRow({ key: "muni:13111", kind: "municipality", code: "13111", lineCd: null, widthM: null, nameJa: "大田区", labelJa: "東京都大田区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 61.86, missing: [], stationCount: 39, values: { pop_2020: 748081, pop_2025: 758181, pop_pred_2024_2020: 748080.9988, pop_pred_2024_2050: 768129.9996 } }),
  areaRow({ key: "muni:13112", kind: "municipality", code: "13112", lineCd: null, widthM: null, nameJa: "世田谷区", labelJa: "東京都世田谷区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 58.05, missing: [], stationCount: 38, values: { pop_2020: 943664, pop_2025: 954737, pop_pred_2024_2020: 943663.9996, pop_pred_2024_2050: 987144.0002 } }),
  areaRow({ key: "muni:13113", kind: "municipality", code: "13113", lineCd: null, widthM: null, nameJa: "渋谷区", labelJa: "東京都渋谷区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 15.11, missing: [], stationCount: 18, values: { pop_2020: 243883, pop_2025: 238826, pop_pred_2024_2020: 243882.9999, pop_pred_2024_2050: 267178.9996 } }),
  areaRow({ key: "muni:13114", kind: "municipality", code: "13114", lineCd: null, widthM: null, nameJa: "中野区", labelJa: "東京都中野区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 15.59, missing: [], stationCount: 12, values: { pop_2020: 344880, pop_2025: 354853, pop_pred_2024_2020: 344879.9997, pop_pred_2024_2050: 361659.9994 } }),
  areaRow({ key: "muni:13115", kind: "municipality", code: "13115", lineCd: null, widthM: null, nameJa: "杉並区", labelJa: "東京都杉並区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 34.06, missing: [], stationCount: 18, values: { pop_2020: 591108, pop_2025: 597038, pop_pred_2024_2020: 591107.9996, pop_pred_2024_2050: 618595.0003 } }),
  areaRow({ key: "muni:13116", kind: "municipality", code: "13116", lineCd: null, widthM: null, nameJa: "豊島区", labelJa: "東京都豊島区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 13.01, missing: [], stationCount: 24, values: { pop_2020: 301599, pop_2025: 305516, pop_pred_2024_2020: 301598.9994, pop_pred_2024_2050: 329402.9993 } }),
  areaRow({ key: "muni:13117", kind: "municipality", code: "13117", lineCd: null, widthM: null, nameJa: "北区", labelJa: "東京都北区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 20.61, missing: [], stationCount: 19, values: { pop_2020: 355213, pop_2025: 367827, pop_pred_2024_2020: 355212.9996, pop_pred_2024_2050: 358782.0001 } }),
  areaRow({ key: "muni:13118", kind: "municipality", code: "13118", lineCd: null, widthM: null, nameJa: "荒川区", labelJa: "東京都荒川区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 10.16, missing: [], stationCount: 20, values: { pop_2020: 217475, pop_2025: 226291, pop_pred_2024_2020: 217474.9997, pop_pred_2024_2050: 231169.9999 } }),
  areaRow({ key: "muni:13119", kind: "municipality", code: "13119", lineCd: null, widthM: null, nameJa: "板橋区", labelJa: "東京都板橋区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 32.22, missing: [], stationCount: 20, values: { pop_2020: 584483, pop_2025: 595972, pop_pred_2024_2020: 584483.0001, pop_pred_2024_2050: 605109.0011 } }),
  areaRow({ key: "muni:13120", kind: "municipality", code: "13120", lineCd: null, widthM: null, nameJa: "練馬区", labelJa: "東京都練馬区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 48.08, missing: [], stationCount: 19, values: { pop_2020: 752608, pop_2025: 760819, pop_pred_2024_2020: 752608.0003, pop_pred_2024_2050: 755009.0014 } }),
  areaRow({ key: "muni:13121", kind: "municipality", code: "13121", lineCd: null, widthM: null, nameJa: "足立区", labelJa: "東京都足立区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 53.25, missing: [], stationCount: 24, values: { pop_2020: 695043, pop_2025: 701667, pop_pred_2024_2020: 695042.9996, pop_pred_2024_2050: 711212.9991 } }),
  areaRow({ key: "muni:13122", kind: "municipality", code: "13122", lineCd: null, widthM: null, nameJa: "葛飾区", labelJa: "東京都葛飾区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 34.8, missing: [], stationCount: 12, values: { pop_2020: 453093, pop_2025: 467267, pop_pred_2024_2020: 453092.9997, pop_pred_2024_2050: 451040.0002 } }),
  areaRow({ key: "muni:13123", kind: "municipality", code: "13123", lineCd: null, widthM: null, nameJa: "江戸川区", labelJa: "東京都江戸川区", prefecture: "東京都", parentKey: "pref:13", groupKey: "muni:13100", areaKm2: 49.9, missing: [], stationCount: 11, values: { pop_2020: 697932, pop_2025: 704696, pop_pred_2024_2020: 697931.9996, pop_pred_2024_2050: 679002.9997 } }),
]

/** 横浜市の 137 駅の、1km 圏の分布（`area_station_stats`）。 */
// prettier-ignore
export const YOKOHAMA_STATION_STATS: { readonly stationCount: number; readonly stats: readonly StationStatRow[] } = {
  stationCount: 137,
  stats: [
  { key: "pop_2020_1km", n: 137, flaggedN: 0, q1: 25164, median: 34581, q3: 44957, top: [{"grp": "阪東橋#0", "label": "阪東橋", "value": 72082}, {"grp": "黄金町#0", "label": "黄金町", "value": 70494}, {"grp": "伊勢佐木長者町#0", "label": "伊勢佐木長者町", "value": 66951}], bottom: [{"grp": "海芝浦#0", "label": "海芝浦", "value": 0}, {"grp": "新芝浦#0", "label": "新芝浦", "value": 223}, {"grp": "市大医学部#0", "label": "市大医学部", "value": 2789}] },
  { key: "pop_gr_2020_2015_1km", n: 136, flaggedN: 0, q1: 0.2, median: 2.5, q3: 4.9, top: [{"grp": "みなとみらい#0", "label": "みなとみらい", "value": 24.3}, {"grp": "馬車道#0", "label": "馬車道", "value": 18.3}, {"grp": "桜木町#0", "label": "桜木町", "value": 17.7}], bottom: [{"grp": "産業振興センター#0", "label": "産業振興センター", "value": -9.8}, {"grp": "福浦#0", "label": "福浦", "value": -8}, {"grp": "幸浦#0", "label": "幸浦", "value": -6.2}] },
  { key: "pop_gr_pred_2024_2050_1km", n: 136, flaggedN: 0, q1: -10.7, median: -3.8, q3: 2.3499999999999996, top: [{"grp": "新綱島#0", "label": "新綱島", "value": 10.4}, {"grp": "平沼橋#0", "label": "平沼橋", "value": 10.1}, {"grp": "戸部#0", "label": "戸部", "value": 10.1}], bottom: [{"grp": "並木中央#0", "label": "並木中央", "value": -35.3}, {"grp": "幸浦#0", "label": "幸浦", "value": -33.1}, {"grp": "並木北#0", "label": "並木北", "value": -31.5}] },
  { key: "lp_med_2026_1km", n: 94, flaggedN: 40, q1: 287625, median: 357000, q3: 481250, top: [{"grp": "神奈川#0", "label": "神奈川", "value": 2020000}, {"grp": "新高島#0", "label": "新高島", "value": 1735000}, {"grp": "横浜#0", "label": "横浜", "value": 1735000}], bottom: [{"grp": "下永谷#0", "label": "下永谷", "value": 191000}, {"grp": "いずみ中央#0", "label": "いずみ中央", "value": 200000}, {"grp": "上永谷#0", "label": "上永谷", "value": 211500}] },
  { key: "emp_n_2021_1km", n: 137, flaggedN: 0, q1: 6965, median: 12443, q3: 20054, top: [{"grp": "新高島#0", "label": "新高島", "value": 184183}, {"grp": "横浜#0", "label": "横浜", "value": 179031}, {"grp": "馬車道#0", "label": "馬車道", "value": 156162}], bottom: [{"grp": "恩田#0", "label": "恩田", "value": 2356}, {"grp": "下飯田#0", "label": "下飯田", "value": 3488}, {"grp": "ゆめが丘#0", "label": "ゆめが丘", "value": 3735}] },
  ],
}

/** 横浜市の 137 駅の人口の増減（2015→2020・1km）。 */
// prettier-ignore
export const YOKOHAMA_POP_GR: readonly StationMetricValue[] = metricValues([["あざみ野#0", 3.2, 0], ["いずみ中央#0", 0.5, 0], ["いずみ野#0", -1.6, 0], ["こどもの国#0", -1.6, 0], ["たまプラーザ#0", 3.2, 0], ["みなとみらい#0", 24.3, 0], ["ゆめが丘#0", 2.4, 0], ["センター北#0", 1.1, 0], ["センター南#0", 3.2, 0], ["三ツ境#0", -1.9, 0], ["三ツ沢上町#0", 1.4, 0], ["三ツ沢下町#0", 3.8, 0], ["上大岡#0", 3.8, 0], ["上星川#0", 9, 0], ["上永谷#0", -2, 0], ["下永谷#0", -0.6, 0], ["下飯田#0", 1.7, 0], ["並木中央#0", -3.9, 0], ["並木北#0", -3.7, 0], ["中山#1", 1.3, 0], ["中川#0", 0.3, 0], ["中田#0", 1.8, 0], ["二俣川#0", 4.9, 0], ["井土ヶ谷#0", 1.8, 0], ["京急富岡#0", -1, 0], ["京急新子安#0", 5.1, 0], ["京急東神奈川#0", 10.2, 0], ["京急鶴見#0", 4.8, 0], ["仲町台#0", 4.6, 0], ["伊勢佐木長者町#0", 2, 0], ["保土ヶ谷#0", 2, 0], ["元町・中華街#0", -0.5, 0], ["八景島#0", -2.1, 0], ["六浦#0", -0.8, 0], ["北山田#1", -0.2, 0], ["北新横浜#0", -0.2, 0], ["十日市場#0", 2.5, 0], ["南万騎が原#0", 3.8, 0], ["南太田#0", 4.5, 0], ["南部市場#0", 0.6, 0], ["反町#0", 7.3, 0], ["吉野町#0", 4.8, 0], ["和田町#0", 8.4, 0], ["国道#0", 3.4, 0], ["大倉山#1", 2, 0], ["大口#0", 2.9, 0], ["天王町#0", 3.8, 0], ["妙蓮寺#0", 2.9, 0], ["子安#0", 3.7, 0], ["安善#0", 1.4, 0], ["小机#0", 6.2, 0], ["屏風浦#0", 3, 0], ["山手#0", 1.7, 0], ["岸根公園#0", 3.7, 0], ["川和町#0", 2.5, 0], ["市が尾#0", 3.9, 0], ["市大医学部#0", -3.1, 0], ["希望ヶ丘#0", -0.2, 0], ["平沼橋#0", 7.6, 0], ["幸浦#0", -6.2, 0], ["弁天橋#0", 3.5, 0], ["弘明寺#0", 2.9, 0], ["弥生台#0", -0.6, 0], ["恩田#0", -2.4, 0], ["戸塚#0", 11.6, 0], ["戸部#0", 7.3, 0], ["新子安#0", 5, 0], ["新杉田#0", 7.3, 0], ["新横浜#0", 7.4, 0], ["新綱島#0", 7.3, 0], ["新羽#0", 0.1, 0], ["新芝浦#0", 4.2, 0], ["新高島#0", 8.5, 0], ["日ノ出町#0", 8.2, 0], ["日吉#1", 5.7, 0], ["日吉本町#0", 1.4, 0], ["日本大通り#0", 8.4, 0], ["星川#1", 2.5, 0], ["本郷台#0", -0.6, 0], ["杉田#0", 4.6, 0], ["東山田#0", 0.6, 0], ["東戸塚#0", 3.6, 0], ["東白楽#0", 6.5, 0], ["東神奈川#0", 10, 0], ["根岸#0", 5.5, 0], ["桜木町#0", 17.7, 0], ["横浜#0", 5.3, 0], ["江田#0", 2.2, 0], ["洋光台#0", -3.2, 0], ["浅野#0", 2.3, 0], ["海の公園南口#0", -0.4, 0], ["海の公園柴口#0", -1, 0], ["海芝浦#0", null, 0], ["港南中央#0", 0.2, 0], ["港南台#0", 0.6, 0], ["瀬谷#0", -1, 0], ["片倉町#0", 1.8, 0], ["生麦#0", 2, 0], ["産業振興センター#0", -9.8, 0], ["田奈#0", 3.2, 0], ["白楽#0", 4.6, 0], ["石川町#0", -1.6, 0], ["磯子#0", 0.8, 0], ["神奈川#0", 9, 0], ["神奈川新町#0", 6.1, 0], ["福浦#0", -8, 0], ["立場#0", 2.3, 0], ["綱島#0", 5.5, 0], ["緑園都市#0", -3.3, 0], ["羽沢横浜国大#0", -2.4, 0], ["能見台#0", -2.4, 0], ["舞岡#0", 2.6, 0], ["花月総持寺#0", 2.9, 0], ["菊名#0", 4.9, 0], ["蒔田#0", 1.5, 0], ["藤が丘#1", 0.3, 0], ["西横浜#0", 4.5, 0], ["西谷#0", 1.6, 0], ["踊場#0", 2.2, 0], ["都筑ふれあいの丘#0", 0.6, 0], ["野島公園#0", -1.2, 0], ["金沢八景#0", 0.7, 0], ["金沢文庫#0", 0.2, 0], ["長津田#0", 4.5, 0], ["関内#0", 5.5, 0], ["阪東橋#0", 4.9, 0], ["青葉台#0", 0.2, 0], ["馬車道#0", 18.3, 0], ["高島町#0", 9.6, 0], ["高田#5", 2.5, 0], ["鳥浜#0", -3.5, 0], ["鴨居#0", -5.1, 0], ["鶴ヶ峰#0", 1.4, 0], ["鶴見#0", 5.6, 0], ["鶴見小野#0", 3.1, 0], ["鶴見市場#0", 5.3, 0], ["黄金町#0", 5.4, 0]])

/** 川崎市の 53 駅の人口の増減（2015→2020・1km）。 */
// prettier-ignore
export const KAWASAKI_POP_GR: readonly StationMetricValue[] = metricValues([["はるひ野#0", 0.4, 0], ["中野島#0", 6.3, 0], ["久地#0", 4.1, 0], ["二子新地#0", 3.1, 0], ["五月台#0", 3.2, 0], ["京急川崎#0", 5.6, 0], ["京王稲田堤#0", 3.9, 0], ["元住吉#0", 9.1, 0], ["八丁畷#0", 5.3, 0], ["向ヶ丘遊園#0", 5.2, 0], ["向河原#0", 9.3, 0], ["大川#0", 4.7, 0], ["大師橋#0", 5.5, 0], ["宮前平#0", 9.4, 0], ["宮崎台#0", 11, 0], ["宿河原#0", 2.9, 0], ["小島新田#0", 9.5, 0], ["小田栄#0", -0.8, 0], ["尻手#0", 5.3, 0], ["川崎#0", 7.4, 0], ["川崎大師#0", 7.6, 0], ["川崎新町#0", 4.2, 0], ["平間#0", 5.1, 0], ["扇町#1", -20, 0], ["新丸子#0", 10.6, 0], ["新川崎#0", 7.9, 0], ["新百合ヶ丘#0", 2.9, 0], ["昭和#0", 3, 0], ["東門前#0", 6.5, 0], ["柿生#0", 3.6, 0], ["栗平#0", 8.5, 0], ["梶が谷#0", 3.7, 0], ["武蔵中原#0", 4.5, 0], ["武蔵小杉#0", 11.6, 0], ["武蔵新城#0", 4.1, 0], ["武蔵溝ノ口#0", 4, 0], ["武蔵白石#0", -0.1, 0], ["津田山#0", 3.7, 0], ["浜川崎#0", -1.3, 0], ["港町#0", 12.1, 0], ["溝の口#0", 4.4, 0], ["生田#0", 4.3, 0], ["登戸#0", 4.7, 0], ["百合ヶ丘#0", 1.4, 0], ["矢向#0", 10, 0], ["稲田堤#0", 4.2, 0], ["若葉台#0", 6.5, 0], ["読売ランド前#0", 2.4, 0], ["鈴木町#0", 10.8, 0], ["高津#1", 4.9, 0], ["鷺沼#0", 3.1, 0], ["鹿島田#0", 6.6, 0], ["黒川#1", 9.8, 0]])

/** 横浜市の 137 駅の地価の中央値（2026・1km・⚠ が 40 駅）。 */
// prettier-ignore
export const YOKOHAMA_LP_MED: readonly StationMetricValue[] = metricValues([["あざみ野#0", 571000, 0], ["いずみ中央#0", 200000, 0], ["いずみ野#0", 282000, 1], ["こどもの国#0", 194000, 1], ["たまプラーザ#0", 584000, 0], ["みなとみらい#0", 1400000, 0], ["ゆめが丘#0", 249000, 1], ["センター北#0", 433000, 0], ["センター南#0", 417000, 1], ["三ツ境#0", 229000, 0], ["三ツ沢上町#0", 364000, 0], ["三ツ沢下町#0", 371500, 0], ["上大岡#0", 302000, 0], ["上星川#0", 218500, 0], ["上永谷#0", 211500, 0], ["下永谷#0", 191000, 0], ["下飯田#0", 249000, 1], ["並木中央#0", 218000, 1], ["並木北#0", 184000, 1], ["中山#1", 283000, 0], ["中川#0", 344000, 0], ["中田#0", 248000, 0], ["二俣川#0", 279000, 0], ["井土ヶ谷#0", 311000, 0], ["京急富岡#0", 236500, 0], ["京急新子安#0", 423000, 0], ["京急東神奈川#0", 576000, 0], ["京急鶴見#0", 461000, 0], ["仲町台#0", 368000, 1], ["伊勢佐木長者町#0", 865000, 0], ["保土ヶ谷#0", 242000, 0], ["元町・中華街#0", 911000, 0], ["八景島#0", 184000, 1], ["六浦#0", 156500, 1], ["北山田#1", 300000, 0], ["北新横浜#0", 315000, 1], ["十日市場#0", 254500, 1], ["南万騎が原#0", 279000, 0], ["南太田#0", 332000, 0], ["南部市場#0", 182500, 1], ["反町#0", 705000, 0], ["吉野町#0", 433000, 0], ["和田町#0", 226000, 0], ["国道#0", 364500, 0], ["大倉山#1", 374000, 0], ["大口#0", 423000, 0], ["天王町#0", 407000, 0], ["妙蓮寺#0", 377000, 0], ["子安#0", 385500, 0], ["安善#0", 271000, 1], ["小机#0", 211000, 1], ["屏風浦#0", 244500, 1], ["山手#0", 355500, 0], ["岸根公園#0", 313000, 0], ["川和町#0", 247500, 1], ["市が尾#0", 350000, 0], ["市大医学部#0", 179000, 1], ["希望ヶ丘#0", 215000, 0], ["平沼橋#0", 778000, 0], ["幸浦#0", null, 0], ["弁天橋#0", 291000, 1], ["弘明寺#0", 308000, 0], ["弥生台#0", 208000, 1], ["恩田#0", 194000, 1], ["戸塚#0", 454000, 0], ["戸部#0", 655000, 0], ["新子安#0", 423000, 0], ["新杉田#0", 284000, 1], ["新横浜#0", 1112500, 1], ["新綱島#0", 524000, 0], ["新羽#0", 315000, 0], ["新芝浦#0", null, 0], ["新高島#0", 1735000, 0], ["日ノ出町#0", 611000, 0], ["日吉#1", 458000, 0], ["日吉本町#0", 378000, 0], ["日本大通り#0", 1400000, 0], ["星川#1", 329000, 0], ["本郷台#0", 229000, 0], ["杉田#0", 240500, 1], ["東山田#0", 266000, 1], ["東戸塚#0", 332000, 0], ["東白楽#0", 423000, 0], ["東神奈川#0", 457000, 0], ["根岸#0", 365000, 1], ["桜木町#0", 1123500, 0], ["横浜#0", 1735000, 0], ["江田#0", 348000, 0], ["洋光台#0", 241000, 0], ["浅野#0", 271000, 1], ["海の公園南口#0", 266000, 0], ["海の公園柴口#0", 201500, 1], ["海芝浦#0", null, 0], ["港南中央#0", 239000, 0], ["港南台#0", 250000, 0], ["瀬谷#0", 228500, 0], ["片倉町#0", 313000, 0], ["生麦#0", 317000, 0], ["産業振興センター#0", 179000, 1], ["田奈#0", 309500, 0], ["白楽#0", 377000, 0], ["石川町#0", 905000, 0], ["磯子#0", 245000, 1], ["神奈川#0", 2020000, 0], ["神奈川新町#0", 510000, 1], ["福浦#0", 179000, 1], ["立場#0", 258500, 0], ["綱島#0", 524000, 0], ["緑園都市#0", 230000, 0], ["羽沢横浜国大#0", 261000, 1], ["能見台#0", 215000, 0], ["舞岡#0", 189000, 1], ["花月総持寺#0", 358500, 0], ["菊名#0", 449000, 0], ["蒔田#0", 332000, 0], ["藤が丘#1", 335000, 0], ["西横浜#0", 488000, 0], ["西谷#0", 256000, 1], ["踊場#0", 242500, 1], ["都筑ふれあいの丘#0", 356000, 1], ["野島公園#0", 239000, 0], ["金沢八景#0", 287000, 0], ["金沢文庫#0", 319000, 0], ["長津田#0", 289500, 0], ["関内#0", 930000, 0], ["阪東橋#0", 499000, 0], ["青葉台#0", 341500, 0], ["馬車道#0", 1450000, 0], ["高島町#0", 795000, 0], ["高田#5", 332000, 0], ["鳥浜#0", 184000, 1], ["鴨居#0", 217000, 1], ["鶴ヶ峰#0", 224500, 1], ["鶴見#0", 461000, 0], ["鶴見小野#0", 294000, 0], ["鶴見市場#0", 436000, 0], ["黄金町#0", 507000, 0]])

/** 竹橋（駅から N m の起点）。 */
export const TAKEBASHI: StationRow = {
  grp: '竹橋#0',
  stationName: '竹橋',
  label: '竹橋',
  searchLabel: '竹橋（東京都）',
  prefecture: '東京都',
  municipality: '千代田区',
  lon: 139.75852,
  lat: 35.69028,
  nOp: 1,
  operators: '東京地下鉄',
  paxLatest: 42156,
  lpNearUse: null,
  levelComplete: true,
}

/**
 * 竹橋の 5km の円の値（`station_bundle` の一部・駅詳細と同じ値）。1995〜2010 年の人口（500m のメッシュ）は区域の値に
 * 使わない（沿線と同じ年にそろえる）ので、`pop_1995_5km` も入れて「使わないこと」を確かめる。
 */
export const TAKEBASHI_5KM: Readonly<Record<string, number>> = {
  pop_1995_5km: 821157,
  pop_2015_5km: 1163836,
  pop_2020_5km: 1277680,
  pop_pred_2024_2020_5km: 1271930,
  pop_pred_2024_2025_5km: 1329698,
  pop_pred_2024_2030_5km: 1375663,
  pop_pred_2024_2035_5km: 1414071,
  pop_pred_2024_2040_5km: 1442477,
  pop_pred_2024_2045_5km: 1458615,
  pop_pred_2024_2050_5km: 1464683,
  pop_pred_2024_2055_5km: 1462766,
  pop_pred_2024_2060_5km: 1454915,
  pop_pred_2024_2065_5km: 1440491,
  pop_pred_2024_2070_5km: 1420495,
  estab_n_2012_5km: 170180,
  estab_n_2016_5km: 165299,
  estab_n_2021_5km: 173730,
  emp_n_2012_5km: 3248119,
  emp_n_2016_5km: 3364685,
  emp_n_2021_5km: 3702211,
}
