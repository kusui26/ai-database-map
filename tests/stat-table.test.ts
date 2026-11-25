import { describe, expect, it } from 'vitest'
import { type StatTablePanel } from '@/shared/protocol'
import { showsFolded } from '@/shared/stat-table'

/**
 * 表を畳んで描くかの規則（`src/shared/stat-table.ts`・2026-11-25）。Web の表とビューアが同じ関数で決める。
 * 畳むのは行のある表だけ——行が無いと「題（0）」を開いても何も無い。
 */
const table = (rows: StatTablePanel['rows'], folded?: boolean): StatTablePanel => ({
  type: 'statTable',
  title: '人口増減率',
  rows,
  note: null,
  ...(folded === undefined ? {} : { folded }),
})
const ROW = { label: '2015→2020', value: '+11.6%', flagged: false }

describe('showsFolded', () => {
  it('folded で行があれば畳む', () => {
    expect(showsFolded(table([ROW], true))).toBe(true)
  })

  it('folded でも行が無ければ畳まない（題だけ）', () => {
    expect(showsFolded(table([], true))).toBe(false)
  })

  it('folded を指定しない・false の表は畳まない（以前のまま）', () => {
    expect(showsFolded(table([ROW]))).toBe(false)
    expect(showsFolded(table([ROW], false))).toBe(false)
  })
})
