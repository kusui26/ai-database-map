'use client'

/**
 * 地図の色分けの凡例が出ていないことを、エリアの要約（`AreaSummary`）へ伝える（2026-11-11・`docs/261110_fix_PLAN.md` §4.1）。
 *
 * 既定は false（地図の凡例が出ている＝要約には凡例を出さない。会話の中の要約もこれ）。true を渡すのはエリアの図の列
 * （`AreaBody`）だけで、判定は `components/coloring/legendPlacement.ts`。
 */

import { createContext } from 'react'

export const MapLegendHiddenContext = createContext(false)
