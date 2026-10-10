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
  {
    type: 'stationProfile',
    grp: '横浜#0',
    title: '横浜の周辺（1km圏）',
    placeJa: '横浜',
    radiusM: 1000,
    areaJa: '横浜市',
    positionsLegendJa:
      '位置は 県内＝神奈川県、市内＝横浜市 の駅と比べたものです（値の大きい順・数字は順位/駅数）。',
    character: {
      kind: 'business',
      labelJa: '業務地型',
      summaryJa: '働きに来る人が、住む人より多いエリア',
      basisJa: '1km圏の従業者 179,031 人（2021年）は、人口 43,471 人（2020年）の 4.1 倍',
      radiusM: 1000,
    },
    sections: [
      {
        id: 'people',
        titleJa: '住む人',
        items: [
          {
            id: 'population',
            key: 'pop_2020_1km',
            labelJa: '人口',
            periodJa: '2020年',
            radiusM: 1000,
            value: 43_471,
            valueJa: '43,471 人',
            flagged: false,
            positions: [
              {
                scope: 'prefecture',
                scopeJa: '神奈川県内',
                shortJa: '県内',
                rank: 66,
                total: 348,
                percentile: 81.3,
                shareJa: '上位 19%',
                labelJa: '神奈川県内 348 駅中 66 位（上位 19%）',
              },
            ],
            noteJa: null,
          },
          {
            id: 'income',
            key: 'inc_pc_2025_1km',
            labelJa: '1人当たり所得',
            periodJa: '2025年度',
            radiusM: 1000,
            value: 463.7,
            valueJa: '463.7 万円/人',
            flagged: true,
            positions: [],
            noteJa:
              '政令市の所得は市の単位でしか公表されないため、市全体の平均が主です（市内では比べていません）。',
          },
        ],
      },
    ],
    hazard: {
      level: 'warning',
      headlineJa: 'この場所は、洪水浸水想定区域（想定最大規模）に入っています（0.5〜3m 未満）。',
      hitsJa: ['洪水：洪水浸水想定区域（想定最大規模）：0.5〜3m 未満'],
      nearbyJa: [],
      uncoveredJa: ['土砂災害'],
      caveatJa: '駅の代表点 1 点の値です。',
      sources: [{ source: '国土交通省', license: 'CC BY 4.0' }],
    },
    notCoveredJa: ['治安（犯罪の件数）', '学校・学区・保育園の空き'],
    notesJa: ['順位は値の大きい順です。'],
    sources: [source],
  },
  {
    type: 'areaSummary',
    title: '神奈川県横浜市の要約',
    areas: [
      {
        ref: 'muni:14100',
        kind: 'city',
        kindJa: '政令市（市全体）',
        nameJa: '横浜市',
        labelJa: '神奈川県横浜市',
        parent: { ref: 'pref:14', nameJa: '神奈川県' },
        areaKm2: 438.23,
        stationCount: 137,
        totals: [
          {
            id: 'populationFuture',
            labelJa: '将来推計人口',
            unit: '人',
            method: 'projection',
            methodJa: '推計（市区町村ごとの合計）',
            sourceJa: '国土数値情報 将来推計人口メッシュ（R6）を市区町村ごとに足したもの',
            lead: { year: 2050, value: 3_537_253, valueJa: '3,537,253 人' },
            changes: [
              {
                fromYear: 2020,
                toYear: 2050,
                rate: -6.36,
                rateJa: '-6.4%',
                textJa: '2020→2050年で -6.4%',
              },
            ],
            peak: { year: 2025, value: 3_786_702, valueJa: '3,786,702 人' },
            accuracy: {
              year: 2025,
              projected: 3_786_702,
              actual: 3_750_952,
              gapRate: -0.94,
              textJa: '2025年の実績は推計より 0.9% 少ない',
            },
            headlineJa: '2050年 3,537,253 人（推計・2020年比 -6.4%）',
          },
        ],
        unavailableJa: ['人口（1995〜2015年）：区の再編で生まれた区'],
        stations: {
          count: 137,
          radiusM: 1000,
          stats: [
            {
              key: 'pop_gr_2020_2015_1km',
              labelJa: '人口の増減',
              periodJa: '2015→2020年',
              radiusM: 1000,
              unit: '%',
              format: 'percent1',
              n: 136,
              flaggedN: 2,
              missingN: 1,
              median: 2.5,
              q1: 0.2,
              q3: 4.9,
              medianJa: '+2.5%',
              rangeJa: '+0.2%〜+4.9%',
              top: [
                { grp: 'みなとみらい#0', labelJa: 'みなとみらい', value: 24.3, valueJa: '+24.3%' },
              ],
              bottom: [
                {
                  grp: '産業振興センター#0',
                  labelJa: '産業振興センター',
                  value: -9.8,
                  valueJa: '-9.8%',
                },
              ],
              noteJa: null,
            },
          ],
        },
      },
    ],
    comparison: null,
    legend: {
      metricKey: 'pop_gr_2020_2015_1km',
      titleJa: '人口増減率（2015→2020年・1km圏）',
      unit: '%',
      scheme: 'diverging',
      classes: [
        { index: 0, color: '#0571b0', lower: null, upper: -5, labelJa: '-5%未満', count: 4 },
        { index: 1, color: '#ca0020', lower: -5, upper: null, labelJa: '-5%以上', count: 132 },
      ],
      flagged: { color: '#9ca3af', labelJa: '参考値（⚠）', count: 2 },
      missingCount: 1,
      meaningJa: '赤は増加、青は減少、灰色はほぼ横ばい（-1〜+1%）。0 が真ん中。',
      sourceJa: '総務省 国勢調査 地域メッシュ統計（e-Stat）',
      reasonJa: null,
    },
    radiusM: 1000,
    notesJa: ['区域の値は、市区町村・都道府県は公表値。駅の値を足したものではない。'],
    notIncludedJa: ['増えた・減った理由（再開発・転入・住宅の供給など）', '年齢構成・世帯の形'],
    sources: [source],
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
