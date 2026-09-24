/**
 * 日本語の文の途中に、意図しない**空白**が入っていないことを固定する。
 *
 * ## なぜ起きるか
 *
 * JSX のテキストは、**改行が空白 1 個になる**。英語なら単語の区切りとして正しいが、
 * 日本語には語間の空白が無いので、折り返した場所がそのまま文の中の空白になる。
 *
 * ```jsx
 * <p>
 *   …許可リストがここから作られます）、地図の
 *   タイルを許可する次の 1 行を実行します。
 * </p>
 * ```
 *
 * これは画面に「地図の タイル」と出る（実際に `/ai` でそうなっていた）。prettier は
 * 行を詰め直すとき**ソースにある空白でしか折らない**ので、安全な位置（ASCII の語や数字の隣）に
 * だけ改行を置けば再発しない。
 *
 * ## 空白を入れたいときは `{' '}` と書く
 *
 * 日本語の間に**意図して**空白を置くこともある——「国土数値情報 利用約款」（原典の表記）や
 * 「国土地理院 最適化ベクトルタイル」。このとき**直接の空白では意図が保てない**：prettier が
 * その空白で折り返した瞬間、ソースの見た目は「ただの改行」になり、次に誰かが行を詰めると
 * 空白ごと消える。実際、この検査を書いた回に prettier が同じ場所を折り直した。
 * だから意図した空白は `{' '}` で書く——式なので折り返しでも消えず、読む人にも意図が伝わる。
 *
 * ## なぜ目で見つからないか
 *
 * ソースを読むと改行にしか見えず、レビューで気づけない。ブラウザで見ても、
 * 1 文字ぶんの空白は「文字詰めの揺れ」に見える。**機械で見るしかない。**
 *
 * ## 何を見ているか
 *
 * 正規表現でソースを舐めるとコメントや文字列リテラルまで拾うので、**構文木の JSXText だけ**を
 * 取り出し、JSX の空白規則（行を trim し、非空行を空白 1 個で連結）を再現してから
 * 「日本語 空白 日本語」を探す。数字や ASCII の隣の空白（`1 行`・`URL を`）は対象外——
 * それはこのリポジトリの書き方として正しい。
 */

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { globSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
/** ひらがな・カタカナ・漢字。句読点や括弧は「文の途中」とは限らないので入れない。 */
const JAPANESE = /[぀-ヿ㐀-鿿]/

interface RenderedJsxText {
  /** JSXText が実際に DOM へ出るときの文字列（Babel の `cleanJSXElementLiteralChild` と同じ規則）。 */
  readonly text: string
  /** そのうち**改行に由来する**空白の位置。ソースに直接書いた空白は含めない。 */
  readonly breakSpaces: readonly number[]
}

/** 改行由来の空白だけを区別して、JSXText を「画面に出る文字列」に畳む。
 *
 *  区別するのは、**直接書いた空白は意図的**でありうるから——「国土地理院 最適化ベクトルタイル」は
 *  組織名と製品名の区切りで、直したら読みにくくなる。直せるのは、書いた人が空白のつもりで
 *  入れていない改行のほうだけである。 */
function renderJsxText(raw: string): RenderedJsxText {
  const lines = raw.split(/\r\n|\n|\r/)
  const kept = lines
    .map((line, index) => {
      const withoutTabs = line.replace(/\t/g, ' ')
      const leading = index === 0 ? withoutTabs : withoutTabs.replace(/^ +/, '')
      return index === lines.length - 1 ? leading : leading.replace(/ +$/, '')
    })
    .filter((line) => line.length > 0)
  const breakSpaces: number[] = []
  const text = kept.reduce((accumulated, line, index) => {
    if (index === 0) return line
    breakSpaces.push(accumulated.length)
    return `${accumulated} ${line}`
  }, '')
  return { text, breakSpaces }
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly sample: string
}

function findJapaneseGaps(file: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const findings: Finding[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const { text, breakSpaces } = renderJsxText(node.getText())
      for (const index of breakSpaces) {
        const before = text[index - 1] ?? ''
        const after = text[index + 1] ?? ''
        if (!JAPANESE.test(before) || !JAPANESE.test(after)) continue
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        findings.push({
          file: relative(ROOT, file),
          line: line + 1,
          sample: text.slice(Math.max(0, index - 14), index + 15),
        })
        break // 直す単位はノードなので 1 件で足りる
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return findings
}

describe('JSX の日本語に、意図しない空白が入っていない', () => {
  it('src/**/*.tsx のどこにも「日本語 空白 日本語」が無い', () => {
    const files = globSync('**/*.tsx', { cwd: join(ROOT, 'src') }).map((name) =>
      join(ROOT, 'src', name),
    )
    expect(files.length).toBeGreaterThan(0)
    const findings = files.flatMap(findJapaneseGaps)
    const report = findings.map((f) => `${f.file}:${f.line}  「${f.sample}」`).join('\n')
    expect(report, `改行が空白になっている箇所:\n${report}`).toBe('')
  })
})
