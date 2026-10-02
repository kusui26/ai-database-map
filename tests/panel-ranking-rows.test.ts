/**
 * src/components/panels/rankingRows：会話の中の順位表は上位 10 行だけを出す（2026-10-02・A4）。
 *
 * AI のランキングは既定で 20 行（最大 50 行）。狭い画面・携帯で会話の中に全部並べると、
 * 本文と次の質問が遠くなる。残りは ⤢ のモーダル（full）で見る。
 */

import { describe, expect, it } from 'vitest'
import { type RankingRow, type RankingTablePanel } from '@/shared/protocol'
import { COMPACT_RANKING_ROWS, visibleRankingRows } from '@/components/panels/rankingRows'

function rows(count: number): RankingRow[] {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    grp: `駅${index + 1}#0`,
    name: `駅${index + 1}`,
    prefecture: '千葉県',
    value: 100 - index,
    formatted: `${100 - index}%`,
    flagged: false,
  }))
}

function panel(count: number, size: RankingTablePanel['size']): RankingTablePanel {
  return {
    type: 'rankingTable',
    title: '人口増減率（2015→2020年・1km圏）（千葉県・上位）',
    metricKey: 'pop_gr_2020_2015_1km',
    unit: '%',
    rows: rows(count),
    size,
  }
}

describe('visibleRankingRows（会話の中の順位表）', () => {
  it('上位 10 行だけを出し、残りの数を返す（AI の既定 20 行）', () => {
    const visible = visibleRankingRows(panel(20, 'compact'))
    expect(visible.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(visible.hiddenCount).toBe(10)
  })

  it('ちょうど 10 行なら全部出す（「ほか 0 駅」を出さない）', () => {
    const visible = visibleRankingRows(panel(COMPACT_RANKING_ROWS, 'compact'))
    expect(visible.rows).toHaveLength(COMPACT_RANKING_ROWS)
    expect(visible.hiddenCount).toBe(0)
  })

  it('11 行なら 1 行だけ隠す', () => {
    const visible = visibleRankingRows(panel(COMPACT_RANKING_ROWS + 1, 'compact'))
    expect(visible.rows).toHaveLength(COMPACT_RANKING_ROWS)
    expect(visible.hiddenCount).toBe(1)
  })

  it('0 行（該当なし）は 0 行のまま', () => {
    expect(visibleRankingRows(panel(0, 'compact'))).toEqual({ rows: [], hiddenCount: 0 })
  })

  it('モーダル・キャンバスの表（full・大きさの指定なし）は切らない', () => {
    expect(visibleRankingRows(panel(50, 'full')).rows).toHaveLength(50)
    expect(visibleRankingRows(panel(50, undefined)).hiddenCount).toBe(0)
  })
})
