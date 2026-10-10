/**
 * 駅詳細のタブ：URL（`?tab`）→ この端末で最後に見たタブ → 概要、の順で決める（2026-10-02・既定は 2026-10-09 B4 で
 * 乗降客数から概要＝駅周辺のプロフィールへ）。
 *
 * 以前は駅を替えるたびに乗降客数タブへ戻していた。「同じ項目を見たいので、ブラウザに覚えておいて
 * ほしい」というフィードバックへの対応（`docs/261001_fix_user_feedback_ui.md` §2）。
 * あわせて、タブではない「将来推計人口」を型から外した——チャットがそこに焦点を当てると、
 * どのタブも選ばれず「データがありません」と出ていた（同 §4.3）。
 */

import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  DEFAULT_DETAIL_TAB,
  DETAIL_TABS,
  detailTabFor,
  type DetailTab,
} from '@/shared/constants'
import {
  browserTabStorage,
  DETAIL_TAB_STORAGE_KEY,
  isDetailTab,
  readRememberedDetailTab,
  rememberDetailTab,
  resolveDetailTab,
  type TabStorage,
} from '@/components/detail/detailTab'

/** 読み書きを記録する偽の置き場。 */
function memoryStorage(initial: Readonly<Record<string, string>> = {}): {
  readonly storage: TabStorage
  readonly values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
    },
  }
}

/** 触っただけで投げる置き場（プライベートモード・保存の拒否・容量超過）。 */
const throwingStorage: TabStorage = {
  getItem: () => {
    throw new Error('SecurityError: The operation is insecure.')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('タブの値（DETAIL_TABS・DetailTab）', () => {
  it('10 タブ・重複なし・概要が先頭・乗降客数が 2 番目・災害が末尾', () => {
    expect(DETAIL_TABS).toHaveLength(10)
    expect(new Set(DETAIL_TABS).size).toBe(DETAIL_TABS.length)
    expect(DETAIL_TABS[0]).toBe('overview')
    expect(DETAIL_TABS[1]).toBe('passenger')
    expect(DETAIL_TABS.at(-1)).toBe('hazard')
  })

  it('概要は指標のカテゴリではない（カテゴリからは写らない＝チャットは tab で開く）', () => {
    expect(CATEGORIES.some((category) => detailTabFor(category) === 'overview')).toBe(false)
  })

  it('将来推計人口はタブではない（人口タブの中にある）', () => {
    // @ts-expect-error 型からも外してある。外し忘れると ⤢ が存在しないタブを選べてしまう（§4.3）
    const forecast: DetailTab = 'population_forecast'
    expect(isDetailTab(forecast)).toBe(false)
    expect(DETAIL_TABS.some((tab) => tab === forecast)).toBe(false)
  })

  it('既定のタブは概要（駅周辺のプロフィール）で、タブの 1 つ', () => {
    expect(DEFAULT_DETAIL_TAB).toBe('overview')
    expect(isDetailTab(DEFAULT_DETAIL_TAB)).toBe(true)
  })
})

describe('detailTabFor（指標カテゴリ → タブ）', () => {
  it('将来推計人口は人口タブへ、ほかは同じ名前のタブへ', () => {
    expect(detailTabFor('population_forecast')).toBe('population')
    for (const category of CATEGORIES.filter((each) => each !== 'population_forecast')) {
      expect(detailTabFor(category)).toBe(category)
    }
  })

  it('どのカテゴリでも、返るのは実在するタブ', () => {
    for (const category of CATEGORIES) expect(isDetailTab(detailTabFor(category))).toBe(true)
  })
})

describe('isDetailTab（外から来た値の検査）', () => {
  it('10 タブはすべて通す', () => {
    for (const tab of DETAIL_TABS) expect(isDetailTab(tab)).toBe(true)
  })

  it('似ているだけの値・型の違う値は通さない', () => {
    const rejected: readonly unknown[] = [
      'population_forecast',
      '',
      'Passenger',
      ' passenger',
      'hazard\n',
      'Overview',
      '概要',
      '人口',
      0,
      null,
      undefined,
      {},
      ['passenger'],
    ]
    for (const value of rejected) expect(isDetailTab(value)).toBe(false)
  })
})

describe('resolveDetailTab（URL → この端末の記憶 → 既定）', () => {
  it('URL があれば URL（共有リンク・戻る/進む・リロード）', () => {
    expect(resolveDetailTab('income', 'land_price')).toBe('income')
  })

  it('URL が乗降客数なら、記憶が別のタブでも乗降客数（乗降を明示して書く理由）', () => {
    expect(resolveDetailTab('passenger', 'income')).toBe('passenger')
  })

  it('URL が概要なら、記憶が別のタブでも概要（既定と同じ値でも URL を優先）', () => {
    expect(resolveDetailTab('overview', 'income')).toBe('overview')
  })

  it('URL に無ければ、この端末で最後に見たタブ', () => {
    expect(resolveDetailTab(null, 'land_price')).toBe('land_price')
  })

  it('どちらも無ければ既定（概要）', () => {
    expect(resolveDetailTab(null, null)).toBe(DEFAULT_DETAIL_TAB)
  })
})

describe('この端末の記憶（readRememberedDetailTab・rememberDetailTab）', () => {
  it('覚えたタブを読み戻せる', () => {
    const { storage, values } = memoryStorage()
    rememberDetailTab(storage, 'hazard')
    expect(values.get(DETAIL_TAB_STORAGE_KEY)).toBe('hazard')
    expect(readRememberedDetailTab(storage)).toBe('hazard')
  })

  it('知らない値・壊れた値は「記憶なし」', () => {
    for (const stored of ['population_forecast', 'xyz', '', '"income"']) {
      const { storage } = memoryStorage({ [DETAIL_TAB_STORAGE_KEY]: stored })
      expect(readRememberedDetailTab(storage)).toBeNull()
    }
  })

  it('何も覚えていなければ「記憶なし」', () => {
    expect(readRememberedDetailTab(memoryStorage().storage)).toBeNull()
  })

  it('置き場が無くても（サーバ・使えない端末）落ちない', () => {
    expect(readRememberedDetailTab(null)).toBeNull()
    expect(() => rememberDetailTab(null, 'income')).not.toThrow()
  })

  it('触っただけで投げる置き場でも落ちない（表示は URL で続く）', () => {
    expect(readRememberedDetailTab(throwingStorage)).toBeNull()
    expect(() => rememberDetailTab(throwingStorage, 'income')).not.toThrow()
  })

  it('ほかのキーには触らない', () => {
    const { storage, values } = memoryStorage({ other: 'keep' })
    rememberDetailTab(storage, 'bus')
    expect(values.get('other')).toBe('keep')
  })

  it('キー名は変えない（変えると、利用者が覚えさせたタブが一斉に消える）', () => {
    expect(DETAIL_TAB_STORAGE_KEY).toBe('ai-database-map:detail-tab')
  })

  it('サーバ（window が無い）では置き場は null', () => {
    expect(browserTabStorage()).toBeNull()
  })
})
