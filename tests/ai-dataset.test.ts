import { describe, expect, it } from 'vitest'
import {
  columnsFromKeys,
  DATASET_MAX_VALUE_COLUMNS,
  resolveDatasetColumns,
  type DatasetColumn,
} from '@/ai/dataset/columns'
import { buildDatasetCsv, datasetNotes, datasetPreview, datasetRowCount } from '@/ai/dataset/csv'
import {
  DATASET_URL_TTL_MS,
  datasetQuerySchema,
  signDatasetToken,
  verifyDatasetToken,
} from '@/ai/dataset/token'
import { entries } from '@/shared/catalog'
import { type StationListItem } from '@/shared/api'

/**
 * **build_dataset の純粋部**（`docs/260828_research_claude_auth.md` §5.3 PR-5）。
 *
 * 固定するのは、①列解決がカタログだけを参照し決定的であること（ファミリ×年の展開・
 * 重複排除・上限・フラグ列の自動同伴）、②CSV の欠損の非対称（値=空欄／フラグ=0）と
 * RFC 4180 の引用、③署名 URL の検証（改竄・期限切れ・別鍵を区別して落とす）。
 */

describe('resolveDatasetColumns（列解決＝カタログが単一の真実）', () => {
  it('完全一致キーはそのまま採用する', () => {
    const result = resolveDatasetColumns(['pop_2020_1km'], undefined, undefined)
    if (!result.ok) throw new Error(result.error)
    expect(result.valueKeys).toEqual(['pop_2020_1km'])
  })

  it('ファミリは既定（1km・直近）で確定し、埋めた事実を notes に残す', () => {
    const result = resolveDatasetColumns(['pop_gr'], undefined, undefined)
    if (!result.ok) throw new Error(result.error)
    expect(result.valueKeys).toEqual(['pop_gr_2020_2015_1km'])
    expect(result.notes.length).toBeGreaterThan(0)
    // 増減率の信頼性フラグ列が自動で同伴する（§5.4-4 を CSV の形で強制）。
    expect(result.flagKeys).toContain('pop_lowbase_2015_1km')
    const flagColumn = result.columns.find((column) => column.key === 'pop_lowbase_2015_1km')
    expect(flagColumn?.role).toBe('flag')
  })

  it('years 配列はファミリ×各年に展開される', () => {
    const result = resolveDatasetColumns(['pop'], undefined, [2015, 2020])
    if (!result.ok) throw new Error(result.error)
    expect(result.valueKeys).toEqual(['pop_2015_1km', 'pop_2020_1km'])
  })

  it('radiusM でファミリの半径が確定する', () => {
    const result = resolveDatasetColumns(['pop'], 2000, undefined)
    if (!result.ok) throw new Error(result.error)
    expect(result.valueKeys).toEqual(['pop_2020_2km'])
  })

  it('重複（ファミリと完全一致キーが同じ列）を落とす', () => {
    const result = resolveDatasetColumns(['pop', 'pop_2020_1km'], undefined, undefined)
    if (!result.ok) throw new Error(result.error)
    expect(result.valueKeys).toEqual(['pop_2020_1km'])
  })

  it('未知の指標は確定させず候補を返す', () => {
    const result = resolveDatasetColumns(['xyz_abc'], undefined, undefined)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('未知の指標')
  })

  it('フラグ列の直接指定は弾く（自動で同伴するため）', () => {
    const flagEntry = entries.find((entry) => entry.kind === 'flag')
    expect(flagEntry).toBeDefined()
    if (flagEntry === undefined) return
    const result = resolveDatasetColumns([flagEntry.key], undefined, undefined)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('フラグ列')
  })

  it(`値列が上限（${DATASET_MAX_VALUE_COLUMNS}）を超えたら確定させない`, () => {
    const keys = entries
      .filter((entry) => entry.kind !== 'flag')
      .slice(0, DATASET_MAX_VALUE_COLUMNS + 1)
      .map((entry) => entry.key)
    expect(keys.length).toBe(DATASET_MAX_VALUE_COLUMNS + 1)
    const result = resolveDatasetColumns(keys, undefined, undefined)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('列が多すぎます')
  })
})

describe('columnsFromKeys（署名トークンからの再構成）', () => {
  it('実在キーはカタログの kind から role を導く', () => {
    const result = columnsFromKeys(['pop_2020_1km', 'pop_lowbase_2015_1km'])
    if (!result.ok) throw new Error('missing')
    expect(result.columns.map((column) => column.role)).toEqual(['value', 'flag'])
  })

  it('カタログに無いキーは missing で返す（黙って欠けさせない）', () => {
    const result = columnsFromKeys(['pop_2020_1km', 'gone_key'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual(['gone_key'])
  })
})

// --- CSV（形の固定・カタログ非依存の合成フィクスチャ） ---------------------

const stationA: StationListItem = {
  grp: 'A#0',
  stationName: 'エー',
  label: 'エー',
  prefecture: '東京都',
  municipality: '千代田区',
  municipalityCode: '13101',
  lon: 139.7,
  lat: 35.6,
  nOp: 2,
  paxLatest: 100,
}
const stationB: StationListItem = {
  ...stationA,
  grp: 'B#0',
  label: 'ビー,"引用"', // RFC 4180 の引用が要る駅名
  municipality: null,
  municipalityCode: null,
}
const valueColumn: DatasetColumn = {
  key: 'pop_2020_1km',
  role: 'value',
  labelJa: '人口',
  unit: '人',
  kind: 'level',
  category: 'population',
  radiusM: 1000,
  year: 2020,
  yearBase: null,
  vintage: null,
  reliabilityFlagKey: 'pop_flag',
  source: 'S',
  license: 'L',
}
const flagColumn: DatasetColumn = {
  ...valueColumn,
  key: 'pop_flag',
  role: 'flag',
  kind: 'flag',
  reliabilityFlagKey: null,
}
const columns = [valueColumn, flagColumn]
const values = { 'A#0': { pop_2020_1km: 5000, pop_flag: 1 } } // B は両列とも欠損

describe('buildDatasetCsv（欠損の非対称と引用）', () => {
  it('wide：値の欠損は空欄・フラグの欠損は 0・引用符とカンマは RFC 4180', () => {
    const csv = buildDatasetCsv([stationA, stationB], values, columns, 'wide')
    expect(csv).toBe(
      [
        'grp,station_name,prefecture,municipality,municipality_code,lon,lat,pop_2020_1km,pop_flag',
        'A#0,エー,東京都,千代田区,13101,139.7,35.6,5000,1',
        'B#0,"ビー,""引用""",東京都,,,139.7,35.6,,0',
        '',
      ].join('\n'),
    )
    expect(datasetRowCount([stationA, stationB], values, columns, 'wide')).toBe(2)
  })

  it('long：値の欠損は行を作らない・フラグは 0 の行を作る', () => {
    const csv = buildDatasetCsv([stationA, stationB], values, columns, 'long')
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('grp,station_name,prefecture,key,value')
    expect(lines).toHaveLength(1 + 3) // A の値・A のフラグ・B のフラグ（B の値は欠損＝行なし）
    expect(lines).toContain('B#0,"ビー,""引用""",東京都,pop_flag,0')
    expect(datasetRowCount([stationA, stationB], values, columns, 'long')).toBe(3)
  })

  it('プレビューは先頭 5 行まで（ヘッダは別枠）', () => {
    const preview = datasetPreview([stationA, stationB], values, columns, 'wide')
    expect(preview.header[0]).toBe('grp')
    expect(preview.rows).toHaveLength(2)
    expect(preview.rows[0]?.[0]).toBe('A#0')
  })

  it('notes：欠損セル数・フラグの意味・フラグ該当数を全部言う', () => {
    const notes = datasetNotes([stationA, stationB], values, columns)
    expect(notes.join('\n')).toContain('1 セル')
    expect(notes.join('\n')).toContain('pop_2020_1km=1')
    expect(notes.join('\n')).toContain('1=注意')
    expect(notes.join('\n')).toContain('pop_flag=1')
  })
})

describe('署名トークン（短命 URL の検証）', () => {
  const query = datasetQuerySchema.parse({ grps: ['A#0'], keys: ['pop_2020_1km'], shape: 'wide' })
  const secret = 'test-secret'

  it('往復：署名 → 検証でクエリが同値・期限は now + TTL', () => {
    const signed = signDatasetToken(query, { secret, now: 1_000 })
    expect(signed.expiresAtMs).toBe(1_000 + DATASET_URL_TTL_MS)
    const verified = verifyDatasetToken(signed.token, { secret, now: 2_000 })
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.query).toEqual(query)
  })

  it('期限切れは expired（410 の材料）', () => {
    const signed = signDatasetToken(query, { secret, now: 1_000 })
    const verified = verifyDatasetToken(signed.token, { secret, now: 1_000 + DATASET_URL_TTL_MS })
    expect(verified).toEqual({ ok: false, reason: 'expired' })
  })

  it('別の鍵・本文改竄は signature で落ちる', () => {
    const signed = signDatasetToken(query, { secret, now: 1_000 })
    expect(verifyDatasetToken(signed.token, { secret: 'other', now: 2_000 })).toEqual({
      ok: false,
      reason: 'signature',
    })
    expect(verifyDatasetToken(`X${signed.token}`, { secret, now: 2_000 })).toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('形になっていない文字列は malformed', () => {
    expect(verifyDatasetToken('zzzz', { secret, now: 2_000 })).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('クエリ定義は grps と selector のどちらか一方だけ', () => {
    expect(datasetQuerySchema.safeParse({ keys: ['k'], shape: 'wide' }).success).toBe(false)
    expect(
      datasetQuerySchema.safeParse({
        grps: ['A#0'],
        selector: { municipality: '横浜市' },
        keys: ['k'],
        shape: 'wide',
      }).success,
    ).toBe(false)
    expect(
      datasetQuerySchema.safeParse({
        selector: { municipality: '横浜市' },
        keys: ['k'],
        shape: 'long',
      }).success,
    ).toBe(true)
  })
})
