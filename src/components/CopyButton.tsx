'use client'

/**
 * コピーボタン（導入ページ用）。コマンドや URL をワンクリックでクリップボードへ。
 * 失敗時（クリップボード権限なし等）はテキスト選択に頼れるよう、静かに何もしない。
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'

const COPIED_RESET_MS = 2_000

export function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch {
      // 権限が無い環境では選択コピーにフォールバック（ボタンは沈黙）
    }
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`${label}（クリップボードへ）`}
      className={cn(
        'shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
        copied
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
      )}
    >
      {copied ? 'コピーしました' : label}
    </button>
  )
}
