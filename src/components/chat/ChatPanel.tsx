'use client'

/**
 * 左併設チャットパネル（plan_fable §2.4「AIインタラクション UI」・ルール①〜⑤）。
 * デスクトップ＝左サイドパネル（開閉・地図は常に可視）／モバイル＝vaul ボトムシート（半分⇔全画面）。
 * useChat で /api/chat をストリーミング。data-map の mapActions は onData で **即時**地図へ反映。
 * 図はスレッドに描かず、参照チップから ChatCanvas（narrow はモーダル）で開く。
 */

import { useMemo, useState } from 'react'
import { DefaultChatTransport } from 'ai'
import { useChat } from '@ai-sdk/react'
import { Drawer } from 'vaul'
import { mapResponseSchema } from '@/shared/protocol'
import { cn } from '@/lib/utils'
import { PANEL_WIDTH_CSS, radiusLabel } from '@/shared/constants'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useIsWide } from '@/hooks/useIsWide'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useStationDetail } from '@/components/detail/useStationDetail'
import { useMapStore } from '@/stores/mapStore'
import { useChatStore } from '@/stores/chatStore'
import { type ChatUIMessage } from './types'
import { ChatMessage } from './ChatMessage'
import { SuggestionChips } from './SuggestionChips'
import { useApplyMapActions } from './useApplyMapActions'
import { useCanvasAutoOpen } from './useCanvasAutoOpen'

/** 入力の最大文字数（サーバ /api/chat の 500 字上限に合わせる）。 */
const MAX_INPUT_CHARS = 500

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2Z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" />
    </svg>
  )
}

function Thread({ messages, busy }: { messages: readonly ChatUIMessage[]; busy: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {busy && (
        <div className="mr-auto flex items-center gap-1.5 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
          <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-slate-400" />
        </div>
      )}
    </div>
  )
}

/** チャットの中身（デスクトップ／モバイル共通）。 */
function ChatBody() {
  const { grp, setGrp, radiusM } = useMapUrlState()
  const setHighlightedGrps = useMapStore((state) => state.setHighlightedGrps)
  const closeChat = useChatStore((state) => state.setOpen)
  const applyMapActions = useApplyMapActions()
  // 選択駅の名前（インジケータ表示用）。ドロワーと SWR キャッシュを共有＝追加フェッチなし。
  const { detail: selectedDetail } = useStationDetail(grp)

  const transport = useMemo(() => new DefaultChatTransport<ChatUIMessage>({ api: '/api/chat' }), [])
  const { messages, sendMessage, status, stop, error, setMessages } = useChat<ChatUIMessage>({
    transport,
    onData: (part) => {
      // data-map はサーバ検証済みだが、クライアントでも safeParse して型を確定＋失敗時は無視（防御的）。
      if (part.type !== 'data-map') return
      const parsed = mapResponseSchema.safeParse(part.data)
      if (parsed.success) applyMapActions(parsed.data)
    },
  })

  // 回答に図が含まれたらキャンバスへ（広い画面のみ。narrow はチップから手動で開く）。
  useCanvasAutoOpen(messages, useIsWide())

  const [input, setInput] = useState('')
  const busy = status === 'submitted' || status === 'streaming'

  const send = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_INPUT_CHARS || busy) return
    // 地図で駅を選択中なら、その選択を文脈として同送する（「この駅」等の解決に使う・P8e）。
    void sendMessage(
      { text: trimmed },
      grp === null ? undefined : { body: { selectedGrp: grp, radiusM } },
    )
    setInput('')
  }

  const resetMap = (): void => {
    void setGrp(null)
    setHighlightedGrps([])
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ヘッダ */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
          <span className="text-indigo-600">
            <SparkleIcon />
          </span>
          AI チャット
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={resetMap}
            className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="地図の選択・ハイライトを消す"
          >
            地図をリセット
          </button>
          <button
            type="button"
            onClick={() => closeChat(false)}
            aria-label="チャットを閉じる"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* スレッド */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!hasMessages ? (
          <div className="mt-2 space-y-3 px-1">
            <p className="text-sm leading-relaxed text-slate-500">
              駅周辺のデータ（乗降客数、人口、地価、バス停数、事業所数、従業者数）について質問してください。
            </p>
          </div>
        ) : (
          <Thread messages={messages} busy={busy} />
        )}
        {error !== undefined && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-700 ring-1 ring-amber-200">
            {error.message.includes('429') || error.message.includes('多す')
              ? 'リクエストが集中しています。少し時間をおいて再度お試しください。'
              : '応答の取得に失敗しました。時間をおいて再度お試しください。'}
          </div>
        )}
      </div>

      {/* サジェスト＋入力 */}
      <div className="space-y-2 border-t border-slate-100 px-3 py-3">
        {/* 現在の対象（地図で選択中の駅）。以降の「この駅…」がこの駅を指すことを可視化（P8e）。 */}
        {grp !== null && (
          <div className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700">
            <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="currentColor" aria-hidden>
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
            </svg>
            <span className="min-w-0 truncate">
              現在の対象：
              <span className="font-semibold">
                {selectedDetail?.station.stationName ?? '選択中の駅'}
              </span>
              駅（{radiusLabel(radiusM)}圏）
            </span>
          </div>
        )}
        {(!hasMessages || !busy) && <SuggestionChips hasMessages={hasMessages} onPick={send} />}
        {hasMessages && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setMessages([])}
              className="text-xs text-slate-400 transition-colors hover:text-slate-600"
            >
              会話をクリア
            </button>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(input)
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value.slice(0, MAX_INPUT_CHARS))}
            onKeyDown={(event) => {
              // IME 変換中の Enter（漢字確定など）は送信しない（日本語入力で誤送信を防ぐ）。
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder="質問を入力…（例：新宿駅の地価は？）"
            aria-label="チャット入力"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="生成を停止"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-600 transition-colors hover:bg-slate-300"
            >
              <span className="size-3 rounded-sm bg-slate-600" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={input.trim().length === 0}
              aria-label="送信"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const isDesktop = useIsDesktop()
  const open = useChatStore((state) => state.open)
  const setOpen = useChatStore((state) => state.setOpen)
  // 初期は上スナップ＝1（コンテンツ全体＝入力まで見える）。下スナップ 0.5 へドラッグすると地図が動くのが見える。
  const [snap, setSnap] = useState<number | string | null>(1)

  if (isDesktop) {
    return (
      <aside
        // 閉じている間はフォーカスを内部へ入れない（aria-hidden だけでは tab 順から外れないため inert）。
        inert={!open}
        aria-hidden={!open}
        aria-label="AI チャット"
        // 幅は駅詳細ドロワーと共通の定数から（260804・両パネルを同じ幅に揃える）。
        style={{ width: PANEL_WIDTH_CSS }}
        className={cn(
          // z-20＝浮遊パネルの段。ヘッダ（z-30）の駅名検索の候補が前に出る（`MapShell.tsx`）。
          'absolute top-20 bottom-3 left-3 z-20 flex flex-col overflow-hidden rounded-2xl bg-white/95 shadow-2xl ring-1 ring-slate-200 backdrop-blur transition-[transform,opacity] duration-300 ease-out',
          open ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-[120%] opacity-0',
        )}
      >
        <ChatBody />
      </aside>
    )
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => setOpen(next)}
      snapPoints={[0.5, 1]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      modal={false}
    >
      <Drawer.Portal>
        {/* snapPoints はコンテンツ高の割合。上スナップ=1 で全コンテンツ（入力まで）を表示、高さ 85dvh で上に地図が覗く。 */}
        {/* z-20＝浮遊パネルの段。`modal={false}` で上の地図・ヘッダを触れるので、
            駅名検索の候補（ヘッダ＝z-30）がこのシートの前に出る（`MapShell.tsx`）。 */}
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-20 flex h-[85dvh] flex-col rounded-t-2xl bg-white outline-none">
          <div className="mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
          <Drawer.Title className="sr-only">AI チャット</Drawer.Title>
          <ChatBody />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
