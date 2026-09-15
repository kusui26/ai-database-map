'use client'

/**
 * 重みのスライダ（§13.4-2「重みは利用者のもの」）。
 *
 * 既定は**宣言するが押しつけない**。プリセットの値から始めて、その場で動かせる。
 * 表示は `%`（合計 1 に正規化した割合）で、**サーバと同じ関数**（`shareOfWeights`）で出す——
 * 同じ重みなのに画面と応答で違う % が出ることがないように。
 *
 * 重み 0 は「その指標を見ない」。色を消して、合成にも仕分けにも使われないことを示す
 * （domain は重み 0 の指標で駅を落とさない・W1 の決定②）。
 */

import { shareOfWeights } from '@/domain/recommend/compose'
import { RECOMMEND_PRESETS } from '@/domain/recommend/presets'
import type { RecommendPresetId } from '@/shared/recommend'
import { colorIndexes, contributionColor } from './colors'
import { quantizeWeight, WEIGHT_STEP } from './query'
import { percentJa } from './summary'

/** スライダの上限。既定の最大が 0.3 なので、倍以上へ振れる余地を持たせる。 */
const MAX_WEIGHT = 1

export function WeightSliders({
  preset,
  weights,
  onChange,
}: {
  preset: RecommendPresetId
  weights: Readonly<Record<string, number>>
  onChange: (weights: Record<string, number>) => void
}) {
  const metrics = RECOMMEND_PRESETS[preset].metrics
  const values = metrics.map((metric) => weights[metric.metric] ?? metric.weight)
  const shares = shareOfWeights(values)
  const colors = colorIndexes(values)

  return (
    <div className="space-y-1.5">
      {metrics.map((metric, index) => {
        const color = colors[index] ?? null
        return (
          <label key={metric.metric} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{
                backgroundColor: color === null ? '#e2e8f0' : contributionColor(color),
              }}
              aria-hidden
            />
            <span className="w-20 shrink-0 text-slate-700">{metric.labelJa}</span>
            <input
              type="range"
              min={0}
              max={MAX_WEIGHT}
              step={WEIGHT_STEP}
              value={values[index] ?? 0}
              aria-label={`${metric.labelJa}の重み`}
              onChange={(event) =>
                onChange({
                  ...weights,
                  [metric.metric]: quantizeWeight(Number(event.target.value)),
                })
              }
              className="min-w-0 flex-1 accent-indigo-600"
            />
            <span className="w-9 shrink-0 text-right text-slate-500 tabular-nums">
              {percentJa(shares[index] ?? 0)}
            </span>
          </label>
        )
      })}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[11px] text-slate-400">
          重みは合計 100% に正規化されます（0% の指標は見ません）
        </span>
        <button
          type="button"
          onClick={() => onChange({})}
          disabled={Object.keys(weights).length === 0}
          className="rounded-md px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          既定に戻す
        </button>
      </div>
    </div>
  )
}
