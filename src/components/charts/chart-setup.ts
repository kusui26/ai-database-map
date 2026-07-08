/**
 * Chart.js の必要コンポーネントだけを一度登録する（tree-shaking 構成）。
 * 折れ線＋塗り＋ツールチップのみ。チャート系コンポーネントの import 時に呼ぶ。
 */

import {
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

let registered = false

/** 冪等：初回のみ Chart.register する。 */
export function ensureChartRegistered(): void {
  if (registered) return
  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Filler,
    Tooltip,
  )
  registered = true
}
