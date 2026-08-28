'use client'

/**
 * 駅詳細パネル（骨格＋乗降タブ）。デスクトップ＝右ドロワー／モバイル＝vaul ボトムシート。
 * ?grp 選択で開き、閉じると ?grp をクリア。カード＋タブは Protocol の Panel を PanelStack で描画する。
 * タブは 8 カテゴリ（乗降・人口・所得・売上・地価・バス・事業所・従業者）＋**災害**。
 * 半径依存タブは集計半径セレクタを表示。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Drawer } from 'vaul'
import { type Panel } from '@/shared/protocol'
import { type StationDetail } from '@/shared/api'
import {
  type Category,
  type DetailTab,
  CATEGORY_LABELS_JA,
  DETAIL_TAB_LABELS_JA,
  PANEL_WIDTH_CSS,
  RADII_M,
  RADIUS_LABELS,
} from '@/shared/constants'
import {
  busPanels,
  employeePanels,
  establishmentPanels,
  incomePanels,
  landPricePanels,
  paxTrendPanel,
  populationPanels,
  salesPanels,
  stationCardPanel,
} from '@/domain/stations/panels'
import { isRadiusDependentCategory } from '@/domain/metrics'
import { useMapUrlState } from '@/components/map/useMapUrlState'
import { useChatStore } from '@/stores/chatStore'
import { useStationDetail } from '@/components/detail/useStationDetail'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { PanelRenderer, PanelStack } from '@/components/panels/PanelRenderer'
import { StationHazardBadge } from '@/components/hazard/StationHazardBadge'
import { StationHazardTab } from '@/components/hazard/StationHazardTab'
import { type HazardTarget } from '@/components/hazard/useHazardPoint'
import { TAB_FADE_WIDTH_PX, tabStripScrollLeft } from '@/lib/tab-strip'
import { cn } from '@/lib/utils'

/**
 * 詳細タブ（表示順）。所得は「そこに住む人の稼ぎ」、売上は「そこで落ちるお金」なので、
 * 人口 → 所得 → 売上 と並べる（`CATEGORY_ORDER` と同順）。
 *
 * **災害は末尾**（`docs/260828_fix_flood.md` §7 決定 2）。指標ではないので `Category` ではなく
 * `DetailTab` で持つ。2 番目に置けば見つけやすいが、**乗降・人口を主に使う人の並びを乱す**——
 * ヘッダのバッジという確実な入口があるので、並びを壊してまで前に出さない。
 *
 * ⚠ タブ帯は 7 タブで 460px、8 タブ（売上）で 516px、**9 タブ（災害）で 572px** になり、
 * パネル幅 420px を超えて横スライドが要る（パネルを広げると地図が狭くなるので広げない・
 * `docs/260805_research_add_dataset_economy.md` §16.3）。7 タブまでは最後のタブが 26px 見えて
 * 「続きがある」と分かったが、**8 タブ以降は最後のタブが完全に隠れる**ため、帯の右端に
 * フェードを出し、**選んだタブは帯を送って見せる**（`docs/260816_sales.md` §7.4 案A・
 * `docs/260828_fix_flood.md` §4.2・`tests/panel-layout.test.ts`）。
 */
export const DETAIL_TABS: readonly DetailTab[] = [
  'passenger',
  'population',
  'income',
  'sales',
  'land_price',
  'bus',
  'establishment',
  'employee',
  'hazard',
]

/**
 * 災害バッジとタブが見る地点。**1 か所で作る**——バッジ（ヘッダ）とタブ（本文）で
 * `useHazardPoint` の SWR キーが同じになり、**タブを開いても追加の通信が起きない**。
 */
function hazardTargetOf(detail: StationDetail): HazardTarget {
  return { lon: detail.station.lon, lat: detail.station.lat, placeJa: detail.station.label }
}

/** タブごとの本文パネル（選択半径で再計算）。パネルの組み立てはドメイン層が持つ。 */
function tabPanels(detail: StationDetail, tab: Category, radiusM: number): Panel[] {
  switch (tab) {
    case 'passenger':
      return [paxTrendPanel(detail)]
    case 'population':
      return populationPanels(detail, radiusM)
    case 'income':
      return incomePanels(detail, radiusM)
    case 'sales':
      return salesPanels(detail, radiusM)
    case 'land_price':
      return landPricePanels(detail, radiusM)
    case 'bus':
      return busPanels(detail, radiusM)
    case 'establishment':
      return establishmentPanels(detail, radiusM)
    case 'employee':
      return employeePanels(detail, radiusM)
    default:
      return []
  }
}

/** 詳細内の集計半径セレクタ（?r 同期）。半径依存タブでのみ表示。 */
function DrawerRadiusControl({
  radiusM,
  onChange,
}: {
  radiusM: number
  onChange: (radiusM: number) => void
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-slate-400">集計半径</span>
      <div className="flex gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5">
        {RADII_M.map((radius) => (
          <button
            key={radius}
            type="button"
            onClick={() => onChange(radius)}
            className={cn(
              'shrink-0 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
              radius === radiusM
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {RADIUS_LABELS[radius]}
          </button>
        ))}
      </div>
    </div>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="閉じる"
      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/**
 * 選んだタブを帯の中に出す。**選んだタブが見えないままだと壊れて見える**——
 * 災害タブは末尾にあり、既定では完全に隠れているので、バッジから飛んだときに必ず要る。
 * 既に見えているときは動かさない（幾何と境界は `src/lib/tab-strip.ts`）。
 */
function useRevealTab(
  value: DetailTab,
  stripRef: RefObject<HTMLDivElement | null>,
  tabRefs: RefObject<Map<DetailTab, HTMLButtonElement>>,
) {
  useEffect(() => {
    const strip = stripRef.current
    const tab = tabRefs.current.get(value)
    if (strip === null || tab === undefined) return
    strip.scrollTo({ left: tabStripScrollLeft(strip, tab), behavior: 'smooth' })
  }, [value, stripRef, tabRefs])
}

function DetailTabs({ value, onChange }: { value: DetailTab; onChange: (tab: DetailTab) => void }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<DetailTab, HTMLButtonElement>())
  const [atEnd, setAtEnd] = useState(false)

  // 9 タブで帯は 572px になり、420px のパネルからはみ出して最後のタブが完全に隠れる。
  // 右端にフェードを出して「まだ続く」ことを示し、**右端まで送ったら消す**（無い続きを示唆しない）。
  const syncFade = useCallback(() => {
    const strip = stripRef.current
    if (strip === null) return
    setAtEnd(strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1)
  }, [])

  useEffect(() => {
    syncFade() // 初期表示と、画面幅が変わって可視幅が変わったとき
    window.addEventListener('resize', syncFade)
    return () => window.removeEventListener('resize', syncFade)
  }, [syncFade])

  useRevealTab(value, stripRef, tabRefs)

  return (
    <div className="relative border-b border-slate-100">
      {/* `relative`＝タブの `offsetLeft` を**この帯を基準に**測るため（`tabStripScrollLeft`）。 */}
      <div ref={stripRef} onScroll={syncFade} className="relative flex gap-1 overflow-x-auto px-2">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            ref={(node) => {
              if (node !== null) tabRefs.current.set(tab, node)
            }}
            onClick={() => onChange(tab)}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              value === tab
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {DETAIL_TAB_LABELS_JA[tab]}
          </button>
        ))}
      </div>
      {!atEnd && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-white to-transparent"
          style={{ width: TAB_FADE_WIDTH_PX }}
        />
      )}
    </div>
  )
}

/** 指標タブの本文（半径セレクタ＋パネル束）。 */
function MetricTabContent({
  detail,
  tab,
  radiusM,
  onRadius,
}: {
  detail: StationDetail
  tab: Category
  radiusM: number
  onRadius: (radiusM: number) => void
}) {
  const panels = tabPanels(detail, tab, radiusM)
  return (
    <div>
      {isRadiusDependentCategory(tab) && (
        <DrawerRadiusControl radiusM={radiusM} onChange={onRadius} />
      )}
      {panels.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">
          この駅は「{CATEGORY_LABELS_JA[tab]}」のデータがありません。
        </div>
      ) : (
        <PanelStack panels={panels} />
      )}
    </div>
  )
}

/**
 * タブの本文。**災害だけは指標ではない**ので、集計半径もカタログも通さず別の器に渡す
 * （`docs/260828_fix_flood.md` §4.1）。ここで分けておくと、指標側の型が `Category` のまま保てる。
 */
function TabContent({
  detail,
  tab,
  radiusM,
  onRadius,
}: {
  detail: StationDetail
  tab: DetailTab
  radiusM: number
  onRadius: (radiusM: number) => void
}) {
  if (tab === 'hazard') return <StationHazardTab target={hazardTargetOf(detail)} />
  return <MetricTabContent detail={detail} tab={tab} radiusM={radiusM} onRadius={onRadius} />
}

type BodyProps = {
  detail: StationDetail | undefined
  isLoading: boolean
  error: Error | undefined
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  radiusM: number
  onRadius: (radiusM: number) => void
  onClose: () => void
}

/** 詳細パネルの中身（ドロワー／シート共通）。ヘッダ＝駅カード、以下にタブと本文。 */
function DetailBody({
  detail,
  isLoading,
  error,
  tab,
  onTab,
  radiusM,
  onRadius,
  onClose,
}: BodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          {detail !== undefined ? (
            <>
              <PanelRenderer panel={stationCardPanel(detail)} />
              {/* 災害タブは末尾で既定では隠れるので、1 行のバッジを確実な入口にする（§7.2）。
                  ⚠ ここで**開かない**——ヘッダはスクロールしないので、伸ばすと下が切れる。 */}
              <StationHazardBadge target={hazardTargetOf(detail)} onOpen={() => onTab('hazard')} />
            </>
          ) : (
            <p className="py-2 text-sm text-slate-400">{isLoading ? '読み込み中…' : '駅を選択'}</p>
          )}
        </div>
        <CloseButton onClick={onClose} />
      </header>

      <DetailTabs value={tab} onChange={onTab} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error !== undefined ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
            詳細を取得できませんでした。時間をおいて再度お試しください。
          </div>
        ) : detail === undefined ? (
          <div className="grid h-40 place-items-center text-sm text-slate-400">読み込み中…</div>
        ) : (
          <TabContent detail={detail} tab={tab} radiusM={radiusM} onRadius={onRadius} />
        )}
      </div>
    </div>
  )
}

export function StationDetailPanel() {
  const { grp, setGrp, radiusM, setRadiusM } = useMapUrlState()
  const isDesktop = useIsDesktop()
  const { detail, isLoading, error } = useStationDetail(grp)
  const [tab, setTab] = useState<DetailTab>('passenger')

  // チャットの ⤢ 昇格が焦点タブを要求していれば、その1回だけ反映（無ければ乗降）。
  const requestedCategory = useChatStore((state) => state.requestedCategory)
  const setRequestedCategory = useChatStore((state) => state.setRequestedCategory)
  const requestedRef = useRef(requestedCategory)
  requestedRef.current = requestedCategory

  // ⤢ 昇格が焦点タブを要求したら、選択駅が同じ（ドロワー既開）でもそのタブへ切替え、要求は消費する
  useEffect(() => {
    if (requestedCategory !== null) {
      setTab(requestedCategory)
      setRequestedCategory(null)
    }
  }, [requestedCategory, setRequestedCategory])

  // 駅が変わったら乗降タブへ戻す（ただし焦点要求が保留中なら上の効果を優先）
  useEffect(() => {
    if (requestedRef.current === null) setTab('passenger')
  }, [grp])

  const open = grp !== null
  const close = useCallback(() => {
    void setGrp(null)
  }, [setGrp])

  const body = (
    <DetailBody
      detail={detail}
      isLoading={isLoading}
      error={error}
      tab={tab}
      onTab={setTab}
      radiusM={radiusM}
      onRadius={(radius) => void setRadiusM(radius)}
      onClose={close}
    />
  )

  if (isDesktop) {
    return (
      <aside
        // 閉じている間はフォーカスを内部へ入れない（body は閉じアニメのため残すが tab/a11y 順から外す）。
        inert={!open}
        aria-hidden={!open}
        // 幅は AI チャットと共通の定数から（260804）。カテゴリのタブ帯（404px）が
        // 既定でスライドしないだけの幅を確保する。狭い画面では min() で縮む。
        style={{ width: PANEL_WIDTH_CSS }}
        className={cn(
          // z-20＝浮遊パネルの段。ヘッダ（z-30）の駅名検索の候補が前に出る（`MapShell.tsx`）。
          // bottom-9＝下端に地図の出典の帯を空ける（MAP_ATTRIBUTION_STRIP_PX・チャットと同値）。
          'pointer-events-auto absolute top-20 right-3 bottom-9 z-20 flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-[transform,opacity] duration-300 ease-out',
          open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[120%] opacity-0',
        )}
      >
        {open || detail !== undefined ? body : null}
      </aside>
    )
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-40 flex max-h-[86vh] flex-col rounded-t-2xl bg-white outline-none">
          <div className="mx-auto mt-3 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-slate-300" />
          <Drawer.Title className="sr-only">{detail?.station.stationName ?? '駅詳細'}</Drawer.Title>
          {body}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
