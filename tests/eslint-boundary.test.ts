import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * P0 受け入れ基準：「ESLint の import 境界ルールが violation を検出できる」を
 * 手動確認ではなく自動テストで担保する。
 *
 * ESLint を Node API で起動し、src/domain 配下の仮想ファイルを lint して、
 * 依存方向違反（domain → UI/app/ai）が no-restricted-imports で検出されることを検証する。
 * lintText はファイルを実在させる必要がなく、filePath で適用される flat config が決まる。
 */
const projectRoot = process.cwd()

async function lintDomainRuleIds(fileName: string, code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: projectRoot })
  const filePath = path.join(projectRoot, 'src', 'domain', fileName)
  const results = await eslint.lintText(code, { filePath })
  const first = results[0]
  return first ? first.messages.map((message) => message.ruleId ?? '') : []
}

describe('アーキテクチャ境界（ESLint import ルール）', () => {
  it('domain → UI/app/ai の import を no-restricted-imports で検出する', async () => {
    const ruleIds = await lintDomainRuleIds(
      '__boundary_violation_probe__.ts',
      "import { Panel } from '@/components/panel'\nexport const value = 1\n",
    )
    expect(ruleIds).toContain('no-restricted-imports')
  })

  it('相対パスでの UI 依存も検出する', async () => {
    const ruleIds = await lintDomainRuleIds(
      '__boundary_relative_probe__.ts',
      "import { Panel } from '../components/panel'\nexport const value = 1\n",
    )
    expect(ruleIds).toContain('no-restricted-imports')
  })

  it('domain → shared の正当な import は許可する', async () => {
    const ruleIds = await lintDomainRuleIds(
      '__boundary_ok_probe__.ts',
      "import { RADII_M } from '@/shared/constants'\nexport const count = RADII_M.length\n",
    )
    expect(ruleIds).not.toContain('no-restricted-imports')
  })
})
