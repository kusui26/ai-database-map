'use client'

/**
 * 「最新の回答へ」ボタン（2026-10-02・`docs/261001_fix_user_feedback_ui.md` §3.3）。
 *
 * 上へスクロールして前の回答を読んでいる間は、新しい回答が届いても**読んでいる所を奪わない**
 * （追従しない）。その代わりに、最新の質問と回答へ一押しで戻れるようにする。
 */

function ArrowDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-md ring-1 ring-slate-200 backdrop-blur transition-colors hover:bg-white hover:text-slate-800"
    >
      <ArrowDownIcon />
      最新の回答へ
    </button>
  )
}
