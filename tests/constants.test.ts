import { describe, expect, it } from 'vitest'
import {
  ACCENT_COLOR,
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_LABELS_JA,
  CLUSTER_COLORS,
  clusterColor,
  operatorLabel,
  PREFECTURES,
  prefectureLabel,
  RADII_M,
  RADIUS_LABELS,
  ROUTE_TYPE_LABELS,
  ROUTE_TYPES,
  routeFilterLabel,
  routeLabel,
  routeOptionLabel,
  routeTypeLabel,
  selectionLabel,
  WARNING_COLOR,
} from '@/shared/constants'

const HEX_COLOR = /^#[0-9a-f]{6}$/

describe('RADII_M', () => {
  it('6 段の半径を厳密昇順・重複なしで保持する', () => {
    expect(RADII_M).toHaveLength(6)
    expect([...RADII_M].sort((a, b) => a - b)).toEqual([...RADII_M])
    expect(new Set(RADII_M).size).toBe(RADII_M.length)
  })

  it('dataset.md の 500m–20km と一致する', () => {
    expect(RADII_M).toEqual([500, 1000, 2000, 5000, 10000, 20000])
  })

  it('全ての半径に表示ラベルがある', () => {
    for (const radius of RADII_M) {
      expect(RADIUS_LABELS[radius]).toMatch(/^\d+(m|km)$/)
    }
  })
})

describe('CATEGORIES', () => {
  it('8 カテゴリを重複なく保持する', () => {
    expect(CATEGORIES).toHaveLength(8)
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length)
  })

  it('全カテゴリに日本語ラベルと配色がある', () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_LABELS_JA[category].length).toBeGreaterThan(0)
      expect(CATEGORY_COLORS[category]).toMatch(HEX_COLOR)
    }
  })
})

describe('配色トークン', () => {
  it('アクセント・警告色が有効な hex', () => {
    expect(ACCENT_COLOR).toMatch(HEX_COLOR)
    expect(WARNING_COLOR).toMatch(HEX_COLOR)
  })
})

describe('CLUSTER_COLORS（散布図クラスタ配色）', () => {
  it('旧プロジェクト（Station Area Database Map）と同一の 4 色を保持する', () => {
    // 旧アプリ GrowthRateGraphModal.vue の clusterColors（rgba・alpha=1）と等価な hex。
    expect(CLUSTER_COLORS).toEqual(['#ff6384', '#36a2eb', '#ffce56', '#4bc0c0'])
  })

  it('全て有効な hex・重複なし', () => {
    for (const color of CLUSTER_COLORS) {
      expect(color).toMatch(HEX_COLOR)
    }
    expect(new Set(CLUSTER_COLORS).size).toBe(CLUSTER_COLORS.length)
  })

  it('アクセント（選択駅）・警告（信頼性フラグ）と衝突しない', () => {
    expect(CLUSTER_COLORS).not.toContain(ACCENT_COLOR)
    expect(CLUSTER_COLORS).not.toContain(WARNING_COLOR)
  })
})

describe('clusterColor', () => {
  it('クラスタ番号 0..n-1 は定義順の色を返す', () => {
    CLUSTER_COLORS.forEach((color, index) => {
      expect(clusterColor(index)).toBe(color)
    })
  })

  it('色数を超える番号は循環する（k=4 超のクラスタでも必ず着色）', () => {
    expect(clusterColor(CLUSTER_COLORS.length)).toBe(CLUSTER_COLORS[0])
    expect(clusterColor(CLUSTER_COLORS.length + 2)).toBe(CLUSTER_COLORS[2])
  })

  it('負値・小数・巨大値でも必ずパレット内の色を返す', () => {
    for (const index of [-1, -5, 0.5, 3.9, 1_000_001]) {
      expect(CLUSTER_COLORS).toContain(clusterColor(index))
    }
    expect(clusterColor(-1)).toBe(CLUSTER_COLORS[CLUSTER_COLORS.length - 1])
  })
})

describe('selectionLabel（複数選択の表示ラベル）', () => {
  it('空は emptyLabel、1–2 件は連結、3 件以上は先頭＋他N件', () => {
    expect(selectionLabel([], '全社')).toBe('全社')
    expect(selectionLabel(['東日本旅客鉄道'], '全社')).toBe('東日本旅客鉄道')
    expect(selectionLabel(['東日本旅客鉄道', '東京地下鉄'], '全社')).toBe(
      '東日本旅客鉄道・東京地下鉄',
    )
    expect(selectionLabel(['東日本旅客鉄道', '東京地下鉄', '東京都'], '全社')).toBe(
      '東日本旅客鉄道 他2件',
    )
  })

  it('都道府県・運営会社のラベルは同じ文法で空文言だけが違う', () => {
    expect(prefectureLabel([])).toBe('全国')
    expect(operatorLabel([])).toBe('全社')
    expect(prefectureLabel(['千葉県', '埼玉県'])).toBe('千葉県・埼玉県')
    expect(operatorLabel(['東武鉄道', '西武鉄道'])).toBe('東武鉄道・西武鉄道')
  })
})

describe('事業者種別（路線・260731）', () => {
  it('5 種別に表示名があり、新幹線はコード 1', () => {
    expect(ROUTE_TYPES).toEqual([1, 2, 3, 4, 5])
    expect(routeTypeLabel(1)).toBe('新幹線')
    for (const type of ROUTE_TYPES) {
      expect(ROUTE_TYPE_LABELS[type].length).toBeGreaterThan(0)
    }
  })

  it('未知のコードでも壊れない（安全側のフォールバック）', () => {
    expect(routeTypeLabel(9)).toBe('種別9')
  })

  it('路線ラベルは空＝全路線（都道府県・会社と同じ文法）', () => {
    expect(routeLabel([])).toBe('全路線')
    expect(routeLabel(['東海道新幹線'])).toBe('東海道新幹線')
    expect(routeLabel(['東海道新幹線', '山陽新幹線', '東北新幹線'])).toBe('東海道新幹線 他2件')
  })

  it('セレクタのボタンは種別と路線をまとめて表示する（種別が先）', () => {
    expect(routeFilterLabel([], [])).toBe('全路線')
    expect(routeFilterLabel([], [1])).toBe('新幹線')
    expect(routeFilterLabel(['東海道線'], [1])).toBe('新幹線・東海道線')
    expect(routeFilterLabel(['東海道線', '中央線'], [1])).toBe('新幹線 他2件')
  })

  it('一覧の表示名は同名路線が複数社にあるときだけ識別子を足す（決定 5）', () => {
    expect(routeOptionLabel('東海道新幹線', ['東海旅客鉄道'])).toBe('東海道新幹線')
    expect(routeOptionLabel('東海道線', [])).toBe('東海道線') // 会社不明でも壊れない
    // 会社名の併記は実測で 28 本すべてが行幅に収まらないため、会社数に畳む。
    expect(routeOptionLabel('山陽線', ['九州旅客鉄道', '西日本旅客鉄道'])).toBe('山陽線（2社）')
    expect(routeOptionLabel('本線', ['京成電鉄', '広島電鉄', '函館市'])).toBe('本線（3社）')
  })

  it('一覧の表示名は行幅（約 14 字）に収まる', () => {
    const longest = routeOptionLabel('東海道本線支線', [
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
    ])
    expect(longest.length).toBeLessThanOrEqual(14)
  })
})

describe('PREFECTURES', () => {
  it('47 都道府県をコード昇順・ゼロ埋め 2 桁で保持する', () => {
    expect(PREFECTURES).toHaveLength(47)
    const codes = PREFECTURES.map((prefecture) => prefecture.code)
    expect(new Set(codes).size).toBe(47)
    const expected = Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, '0'))
    expect(codes).toEqual(expected)
  })

  it('全ての都道府県名が非空で「都・道・府・県」で終わる', () => {
    for (const prefecture of PREFECTURES) {
      expect(prefecture.name.length).toBeGreaterThan(0)
      expect(prefecture.name).toMatch(/[都道府県]$/)
    }
  })

  it('代表例（東京都 = 13）が正しい', () => {
    expect(PREFECTURES.find((prefecture) => prefecture.code === '13')?.name).toBe('東京都')
  })
})
