/**
 * Chart.js の必要コンポーネントだけを一度登録する（tree-shaking 構成）。
 * 折れ線＋塗り＋棒＋散布＋ツールチップ＋凡例。チャート系コンポーネントの import 時に呼ぶ。
 */

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
} from 'chart.js'

let registered = false

/** 冪等：初回のみ Chart.register する。 */
export function ensureChartRegistered(): void {
  if (registered) return
  Chart.register(
    LineController,
    LineElement,
    BarController, // 積み上げ縦棒（trendChart の stacked・260816）
    BarElement,
    PointElement,
    ScatterController,
    LinearScale,
    CategoryScale,
    Filler,
    Tooltip,
    Legend, // 積み上げ縦棒の内訳を読むのに要る（折れ線は従来どおり凡例を出さない・260817）
  )
  registered = true
}
