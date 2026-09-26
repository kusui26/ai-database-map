/**
 * チャットのモデル選び（`src/ai/client.ts`）の約束ごと。
 *
 * 2026-09、既定の `gemini-flash-lite-latest`（別名）の中身が、断りなく 3.1 → 3.5 Flash-Lite に
 * 替わっていた。別名は中身が替わってもエラーを出さないので、**気づけない**。だから既定は
 * 番号つきの版に固定し、上げるときは eval を流してから上げる（`docs/260926_chat_model_eval.md` §2.4）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatModelId, DEFAULT_CHAT_MODEL } from '@/ai/client'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('既定モデル', () => {
  it('番号つきの版に固定する（中身が断りなく替わる -latest の別名にしない）', () => {
    expect(DEFAULT_CHAT_MODEL).not.toContain('latest')
    expect(DEFAULT_CHAT_MODEL).toMatch(/^gemini-\d+(\.\d+)?-/)
  })

  it('プレビュー版にもしない（数か月で退役する）', () => {
    expect(DEFAULT_CHAT_MODEL).not.toContain('preview')
  })
})

describe('env GEMINI_MODEL での差し替え', () => {
  it('値があれば、それを使う', () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.1-flash-lite')
    expect(chatModelId()).toBe('gemini-3.1-flash-lite')
  })

  it('空文字なら既定（ダッシュボードで値だけ消したときの形）', () => {
    vi.stubEnv('GEMINI_MODEL', '')
    expect(chatModelId()).toBe(DEFAULT_CHAT_MODEL)
  })

  it('無ければ既定', () => {
    vi.stubEnv('GEMINI_MODEL', undefined)
    expect(chatModelId()).toBe(DEFAULT_CHAT_MODEL)
  })
})
