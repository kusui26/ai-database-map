/**
 * **全パネル型の見本**（`viewer-panels` と `presenters-echarts` が共有する）。
 *
 * 1 か所に置くのは、この配列が「protocol の全型に見本があるか」を測る物差しでもあるため——
 * 両方のテストが同じ物差しを使うので、パネル型を足したときに**両方**が同時に落ちる。
 * 値はすべて `panelSchema` を通す（形がずれたら見本の側が落ちる）。
 */

import { panelSchema, type Panel } from '@/shared/protocol'

/** protocol の判別ユニオンから全パネル型リテラルを導出（手書きリストにしない）。 */
export const PANEL_TYPES: readonly string[] = panelSchema.options.map(
  (option) => option.shape.type.value,
)

const source = { labelJa: '国土地理院', url: null, license: 'CC BY 4.0', forJa: null }

/** 全パネル型の見本（**Zod で検証**するので、形がずれたらテストが落ちる）。 */
export const PANEL_FIXTURES: readonly Panel[] = [
  {
    type: 'stationCard',
    grp: '横浜#0',
    stationName: '横浜',
    label: '横浜駅',
    prefecture: '神奈川県',
    operators: 'JR東日本 / 東急',
    paxLatest: 393_622,
    badges: [{ label: '低分母', level: 'warn' }],
  },
  {
    type: 'trendChart',
    title: '乗降客数の推移',
    unit: '人/日',
    format: 'int',
    category: 'passenger',
    flags: [],
    series: [
      {
        label: '乗降客数',
        points: [
          { x: 2018, y: 450_000 },
          { x: 2019, y: 420_000 },
          { x: 2020, y: null },
          { x: 2021, y: 300_000 },
          { x: 2022, y: 330_000 },
        ],
      },
    ],
    stats: [{ label: 'コロナ前後比', value: '-21.4%', flagged: false }],
  },
  {
    type: 'trendChart',
    title: '売上の推移',
    unit: '百万円',
    format: 'int',
    stacked: true,
    totals: [
      { x: 2016, y: 1_902.3 },
      { x: 2021, y: 2_010.0 },
    ],
    flags: [],
    series: [
      {
        label: '小売',
        color: '#ea580c',
        points: [
          { x: 2016, y: 1_469.2 },
          { x: 2021, y: 1_500 },
        ],
      },
      {
        label: '飲食宿泊',
        points: [
          { x: 2016, y: 263.3 },
          { x: 2021, y: 310 },
        ],
      },
    ],
  },
  {
    type: 'statTable',
    title: '増減率',
    rows: [{ label: '2015→2020', value: '+3.2%', flagged: true }],
    note: '低分母の行には ⚠ を付けています',
  },
  {
    type: 'barChart',
    title: '半径別の人口',
    unit: '人',
    format: 'int',
    bars: [
      { label: '500m', value: 12_000, formatted: '12,000', flagged: false },
      { label: '1km', value: 34_000, formatted: '34,000', flagged: false, emphasis: true },
      { label: '2km', value: null, formatted: '—', flagged: true },
    ],
    flags: [{ label: '低分母', level: 'info' }],
    note: null,
  },
  {
    type: 'rankingTable',
    title: '人口増減率ランキング',
    metricKey: 'pop_gr_2020_2015_1km',
    unit: '%',
    rows: [
      {
        rank: 1,
        grp: '武蔵小杉#0',
        name: '武蔵小杉',
        prefecture: '神奈川県',
        value: 12.3,
        formatted: '+12.3%',
        flagged: false,
      },
    ],
  },
  {
    type: 'scatter',
    title: '人口増減率 × 地価増減率',
    xLabel: '人口増減率',
    yLabel: '地価増減率',
    xUnit: '%',
    yUnit: '%',
    points: [
      { grp: 'a#0', name: 'A', x: 1, y: 2, cluster: 0 },
      { grp: 'b#0', name: 'B', x: 3, y: 1, cluster: 2 },
    ],
    clusterCount: 4,
  },
  {
    type: 'hazardCard',
    placeJa: '横浜駅',
    level: 'danger',
    headlineJa: 'この場所は洪水浸水想定区域に入っています',
    evacuation: 'takeaway',
    certainty: 'exact',
    items: [
      {
        layerKey: 'flood_l2',
        labelJa: '洪水浸水想定区域（想定最大規模）',
        valueJa: '3.0〜5.0m 未満',
        meaningJa: '2 階部分が浸水する高さ',
        level: 'danger',
        color: '#ff9f15',
        source: 'tile',
        coverage: null,
        certainty: 'exact',
      },
    ],
    reasonsJa: ['浸水深の階級が 3.0m 以上です'],
    coverageNotesJa: ['白い場所が安全という意味ではありません'],
    sources: [source],
    disclaimerJa: '想定であり、実際の被害を保証するものではありません',
  },
  {
    type: 'evacuationList',
    forDisasterJa: '洪水',
    siteKindJa: '指定緊急避難場所',
    placeJa: '横浜駅',
    headlineJa: '近くの指定緊急避難場所は 1 件です',
    items: [
      {
        nameJa: '〇〇小学校',
        addressJa: '神奈川県横浜市…',
        lon: 139.62,
        lat: 35.466,
        distanceM: 1_200,
        distanceJa: '約1.2km',
        bearingJa: '北東',
        disastersJa: ['洪水', '土砂災害'],
        hazardAreaCertainty: 'outside',
        hazardAreaSource: 'tile',
        hazardAreaJa: '想定区域にかからない',
        hazardAreaDetailJa: null,
        elevationM: 12.3,
        remarksJa: '洪水での避難は〇〇川を対象とする',
      },
    ],
    limitationsJa: ['開設状況は分かりません'],
    notesJa: ['直線距離です'],
    sources: [source],
    disclaimerJa: '実際の避難は市町村の避難情報に従ってください',
  },
  {
    type: 'escapeDirection',
    placeJa: '横浜駅',
    forDisasterJa: '洪水の想定区域',
    headlineJa: '北東へ約 600m で想定区域の外に出ます',
    direction: {
      bearingJa: '北東',
      distanceM: 600,
      distanceJa: '約600m',
      lon: 139.63,
      lat: 35.47,
    },
    limitationsJa: ['250m の目安です'],
    notesJa: ['移動が安全とは限りません'],
    sources: [source],
    disclaimerJa: '経路案内ではありません',
  },
  { type: 'markdown', body: '第 1 段落です。\n\n第 2 段落です。' },
]

/** 型ごとの最初の見本（無ければ落とす＝見本の付け忘れを隠さない）。 */
export function panelFixture(type: string): Panel {
  const panel = PANEL_FIXTURES.find((each) => each.type === type)
  if (panel === undefined) throw new Error(`見本の無いパネル型: ${type}`)
  return panel
}

/** 積み上げの見本（合計が内訳の丸め和と食い違う本物の事例）。 */
export function stackedTrendFixture(): Panel {
  const panel = PANEL_FIXTURES.find((each) => each.type === 'trendChart' && each.stacked === true)
  if (panel === undefined) throw new Error('積み上げの見本がありません')
  return panel
}
