/**
 * **画面とエージェントで、同じ質問に同じ既定を出す**（`src/domain/recommend/presets.ts` の冒頭）。
 *
 * ## なぜこの検査が要るのか
 *
 * 「おすすめの駅は？」の答えは、**2 つの実装**を通る。
 *
 * | 入口 | 実装 |
 * | --- | --- |
 * | 画面（おすすめ駅） | `/api/recommend` ＋ `src/domain/recommend/*`（サーバで合成） |
 * | AI クライアント | `station-recommendation` スキル（**手元の pandas** で合成） |
 *
 * MCP クライアントは CSV を受け取って自分で計算するので、この二重化は避けられない。
 * だから `presets.ts` は「数値はスキルの表と**同じもの**にしてある」と宣言している——
 * **違う答えになるとしたら、それは利用者が重みを動かしたからであって、入口が違うからであっては
 * ならない**。しかしその同期は**手作業**で、片方だけ動かしても誰も気づかなかった。
 *
 * ここが気づく場所である。**型でも lint でも止まらない**——どちらもただの数字だからである。
 *
 * ⚠ `budget`（予算重視）だけは**サーバにしか無い**。スキルは「ファミリー初期値からの振り替え」を
 * 会話で説明する形を採っていて、表に行を持たない（`presets.ts` にもそう書いてある）。
 * その差は下の `SERVER_ONLY` で明示的に許す——**黙って通すのではなく、名前で許す**。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HAZARD_PENALTY_STEPS, RECOMMEND_PRESETS, type PresetId } from '@/domain/recommend/presets'

const SKILL_PATH = 'plugins/ai-database-map/skills/station-recommendation/SKILL.md'
const SKILL = readFileSync(SKILL_PATH, 'utf-8')

/** スキルの表に行を持たないプリセット（理由は上のドキュメント）。 */
const SERVER_ONLY: readonly PresetId[] = ['budget']

/** 画面の既定と同じ段階減点（スキルはこれを例として書く）。 */
const DEFAULT_PENALTY_ID = 'standard'

/** `| a | b |` の行を配列にする（前後の空セルは落とす）。 */
function cellsOf(line: string): readonly string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

/** 見出しに `プリセット` を含む表を、ヘッダ行と本文行に分けて取り出す。 */
function presetTable(): {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
} {
  const lines = SKILL.split('\n')
  const start = lines.findIndex((line) => line.startsWith('|') && line.includes('プリセット'))
  expect(start, `${SKILL_PATH} に「プリセット」の表が無い`).toBeGreaterThanOrEqual(0)
  const body = lines
    .slice(start + 2) // ヘッダと区切り行を飛ばす
    .filter((line) => line.startsWith('|'))
  return { header: cellsOf(lines[start] ?? ''), rows: body.map(cellsOf) }
}

const TABLE = presetTable()
/** 表の 1 行目は見出し（「プリセット」）なので、2 列目以降が軸。 */
const AXIS_LABELS = TABLE.header.slice(1)

describe('スキルの表と、画面のプリセットが同じであること', () => {
  it('軸の並びが同じ（列を入れ替えたら落ちる）', () => {
    const server = RECOMMEND_PRESETS.family.metrics.map((metric) => metric.labelJa)
    expect(AXIS_LABELS).toEqual(server)
  })

  it.each(TABLE.rows.map((row) => [row[0] ?? '', row] as const))(
    '%s：重みが 1 つ残らず一致する',
    (labelJa, row) => {
      const preset = Object.values(RECOMMEND_PRESETS).find((each) => each.labelJa === labelJa)
      expect(preset, `画面に「${labelJa}」というプリセットが無い`).toBeDefined()
      const fromSkill = row.slice(1).map(Number)
      expect(fromSkill.every(Number.isFinite), `数値として読めない行: ${row.join(' | ')}`).toBe(
        true,
      )
      expect(fromSkill).toEqual(preset?.metrics.map((metric) => metric.weight))
    },
  )

  it('画面にあるプリセットは、スキルの表にもある（`budget` を除く）', () => {
    const inSkill = new Set(TABLE.rows.map((row) => row[0]))
    const missing = Object.values(RECOMMEND_PRESETS)
      .filter((preset) => !SERVER_ONLY.includes(preset.id))
      .filter((preset) => !inSkill.has(preset.labelJa))
      .map((preset) => preset.id)
    expect(missing, `スキルの表に足りない: ${missing.join(', ')}`).toEqual([])
  })

  it('`budget` は意図してサーバだけにある（スキルの表には出さない）', () => {
    const inSkill = new Set(TABLE.rows.map((row) => row[0]))
    expect(inSkill.has(RECOMMEND_PRESETS.budget.labelJa)).toBe(false)
  })
})

/**
 * 災害の段階減点。スキルは「例」として数値を書くが、**画面のどの表とも違う数字**だと、
 * 同じ「減点で」という指示に対して入口ごとに違う順位が出る。
 * 名前つきの表（`light` / `standard` / `heavy`）のどれかと一致していること。
 */
describe('災害の段階減点も、名前つきの表と一致していること', () => {
  const steps = HAZARD_PENALTY_STEPS[DEFAULT_PENALTY_ID]

  it.each(['warning', 'danger', 'critical'] as const)('%s の減点が画面と同じ', (level) => {
    const found = new RegExp(`${level} −([0-9.]+)`).exec(SKILL)
    expect(found, `スキルに ${level} の減点が書かれていない`).not.toBeNull()
    expect(Number(found?.[1])).toBe(steps[level])
  })

  it('どの段階を使っているかを名指ししている（「例」で濁さない）', () => {
    expect(SKILL).toContain(`\`${DEFAULT_PENALTY_ID}\``)
  })
})
