/**
 * 空振りの言い方（純関数・§13.7 W5）。
 *
 * 「該当なし」とだけ返すのは、**こちらが理由を知っているのに黙っている**ということ。
 * 候補が 0 だったのか、候補はあったが全部外れたのか、外れた理由は災害か欠損か ⚠ か——
 * 応答はどれも持っているので、**何が起きたか**と**次にどこを動かせばよいか**を出す。
 *
 * ここが UI 側にあるのは、助言の中身が**画面のつまみ**（足切りのセレクタ・⚠除外・半径）に
 * 依っているため。サーバはつまみを知らない。
 */

import { HAZARD_LEVEL_LABELS_JA, type HazardLevel } from '@/shared/constants'
import type { RecommendArea, RecommendHazardPolicy, RecommendResponse } from '@/shared/api'

/**
 * 助言に要るところだけを受ける（`RecommendResponse` をそのまま渡せる）。
 * 狭く受けるほど、境界の検査に**応答まるごとの作り物**が要らなくなる。
 */
export type AdviceInput = {
  readonly candidateCount: number
  readonly rankedCount: number
  readonly area: Pick<
    RecommendArea,
    'labelJa' | 'municipality' | 'routes' | 'operators' | 'routeTypes'
  >
  readonly excludedCounts: RecommendResponse['excludedCounts']
  readonly hazard: Pick<RecommendHazardPolicy, 'mode' | 'groupJa' | 'atOrAbove'>
}

/** この数までは「順位」と呼べない（正規化は 2 駅以上で意味を持つ・`normalize.ts` の `MIN_SAMPLES`）。 */
export const THIN_RESULT_MAX = 2

/** 足切りは「軽い → 重い」の順。緩めるとは、1 段重い側へ動かすこと。 */
const CUTOFF_ORDER: readonly HazardLevel[] = ['caution', 'warning', 'danger', 'critical']

export type ResultAdvice = {
  /** `empty`＝順位が 1 件も出ない／`thin`＝出たが少なすぎて比べられない。 */
  readonly tone: 'empty' | 'thin'
  readonly headlineJa: string
  /** 次の一手（画面のどのつまみを動かすか）。 */
  readonly hintsJa: readonly string[]
}

/** 1 段緩い足切り（これ以上緩められないときは null）。 */
function looserCutoff(level: HazardLevel): HazardLevel | null {
  const index = CUTOFF_ORDER.indexOf(level)
  return index < 0 ? null : (CUTOFF_ORDER[index + 1] ?? null)
}

/** 候補そのものが 0 だったとき——絞り込みのどれを外せば広がるかを言う。 */
function noCandidates(response: AdviceInput): ResultAdvice {
  const { area } = response
  const narrowed = area.routes.length + area.operators.length + area.routeTypes.length > 0
  return {
    tone: 'empty',
    headlineJa: `${area.labelJa} に当てはまる駅がありませんでした。`,
    hintsJa: [
      ...(narrowed ? ['路線・会社・種別の指定を外すと、候補が広がります。'] : []),
      ...(area.municipality === null
        ? []
        : ['市区町村を「（全域）」に戻すと、都道府県の全駅が候補になります。']),
      ...(narrowed || area.municipality !== null ? [] : ['別のエリアを選んでください。']),
    ],
  }
}

/** 災害の足切りで全部消えたとき。 */
function hazardHints(response: AdviceInput): readonly string[] {
  const { hazard } = response
  if (hazard.mode !== 'exclude' || hazard.atOrAbove === null || hazard.groupJa === null) return []
  const looser = looserCutoff(hazard.atOrAbove)
  return [
    ...(looser === null
      ? []
      : [
          `${hazard.groupJa}の足切りを「${HAZARD_LEVEL_LABELS_JA[hazard.atOrAbove]}」から「${HAZARD_LEVEL_LABELS_JA[looser]}」に緩めると、一部が候補に戻ります。`,
        ]),
    '「段階減点」にすると、危険度を点数に反映したうえで全駅を比べられます。',
  ]
}

/** 候補はあったが、全部外れたとき——多い理由から順に、戻し方を言う。 */
function allExcluded(response: AdviceInput): ResultAdvice {
  const counts = response.excludedCounts
  return {
    tone: 'empty',
    headlineJa: `候補 ${response.candidateCount} 駅は、すべて候補から外れました。`,
    hintsJa: [
      ...(counts.hazard > 0 ? hazardHints(response) : []),
      ...(counts.missing > 0
        ? [
            `値が無い駅が ${counts.missing} 件あります。半径を変えるか、足りない指標の重みを 0 にすると候補に戻ります。`,
          ]
        : []),
      ...(counts.flagged > 0
        ? [`「⚠除外」を外すと、⚠ の付いた ${counts.flagged} 件が候補に戻ります。`]
        : []),
    ],
  }
}

/**
 * 順位が出なかった／出たが少なすぎるときの言い方。問題なければ `null`。
 * **「少なすぎる」を黙って順位にしない**——1 駅の「1 位」は順位ではない。
 */
export function resultAdvice(response: AdviceInput): ResultAdvice | null {
  if (response.candidateCount === 0) return noCandidates(response)
  if (response.rankedCount === 0) return allExcluded(response)
  if (response.rankedCount > THIN_RESULT_MAX) return null
  return {
    tone: 'thin',
    headlineJa: `順位が付いたのは ${response.rankedCount} 駅だけです。`,
    hintsJa: [
      'おすすめは「エリアの中での相対評価」なので、この数では順位がほとんど意味を持ちません。',
      'エリアを広げるか、絞り込みを外して比べる相手を増やしてください。',
    ],
  }
}
