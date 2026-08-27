import { describe, expect, it } from 'vitest'
import {
  needsTileTime,
  newestTileTime,
  resolveHazardTile,
  resolveTileUrl,
  tileElementOf,
  tileTimeLabelJa,
  tileTimesUrlOf,
  type HazardTileTime,
} from '@/domain/hazard/tile-time'
import { jstClockJa, jstDateTimeJa, parseCompactUtc, parseIso } from '@/shared/time'
import { hazardLayers } from '@/shared/hazard'

/**
 * 時刻を差し込むタイル（キキクル・`docs/260824_flood.md` §7.4）。
 *
 * ここで守りたいのは 1 つ——**埋め残した URL を地図に渡さない**こと。
 * 渡すと 404 が並ぶだけで面が出ず、白い地図が「危険なし」に見える（§7.5-1）。
 */

/** 実測に合わせた `targetTimes.json`（2026-08-27・UTC）。 */
const TIMES: readonly HazardTileTime[] = [
  {
    basetime: '20260827011000',
    validtime: '20260827011000',
    member: 'immed0',
    elements: ['land', 'inund', 'flood', 'rain_mesh'],
  },
  {
    basetime: '20260827010000',
    validtime: '20260827010000',
    member: 'immed1',
    elements: ['land', 'inund', 'flood'],
  },
  { basetime: '20260827005000', validtime: '20260827005000', member: 'none', elements: ['land'] },
]

describe('domain/hazard: 時刻を差し込むタイル', () => {
  it('キキクルだけが時刻を要り、取得先を持つ', () => {
    const needing = hazardLayers.filter((layer) => needsTileTime(layer.key)).map((l) => l.key)
    expect(needing).toEqual(['kikikuru_land', 'kikikuru_inund', 'kikikuru_flood'])
    expect(needing.every((key) => tileTimesUrlOf(key) !== null)).toBe(true)
    expect(tileTimesUrlOf('flood_l2')).toBeNull()
    expect(needsTileTime('flood_l2')).toBe(false)
    expect(needsTileTime('存在しないレイヤ')).toBe(false)
  })

  it('要素名は URL から読む（カタログに二重に持たない）', () => {
    expect(tileElementOf('kikikuru_land')).toBe('land')
    expect(tileElementOf('kikikuru_inund')).toBe('inund')
    expect(tileElementOf('kikikuru_flood')).toBe('flood')
    expect(tileElementOf('flood_l2')).toBeNull()
  })

  it('いちばん新しい時刻を選ぶ（配信の並び順に依存しない）', () => {
    const shuffled = [TIMES[2], TIMES[0], TIMES[1]].filter((time) => time !== undefined)
    expect(newestTileTime(shuffled, 'land')?.basetime).toBe('20260827011000')
    // 古い時刻にしか無い要素は、その古い時刻を採る（黙って諦めない）。
    expect(newestTileTime([TIMES[2]].filter((t) => t !== undefined), 'land')?.member).toBe('none')
    // 要素を持たない時刻しか無ければ null（無いものを埋めない）。
    expect(newestTileTime(TIMES, '存在しない要素')).toBeNull()
  })

  it('elements が無い配信は「全部ある」とみなす（形が変わっても止まらない）', () => {
    const legacy: readonly HazardTileTime[] = [
      { basetime: '20260827012000', validtime: '20260827012000', member: 'immed0' },
    ]
    expect(newestTileTime(legacy, 'land')?.basetime).toBe('20260827012000')
  })

  it('3 つの差し込み口をすべて埋める', () => {
    const url = resolveTileUrl(
      'https://example.test/{basetime}/{member}/{validtime}/surf/land/{z}/{x}/{y}.png',
      { basetime: 'B', validtime: 'V', member: 'M' },
    )
    expect(url).toBe('https://example.test/B/M/V/surf/land/{z}/{x}/{y}.png')
    // {z}/{x}/{y} は MapLibre が埋めるので残す。
    expect(url).toContain('{z}/{x}/{y}')
  })

  it('埋め残しは例外にする（白い地図を出さない）', () => {
    expect(() =>
      resolveTileUrl('https://example.test/{basetime}/{member}/{validtime}/{basetime}/x.png', {
        basetime: 'B',
        validtime: 'V',
        member: 'M',
      }),
    ).toThrow('{basetime}')
  })

  it('カタログのキキクルを実際の配信時刻で解決できる', () => {
    const tile = resolveHazardTile('kikikuru_land', TIMES)
    expect(tile?.basetime).toBe('20260827011000')
    expect(tile?.url).toContain('/20260827011000/immed0/20260827011000/surf/land/')
    expect(tile?.url).not.toContain('{basetime}')
    expect(resolveHazardTile('flood_l2', TIMES)).toBeNull()
  })
})

describe('shared/time: 日本時間の表示', () => {
  it('UTC の basetime を日本時間で書く（+9 時間）', () => {
    expect(tileTimeLabelJa('20260827011000')).toBe('8月27日 10:10 現在')
    // 日付をまたぐ（UTC 15:30 → 翌日 00:30 JST）。
    expect(tileTimeLabelJa('20260827153000')).toBe('8月28日 00:30 現在')
  })

  it('読めない時刻は null（推測で書かない）', () => {
    expect(tileTimeLabelJa('2026')).toBeNull()
    expect(tileTimeLabelJa('こわれた')).toBeNull()
    // 桁が合っていても、あり得ない日付は null（13 月 32 日を「読めた」ことにしない）。
    expect(parseCompactUtc('20261332000000')).toBeNull()
    expect(parseCompactUtc('20260827011000')).toBe(Date.parse('2026-08-27T01:10:00Z'))
    expect(parseIso('こわれた')).toBeNull()
  })

  it('ISO8601＋09:00 は実行環境のタイムゾーンに関わらず同じ時刻になる', () => {
    const epochMs = parseIso('2026-08-27T10:02:00+09:00')
    expect(epochMs).not.toBeNull()
    expect(jstDateTimeJa(epochMs ?? 0)).toBe('8月27日 10:02')
    expect(jstClockJa(epochMs ?? 0)).toBe('10:02')
    // 同じ瞬間を UTC 表記で渡しても、表示は日本時間で一致する。
    expect(jstDateTimeJa(parseIso('2026-08-27T01:02:00Z') ?? 0)).toBe('8月27日 10:02')
  })
})
