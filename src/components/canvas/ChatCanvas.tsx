'use client'

/**
 * 広い画面で「図」を出す併設パネル＝キャンバス（260802）。
 *
 * テキストはチャットの吹き出しに残し、散布・ランキングはここに出して**手動でも操作できる**
 * ようにする。中身はモーダルとまったく同じ `ScatterBody` / `RankingBody`（PR #45 で切り出し）。
 *
 * - **既定では出さない**：図が開いていない（URL に `?fig` が無い）間は描画しない＝初期表示で地図を隠さない。
 * - 幅は散布ダイアログと同じ **896px を上限**にし、チャートの実寸（864×432＝2.00:1）を保つ。
 * - 駅を選ぶと右に詳細ドロワーが開くため、そのぶん右端を空けて重ならないようにする。
 *
 * 2026-10-02：図は URL（`figure/url.ts`）から読む。チャットの回答・⤢ に加えて **FAB の図もここに出る**
 * （図の出し方を 1 つにした・計画書 §12-6）。閉じるとブラウザの「戻る」で開き直せる。
 */

import { PANEL_GAP_PX, PANEL_WIDTH_PX } from '@/shared/constants'
import { useChatStore } from '@/stores/chatStore'
import { useIsWide } from '@/hooks/useIsWide'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useFigureHost } from '@/components/figure/useFigureHost'
import { ScatterBody } from '@/components/scatter/ScatterBody'
import { RankingBody } from '@/components/ranking/RankingBody'

// 左右端はパネル幅の共通定数から算出する（260804）。直書きすると、パネル幅を変えたときに
// キャンバスがドロワーと重なる。
/** チャット（左余白＋幅）の右隣に置くときの左端。 */
const LEFT_WITH_CHAT_PX = PANEL_GAP_PX + PANEL_WIDTH_PX + PANEL_GAP_PX
/** チャットを閉じているときの左端（他パネルと同じ余白）。 */
const LEFT_ALONE_PX = PANEL_GAP_PX
/** 駅詳細ドロワー（幅＋余白）を避けるときの右端。 */
const RIGHT_WITH_DETAIL_PX = PANEL_WIDTH_PX + PANEL_GAP_PX + PANEL_GAP_PX
/** 通常の右端（他パネルと同じ余白）。 */
const RIGHT_PX = PANEL_GAP_PX
/** 散布ダイアログと同じ最大幅（`max-w-4xl`）。 */
const MAX_WIDTH_PX = 896

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

export function ChatCanvas() {
  const { figure, bodyKey, onConditions, close } = useFigureHost()
  const chatOpen = useChatStore((state) => state.open)
  const isWide = useIsWide()
  const { grp, setGrp } = useMapUrlState()

  // narrow・モバイルはモーダル（PromotionHost）が担当する。図が無ければ何も出さない。
  if (!isWide || figure === null) return null

  const title = figure.kind === 'scatter' ? '散布図' : 'ランキング'
  // 図の中で駅を選んでも閉じない（キャンバスは見比べる場所）。地図と詳細ドロワーだけが動く。
  const onSelect = (selected: string): void => void setGrp(selected)

  return (
    <aside
      aria-label="キャンバス"
      style={{
        left: chatOpen ? LEFT_WITH_CHAT_PX : LEFT_ALONE_PX,
        right: grp === null ? RIGHT_PX : RIGHT_WITH_DETAIL_PX,
        maxWidth: MAX_WIDTH_PX,
      }}
      // z-20＝浮遊パネルの段。ヘッダ（z-30）の駅名検索の候補が前に出る（`MapShell.tsx`）。
      className="absolute top-20 bottom-3 z-20 flex flex-col overflow-hidden rounded-2xl bg-white/95 shadow-2xl ring-1 ring-slate-200 backdrop-blur transition-[left,right] duration-300 ease-out"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <button
          type="button"
          onClick={close}
          aria-label="キャンバスを閉じる"
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <CloseIcon />
        </button>
      </div>

      {/* key＝外から図が変わったときだけ作り直す（戻る/進む・⤢・AI・FAB。条件の書き戻しでは作り直さない）。 */}
      {figure.kind === 'scatter' ? (
        <ScatterBody
          key={bodyKey}
          initial={figure}
          active
          onSelect={onSelect}
          onConditions={onConditions}
        />
      ) : (
        <RankingBody
          key={bodyKey}
          initial={figure}
          active
          onSelect={onSelect}
          onConditions={onConditions}
        />
      )}
    </aside>
  )
}
