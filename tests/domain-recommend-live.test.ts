/**
 * 実データでの突き合わせ（`docs/260912_gui_chat_protocol.md` §13.7 W2 の受け入れ）。
 *
 * **スキルが実走で出した順位を、ドメインが再現できるか**を見る。数字が合うことより、
 * 食い違ったときに理由を説明できることが目的——ただし今回は完全に一致した。
 *
 * 比較の相手は `plugins/ai-database-map/evals/` の golden（住宅・横浜市）を 2026-09 に
 * 実走した応答。エージェントが採った重み・正規化・足切りを**そのまま**与えている。
 *
 * ## 候補集合だけは、こちらで揃える必要がある
 *
 * 実走はルート指定に加えて「羽沢横浜国大は東京方面への直通が主ではないので参考扱い」という
 * **エージェントの判断**を 1 つ挟んでいる。ドメインにその判断をする手立ては無い（持たせるべきでもない）。
 * だから候補集合は明示的に 17 駅へ揃える。min-max は候補集合の最小・最大に依るので、
 * 1 駅の差がそのまま順位に出る——**この機能では「候補集合が何か」を画面に必ず出す**という
 * W4 の要件は、ここから来ている。
 *
 * ⚠ 実行には DB が要るので既定では skip。`RECOMMEND_LIVE=1` と `.env` の鍵を渡すと走る。
 */

import { describe, expect, it } from 'vitest'
import { recommendStations } from '@/domain/recommend'
import { gatherCandidates } from '@/domain/recommend/gather'
import { resolveMetrics } from '@/domain/recommend/metrics'
import type { PresetMetric } from '@/domain/recommend/presets'
import type { HazardPolicy } from '@/domain/recommend/types'

const ENABLED = process.env.RECOMMEND_LIVE === '1'
const TIMEOUT_MS = 60_000

/** 実走が採った重みと key（`docs/260912_gui_chat_protocol.md` §13.7 W2）。 */
const SPECS: readonly PresetMetric[] = [
  { metric: 'pop_gr_pred_2024_2040_1km', labelJa: '将来人口', direction: 'higher', weight: 0.25 },
  { metric: 'pop_gr_2020_2015_1km', labelJa: '実績人口', direction: 'higher', weight: 0.2 },
  { metric: 'lp_gr_2026_2021_1km', labelJa: '地価トレンド', direction: 'higher', weight: 0.1 },
  { metric: 'lp_med_2026_1km', labelJa: '地価水準', direction: 'lower', weight: 0.15 },
  { metric: 'rate_covid', labelJa: '乗降回復', direction: 'higher', weight: 0.15 },
  { metric: 'pax_2024', labelJa: '乗降水準', direction: 'higher', weight: 0.15 },
]

/** 実走が挟んだ判断——ドメインには持たせない（§13.7 の注記）。 */
const JUDGED_OUT = '羽沢横浜国大'

const FLOOD_CUT: HazardPolicy = { mode: 'exclude', group: 'flood', atOrAbove: 'danger' }

/** 実走が出した順位（応答からの転記）。 */
const SKILL_ORDER = ['戸塚', '桜木町', '東神奈川', '山手', '新杉田', '鶴見'] as const
/** 実走が足切りで外した駅（洪水 critical）。 */
const SKILL_EXCLUDED = ['横浜', '石川町', '保土ヶ谷'] as const

async function runYokohama() {
  const { metrics } = resolveMetrics(SPECS, 1000)
  const gathered = await gatherCandidates(
    { municipality: '横浜市', routes: ['東海道線', '根岸線', '横須賀線'] },
    metrics,
    { includeHazard: true },
  )
  const candidates = gathered.candidates.filter((station) => station.name !== JUDGED_OUT)
  return {
    candidates,
    result: recommendStations(candidates, { metrics, method: 'minmax', hazard: FLOOD_CUT }),
  }
}

describe.skipIf(!ENABLED)('実データ：横浜市でスキルの実走と突き合わせる', () => {
  it(
    '足切りで外れる駅が一致する（3 駅・洪水 critical）',
    async () => {
      const { result } = await runYokohama()
      const names = result.excluded.map((entry) => entry.name).sort()
      expect(names).toEqual([...SKILL_EXCLUDED].sort())
      for (const entry of result.excluded) {
        expect(entry.reason.kind).toBe('hazard')
      }
    },
    TIMEOUT_MS,
  )

  it(
    '上位 6 駅の並びが一致する',
    async () => {
      const { candidates, result } = await runYokohama()
      expect(candidates).toHaveLength(17)
      expect(result.ranked).toHaveLength(14)
      expect(result.ranked.slice(0, 6).map((station) => station.name)).toEqual([...SKILL_ORDER])
    },
    TIMEOUT_MS,
  )

  it(
    '⚠ の付く駅と、僅差である判定も一致する',
    async () => {
      const { result } = await runYokohama()
      const flagged = result.ranked.filter((station) =>
        station.breakdown.some((item) => item.flagged),
      )
      // 実走は新杉田を「地価系が低分母フラグ・参考値」と書いている。
      expect(flagged.map((station) => station.name)).toContain('新杉田')
      // 実走は「3〜8 位は僅差の集団」と書いている。
      expect(result.sensitivity.stable).toBe(false)
    },
    TIMEOUT_MS,
  )
})
