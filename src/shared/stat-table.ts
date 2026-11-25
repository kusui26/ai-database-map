/**
 * 表（`statTable`）の描き方の規則（純関数・2026-11-25）。Web の表（`components/panels/StatTable.tsx`）と
 * ビューア（`shared/viewer/panels.ts`）が同じ規則で描くように、ここ 1 か所で決める。
 */

import { type StatTablePanel } from './protocol'

/**
 * 畳んで描くか（`folded`）。畳むのは**行のある表だけ**——行が無いと「題（0）」を開いても何も無いので、
 * 畳まずに題だけを描く（畳む前と同じ）。
 */
export function showsFolded(panel: StatTablePanel): boolean {
  return panel.folded === true && panel.rows.length > 0
}
