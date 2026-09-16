/**
 * **繋がっている人に「オフライン」と言わない**（`docs/260916_ops_guard.md` §7）。
 *
 * ## 何が起きていたか
 *
 * 共通API に届かないとき、画面は端末の 250m メッシュだけで組み立てた答えに切り替わる
 * （`docs/260824_flood.md` §6.3「沈黙させない」）。その答えには必ず 1 文が添うが、
 * それが**理由によらず**「オフラインのため」だった。
 *
 * 届かない事情は 2 つあり、**利用者から見た意味が正反対**である。
 *
 * | 事情 | 利用者は |
 * | --- | --- |
 * | 端末が「繋がっていない」と言っている | 繋がっていない |
 * | 5xx・タイムアウト・サーバが公式タイルに届かない | **繋がっている** |
 *
 * G5 で上流にレート制限を入れ、G2 で 4xx を塞いだ結果、**残った 5xx・タイムアウトの経路**が
 * そのまま「オフライン」と言う道になっていた。**知らないことを知っているように書かない。**
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { certaintyNoteJa, meshOnlyNoteJa, noHazardHeadlineJa } from '@/domain/hazard/wording'
import { escapeMeshOnlyNoteJa } from '@/domain/hazard/escape'
import { HAZARD_CERTAINTY_LABELS_JA } from '@/shared/constants'

/** 画面と AI に出る文のうち、**メッシュだけで答えたとき**に出うるもの。 */
const USER_FACING = {
  '地点の注記（届かなかった）': meshOnlyNoteJa('unreachable'),
  '脱出方向の注記（届かなかった）': escapeMeshOnlyNoteJa('unreachable'),
  該当なしの見出し: noHazardHeadlineJa('unknown'),
  確からしさのバッジ: HAZARD_CERTAINTY_LABELS_JA.unknown,
} as const satisfies Record<string, string>

describe('「オフライン」と名乗ってよい場面は 1 つだけ', () => {
  it.each(Object.entries(USER_FACING))('%s は「オフライン」と言わない', (_name, text) => {
    expect(text).not.toContain('オフライン')
  })

  /**
   * 「通信」も同じ罠だった。バッジの一言は UI に直書きされていて、
   * **繋がっている利用者にも**「通信できるようになったら」と言っていた（ブラウザ実測で発見）。
   */
  it.each(Object.entries(USER_FACING))('%s は利用者の回線のせいにしない', (_name, text) => {
    expect(text).not.toContain('通信できる')
  })

  it('端末が「繋がっていない」と言っているときだけ、そう書く', () => {
    expect(meshOnlyNoteJa('offline')).toContain('オフラインのため')
    expect(escapeMeshOnlyNoteJa('offline')).toContain('オフラインのため')
  })

  it('届かなかっただけのときは、こちらの不調として書く', () => {
    expect(meshOnlyNoteJa('unreachable')).toContain('最新のデータを取得できなかったため')
  })
})

describe('理由が変わっても、言う中身は変わらない', () => {
  it.each(['offline', 'unreachable'] as const)('%s：何で判断したかを必ず言う', (reason) => {
    expect(meshOnlyNoteJa(reason)).toContain('250m メッシュだけで判断しています')
    expect(escapeMeshOnlyNoteJa(reason)).toContain('250m メッシュだけで判断しています')
  })

  it.each(['offline', 'unreachable'] as const)('%s：どちらも「安全」とは言わない', (reason) => {
    expect(meshOnlyNoteJa(reason)).not.toContain('安全')
    expect(escapeMeshOnlyNoteJa(reason)).not.toContain('安全')
  })
})

/**
 * 理由を選ぶのは**フックの分岐**なので、そこを固定する。
 * ここを取り違えると型では止まらない——どちらも `MeshOnlyReason` だからである。
 */
describe('確からしさに添える一言', () => {
  it('exact のときは何も言わない', () => {
    expect(certaintyNoteJa('exact')).toBeNull()
  })

  it('partial は「この地点の値は地図で」、unknown は「時間をおいて」', () => {
    expect(certaintyNoteJa('partial')).toContain('地図の色でご確認ください')
    expect(certaintyNoteJa('unknown')).toContain('時間をおいて')
  })

  it('画面に直書きしない（domain の関数を読んでいる）', () => {
    const card = readFileSync('src/components/panels/HazardCard.tsx', 'utf-8')
    expect(card).toContain('certaintyNoteJa(')
    expect(card).not.toContain('での判断です')
  })
})

describe('どちらの理由を渡すかは、分岐で決まっている', () => {
  /** コメントと import を落として、**実際に走る行**だけを見る（`tests/hazard-escape.test.ts` と同じ形）。 */
  function rendered(path: string): string {
    return readFileSync(path, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^import[\s\S]*?from '[^']+'$/gm, '')
  }

  const HOOKS = [
    'src/components/hazard/useHazardPoint.ts',
    'src/components/hazard/useEscapeDirection.ts',
  ]

  it.each(HOOKS)('%s：navigator.onLine を見た側だけが offline を名乗る', (path) => {
    const source = rendered(path)
    const [beforeCatch, afterCatch] = source.split('shouldFallBackToMesh(')
    expect(beforeCatch).toContain('navigator.onLine')
    expect(beforeCatch).toContain("'offline'")
    expect(beforeCatch).not.toContain("'unreachable'")
    // 取りに行って落ちた側（catch）は、繋がっている前提で書く。
    expect(afterCatch).toContain("'unreachable'")
    expect(afterCatch).not.toContain("'offline'")
  })
})
