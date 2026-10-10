/**
 * ドメイン：駅周辺のプロフィール → GUI Chat Protocol の `stationProfile` パネル（純関数・2026-10-09 B4）。
 *
 * 駅詳細の「概要」タブ（クリック）とチャットの回答（会話・MCP）が、この同じパネルを描く
 * （.claude/CLAUDE.md §2「クリックでも会話でも、同じ場所に同じ物が出る」）。中身は共通 API の応答そのもので、
 * ここで足すのは見出しと出典の形だけ（意味づけは `build.ts` が済ませている）。
 */

import { type StationProfile } from '@/shared/api'
import { radiusLabel } from '@/shared/constants'
import { type PanelSize, type SourceRef, type StationProfilePanel } from '@/shared/protocol'

/** 見出し（「横浜の周辺（1km圏）」）。駅の呼び名に「駅」を足さない（「富山駅」という電停がある）。 */
export function profileTitleOf(profile: StationProfile): string {
  return `${profile.station.label}の周辺（${radiusLabel(profile.radiusM)}圏）`
}

/** 出典 → protocol の出典（リンクは持たない・同じ表記は描く側が畳む）。 */
function sourceRefsOf(profile: StationProfile): SourceRef[] {
  return profile.sources.map((each) => ({
    labelJa: each.source,
    url: null,
    license: each.license,
    forJa: null,
  }))
}

/** プロフィール → パネル（チャットは compact、駅詳細は full）。 */
export function stationProfilePanel(
  profile: StationProfile,
  size: PanelSize = 'full',
): StationProfilePanel {
  return {
    type: 'stationProfile',
    grp: profile.station.grp,
    title: profileTitleOf(profile),
    placeJa: profile.station.label,
    radiusM: profile.radiusM,
    areaJa: profile.area,
    positionsLegendJa: profile.positionsLegendJa,
    character: profile.character,
    sections: profile.sections,
    hazard: profile.hazard,
    notCoveredJa: profile.notCoveredJa,
    notesJa: profile.notesJa,
    sources: sourceRefsOf(profile),
    size,
  }
}
