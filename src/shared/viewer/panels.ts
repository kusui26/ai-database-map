/**
 * ビューアのパネル描画——**GUI Chat Protocol (Map Edition) のパネル → VNode**（純関数）。
 *
 * `docs/260912_gui_chat_protocol.md` 決定 11 の「残す部品」。旧 MCP Apps ビューアが
 * 文字列 JS の `RENDERERS` で持っていた描き分けを、**判別ユニオンを網羅する switch** に移した
 * ——protocol にパネル型を足すと、ここが型エラーになる（描き忘れがテストより前に落ちる）。
 *
 * 設計判断：
 * - **意味づけは持たない**：単位・年次・⚠・免責・出典は protocol のパネルが既に持っている。
 *   ここがするのは並べ方（と、色・記号のような表示語彙の付与）だけ
 * - **色・ラベルは共有定数から**：危険度の色／ラベル／記号、クラスタ色、整形は
 *   `shared/constants`・`shared/format` を使う（旧ビューアはこれらを文字列 JS に**複製**して
 *   「変えるときは両方」と注記していた。TS に移す最大の利得がこの重複の解消）
 * - **色だけで危険度を伝えない**（`docs/260824_flood.md` §7.6）：色＋記号＋テキストの 3 要素
 */

import {
  ACCENT_COLOR,
  radiusLabel,
  EVACUATION_LABELS_JA,
  HAZARD_LEVEL_COLORS,
  HAZARD_LEVEL_ICONS,
  HAZARD_LEVEL_LABELS_JA,
} from '@/shared/constants'
import { formatNumber } from '@/shared/format'
import {
  type AreaComparisonTable,
  type AreaStationStat,
  type AreaSummaryCard,
  type AreaTotalLine,
  type StationLegend,
} from '@/shared/area-summary'
import {
  type AreaSummaryPanel,
  type BarChartPanel,
  type EscapeDirectionPanel,
  type EvacuationListPanel,
  type HazardCardPanel,
  type MarkdownPanel,
  type Panel,
  type RankingTablePanel,
  type ReliabilityFlag,
  type ScatterPanel,
  type SourceRef,
  type StatTablePanel,
  type StationCardPanel,
  type StationProfilePanel,
  type TrendChartPanel,
} from '@/shared/protocol'
import { type ProfileItem, type ProfileSection } from '@/shared/profile'
import { CHART_BAR_COLOR, safeColor, scatterSvg, seriesColor, trendChartSvg } from './charts'
import { el, type VNode } from './vnode'

// --- 共通部品 -----------------------------------------------------------

/** 丸いラベル（⚠ つきは警告色）。 */
const chip = (label: string, warn = false): VNode =>
  el('span', { cls: warn ? 'chip warn' : 'chip', text: label })

/** 見出し（単位があれば括弧で添える）。 */
const titleNode = (title: string, unit: string | null = null): VNode =>
  el('div', { cls: 'title', text: unit === null ? title : `${title}（${unit}）` })

/** 信頼性フラグの行（無ければ null＝描かない）。 */
function flagChips(flags: readonly ReliabilityFlag[]): VNode | null {
  if (flags.length === 0) return null
  return el('div', {
    cls: 'chips',
    children: flags.map((flag) => chip(`⚠ ${flag.label}`, flag.level === 'warn')),
  })
}

/** 注記のかたまり（限界・網羅性・理由。**削らない**のが規範なので、全部並べる）。 */
function notesNode(notes: readonly string[]): VNode | null {
  if (notes.length === 0) return null
  return el('div', {
    cls: 'notes',
    children: notes.map((note) => el('div', { text: `・${note}` })),
  })
}

/** 出典（同じ表記は畳む。リンクにはしない＝遷移はホスト裁量）。 */
function sourcesNode(sources: readonly SourceRef[]): VNode | null {
  if (sources.length === 0) return null
  const labels = [...new Set(sources.map((source) => source.labelJa))]
  return el('div', { cls: 'muted', text: `出典: ${labels.join(' / ')}` })
}

/** 危険度のバッジ（色＋記号＋テキストの 3 要素）。 */
function levelBadge(level: HazardCardPanel['level']): VNode {
  return el('span', {
    cls: 'level',
    text: `${HAZARD_LEVEL_ICONS[level]} ${HAZARD_LEVEL_LABELS_JA[level]}`,
    style: { background: HAZARD_LEVEL_COLORS[level] },
  })
}

/** パネルの外枠。 */
const panelBox = (children: readonly (VNode | null)[]): VNode =>
  el('div', { cls: 'panel', children })

// --- パネル別 -----------------------------------------------------------

function stationCardNode(panel: StationCardPanel): VNode {
  return panelBox([
    el('div', { cls: 'title', text: `${panel.label}（${panel.prefecture}）` }),
    panel.operators === null ? null : el('div', { cls: 'muted', text: panel.operators }),
    panel.paxLatest === null
      ? null
      : el('div', {
          cls: 'muted',
          text: `乗降客数（最新年）: ${formatNumber(panel.paxLatest, 'int')} 人/日`,
        }),
    flagChips(panel.badges),
  ])
}

function trendChartNode(panel: TrendChartPanel): VNode {
  return panelBox([
    titleNode(panel.title, panel.unit),
    trendChartSvg(panel),
    el('div', {
      cls: 'chips',
      children: panel.series.map((series, index) =>
        el('span', {
          cls: 'chip',
          text: series.label,
          style: { 'border-color': seriesColor(series, index, panel.category) },
        }),
      ),
    }),
    panel.stats === undefined || panel.stats.length === 0
      ? null
      : el('div', {
          cls: 'chips',
          children: panel.stats.map((stat) => chip(`${stat.label} ${stat.value}`, stat.flagged)),
        }),
    flagChips(panel.flags),
  ])
}

function statTableNode(panel: StatTablePanel): VNode {
  return panelBox([
    titleNode(panel.title),
    el('table', {
      children: panel.rows.map((row) =>
        el('tr', {
          children: [
            el('td', { text: row.flagged ? `⚠ ${row.label}` : row.label }),
            el('td', { cls: 'num', text: row.value }),
          ],
        }),
      ),
    }),
    panel.note === null || panel.note === undefined
      ? null
      : el('div', { cls: 'muted', text: panel.note }),
  ])
}

/**
 * 棒の塗り。値に負があれば **0 を真ん中**に置き、負は左・正は右へ伸ばす（人口の増減など）。
 * 負が無ければ以前のまま左から（半径別の地価など・見た目は変えない）。
 */
function barFill(bar: BarChartPanel['bars'][number], scale: number, signed: boolean): VNode[] {
  const accent: Readonly<Record<string, string>> =
    bar.emphasis === true ? { background: ACCENT_COLOR } : {}
  if (!signed) {
    const width = bar.value === null ? '0%' : `${Math.max(2, (bar.value / scale) * 100)}%`
    return [el('div', { cls: 'bar-fill', style: { width, ...accent } })]
  }
  // 幅は小数 2 桁に丸める（属性を短く・出力を決定的に・チャートの座標と同じ）。
  const half = bar.value === null ? 0 : Math.round((Math.abs(bar.value) / scale) * 50 * 100) / 100
  const left = bar.value !== null && bar.value < 0 ? Math.round((50 - half) * 100) / 100 : 50
  return [
    el('div', { cls: 'bar-zero' }),
    el('div', {
      cls: 'bar-fill signed',
      style: { left: `${left}%`, width: `${half}%`, ...accent },
    }),
  ]
}

function barChartNode(panel: BarChartPanel): VNode {
  const values = panel.bars.flatMap((bar) => (bar.value === null ? [] : [bar.value]))
  const signed = values.some((value) => value < 0)
  const scale = signed
    ? Math.max(...values.map((value) => Math.abs(value)), 1)
    : Math.max(...values, 1)
  return panelBox([
    titleNode(panel.title, panel.unit),
    ...panel.bars.map((bar) =>
      el('div', {
        cls: 'bar-row',
        children: [
          el('div', {
            text: bar.flagged ? `⚠ ${bar.label}` : bar.label,
            ...(bar.emphasis === true ? { style: { 'font-weight': '600' } } : {}),
          }),
          el('div', { cls: 'bar-track', children: barFill(bar, scale, signed) }),
          el('div', { cls: 'num', text: bar.formatted }),
        ],
      }),
    ),
    panel.note === null || panel.note === undefined
      ? null
      : el('div', { cls: 'muted', text: panel.note }),
    flagChips(panel.flags),
  ])
}

function rankingTableNode(panel: RankingTablePanel): VNode {
  const head = ['#', '駅', '都道府県', panel.unit === null ? '値' : `値（${panel.unit}）`]
  return panelBox([
    titleNode(panel.title),
    el('table', {
      children: [
        el('tr', { children: head.map((label) => el('th', { text: label })) }),
        ...panel.rows.map((row) =>
          el('tr', {
            children: [
              el('td', { cls: 'num', text: row.rank }),
              el('td', { text: row.flagged ? `⚠ ${row.name}` : row.name }),
              el('td', { text: row.prefecture }),
              el('td', { cls: 'num', text: row.formatted }),
            ],
          }),
        ),
      ],
    }),
  ])
}

function scatterNode(panel: ScatterPanel): VNode {
  const axis = (label: string, unit: string | null): string =>
    unit === null ? label : `${label}（${unit}）`
  return panelBox([
    titleNode(panel.title),
    scatterSvg(panel),
    el('div', {
      cls: 'muted',
      text:
        `x: ${axis(panel.xLabel, panel.xUnit)} ／ y: ${axis(panel.yLabel, panel.yUnit)}` +
        ` ／ 色＝クラスタ（${panel.clusterCount}）`,
    }),
  ])
}

function hazardCardNode(panel: HazardCardPanel): VNode {
  return panelBox([
    el('div', {
      children: [levelBadge(panel.level), el('span', { cls: 'muted', text: ` ${panel.placeJa}` })],
    }),
    el('div', { cls: 'title', text: panel.headlineJa }),
    panel.evacuation === null
      ? null
      : el('div', { text: `避難の目安: ${EVACUATION_LABELS_JA[panel.evacuation]}` }),
    el('ul', {
      cls: 'items',
      children: panel.items.map((item) =>
        el('li', {
          text: `${HAZARD_LEVEL_ICONS[item.level]} ${item.labelJa}：${item.valueJa}`,
          style: { 'border-left-color': HAZARD_LEVEL_COLORS[item.level] },
        }),
      ),
    }),
    notesNode([...panel.reasonsJa, ...panel.coverageNotesJa]),
    sourcesNode(panel.sources),
    el('div', { cls: 'muted', text: panel.disclaimerJa }),
  ])
}

function evacuationListNode(panel: EvacuationListPanel): VNode {
  return panelBox([
    el('div', { cls: 'title', text: panel.headlineJa }),
    el('div', {
      cls: 'muted',
      text: `${panel.siteKindJa}（${panel.forDisasterJa}・${panel.placeJa}）`,
    }),
    el('table', {
      children: panel.items.map((item, index) =>
        el('tr', {
          children: [
            el('td', { cls: 'num', text: index + 1 }),
            el('td', {
              children: [
                el('div', { text: `${item.nameJa}（${item.distanceJa}・${item.bearingJa}）` }),
                el('div', {
                  cls: 'muted',
                  text:
                    item.remarksJa === null
                      ? item.hazardAreaJa
                      : `${item.hazardAreaJa}／${item.remarksJa}`,
                }),
              ],
            }),
          ],
        }),
      ),
    }),
    notesNode([...panel.limitationsJa, ...panel.notesJa]),
    sourcesNode(panel.sources),
    el('div', { cls: 'muted', text: panel.disclaimerJa }),
  ])
}

function escapeDirectionNode(panel: EscapeDirectionPanel): VNode {
  return panelBox([
    el('div', { cls: 'title', text: panel.headlineJa }),
    el('div', { cls: 'muted', text: `${panel.forDisasterJa}・${panel.placeJa}` }),
    panel.direction === null
      ? null
      : el('div', {
          text: `${panel.direction.bearingJa} へ ${panel.direction.distanceJa}`,
        }),
    notesNode([...panel.limitationsJa, ...panel.notesJa]),
    sourcesNode(panel.sources),
    el('div', { cls: 'muted', text: panel.disclaimerJa }),
  ])
}

/** プロフィールの表の列の数（名前・年 ／ 値 ／ 位置）。 */
const PROFILE_COLUMNS = 3
/** エリアの区域の値・駅の周りの表の列の数（注記の行を横に通す）。 */
const AREA_TOTAL_COLUMNS = 3

/** プロフィールの 1 項目の行（名前・年 ／ 値 ／ 県内・市内の位置）。注記は次の行に。 */
function profileItemRows(item: ProfileItem): VNode[] {
  const positions = item.positions.map((each) => `${each.scopeJa} ${each.shareJa}`).join('・')
  const row = el('tr', {
    children: [
      el('td', {
        children: [
          el('div', { text: item.flagged ? `⚠ ${item.labelJa}` : item.labelJa }),
          el('div', { cls: 'muted', text: item.periodJa }),
        ],
      }),
      el('td', { cls: 'num', text: item.valueJa }),
      el('td', { cls: 'muted', text: positions === '' ? '—' : positions }),
    ],
  })
  if (item.noteJa === null) return [row]
  const note = el('td', { cls: 'muted', text: item.noteJa, attrs: { colspan: PROFILE_COLUMNS } })
  return [row, el('tr', { children: [note] })]
}

function profileSectionNodes(section: ProfileSection): VNode[] {
  return [
    el('div', { cls: 'title', text: section.titleJa }),
    el('table', { children: section.items.flatMap(profileItemRows) }),
  ]
}

/** 災害の要約。危険度の**語**は出さない（いまの危険度と読まれる・Web UI のバッジと同じ）——色と記号と文で。 */
function profileHazardNodes(panel: StationProfilePanel): VNode[] {
  const hazard = panel.hazard
  if (hazard === null) {
    return [
      el('div', { cls: 'muted', text: '災害の要約はありません（安全という意味ではありません）。' }),
    ]
  }
  return [
    el('div', { cls: 'title', text: '災害（もし起きたら）' }),
    el('div', {
      children: [
        el('span', {
          cls: 'level',
          text: HAZARD_LEVEL_ICONS[hazard.level],
          style: { background: HAZARD_LEVEL_COLORS[hazard.level] },
        }),
        el('span', { text: ` ${hazard.headlineJa}` }),
      ],
    }),
    el('ul', { cls: 'items', children: hazard.hitsJa.map((hit) => el('li', { text: hit })) }),
    hazard.uncoveredJa.length === 0
      ? el('div', { cls: 'muted', text: hazard.caveatJa })
      : el('div', {
          cls: 'muted',
          text: `区域図が無い災害: ${hazard.uncoveredJa.join('・')}（安全という意味ではありません）。${hazard.caveatJa}`,
        }),
    el('div', {
      cls: 'muted',
      text: `出典: ${hazard.sources.map((each) => each.source).join(' / ')}`,
    }),
  ]
}

function stationProfileNode(panel: StationProfilePanel): VNode {
  const { character } = panel
  return panelBox([
    titleNode(panel.title),
    el('div', { text: `${character.labelJa}：${character.summaryJa}` }),
    character.basisJa === '' ? null : el('div', { cls: 'muted', text: character.basisJa }),
    el('div', { cls: 'muted', text: panel.positionsLegendJa }),
    ...panel.sections.flatMap(profileSectionNodes),
    ...profileHazardNodes(panel),
    notesNode([`見ていないこと: ${panel.notCoveredJa.join('・')}`, ...panel.notesJa]),
    sourcesNode(panel.sources),
  ])
}

/** 区域の値の行（名前 ／ 見出しの文 ／ 作り方）。推計の山と当たり具合は次の行に。 */
function areaTotalRows(total: AreaTotalLine): VNode[] {
  const row = el('tr', {
    children: [
      el('td', { text: total.labelJa }),
      el('td', { text: total.headlineJa }),
      el('td', { cls: 'muted', text: total.methodJa }),
    ],
  })
  const extras = [
    total.peak === null ? null : `推計の山：${total.peak.year}年 ${total.peak.valueJa}`,
    total.accuracy?.textJa ?? null,
  ].filter((text): text is string => text !== null)
  if (extras.length === 0) return [row]
  const note = el('td', {
    cls: 'muted',
    text: extras.join('・'),
    attrs: { colspan: AREA_TOTAL_COLUMNS },
  })
  return [row, el('tr', { children: [note] })]
}

/** 駅の周りの 1 指標（名前・期間 ／ 中央値 ／ 中ほどの半分）と、上位・下位。 */
function areaStationRows(stat: AreaStationStat): VNode[] {
  const row = el('tr', {
    children: [
      el('td', {
        children: [
          el('div', { text: stat.labelJa }),
          el('div', { cls: 'muted', text: stat.periodJa }),
        ],
      }),
      el('td', { cls: 'num', text: stat.medianJa }),
      el('td', { cls: 'muted', text: `${stat.rangeJa}（${stat.n} 駅）` }),
    ],
  })
  const edges = [
    stat.top.length === 0
      ? null
      : `上位 ${stat.top.map((each) => `${each.labelJa} ${each.valueJa}`).join('・')}`,
    stat.bottom.length === 0
      ? null
      : `下位 ${stat.bottom.map((each) => `${each.labelJa} ${each.valueJa}`).join('・')}`,
    stat.flaggedN > 0 ? `⚠ ${stat.flaggedN} 駅は参考値なので除いた` : null,
    stat.noteJa,
  ].filter((text): text is string => text !== null)
  if (edges.length === 0) return [row]
  const note = el('td', {
    cls: 'muted',
    text: edges.join('／'),
    attrs: { colspan: AREA_TOTAL_COLUMNS },
  })
  return [row, el('tr', { children: [note] })]
}

/** エリア 1 つ（比較のときは見出しを付ける）。 */
function areaCardNodes(card: AreaSummaryCard, comparing: boolean): (VNode | null)[] {
  const facts = [
    card.kindJa,
    `駅 ${card.stationCount}`,
    card.areaKm2 === null ? null : `${card.areaKm2} km²`,
  ]
  const stations = card.stations
  return [
    comparing ? el('div', { cls: 'title', text: card.labelJa }) : null,
    el('div', { cls: 'muted', text: facts.filter((fact) => fact !== null).join('・') }),
    card.totals.length === 0 ? null : el('table', { children: card.totals.flatMap(areaTotalRows) }),
    notesNode(card.unavailableJa.map((item) => `出せない値：${item}`)),
    stations.stats.length === 0
      ? null
      : el('div', {
          cls: 'title',
          text: `駅の周り（${radiusLabel(stations.radiusM)}圏・${stations.count} 駅）`,
        }),
    stations.stats.length === 0
      ? null
      : el('table', { children: stations.stats.flatMap(areaStationRows) }),
  ]
}

/** 比べる表（行＝項目・列＝エリア）。 */
function comparisonNode(comparison: AreaComparisonTable): VNode {
  const head = el('tr', {
    children: [el('th', { text: '' }), ...comparison.names.map((name) => el('th', { text: name }))],
  })
  const rows = comparison.rows.map((row) =>
    el('tr', {
      children: [
        el('td', { cls: 'muted', text: row.labelJa }),
        ...row.cells.map((cell) => el('td', { text: cell })),
      ],
    }),
  )
  return el('table', { children: [head, ...rows] })
}

/** 色分けの凡例（色は形を確かめてから描く・色分けしなかったら理由）。 */
function legendNodes(legend: StationLegend): (VNode | null)[] {
  const item = (color: string, label: string, count: number): VNode =>
    el('div', {
      children: [
        el('span', { cls: 'swatch', style: { background: safeColor(color, CHART_BAR_COLOR) } }),
        el('span', { text: `${label}（${count} 駅）` }),
      ],
    })
  const classes = legend.classes.map((each) => item(each.color, each.labelJa, each.count))
  const flagged =
    legend.flagged.count > 0
      ? item(legend.flagged.color, legend.flagged.labelJa, legend.flagged.count)
      : null
  return [
    el('div', { cls: 'title', text: `地図の色分け：${legend.titleJa}` }),
    legend.reasonJa === null ? null : el('div', { cls: 'muted', text: legend.reasonJa }),
    ...classes,
    flagged,
    legend.missingCount > 0
      ? el('div', { cls: 'muted', text: `値なし ${legend.missingCount} 駅（描かない）` })
      : null,
    legend.meaningJa === null ? null : el('div', { cls: 'muted', text: legend.meaningJa }),
  ]
}

function areaSummaryNode(panel: AreaSummaryPanel): VNode {
  const comparing = panel.comparison !== null
  return panelBox([
    titleNode(panel.title),
    panel.comparison === null ? null : comparisonNode(panel.comparison),
    ...panel.areas.flatMap((card) => areaCardNodes(card, comparing)),
    ...(panel.legend === null ? [] : legendNodes(panel.legend)),
    notesNode([
      `見ていないこと: ${panel.notIncludedJa.join('・')}`,
      ...panel.notesJa,
      ...(panel.comparison?.notesJa ?? []),
    ]),
    sourcesNode(panel.sources),
  ])
}

function markdownNode(panel: MarkdownPanel): VNode {
  // 段落だけを扱う（強調・リンクの解釈はしない＝本文をそのまま読ませる）。
  const paragraphs = panel.body.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== '')
  return panelBox(paragraphs.map((paragraph) => el('p', { text: paragraph })))
}

/**
 * 未対応のパネル型（**型としては到達しない**）。
 * 引数が `never` なので、protocol に型を足して switch に書き忘れると**ここで型エラー**になる。
 * 実行時には来うる（新しいサーバの応答を古いビューアが読む）ので、黙らずに 1 行出す。
 */
function unsupportedPanelNode(panel: never): VNode {
  const raw: unknown = panel
  const type =
    typeof raw === 'object' && raw !== null && 'type' in raw && typeof raw.type === 'string'
      ? raw.type
      : '不明'
  return panelBox([el('div', { cls: 'muted', text: `未対応のパネル型: ${type}` })])
}

/** パネル 1 枚 → 描画する木（`.panel` の箱ごと返す）。 */
export function panelToVNode(panel: Panel): VNode {
  switch (panel.type) {
    case 'stationCard':
      return stationCardNode(panel)
    case 'trendChart':
      return trendChartNode(panel)
    case 'statTable':
      return statTableNode(panel)
    case 'barChart':
      return barChartNode(panel)
    case 'rankingTable':
      return rankingTableNode(panel)
    case 'scatter':
      return scatterNode(panel)
    case 'hazardCard':
      return hazardCardNode(panel)
    case 'evacuationList':
      return evacuationListNode(panel)
    case 'escapeDirection':
      return escapeDirectionNode(panel)
    case 'stationProfile':
      return stationProfileNode(panel)
    case 'areaSummary':
      return areaSummaryNode(panel)
    case 'markdown':
      return markdownNode(panel)
    default:
      return unsupportedPanelNode(panel)
  }
}

/** パネル列 → 描画する木の列（順序はそのまま）。 */
export function panelsToVNodes(panels: readonly Panel[]): readonly VNode[] {
  return panels.map(panelToVNode)
}
