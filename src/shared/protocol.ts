/**
 * GUI Chat Protocol (Map Edition) v1 — 構造化UI（クリック）と LLM（会話）が
 * produce/consume する共通の応答型（architecture.md §4・plan_fable §3.2）。
 *
 * P5/P6 の UI パネルはこの Panel 型を props に取り、Step2 でそのままレンダラになる。
 * すべて Zod で定義し、型は z.infer で導出する（UI と AI が同一の型を共有）。
 */

import { z } from 'zod'
import { categorySchema, formatSchema } from './catalog'
import {
  evacuationActionSchema,
  hazardCertaintySchema,
  hazardLevelSchema,
  hazardSourceSchema,
} from './hazard'

// --- メッセージ ---------------------------------------------------------
export const messageSchema = z.object({
  role: z.enum(['assistant', 'user']),
  text: z.string(),
})
export type Message = z.infer<typeof messageSchema>

// --- 地図アクション（返答ストリーミング中に即時実行） -------------------
export const mapActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('flyTo'),
    lon: z.number(),
    lat: z.number(),
    zoom: z.number().optional(),
  }),
  z.object({ type: z.literal('selectStation'), grp: z.string(), radiusM: z.number().optional() }),
  z.object({ type: z.literal('highlightStations'), grps: z.array(z.string()) }),
  z.object({ type: z.literal('clearOverlays') }),
  /**
   * ハザードレイヤの表示切替（260824_flood §6.4）。`layers` はハザード・カタログに実在する key で、
   * **空配列＝すべて消す**。`opacity` は 0.3–0.9（`constants.HAZARD_OPACITY_*`）。
   * 生の key をそのまま流さない（受け手が `resolveHazardLayerKeys` で正規化する）。
   */
  z.object({
    type: z.literal('setHazardLayers'),
    layers: z.array(z.string()),
    opacity: z.number().optional(),
  }),
  /**
   * 駅ではない**任意の地点**を指す（地図クリック・現在地・避難先）。
   * 水害は「その一点の話」なので、駅選択とは別の操作系が要る（同 §7.1）。
   */
  z.object({
    type: z.literal('showPoint'),
    lon: z.number(),
    lat: z.number(),
    labelJa: z.string().optional(),
  }),
  /**
   * **複数の行き先**を地図に置く（避難先・§8.5）。`showPoint`（今いる・聞かれた 1 点）とは
   * 役割が違うので別の操作にしてある——同じ印にすると「どこからどこへ」が読めなくなる。
   * 並びは一覧と同じで、地図には**番号**が出る（一覧の何番かが分かる）。
   * **空配列＝すべて消す。**
   */
  z.object({
    type: z.literal('highlightPoints'),
    points: z.array(z.object({ lon: z.number(), lat: z.number(), labelJa: z.string() })),
  }),
])
export type MapAction = z.infer<typeof mapActionSchema>

// --- パネル部品 ---------------------------------------------------------
/** 表示先ヒント（チャット=inline 既定・⤢で drawer/modal へ昇格）。 */
export const placementSchema = z.enum(['inline', 'drawer', 'modal']).optional()
/** 表示バリアント（チャット内=compact／ドロワー・モーダル=full）。 */
export const sizeSchema = z.enum(['compact', 'full']).optional()

/** 信頼性フラグの注意表示（lowbase/lown）。 */
export const reliabilityFlagSchema = z.object({
  label: z.string(),
  level: z.enum(['warn', 'info']),
})
export type ReliabilityFlag = z.infer<typeof reliabilityFlagSchema>

/**
 * 出典の参照（ハザードは「いつの・誰のデータか」を必ず添える・260824_flood §7.5-3）。
 *
 * この 1 件は 2 つの仕事をしている（260828_fix_flood §11.3）。
 * ①**法的な出典表示**（`labelJa`・配信元の verbatim）……同じ文なら 1 回出せばよい
 * ②**凡例・詳細ページへのリンク**（`url`）……データセットごとに要る
 * `forJa` は②のための名前で、「そのリンクが何のためか」（例「洪水」「高潮」）。
 * 表示は `labelJa` で束ね、`forJa` をリンクの文字にする——こうすると①を繰り返さずに
 * ②を 1 本も落とさない（同 §11.5 案 C）。`null` は「束ねる相手がいない」（従来どおりの 1 行）。
 */
export const sourceRefSchema = z.object({
  labelJa: z.string(),
  url: z.string().nullable(),
  license: z.string(),
  forJa: z.string().nullable(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

/** 地点に該当したハザード 1 件（レイヤ名＋階級ラベル＋危険度）。 */
export const hazardItemSchema = z.object({
  layerKey: z.string(),
  /** レイヤ名（例「洪水浸水想定区域（想定最大規模）」）。 */
  labelJa: z.string(),
  /** 階級のラベル（例「3.0〜5.0m 未満」）。 */
  valueJa: z.string(),
  /** その階級の意味（例「2 階部分が浸水する高さ」）。 */
  meaningJa: z.string().nullable(),
  level: hazardLevelSchema,
  /** 公式凡例の色（未確定は null＝色見本を出さない）。 */
  color: z.string().nullable(),
  /** どこから得た値か（浸水ナビ ＞ 公式タイル ＞ メッシュ・260824_flood §6.3）。 */
  source: hazardSourceSchema,
  /**
   * メッシュ由来のときだけ意味を持つ。250m セルのうち区域が占める割合（0–1）。
   * **0 と 1 だけが厳密**で、間は約 6.7 ポイント刻みの近似（同 §5.9）。
   */
  coverage: z.number().nullable(),
  /** この 1 行の確からしさ。UI と AI はこれを見て言い方を変える。 */
  certainty: hazardCertaintySchema,
})
export type HazardItem = z.infer<typeof hazardItemSchema>

/**
 * 避難先の候補 1 件（`docs/260824_flood.md` §6.4・§8.5）。
 * **意味づけ済みの文字列だけ**を持つ——UI と AI が同じ言い方をするため、
 * 距離も重なり方も「サーバが作った日本語」をそのまま出す。
 */
export const evacuationItemSchema = z.object({
  nameJa: z.string(),
  addressJa: z.string(),
  lon: z.number(),
  lat: z.number(),
  /** 直線距離（メートル）。並び替えの根拠を数値でも残す。 */
  distanceM: z.number().int(),
  /** 「約1.2km」。 */
  distanceJa: z.string(),
  /** 八方位（「北東」）。地図が見られなくても動ける情報にする。 */
  bearingJa: z.string(),
  /** その場所が指定されている災害種別（表示名）。 */
  disastersJa: z.array(z.string()),
  /** 想定区域との重なり（`null`＝判定できない）。**真偽値にしない**（§5.9）。 */
  hazardAreaCertainty: z.enum(['outside', 'partial', 'inside']).nullable(),
  /** どこから読んだか（`tile`＝地図と同じ画素／`mesh`＝250m メッシュ）。 */
  hazardAreaSource: z.enum(['tile', 'mesh']).nullable(),
  /** 上の日本語（「想定区域にかからない」など）。 */
  hazardAreaJa: z.string(),
  /** 当たった区域の名前（「土砂災害警戒区域（イエローゾーン）」など）。無ければ null。 */
  hazardAreaDetailJa: z.string().nullable(),
  elevationM: z.number().nullable(),
  /** 原典の備考（「洪水での避難は◯◯川を対象とする」など。**捨てない**）。 */
  remarksJa: z.string().nullable(),
})
export type EvacuationItem = z.infer<typeof evacuationItemSchema>

/** 時系列の 1 点（y は欠損で null＝チャートのギャップ）。 */
export const seriesPointSchema = z.object({ x: z.number(), y: z.number().nullable() })

/** トレンドチャートの 1 系列（実線/破線・色はカテゴリ駆動）。 */
export const trendSeriesSchema = z.object({
  label: z.string(),
  points: z.array(seriesPointSchema),
  color: z.string().optional(),
  dashed: z.boolean().optional(),
})
export type TrendSeries = z.infer<typeof trendSeriesSchema>

/** パネル内の要約スタッツ（前年比・コロナ前後比など・整形済み文字列＋フラグ）。 */
export const panelStatSchema = z.object({
  label: z.string(),
  value: z.string(),
  flagged: z.boolean(),
})
export type PanelStat = z.infer<typeof panelStatSchema>

/** 棒グラフの 1 本（値＋整形済み文字列・emphasis で強調＝選択半径など）。 */
export const barSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
  formatted: z.string(),
  flagged: z.boolean(),
  emphasis: z.boolean().optional(),
})
export type Bar = z.infer<typeof barSchema>

export const rankingRowSchema = z.object({
  rank: z.number(),
  grp: z.string(),
  name: z.string(),
  prefecture: z.string(),
  value: z.number(),
  formatted: z.string(),
  flagged: z.boolean(),
})
export type RankingRow = z.infer<typeof rankingRowSchema>

export const scatterPointSchema = z.object({
  grp: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  /**
   * クラスタ番号。**`0..clusterCount-1` の連番（欠番なし）** が不変条件で、
   * domain の k-means が正規化して保証する（docs/260728_fix_scatter_chart_sparse_cluster_labels.md）。
   * 番号自体に意味はない（k-means の任意 index）ため、凡例は出さず色の区別にのみ使う。
   */
  cluster: z.number(),
})
export type ScatterPoint = z.infer<typeof scatterPointSchema>

export const panelSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stationCard'),
    grp: z.string(),
    stationName: z.string(),
    label: z.string(),
    prefecture: z.string(),
    operators: z.string().nullable(),
    paxLatest: z.number().nullable(),
    badges: z.array(reliabilityFlagSchema),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('trendChart'),
    title: z.string(),
    unit: z.string().nullable(),
    format: formatSchema, // 値の整形指定（tooltip / 軸ラベル：カタログ駆動）
    category: categorySchema.optional(),
    /**
     * 積み上げ縦棒で描くか（既定＝折れ線）。**内訳の合計そのものが指標**のとき
     * （売上＝小売＋飲食宿泊＋娯楽）だけ true にする。指定しないパネルの描画は変わらない。
     */
    stacked: z.boolean().optional(),
    /**
     * 積み上げの**合計**（`stacked` のときだけ意味を持つ）。棒の上に描く値で、
     * **内訳の丸め和ではなく、丸める前から作った正しい合計**を渡す
     * （売上は `sales_dest` が正。1,469.2+263.3+169.9=1,902.4 だが正解は 1,902.3・docs/sales.md §4.5）。
     * 省略時は表示中の系列を足した値を描く。
     */
    totals: z.array(seriesPointSchema).optional(),
    flags: z.array(reliabilityFlagSchema),
    series: z.array(trendSeriesSchema),
    stats: z.array(panelStatSchema).optional(), // 折れ線に添える要約 KPI（前年比・コロナ比等）
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('statTable'),
    title: z.string(),
    rows: z.array(panelStatSchema), // ラベル付き値の一覧（増減率 9 ペア等）
    note: z.string().nullable().optional(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('barChart'),
    title: z.string(),
    unit: z.string().nullable(),
    format: formatSchema,
    category: categorySchema.optional(),
    bars: z.array(barSchema), // 半径別・年次対比・内訳などの棒（横棒で描画）
    flags: z.array(reliabilityFlagSchema),
    note: z.string().nullable().optional(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('rankingTable'),
    title: z.string(),
    metricKey: z.string(),
    unit: z.string().nullable(),
    rows: z.array(rankingRowSchema),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('scatter'),
    title: z.string(),
    xLabel: z.string(),
    yLabel: z.string(),
    xUnit: z.string().nullable(),
    yUnit: z.string().nullable(),
    points: z.array(scatterPointSchema),
    clusterCount: z.number(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    /**
     * 地点のハザード（260824_flood §6.4）。浸水深は「数値」ではなく**レベル**で、
     * 色と行動が紐づく。汎用の `statTable` に流すと `level` が消えて UI は色を付けられず
     * AI は行動を説明できないので、**意味を型に残す**（`trendChart.stacked` と同じ判断）。
     */
    type: z.literal('hazardCard'),
    /** 地点の呼び名（駅名・住所・「現在地」など）。 */
    placeJa: z.string(),
    /** 総合的な危険度（該当した階級のうち最も重いもの・domain が決める）。 */
    level: hazardLevelSchema,
    /** 1 文の結論（例「この場所は家屋倒壊等氾濫想定区域（氾濫流）に入っています」）。 */
    headlineJa: z.string(),
    /** 立退き／垂直避難／その場に留まる。**判定できないときは null**（断定しない）。 */
    evacuation: evacuationActionSchema.nullable(),
    /**
     * カード全体の確からしさ＝**items のうち最も弱いもの**（同 §5.9）。
     * 強い方に丸めると嘘になるので、必ず弱い方へ倒す。
     */
    certainty: hazardCertaintySchema,
    items: z.array(hazardItemSchema),
    /** 結論の根拠。UI は箇条書きで出し、AI は同じ文字列で説明する。 */
    reasonsJa: z.array(z.string()),
    /** 網羅性の注記（「白＝安全ではない」）。該当レイヤぶんを並べる。 */
    coverageNotesJa: z.array(z.string()),
    sources: z.array(sourceRefSchema),
    /** 免責（カタログの 1 文）。**必ず表示する。** */
    disclaimerJa: z.string(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    /**
     * 避難先の候補（`docs/260824_flood.md` §6.4・§8.5）。**`hazardCard` とは別の型**にしてある——
     * あちらは「その場所がどうか」、こちらは「どこへ行くか」で、混ぜると
     * 「危ない場所の一覧」と読まれかねない。
     */
    type: z.literal('evacuationList'),
    /** どの災害向けの一覧か（**必ず出す**。洪水用を土砂災害に使わせない・§11 リスク 10）。 */
    forDisasterJa: z.string(),
    /** 「指定緊急避難場所」。滞在する「指定避難所」と混同させないため、型に持たせる。 */
    siteKindJa: z.string(),
    placeJa: z.string(),
    headlineJa: z.string(),
    items: z.array(evacuationItemSchema),
    /** **必ず全部出す**（開設状況は分からない・直線距離である・指定避難所ではない…）。 */
    limitationsJa: z.array(z.string()),
    notesJa: z.array(z.string()),
    sources: z.array(sourceRefSchema),
    disclaimerJa: z.string(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    /**
     * 脱出方向（`docs/260824_flood.md` §8.6）。**避難先の一覧とは別の型**にしてある——
     * あちらは「どこへ行くか（点）」、こちらは「どちらへ動けば区域を出られるか（向き）」で、
     * 混ぜると**経路案内だと読まれる**。
     */
    type: z.literal('escapeDirection'),
    placeJa: z.string(),
    /** 「洪水の想定区域」。何の外を指しているかを必ず出す。 */
    forDisasterJa: z.string(),
    headlineJa: z.string(),
    /** 見つからなかった・判定できなかったときは null。 */
    direction: z
      .object({
        bearingJa: z.string(),
        distanceM: z.number().int(),
        distanceJa: z.string(),
        lon: z.number(),
        lat: z.number(),
      })
      .nullable(),
    /** **必ず全部出す**（直線距離・移動が安全とは限らない・250m の目安…）。 */
    limitationsJa: z.array(z.string()),
    notesJa: z.array(z.string()),
    sources: z.array(sourceRefSchema),
    disclaimerJa: z.string(),
    placement: placementSchema,
    size: sizeSchema,
  }),
  z.object({
    type: z.literal('markdown'),
    body: z.string(),
    placement: placementSchema,
    size: sizeSchema,
  }),
])
export type Panel = z.infer<typeof panelSchema>

/**
 * パネル部品ごとの型（判別で抽出）。UI コンポーネントはこの型を props に取り、
 * Step2 でチャット応答の同じパネルをそのままレンダリングする（.claude/CLAUDE.md §2）。
 */
export type PanelOf<T extends Panel['type']> = Extract<Panel, { type: T }>
export type StationCardPanel = PanelOf<'stationCard'>
export type TrendChartPanel = PanelOf<'trendChart'>
export type StatTablePanel = PanelOf<'statTable'>
export type BarChartPanel = PanelOf<'barChart'>
export type RankingTablePanel = PanelOf<'rankingTable'>
export type ScatterPanel = PanelOf<'scatter'>
export type MarkdownPanel = PanelOf<'markdown'>
export type HazardCardPanel = PanelOf<'hazardCard'>
export type EvacuationListPanel = PanelOf<'evacuationList'>
export type EscapeDirectionPanel = PanelOf<'escapeDirection'>

/** パネル表示バリアント（チャット内=compact／ドロワー・モーダル=full）。 */
export type PanelSize = NonNullable<z.infer<typeof sizeSchema>>

// --- 応答本体 -----------------------------------------------------------
export const mapResponseSchema = z.object({
  messages: z.array(messageSchema),
  mapActions: z.array(mapActionSchema),
  panels: z.array(panelSchema),
})
export type MapResponse = z.infer<typeof mapResponseSchema>
