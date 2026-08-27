import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 文言に**別の言語の文字が紛れていないか**を見張る。
 *
 * 実際に 2 回やった——システムプロンプトに `особенно`（ロシア語）、
 * 限界の文に `always`（英語）が混ざったまま通りかけた。日本語の中に 1 語混ざっても
 * 型検査も lint も通ってしまい、**画面に出るまで誰も気づかない**。
 * 機械で見つかる種類の間違いなので、機械に見張らせる。
 */

/** キリル文字・ハングル・タイ文字（このアプリの文言には出てこないはずのもの）。 */
const FOREIGN_SCRIPTS = /[Ѐ-ӿ가-힯฀-๿]/

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('文言：別の言語の文字が紛れていない', () => {
  it('src 配下に想定外の文字体系が無い', () => {
    const offenders = sourceFiles('src').flatMap((path) => {
      const lines = readFileSync(path, 'utf-8').split('\n')
      return lines.flatMap((line, index) =>
        FOREIGN_SCRIPTS.test(line) ? [`${path}:${index + 1} ${line.trim().slice(0, 80)}`] : [],
      )
    })
    expect(offenders).toEqual([])
  })
})
