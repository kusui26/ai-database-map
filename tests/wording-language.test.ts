import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 文言に**別の言語の文字が紛れていないか**を見張る。
 *
 * 実際に 3 回やった——システムプロンプトにロシア語（`osobenno` のキリル表記）、
 * 限界の文に英語の `always`、プランの文書にポーランド語の `ą`。
 * 日本語の中に 1 語混ざっても**型検査も lint も通ってしまい、画面に出るまで誰も気づかない**。
 * 機械で見つかる種類の間違いなので、機械に見張らせる。
 *
 * ⚠ **英単語そのものは検出できない**（コードは英語で書くので当然）。ここで捕まえるのは
 * 「日本語のつもりで別の文字体系が混ざった」場合だけである。それでも 3 回中 2 回は捕まる。
 */

/**
 * このアプリの文言には出てこないはずの文字体系。
 *
 * - `Ā-ɏ` … ラテン拡張（`ą` `ł` `ō` など。実測でポーランド語が混ざった）
 * - `Ѐ-ӿ` … キリル
 * - `가-힯` … ハングル
 * - `฀-๿` … タイ
 *
 * **将来ラテン拡張が正当に要るようになったら**（人名・原典名の引用など）、
 * ここではなく `ALLOWED_FILES` を増やす。
 */
const FOREIGN_SCRIPTS = /[Ā-ɏЀ-ӿ가-힯฀-๿]/

/** 見張りの対象（生成物・依存は見ない）。 */
const ROOTS: readonly string[] = ['src', 'docs', 'tests', 'pipeline']
const EXTENSIONS = /\.(tsx?|md|py|js)$/

/** 例として別の言語を書いてよいファイル（この見張り自身）。 */
const ALLOWED_FILES: readonly string[] = ['tests/wording-language.test.ts']

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return EXTENSIONS.test(name) ? [path] : []
  })
}

describe('文言：別の言語の文字が紛れていない', () => {
  it('コードと文書に、想定外の文字体系が無い', () => {
    const offenders = ROOTS.flatMap(sourceFiles)
      .filter((path) => !ALLOWED_FILES.includes(path))
      .flatMap((path) => {
        const lines = readFileSync(path, 'utf-8').split('\n')
        return lines.flatMap((line, index) =>
          FOREIGN_SCRIPTS.test(line) ? [`${path}:${index + 1} ${line.trim().slice(0, 80)}`] : [],
        )
      })
    expect(offenders).toEqual([])
  })

  it('見張り自身が働くこと（混ざったら捕まえる）', () => {
    // 実際に混ざった 3 つの形。どれもこの正規表現で捕まる。
    expect(FOREIGN_SCRIPTS.test('とくに 無理に動かせない')).toBe(false)
    expect(FOREIGN_SCRIPTS.test('осо 無理に動かせない')).toBe(true)
    expect(FOREIGN_SCRIPTS.test('危ną')).toBe(true)
    expect(FOREIGN_SCRIPTS.test('한국어')).toBe(true)
  })
})
