/**
 * P8c 評価：ゴールデン 20 問（駅詳細・ランキング・散布・比較・曖昧駅名・カタログ探索・データ外拒否）。
 * 各問は自然言語クエリと、機械判定できる期待（score.ts）を持つ。代表性を重視して分野を網羅する。
 */

import { type EvalExpectation } from './score'

export type EvalCase = {
  readonly id: string
  readonly category: string
  readonly query: string
  /** 地図で選択中の駅（P8e・文脈依存ケース）。runner が body で同送する。 */
  readonly selectedGrp?: string
  readonly radiusM?: number
  readonly expect: EvalExpectation
}

export const EVAL_CASES: readonly EvalCase[] = [
  // --- 駅詳細（カテゴリの選択・半径・選択） ---
  {
    id: 'detail-population',
    category: '駅詳細',
    query: '東京駅の人口推移を教えて',
    expect: {
      toolCalls: [{ name: 'getStationDetail', inputIncludes: { category: 'population' } }],
      panels: ['trendChart'],
      select: true,
    },
  },
  {
    id: 'detail-landprice',
    category: '駅詳細',
    query: '新宿駅の地価はどう推移してる？',
    expect: {
      toolCalls: [{ name: 'getStationDetail', inputIncludes: { category: 'land_price' } }],
      select: true,
    },
  },
  {
    id: 'detail-bus',
    category: '駅詳細',
    query: '立川駅の周辺のバス停の数は？',
    expect: {
      toolCalls: [{ name: 'getStationDetail', inputIncludes: { category: 'bus' } }],
      select: true,
    },
  },
  {
    id: 'detail-employee',
    category: '駅詳細',
    query: '大手町駅の従業者数を見せて',
    expect: {
      toolCalls: [{ name: 'getStationDetail', inputIncludes: { category: 'employee' } }],
      select: true,
    },
  },
  {
    id: 'detail-passenger',
    category: '駅詳細',
    query: '池袋駅の乗降客数の推移を見せて',
    expect: {
      toolCalls: [{ name: 'getStationDetail' }],
      panels: ['trendChart'],
      select: true,
    },
  },
  {
    id: 'detail-radius',
    category: '駅詳細',
    query: '千葉駅の人口を半径5kmで教えて',
    expect: {
      toolCalls: [
        { name: 'getStationDetail', inputIncludes: { category: 'population', radiusM: 5000 } },
      ],
      select: true,
    },
  },

  // --- ランキング（都道府県・全国・指標） ---
  {
    id: 'rank-covid-kanagawa',
    category: 'ランキング',
    query: '神奈川県で乗降客の回復が大きい駅トップ5は？',
    expect: {
      toolCalls: [{ name: 'rankStations', inputIncludes: { prefectures: ['神奈川県'] } }],
      panels: ['rankingTable'],
    },
  },
  {
    id: 'rank-national-population',
    category: 'ランキング',
    query: '全国で人口が増えた駅ランキングを見せて',
    expect: {
      toolCalls: [{ name: 'rankStations' }],
      panels: ['rankingTable'],
    },
  },
  {
    id: 'rank-landprice-chiba',
    category: 'ランキング',
    query: '千葉県で地価が上がった駅トップ10を教えて',
    expect: {
      toolCalls: [{ name: 'rankStations', inputIncludes: { prefectures: ['千葉県'] } }],
      panels: ['rankingTable'],
    },
  },
  {
    id: 'rank-tokyo',
    category: 'ランキング',
    query: '東京都で人口が最も減った駅は？',
    expect: {
      toolCalls: [{ name: 'rankStations', inputIncludes: { prefectures: ['東京都'] } }],
      panels: ['rankingTable'],
    },
  },

  // --- 散布（増減率どうしの相関） ---
  {
    id: 'scatter-basic',
    category: '散布',
    query: '人口増減率と乗降客の回復率の関係を散布図で見せて',
    expect: {
      toolCalls: [{ name: 'compareGrowth' }],
      panels: ['scatter'],
    },
  },
  {
    id: 'scatter-chiba',
    category: '散布',
    query: '千葉県で人口増減率と地価増減率を散布図で比べて',
    expect: {
      toolCalls: [{ name: 'compareGrowth', inputIncludes: { prefectures: ['千葉県'] } }],
      panels: ['scatter'],
    },
  },

  // --- 2 駅比較 ---
  {
    id: 'compare-two',
    category: '比較',
    query: '東京駅と新宿駅の人口を比べて',
    expect: {
      toolCalls: [{ name: 'getStationDetail' }],
      panels: ['stationCard'],
      contains: ['新宿'],
    },
  },

  // --- 曖昧駅名（同名駅の区別） ---
  {
    id: 'ambiguous-amagasaki',
    category: '曖昧駅名',
    query: '尼崎駅について教えて',
    expect: {
      toolCalls: [{ name: 'searchStations', inputIncludes: { query: '尼崎' } }],
      contains: ['尼崎'],
    },
  },
  {
    id: 'ambiguous-kamimichi',
    category: '曖昧駅名',
    query: '上道駅はどんな駅？',
    expect: {
      toolCalls: [{ name: 'searchStations' }],
      contains: ['上道'],
    },
  },

  // --- カタログ探索（自己記述の表面） ---
  {
    id: 'catalog-overview',
    category: 'カタログ',
    query: 'この地図ではどんなデータが見られるの？',
    expect: {
      textNonEmpty: true,
      containsAny: ['人口', '地価', '乗降', 'バス', '事業所'],
    },
  },
  {
    id: 'catalog-metric',
    category: 'カタログ',
    query: '地価に関する指標にはどんなものがある？',
    expect: {
      textNonEmpty: true,
      containsAny: ['地価', '中央値', '公示', '増減'],
    },
  },

  // --- データ外・拒否 ---
  {
    id: 'refuse-weather',
    category: '拒否',
    query: '明日の東京の天気を教えて',
    expect: {
      noPanels: true,
      textNonEmpty: true,
    },
  },
  {
    id: 'refuse-predict',
    category: '拒否',
    query: '来年の新宿の地価を予測して',
    expect: {
      textNonEmpty: true,
      noRankScatter: true,
      containsAny: ['予測', '予想', 'できません', 'ありません', '実績', '現状', '過去'],
    },
  },
  {
    id: 'refuse-route',
    category: '拒否',
    query: '東京駅から横浜駅への行き方を教えて',
    expect: {
      noPanels: true,
      textNonEmpty: true,
    },
  },

  // --- 地図文脈（P8e・選択駅を会話の主題に） ---
  {
    // 東京を選択中に駅名を省いた追随質問 → 選択駅の地価を、検索を省いて getStationDetail 直呼び
    id: 'context-followup-landprice',
    category: '地図文脈',
    query: '地価の推移は？',
    selectedGrp: '東京#0',
    radiusM: 1000,
    expect: {
      toolCalls: [{ name: 'getStationDetail', inputIncludes: { grp: '東京#0', category: 'land_price' } }],
      select: true,
    },
  },
  {
    // 東京を選択中でも、別駅を明示したらそちら（選択に縛られない）
    id: 'context-explicit-override',
    category: '地図文脈',
    query: '新宿駅の人口は？',
    selectedGrp: '東京#0',
    radiusM: 1000,
    expect: {
      toolCalls: [{ name: 'searchStations', inputIncludes: { query: '新宿' } }],
      contains: ['新宿'],
    },
  },
]
