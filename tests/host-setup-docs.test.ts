/**
 * 母艦（MulmoTerminal / MulmoClaude）の導入手順が、実機の挙動と一致していることを固定する
 * （`docs/260912_gui_chat_protocol.md` §4.6.1・`docs/260915_week5_mulmo_terminal-claude.md` §10.5）。
 *
 * ここを落とすのは「手順書が間違っている」という不具合で、**実行時には何も起きない**——
 * MulmoClaude では作法が届かないまま、エラーも警告も無く答えの質だけが落ちる。実際に
 * 出荷済みの README がそうなっていた（「読まれない場合はコピー」という条件付きの案内）。
 * 静かに壊れるものはテストで留める。
 *
 * 2026-09-22：上流 1.18.0（#3186 → #3188）で、サンドボックスの中でもプラグインが解決される
 * ようになった。回避策（`<workspace>/.claude/skills/` への symlink）を手順から外したので、
 * **旧文言を書けないこと**も否定で固定する——歴史的な記述は docs/ に残し、手順には戻さない。
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PLUGIN_ROOT = `${process.cwd()}/plugins/ai-database-map`
const README = readFileSync(`${PLUGIN_ROOT}/README.md`, 'utf-8')
const INTRO_PAGE = readFileSync(`${process.cwd()}/src/app/ai/page.tsx`, 'utf-8')
const ROOT_README = readFileSync(`${process.cwd()}/README.md`, 'utf-8')

/** 回避策が必要だった最後の版の、次の版。3 つの文書がこの数字で揃っている必要がある。 */
const MIN_MULMOCLAUDE_VERSION = '1.18.0'

/** 手順から消えた回避策の痕跡。どれか 1 つでも戻ったら落とす。 */
const RETIRED_WORDINGS: readonly string[] = [
  'ln -s', // 回避策そのもの
  'スキルが読まれない場合', // 0.8.0 以前：条件付きで、動かないまま放置される案内
  'MulmoClaude は**プラグインを読みません**', // 0.8.1：誤った原因（走査ルートの話）
  'サンドボックスを使うときだけ', // 0.8.2：条件付きの回避策
  '--disable-sandbox', // 回避のためにサンドボックスを切らせない
]

/** README の掃除コマンド（`rm -f …`）が並べるスキル名。 */
function skillsInCleanupCommand(): string[] {
  const match = README.match(/rm -f ([\s\S]*?)\n>\s*```/)
  if (match === null) return []
  return (
    (match[1] ?? '')
      // 引用の `> ` を先に外す——行継続の `\` を先に潰すと、改行ごと食って `>` が語として残る。
      .replace(/^>\s?/gm, '')
      .replace(/\\\s*/g, ' ')
      .split(/\s+/)
      .filter((name) => name.length > 0)
  )
}

describe('母艦の導入手順（実機と一致しているか）', () => {
  it('MulmoClaude の設定は 2 つで、スキルはプラグインのまま効くと書いてある', () => {
    // 1.18.0 以上では、ワークスペース側の作業は 1 つも無い（実測：docs/260915 §10.5）。
    expect(README).toContain(`MulmoClaude ${MIN_MULMOCLAUDE_VERSION} 以上`)
    expect(README).toContain('プラグインのまま効きます')
    // 登録が任意に見えると省略される。理由まで書く。
    expect(README).toContain('許可リストは**ここに登録したサーバから作られる**')
  })

  it('退役した回避策の文言が、手順に戻っていない', () => {
    for (const wording of RETIRED_WORDINGS) {
      expect(README, wording).not.toContain(wording)
      expect(INTRO_PAGE, wording).not.toContain(wording)
    }
    // 1.18.0 以降は事実として誤り。「読み込まれません」と言い切らない。
    expect(INTRO_PAGE).not.toContain('プラグインが読み込まれません')
    expect(ROOT_README).not.toContain('プラグインを読み込めない')
  })

  it('すでにリンクを張った人向けに、消し方と理由がある', () => {
    // 消さないと同じスキルが 2 回出る（実測：project 版 6＋プラグイン版 11＝コマンド 90 本）。
    expect(README).toContain('rm -f')
    expect(README).toContain('ai-database-map:station-analysis')
    // 直った根拠（上流の PR）を指しておく。issue だけだと「報告済み＝未解決」に読める。
    expect(README).toContain('mulmoclaude/pull/3188')
  })

  it('掃除の対象は実在する方法論スキルだけ（$0 を持つコマンド版は入れない）', () => {
    const skills = skillsInCleanupCommand()
    expect(skills.length).toBe(6)
    for (const name of skills) {
      const path = `${PLUGIN_ROOT}/skills/${name}/SKILL.md`
      expect(existsSync(path), name).toBe(true)
      // コマンド版は `$0` の引数展開を前提にしており、素の skills/ では展開されない。
      expect(readFileSync(path, 'utf-8'), name).not.toContain('$0')
    }
  })

  it('MulmoTerminal は WORKSPACE のセルを選ばせる（Canvas の ON ではない）', () => {
    expect(README).toContain('WORKSPACE')
    // 旧版の誤り：ワークスペースのセルに Canvas スイッチは表示されない。
    expect(README).not.toContain('**Canvas** を ON')
    expect(README).toContain('Canvas のスイッチは探さないでください')
  })

  it('地図タイルの CSP は、ホスト名だけ・再起動不要と書いてある', () => {
    expect(README).toContain('config/csp.json')
    expect(README).toContain('**再起動は不要**')
    expect(README).toContain('パスやワイルドカードは黙って無視されます')
    // カタログ由来の 3 オリジン（`render_map` が実際に読む先）。
    for (const host of [
      'https://cyberjapandata.gsi.go.jp',
      'https://disaportaldata.gsi.go.jp',
      'https://www.jma.go.jp',
    ]) {
      expect(README, host).toContain(host)
      expect(INTRO_PAGE, host).toContain(host)
    }
  })

  it('/ai にも母艦の節があり、CSP の 1 行を配っている', () => {
    expect(INTRO_PAGE).toContain('MulmoTerminal / MulmoClaude')
    expect(INTRO_PAGE).toContain('MULMO_CSP')
    expect(INTRO_PAGE).toContain('スキルはプラグインのまま効きます')
  })

  it('3 つの文書が同じ版数を言っている（片方だけ直すと食い違う）', () => {
    for (const [name, text] of [
      ['plugin README', README],
      ['/ai', INTRO_PAGE],
      ['root README', ROOT_README],
    ] as const) {
      expect(text, name).toContain(MIN_MULMOCLAUDE_VERSION)
    }
  })
})
