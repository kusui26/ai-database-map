import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * オフラインで何が出せて、何が出せないか（§8.3・§11 リスク 4・PR-5b）。
 *
 * **発災時にいちばん落ちるのが通信**なので、「通信が切れたら何も言えない」画面にしない。
 * ここで固定するのは**経路の有無**である——実際の動きは Playwright で確かめた
 * （共通API を落としてもブラウザ側で同じドメイン関数が走ること）。
 */

function source(path: string): string {
  return readFileSync(path, 'utf-8')
}

describe('オフライン：落ちてはいけない経路が残っている', () => {
  it('地点のハザードは、共通API が落ちてもブラウザで組み立てる', () => {
    const hook = source('src/components/hazard/useHazardPoint.ts')
    expect(hook).toContain('navigator.onLine')
    expect(hook).toContain('pointHazard')
  })

  it('脱出方向も、共通API が落ちてもブラウザで組み立てる（メッシュだけで足りる）', () => {
    const hook = source('src/components/hazard/useEscapeDirection.ts')
    expect(hook).toContain('navigator.onLine')
    expect(hook).toContain('escapeDirectionAt')
    // **同じドメイン関数**を通す（UI で作り直さない）。
    expect(hook).toContain("from '@/lib/hazard/escape-source'")
  })

  it('脱出方向の取得層に、ブラウザで動かない依存が無い', () => {
    const lib = source('src/lib/hazard/escape-source.ts')
    expect(lib).not.toMatch(/from 'node:|require\(/)
  })

  /**
   * 避難場所（国土地理院のタイル）は**別ドメイン**で、Service Worker が拾えない。
   * オフラインで出せないこと自体は仕方がないが、**黙って失敗しない**。
   */
  it('避難場所はオフラインで取りに行かず、出せない理由を言う', () => {
    const banner = source('src/components/hazard/HazardAlertBanner.tsx')
    expect(banner).toContain('online ? evacuationTarget : null')
    // 文言は 260828 PR-3 でドメイン（`evacuationUnavailableJa`）へ移した——
    // 駅タブの「逃げる」と同じ文を使うため。出し忘れないことはここで見る。
    expect(banner).toContain('evacuationUnavailableJa(')
    const tab = source('src/components/hazard/StationHazardTab.tsx')
    expect(tab).toContain('online ? escapeTarget : null')
    expect(tab).toContain('evacuationUnavailableJa(')
    const domain = source('src/domain/hazard/panels.ts')
    expect(domain).toContain('オフラインのため、避難場所の一覧は出せません')
    // 代わりに何が見られるかも言う。
    expect(domain).toContain('区域の外へ出る向き')
  })

  it('警戒中は、現在地を使っていなくてもメッシュを先に落とす', () => {
    const shell = source('src/components/MapShell.tsx')
    expect(shell).toContain('useOfflineHazardCache')
    expect(shell).toContain('isWarningMode(alerts.alertLevel) ? alertTarget : null')
  })

  /**
   * ⚠ **同じ量は落とさない。** 3×3 は実測 0.57〜1.49MB あり、発災時の混んだ回線で
   * 頼まれてもいないのに引く量ではない。警戒中は 1 枚（中央値 25KB）に絞る。
   */
  it('警戒中の先読みは 1 枚だけ、現在地は 9 枚（範囲を分けている）', () => {
    const hook = source('src/hooks/useOfflineHazardCache.ts')
    expect(hook).toContain("scope: 'around' as const")
    expect(hook).toContain("scope: 'home' as const")
    expect(hook).toContain('surroundingPrimaries')
  })

  it('Service Worker が拾うのは配布メッシュとカタログだけ（アプリ全体を古いまま配らない）', () => {
    const sw = source('public/sw.js')
    expect(sw).toContain("CACHEABLE_PREFIXES = ['/hazard/', '/api/hazard/catalog']")
  })
})
