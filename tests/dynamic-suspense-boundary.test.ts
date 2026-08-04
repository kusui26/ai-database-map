/**
 * `next/dynamic` の Suspense 境界の付け忘れを検出する（260805）。
 *
 * `dynamic()` は **`ssr: false` か `loading` を渡したときだけ**自前の境界を作る
 * （`hasSuspenseBoundary = !opts.ssr || !!opts.loading`）。どちらも渡さないと、初回の
 * チャンク取得で中断したときに `page.tsx` の fallback まで遡り、**アプリ全体が
 * 「地図を読み込み中…」に差し替わる**（docs/260804_loading_map.md §2）。
 *
 * オプションを書き忘れても型エラーにならず、初回オープンでしか再現しないため、
 * ここでソースを走査して固定する。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_DIR = join(process.cwd(), 'src')
const DYNAMIC_IMPORT = "from 'next/dynamic'"

/** `src` 配下の .ts / .tsx を集める。 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/**
 * `dynamic` の直後の開き括弧から、対応する閉じ括弧までを返す。
 * 括弧を含む文字列リテラルは扱わないが、`dynamic()` の引数は import パスと
 * オプションだけなので実用上は足りる。
 */
function callText(source: string, start: number): string {
  const depths = source.slice(start).split('')
  const end = depths.reduce<{ depth: number; index: number | null }>(
    (state, char, offset) => {
      if (state.index !== null) return state
      if (char === '(') return { depth: state.depth + 1, index: null }
      if (char !== ')') return state
      const depth = state.depth - 1
      return depth === 0 ? { depth, index: start + offset + 1 } : { depth, index: null }
    },
    { depth: 0, index: null },
  )
  return source.slice(start, end.index ?? source.length)
}

/** 境界を作らない `dynamic()` の呼び出しを返す（見つからなければ空配列）。 */
export function boundarylessCalls(source: string, label: string): string[] {
  if (!source.includes(DYNAMIC_IMPORT)) return []
  return [...source.matchAll(/\bdynamic\s*\(/g)]
    .map((match) => callText(source, (match.index ?? 0) + match[0].length - 1))
    .filter((call) => !/ssr\s*:\s*false/.test(call) && !/\bloading\s*:/.test(call))
    .map((call) => `${label}: ${call.replace(/\s+/g, ' ').slice(0, 72)}`)
}

/** 走査で見つかった `dynamic()` の総数（0 件なら走査が壊れている）。 */
function countCalls(source: string): number {
  if (!source.includes(DYNAMIC_IMPORT)) return 0
  return [...source.matchAll(/\bdynamic\s*\(/g)].length
}

describe('next/dynamic の Suspense 境界（260805）', () => {
  const files = sourceFiles(SRC_DIR)

  it('すべての dynamic() に ssr:false か loading が付いている', () => {
    const offenders = files.flatMap((file) =>
      boundarylessCalls(readFileSync(file, 'utf8'), relative(process.cwd(), file)),
    )
    expect(offenders).toEqual([])
  })

  it('走査が実際に dynamic() を見つけている（空振りで合格しない）', () => {
    const total = files.reduce((sum, file) => sum + countCalls(readFileSync(file, 'utf8')), 0)
    expect(total).toBeGreaterThanOrEqual(6)
  })

  it('検出ロジックが、境界なしの書き方を見逃さない', () => {
    const bad = `import dynamic from 'next/dynamic'\nconst A = dynamic(() => import('./A').then((m) => m.A))\n`
    expect(boundarylessCalls(bad, 'bad.tsx')).toHaveLength(1)
  })

  it('検出ロジックが、境界ありの書き方を誤検出しない', () => {
    const withSsr = `import dynamic from 'next/dynamic'\nconst A = dynamic(() => import('./A'), { ssr: false })\n`
    const withLoading = `import dynamic from 'next/dynamic'\nconst A = dynamic(() => import('./A'), { loading: () => null })\n`
    expect(boundarylessCalls(withSsr, 'a.tsx')).toEqual([])
    expect(boundarylessCalls(withLoading, 'b.tsx')).toEqual([])
  })

  it('next/dynamic を使っていないファイルは対象外', () => {
    expect(boundarylessCalls('const dynamic = (x) => x\ndynamic(1)\n', 'c.ts')).toEqual([])
  })
})
