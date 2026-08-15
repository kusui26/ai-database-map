/**
 * ドメイン：StationDetail → GUI Chat Protocol の Panel（純関数）。
 *
 * クリック（P5 の詳細パネル）と会話（Step2 のチャット）は、この同一の Panel[] を消費する
 * （.claude/CLAUDE.md §2「API こそがプロダクト」）。UI にメトリクスの意味づけを埋めない。
 * 各カテゴリ（乗降・人口・所得・地価・バス・事業所・従業者）の Panel を選択半径で組み立てる。
 */

import { type MetricSeries, type StationDetail, type StationRow } from '@/shared/api'
import {
  type Bar,
  type Panel,
  type PanelSize,
  type PanelStat,
  type ReliabilityFlag,
  type StationCardPanel,
  type StatTablePanel,
  type TrendChartPanel,
} from '@/shared/protocol'
import { CATEGORY_COLORS, RADII_M, radiusLabel } from '@/shared/constants'
import { formatNumber, formatWithUnit } from '@/shared/format'
import { baseMetricLabel } from '@/domain/metrics'

/** バス「現行」の代表年（P11 2022年度＋P36 2023年度 → 2023）。2点折れ線の現在側の x。 */
const BUS_CURRENT_YEAR = 2023

/** 系列点 → チャート座標（年欠損はスキップ・値欠損は null＝ギャップ）。 */
function toXY(series: MetricSeries | undefined): { x: number; y: number | null }[] {
  return (series?.points ?? []).flatMap((point) =>
    point.year === null ? [] : [{ x: point.year, y: point.value }],
  )
}

/** 最新乗降客数の整形（int・人/日）。単位の意味づけはドメインが持つ（UI に埋めない）。 */
export function formatPaxLatest(value: number | null): string {
  return formatWithUnit(value, 'int', '人/日')
}

/** 駅の信頼性バッジ（時系列の完全性など・カード見出し級の注意）。 */
function stationBadges(station: StationRow): ReliabilityFlag[] {
  if (station.levelComplete === false) {
    return [{ label: '乗降 時系列に欠損あり', level: 'warn' }]
  }
  return []
}

/** 駅カード Panel（駅名・県・延べ事業者数・最新乗降客・信頼性バッジ）。 */
export function stationCardPanel(
  detail: StationDetail,
  size: PanelSize = 'full',
): StationCardPanel {
  const s = detail.station
  return {
    type: 'stationCard',
    grp: s.grp,
    stationName: s.stationName,
    label: s.label,
    prefecture: s.prefecture,
    // 具体的な社名（P5d の operators）。欠損時は延べ社数にフォールバック。
    operators: s.operators ?? (s.nOp === null ? null : `延べ${s.nOp}社`),
    paxLatest: s.paxLatest,
    badges: stationBadges(s),
    size,
  }
}

/** pax_rate 系列 → 要約スタッツ（前年比 → コロナ前後比の順・整形済み文字列＋フラグ）。 */
function paxRateStats(rate: MetricSeries | undefined): PanelStat[] {
  if (rate === undefined) return []
  const byKey = new Map(rate.points.map((point) => [point.key, point]))
  const LABELS: readonly { key: string; label: string }[] = [
    { key: 'rate_yoy', label: '前年比' },
    { key: 'rate_covid', label: 'コロナ前後比' },
  ]
  return LABELS.flatMap(({ key, label }) => {
    const point = byKey.get(key)
    return point === undefined ? [] : [{ label, value: point.formatted, flagged: point.flagged }]
  })
}

/** 乗降客数の推移 Panel（折れ線＋前年比/コロナ前後比の KPI）。 */
export function paxTrendPanel(detail: StationDetail, size: PanelSize = 'full'): TrendChartPanel {
  const pax = detail.series.find((series) => series.baseMetric === 'pax')
  const rate = detail.series.find((series) => series.baseMetric === 'pax_rate')
  return {
    type: 'trendChart',
    title: '乗降客数の推移',
    unit: pax?.unit ?? '人/日',
    format: pax?.format ?? 'int',
    category: 'passenger',
    flags: [],
    series: [
      { label: baseMetricLabel('pax'), points: toXY(pax), color: CATEGORY_COLORS.passenger },
    ],
    stats: paxRateStats(rate),
    size,
  }
}

/** 半径・ビンテージ指定で系列を1本引く。 */
function seriesAt(
  detail: StationDetail,
  baseMetric: string,
  radiusM: number,
  vintage: number | null = null,
): MetricSeries | undefined {
  return detail.series.find(
    (series) =>
      series.baseMetric === baseMetric && series.radiusM === radiusM && series.vintage === vintage,
  )
}

/** 人口タブの信頼性フラグ（lowbase 警告・H30 推計誤差・500m 秘匿割合）。 */
function populationFlags(detail: StationDetail, radiusM: number): ReliabilityFlag[] {
  const flags: ReliabilityFlag[] = []

  const growth = seriesAt(detail, 'pop_gr', radiusM)
  if (growth?.points.some((point) => point.flagged) === true) {
    flags.push({ label: '母数が小さく増減率は参考値', level: 'warn' })
  }

  const errPoint = seriesAt(detail, 'pop_err', radiusM, 2018)?.points[0]
  if (errPoint !== undefined && errPoint.value !== null) {
    flags.push({ label: `H30推計は2020年実績を ${errPoint.formatted} 乖離`, level: 'info' })
  }

  if (radiusM === 500) {
    const hidden = seriesAt(detail, 'pop_hidden_ratio', radiusM)?.points.at(-1)
    if (hidden !== undefined && hidden.value !== null) {
      flags.push({
        label: `500m圏は秘匿・合算メッシュ割合 ${hidden.formatted}（${hidden.year}年）`,
        level: 'info',
      })
    }
  }

  return flags
}

/** 人口の重ねチャート Panel（実績実線＋R6/H30 推計破線・凡例トグルは Chart.js が担う）。 */
function populationTrendPanel(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize,
): TrendChartPanel {
  const actual = seriesAt(detail, 'pop', radiusM)
  const predR6 = seriesAt(detail, 'pop_pred', radiusM, 2024)
  const predH30 = seriesAt(detail, 'pop_pred', radiusM, 2018)
  return {
    type: 'trendChart',
    title: `人口の推移（実績・将来推計・${radiusLabel(radiusM)}圏）`,
    unit: actual?.unit ?? '人',
    format: actual?.format ?? 'int',
    category: 'population',
    flags: populationFlags(detail, radiusM),
    series: [
      { label: '実績', points: toXY(actual), color: CATEGORY_COLORS.population },
      { label: 'R6推計', points: toXY(predR6), color: CATEGORY_COLORS.population, dashed: true },
      {
        label: 'H30推計',
        points: toXY(predH30),
        color: CATEGORY_COLORS.population_forecast,
        dashed: true,
      },
    ],
    size,
  }
}

/** 人口増減率のミニ表 Panel（選択半径の 9 ペア・lowbase は各行 ⚠）。 */
function populationGrowthTable(detail: StationDetail, radiusM: number, size: PanelSize): Panel {
  return {
    type: 'statTable',
    title: '人口増減率',
    rows: growthRows(seriesAt(detail, 'pop_gr', radiusM)),
    note: null,
    size,
  }
}

/** 人口タブ 1 枚分の Panel[]（重ねチャート → 増減率ミニ表）。選択半径で再計算（再フェッチ不要）。 */
export function populationPanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  return [populationTrendPanel(detail, radiusM, size), populationGrowthTable(detail, radiusM, size)]
}

/** 増減率系列 → ミニ表の行（yearBase→year ラベル・整形済み値・lown フラグ）。接頭辞付与可。 */
function growthRows(series: MetricSeries | undefined, prefix = ''): PanelStat[] {
  return (series?.points ?? []).map((point) => ({
    label: `${prefix}${point.yearBase ?? '?'}→${point.year ?? '?'}`,
    value: point.formatted,
    flagged: point.flagged,
  }))
}

/** 地価タブ：最寄公示カード＋半径別中央値バー＋増減率表（500m/20km はカタログで自動フォールド）。 */
export function landPricePanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  const panels: Panel[] = []

  // 最寄の地価公示（半径非依存）：価格・用途・距離
  const near = detail.series.find((series) => series.baseMetric === 'lp_near')
  const price = near?.points.find((point) => point.key === 'lp_near_price')
  const dist = near?.points.find((point) => point.key === 'lp_near_dist_m')
  const nearRows: PanelStat[] = []
  if (price !== undefined) {
    nearRows.push({
      label: '公示価格',
      value: formatWithUnit(price.value, 'yen', '円/㎡'),
      flagged: false,
    })
  }
  if (detail.station.lpNearUse !== null) {
    nearRows.push({ label: '用途', value: detail.station.lpNearUse, flagged: false })
  }
  if (dist !== undefined) {
    nearRows.push({
      label: '最寄地点まで',
      value: formatWithUnit(dist.value, 'int', 'm'),
      flagged: false,
    })
  }
  if (nearRows.length > 0) {
    panels.push({ type: 'statTable', title: '最寄の地価公示', rows: nearRows, note: null, size })
  }

  // 中央値の推移（選択半径の折れ線＝乗降/人口と同形式・P5e）。20km は lp_med なし＝自動フォールド。
  const lpMed = seriesAt(detail, 'lp_med', radiusM)
  if (lpMed !== undefined && lpMed.points.some((point) => point.value !== null)) {
    panels.push({
      type: 'trendChart',
      title: `地価中央値の推移（${radiusLabel(radiusM)}圏）`,
      unit: '円/㎡',
      format: 'yen',
      category: 'land_price',
      flags: lpMed.points.some((point) => point.flagged)
        ? [{ label: '公示地点が少なく中央値は参考値', level: 'warn' }]
        : [],
      series: [{ label: '地価中央値', points: toXY(lpMed), color: CATEGORY_COLORS.land_price }],
      size,
    })
  }

  // 中央値（半径別・最新年）：500m〜10km の横棒＝空間比較の補助（20km はデータなし＝自動フォールド）。
  const medBars: Bar[] = RADII_M.flatMap((radius) => {
    const point = seriesAt(detail, 'lp_med', radius)?.points.at(-1)
    if (point === undefined || point.value === null) return []
    return [
      {
        label: radiusLabel(radius),
        value: point.value,
        formatted: point.formatted,
        flagged: point.flagged,
        emphasis: radius === radiusM,
      },
    ]
  })
  if (medBars.length > 0) {
    panels.push({
      type: 'barChart',
      title: '地価中央値（半径別・最新年）',
      unit: '円/㎡',
      format: 'yen',
      category: 'land_price',
      bars: medBars,
      flags: [],
      note: '半径が大きいほど郊外を含み、中央値は下がる傾向（空間比較の補助）。',
      size,
    })
  }

  // 増減率（選択半径・5 期間）：500m/20km は非対応 → 注記
  const growth = seriesAt(detail, 'lp_gr', radiusM)
  const grRows = growthRows(growth)
  panels.push({
    type: 'statTable',
    title: `地価増減率（${radiusLabel(radiusM)}圏）`,
    rows: grRows,
    note:
      grRows.length === 0
        ? `${radiusLabel(radiusM)}圏は公示地価の増減率が非対応です（500m・20km は算出対象外）。`
        : null,
    size,
  })

  return panels
}

/** バスタブ：2010→現在の対比バー＋一般/高速内訳・対2010年増減率（lown ⚠）。 */
export function busPanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  const panels: Panel[] = []

  // 停留所数の推移：2010年度 → 現在の 2 点折れ線（データは2時点のみ・P5e）
  const now = seriesAt(detail, 'bus_n', radiusM)?.points[0]
  const y2010 = seriesAt(detail, 'bus_n2010', radiusM)?.points[0]
  const busPoints: { x: number; y: number | null }[] = []
  if (y2010 !== undefined && y2010.value !== null) busPoints.push({ x: 2010, y: y2010.value })
  if (now !== undefined && now.value !== null) busPoints.push({ x: BUS_CURRENT_YEAR, y: now.value })
  if (busPoints.length > 0) {
    panels.push({
      type: 'trendChart',
      title: `バス停留所数の推移（${radiusLabel(radiusM)}圏）`,
      unit: '箇所',
      format: 'int',
      category: 'bus',
      flags: [],
      series: [{ label: 'バス停留所数', points: busPoints, color: CATEGORY_COLORS.bus }],
      size,
    })
  }

  const local = seriesAt(detail, 'bus_n_local', radiusM)?.points[0]
  const highway = seriesAt(detail, 'bus_n_hw', radiusM)?.points[0]
  const growth = seriesAt(detail, 'bus_gr', radiusM)?.points[0]
  const rows: PanelStat[] = []
  if (local !== undefined) {
    rows.push({
      label: '一般バス停',
      value: formatWithUnit(local.value, 'int', '箇所'),
      flagged: false,
    })
  }
  if (highway !== undefined) {
    rows.push({
      label: '高速バス停',
      value: formatWithUnit(highway.value, 'int', '箇所'),
      flagged: false,
    })
  }
  if (growth !== undefined) {
    rows.push({ label: '対2010年 増減率', value: growth.formatted, flagged: growth.flagged })
  }
  if (rows.length > 0) {
    panels.push({ type: 'statTable', title: '内訳・増減', rows, note: null, size })
  }

  return panels
}

/** 事業所タブ：事業所数の推移（3 時点）＋増減率（9年/5年・estab_gr_lown ⚠）。従業者は独立タブ。 */
export function establishmentPanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  const panels: Panel[] = []

  const estab = seriesAt(detail, 'estab_n', radiusM)
  if (estab !== undefined && estab.points.length > 0) {
    panels.push({
      type: 'trendChart',
      title: '事業所数の推移',
      unit: estab.unit,
      format: estab.format,
      category: 'establishment',
      flags: [],
      series: [{ label: '事業所数', points: toXY(estab), color: CATEGORY_COLORS.establishment }],
      size,
    })
  }

  const rows = growthRows(seriesAt(detail, 'estab_gr', radiusM))
  if (rows.length > 0) {
    panels.push({ type: 'statTable', title: '事業所数 増減率', rows, note: null, size })
  }

  return panels
}

/** 従業者タブ：従業者数の推移（3 時点）＋増減率（9年/5年・estab_gr_lown ⚠）。 */
export function employeePanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  const panels: Panel[] = []

  const emp = seriesAt(detail, 'emp_n', radiusM)
  if (emp !== undefined && emp.points.length > 0) {
    panels.push({
      type: 'trendChart',
      title: '従業者数の推移',
      unit: emp.unit,
      format: emp.format,
      category: 'employee',
      flags: [],
      series: [{ label: '従業者数', points: toXY(emp), color: CATEGORY_COLORS.employee }],
      size,
    })
  }

  const rows = growthRows(seriesAt(detail, 'emp_gr', radiusM))
  if (rows.length > 0) {
    panels.push({ type: 'statTable', title: '従業者数 増減率', rows, note: null, size })
  }

  return panels
}

/**
 * 所得タブ：1 人当たり課税対象所得の推移 ＋ 半径別 ＋ 総額 ＋ 1 人当たりの増減率（docs/income.md §6）。
 *
 * 政令市（`inc_city_only`）は**点ごとのバッジではなくタブの注記**にする。所得は市区町村単位でしか
 * 公表されないので 500m〜1km ではどの駅も自区市町村の平均になり（docs/income.md §11 の限界 #1）、
 * 「政令市かどうか」は点の属性というより駅の置かれた条件だから。
 */
export function incomePanels(
  detail: StationDetail,
  radiusM: number,
  size: PanelSize = 'full',
): Panel[] {
  const panels: Panel[] = []
  const radius = radiusLabel(radiusM)

  const perCapita = seriesAt(detail, 'inc_pc', radiusM)
  const total = seriesAt(detail, 'inc_total', radiusM)
  // 総額の notice が政令市フラグ（カタログ駆動）。1 点でも立てばこの半径は市平均が主。
  const cityOnly = total?.points.some((point) => point.flagged) === true
  const lowDenominator = perCapita?.points.some((point) => point.flagged) === true

  if (perCapita !== undefined && perCapita.points.some((point) => point.value !== null)) {
    panels.push({
      type: 'trendChart',
      title: `1人当たり課税対象所得の推移（${radius}圏）`,
      unit: perCapita.unit,
      format: perCapita.format,
      category: 'income',
      flags: lowDenominator
        ? [{ label: '納税義務者が少なく1人当たりは参考値', level: 'warn' }]
        : [],
      series: [
        {
          label: baseMetricLabel('inc_pc'),
          points: toXY(perCapita),
          color: CATEGORY_COLORS.income,
        },
      ],
      stats: incomeStats(perCapita),
      size,
    })
  }

  // 半径別（最新年度）：都心に近いほど高いか／周辺と比べてどうかを空間で見る。
  const perCapitaBars: Bar[] = RADII_M.flatMap((candidate) => {
    const point = seriesAt(detail, 'inc_pc', candidate)?.points.at(-1)
    if (point === undefined || point.value === null) return []
    return [
      {
        label: radiusLabel(candidate),
        value: point.value,
        formatted: point.formatted,
        flagged: point.flagged,
        emphasis: candidate === radiusM,
      },
    ]
  })
  if (perCapitaBars.length > 0) {
    panels.push({
      type: 'barChart',
      title: '1人当たり課税対象所得（半径別・最新年度）',
      unit: perCapita?.unit ?? '万円/人',
      format: perCapita?.format ?? 'decimal1',
      category: 'income',
      bars: perCapitaBars,
      flags: [],
      note: '半径が大きいほど周辺の市区町村が混ざり、水準はならされる（空間比較の補助）。',
      size,
    })
  }

  panels.push(
    ...withNoteOnLast(
      [
        ...incomeTotalTable(total, radius, size),
        ...incomeGrowthTable(seriesAt(detail, 'inc_gr', radiusM), radius, size),
      ],
      incomeNote(cityOnly),
    ),
  )

  return panels
}

/**
 * 課税対象所得の総額（規模）の表：最新年度の 1 行。
 *
 * 総額（規模）と 1 人当たりの増減率は**主語が違う**ので表を分ける。1 つの表に混ぜていた頃は
 * 「+57.0%」が総額の増減率に見え、さらに行が 2 列のセルに収まらず隣の列の文字と重なっていた
 * （docs/260816_stat_table_layout.md）。主語は表題・行は年次にすると、人口・地価・事業所と同じ形になる。
 */
function incomeTotalTable(
  total: MetricSeries | undefined,
  radius: string,
  size: PanelSize,
): StatTablePanel[] {
  const latest = total?.points.at(-1)
  if (latest === undefined) return []
  const row: PanelStat = {
    label: `${latest.year ?? '?'}年度`,
    value: formatWithUnit(latest.value, total?.format ?? 'int', total?.unit ?? '百万円'),
    flagged: false,
  }
  return [
    { type: 'statTable', title: `課税対象所得 総額（${radius}圏）`, rows: [row], note: null, size },
  ]
}

/** 1 人当たり課税対象所得の増減率の表（カタログの `inc_gr` は 1 人当たりの率）。 */
function incomeGrowthTable(
  growth: MetricSeries | undefined,
  radius: string,
  size: PanelSize,
): StatTablePanel[] {
  const rows = growthRows(growth)
  if (rows.length === 0) return []
  return [
    {
      type: 'statTable',
      title: `1人当たり課税対象所得 増減率（${radius}圏）`,
      rows,
      note: null,
      size,
    },
  ]
}

/** 注記（所得の定義・按分・政令市）はタブ全体に効くので、最後の表にだけ添える。 */
function withNoteOnLast(tables: StatTablePanel[], note: string): StatTablePanel[] {
  return tables.map((table, index) => (index === tables.length - 1 ? { ...table, note } : table))
}

/** 全国の市区町村の 1 人当たり課税対象所得 中央値（2025年度・docs/income.md §1）。 */
const INCOME_NATIONWIDE_MEDIAN = 309.9

/** 1 人当たり所得の要約（最新年度の水準と、全国の市区町村中央値との比）。 */
function incomeStats(series: MetricSeries): PanelStat[] {
  const latest = series.points.at(-1)
  if (latest === undefined || latest.value === null) return []
  const ratio = (latest.value / INCOME_NATIONWIDE_MEDIAN - 1) * 100
  return [
    { label: `${latest.year ?? '?'}年度`, value: latest.formatted, flagged: latest.flagged },
    {
      label: '全国の市区町村中央値比',
      value: formatNumber(ratio, 'percent1', { signed: true }),
      flagged: latest.flagged,
    },
  ]
}

/** 所得タブの注記（読み違えやすい 2 点＋政令市のときだけ粒度）。 */
function incomeNote(cityOnly: boolean): string {
  const notes = [
    '「所得」は給与収入ではなく給与所得控除後の額です（N年度の課税＝N−1年の所得）。',
    '市区町村の値を半径内の15〜64歳人口で按分しています。',
  ]
  if (cityOnly) {
    notes.push('この半径の納税義務者は過半が政令指定都市に属するため、値は市全体の平均が主です。')
  }
  return notes.join('')
}

/** 乗降タブ 1 枚分の Panel[]（駅カード → 推移チャート）。UI/AI が同一配列を描画する。 */
export function passengerPanels(detail: StationDetail, size: PanelSize = 'full'): Panel[] {
  return [stationCardPanel(detail, size), paxTrendPanel(detail, size)]
}
