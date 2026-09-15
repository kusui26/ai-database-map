/**
 * 母艦（MulmoTerminal / MulmoClaude）の導入手順が、実機の挙動と一致していることを固定する
 * （PR-15a・`docs/260912_gui_chat_protocol.md` §4.6.1）。
 *
 * ここを落とすのは「手順書が間違っている」という不具合で、**実行時には何も起きない**——
 * MulmoClaude では作法が届かないまま、エラーも警告も無く答えの質だけが落ちる。実際に
 * 出荷済みの README がそうなっていた（「読まれない場合はコピー」という条件付きの案内）。
 * 静かに壊れるものはテストで留める。
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PLUGIN_ROOT = `${process.cwd()}/plugins/ai-database-map`
const README = readFileSync(`${PLUGIN_ROOT}/README.md`, 'utf-8')
const INTRO_PAGE = readFileSync(`${process.cwd()}/src/app/ai/page.tsx`, 'utf-8')

/** README の `for s in …; do` が並べるスキル名。 */
function linkedSkillsInReadme(): string[] {
  const match = README.match(/for s in ([\s\S]*?); do/)
  if (match === null) return []
  return (match[1] ?? '')
    .replace(/\\\s*/g, ' ')
    .split(/\s+/)
    .filter((name) => name.length > 0)
}

/** `/ai` の `MULMO_SKILLS` 配列が並べるスキル名。 */
function linkedSkillsInIntroPage(): string[] {
  const match = INTRO_PAGE.match(/const MULMO_SKILLS = \[([\s\S]*?)\]/)
  if (match === null) return []
  return [...(match[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((entry) => entry[1] ?? '')
}

describe('母艦の導入手順（実機と一致しているか）', () => {
  it('MulmoClaude が動かない理由を、正しい原因で説明している', () => {
    // 真因は Docker サンドボックス内で Claude Code がプラグインを解決できないこと
    // （台帳がホストの絶対パスを持つ）。upstream: receptron/mulmoclaude#3186。
    expect(README).toContain('Docker サンドボックス')
    expect(README).toContain('プラグインが丸ごと読み込まれません')
    expect(README).toContain('mulmoclaude/issues/3186')
    // 旧版の誤り 1：条件付きの案内だと、動かない状態のまま放置される。
    expect(README).not.toContain('スキルが読まれない場合')
    // 旧版の誤り 2：MulmoClaude の走査ルートを原因として書いていた。エージェントの
    // スキル発見は claude CLI の仕事なので、これは症状の原因ではない。
    expect(README).not.toContain('MulmoClaude は**プラグインを読みません**')
    // 登録が任意に見えると省略される。理由まで書く。
    expect(README).toContain('許可リストは**ここに登録したサーバから作られる**')
  })

  it('symlink が要る条件を限定している（サンドボックスを使うときだけ）', () => {
    // 無条件に書くと、サンドボックスを外している人にも不要な作業をさせる。
    // #3186 が直れば、この手順自体が要らなくなる。
    expect(README).toContain('サンドボックスを使うときだけ')
    expect(README).toContain('--disable-sandbox')
    expect(INTRO_PAGE).toContain('サンドボックスを使うときだけ')
  })

  it('MulmoTerminal は WORKSPACE のセルを選ばせる（Canvas の ON ではない）', () => {
    expect(README).toContain('WORKSPACE')
    // 旧版の誤り：ワークスペースのセルに Canvas スイッチは表示されない。
    expect(README).not.toContain('**Canvas** を ON')
    expect(README).toContain('Canvas のスイッチは探さないでください')
  })

  it('スキルのリンクは相対パスで、マーケットプレイス側を指す', () => {
    const command = README.match(/ln -s "([^"]+)"/)?.[1] ?? ''
    // 絶対パスは Docker サンドボックスの中で切れる（ホストと container で home が違う）。
    expect(command.startsWith('../../../')).toBe(true)
    expect(command).not.toContain('/Users/')
    expect(command).not.toContain('~/')
    // 版番号を含む cache/ ではなく marketplaces/ を指す（更新に追随させるため）。
    expect(command).toContain('/plugins/marketplaces/')
    expect(command).not.toContain('/plugins/cache/')
    expect(README).toContain('mkdir -p ~/mulmoclaude/.claude/skills')
  })

  it('リンクするのは実在する方法論スキルだけ（$0 を持つコマンド版は入れない）', () => {
    const skills = linkedSkillsInReadme()
    expect(skills.length).toBe(6)
    for (const name of skills) {
      const path = `${PLUGIN_ROOT}/skills/${name}/SKILL.md`
      expect(existsSync(path), name).toBe(true)
      // コマンド版は `$0` の引数展開を前提にしており、素の skills/ では展開されない。
      expect(readFileSync(path, 'utf-8'), name).not.toContain('$0')
    }
  })

  it('README と /ai が同じスキルを案内している（片方だけ直すと食い違う）', () => {
    expect(linkedSkillsInIntroPage()).toEqual(linkedSkillsInReadme())
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

  it('/ai にも母艦の節があり、2 つのコマンドを配っている', () => {
    expect(INTRO_PAGE).toContain('MulmoTerminal / MulmoClaude')
    expect(INTRO_PAGE).toContain('MULMO_SKILL_LINK')
    expect(INTRO_PAGE).toContain('MULMO_CSP')
    expect(INTRO_PAGE).toContain('プラグインが読み込まれません')
  })
})
