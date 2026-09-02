import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng, hexOf, pixelAt } from '@/shared/png'

/**
 * **パレット PNG（カラータイプ 3）の対応**（PR-6 で実測発見・広島湾岸の高潮タイル）。
 *
 * 固定するのは、①PLTE の索引 → RGB 展開、②tRNS の α（**「塗られていない」＝α0 の判定**が
 * 成立すること）、③tRNS が無い索引は不透明、④PLTE 欠落・範囲外索引は文脈つきで throw
 * （静かに間違った色を作らない——このデコーダの存在理由）。
 */

/** 4 バイト BE。 */
function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

/** チャンク（CRC はデコーダが検証しないので 0 埋め）。 */
function chunk(type: string, body: readonly number[]): number[] {
  return [...u32(body.length), ...[...type].map((ch) => ch.charCodeAt(0)), ...body, 0, 0, 0, 0]
}

/** 2×2・ビット深度 8・パレット形式の PNG を組み立てる。 */
function palettePng(options: {
  readonly indices: readonly (readonly number[])[]
  readonly palette: readonly (readonly [number, number, number])[]
  readonly trns?: readonly number[]
  readonly withPlte?: boolean
}): Uint8Array {
  const height = options.indices.length
  const width = options.indices[0]?.length ?? 0
  const ihdr = chunk('IHDR', [...u32(width), ...u32(height), 8, 3, 0, 0, 0])
  const plte = chunk(
    'PLTE',
    options.palette.flatMap((rgb) => [...rgb]),
  )
  const trns = options.trns === undefined ? [] : chunk('tRNS', [...options.trns])
  const scanlines = options.indices.flatMap((row) => [0, ...row]) // 各行フィルタ 0
  const idat = chunk('IDAT', [...deflateSync(Uint8Array.from(scanlines))])
  const iend = chunk('IEND', [])
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...ihdr,
    ...(options.withPlte === false ? [] : plte),
    ...trns,
    ...idat,
    ...iend,
  ])
}

const PALETTE: readonly (readonly [number, number, number])[] = [
  [0xff, 0xff, 0xff], // 0: 背景（tRNS で透明にする）
  [0xf8, 0xe1, 0xa6], // 1: 高潮の実測色
  [0xe6, 0xc8, 0x32], // 2
]

describe('decodePng（パレット形式）', () => {
  it('PLTE の索引を RGB に展開し、tRNS の α を適用する', async () => {
    const image = await decodePng(
      palettePng({
        indices: [
          [0, 1],
          [2, 1],
        ],
        palette: PALETTE,
        trns: [0], // 索引 0 だけ透明。1 以降は不透明（tRNS に無い索引）
      }),
    )
    expect(image.width).toBe(2)
    expect(image.height).toBe(2)
    expect(pixelAt(image, 0, 0).a).toBe(0) // 塗られていない＝α0 の判定が成立する
    expect(pixelAt(image, 1, 0)).toEqual({ r: 0xf8, g: 0xe1, b: 0xa6, a: 0xff })
    expect(hexOf(pixelAt(image, 1, 0))).toBe('#F8E1A6')
    expect(hexOf(pixelAt(image, 0, 1))).toBe('#E6C832')
  })

  it('tRNS が無ければ全索引が不透明', async () => {
    const image = await decodePng(palettePng({ indices: [[0, 1]], palette: PALETTE }))
    expect(pixelAt(image, 0, 0).a).toBe(0xff)
  })

  it('PLTE が無いパレット PNG は文脈つきで落ちる', async () => {
    await expect(
      decodePng(palettePng({ indices: [[0]], palette: PALETTE, withPlte: false })),
    ).rejects.toThrow('PLTE')
  })

  it('範囲外のパレット索引は落ちる（静かに間違った色を作らない）', async () => {
    await expect(decodePng(palettePng({ indices: [[7]], palette: PALETTE }))).rejects.toThrow(
      '範囲外',
    )
  })

  it('ビット深度 8 以外のパレットは対応外として落ちる', async () => {
    const png = palettePng({ indices: [[0]], palette: PALETTE })
    png[8 + 8 + 8] = 4 // IHDR のビット深度を 4 に書き換える（sig 8 + len/type 8 + w/h 8）
    await expect(decodePng(png)).rejects.toThrow('対応していない PNG')
  })
})
