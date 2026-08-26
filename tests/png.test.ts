import { describe, expect, it } from 'vitest'
import { decodePng, hexOf, pixelAt } from '@/shared/png'

/**
 * 自作 PNG デコーダ（`src/shared/png.ts`）の検証。
 *
 * ここでは**仕様から独立に書いたエンコーダ**でテストデータを作る。デコーダが「足す」ところを
 * エンコーダは「引く」ので、同じ思い違いを両方が持ちにくい。**フィルタ 0（None）は
 * 復元処理が要らない＝自明に正しい**ので、これが基準になる——残る 1–4 が同じ画素に
 * 戻れば、フィルタの復元が正しいと言える。
 *
 * 実配信タイルとの突き合わせは別に実施済み（2026-08-26・Pillow と**全画素一致**）。
 * 自作 17×17 が 12 枚と実タイル 5 枚（327,680 画素）で 1 バイトの差も無かった。
 * 手順は `docs/260824_flood.md` 付録 D。
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const typed = new Uint8Array([...[...type].map((c) => c.charCodeAt(0)), ...body])
  const out = new Uint8Array(8 + body.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(typed, 4)
  view.setUint32(out.length - 4, crc32(typed))
  return out
}

/** PNG 仕様 9.2 のフィルタを**適用する**側（デコーダは逆をやる）。 */
function filterByte(type: number, x: number, a: number, b: number, c: number): number {
  if (type === 1) return x - a
  if (type === 2) return x - b
  if (type === 3) return x - ((a + b) >> 1)
  if (type === 4) {
    const estimate = a + b - c
    const [da, db, dc] = [Math.abs(estimate - a), Math.abs(estimate - b), Math.abs(estimate - c)]
    return x - (da <= db && da <= dc ? a : db <= dc ? b : c)
  }
  return x
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

type Image = { width: number; height: number; channels: number; pixels: Uint8Array }

async function encodePng(image: Image, filterType: number, splitIdat = false): Promise<Uint8Array> {
  const { width, height, channels, pixels } = image
  const stride = width * channels
  const raw = new Uint8Array((stride + 1) * height)
  let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(stride)
  for (let row = 0; row < height; row += 1) {
    const line = pixels.subarray(row * stride, (row + 1) * stride)
    raw[row * (stride + 1)] = filterType
    for (let index = 0; index < stride; index += 1) {
      const a = index >= channels ? (line[index - channels] ?? 0) : 0
      const b = previous[index] ?? 0
      const c = index >= channels ? (previous[index - channels] ?? 0) : 0
      raw[row * (stride + 1) + 1 + index] = filterByte(filterType, line[index] ?? 0, a, b, c) & 0xff
    }
    previous = line
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8)
  const body = await deflate(raw)
  const half = Math.floor(body.length / 2)
  const idat = splitIdat
    ? [chunk('IDAT', body.subarray(0, half)), chunk('IDAT', body.subarray(half))]
    : [chunk('IDAT', body)]
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    ...idat,
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0)
  return out
}

/** 決定的な擬似乱数（種固定・テストが揺れない）。 */
function samplePixels(count: number): Uint8Array {
  let state = 20260826
  return Uint8Array.from({ length: count }, () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return (state >> 16) & 0xff
  })
}

function makeImage(channels: number): Image {
  const [width, height] = [17, 17]
  return { width, height, channels, pixels: samplePixels(width * height * channels) }
}

function toRgba(image: Image): Uint8Array {
  if (image.channels === 4) return image.pixels
  const rgba = new Uint8Array(image.width * image.height * 4)
  for (let index = 0; index < image.width * image.height; index += 1) {
    rgba.set(image.pixels.subarray(index * 3, index * 3 + 3), index * 4)
    rgba[index * 4 + 3] = 0xff
  }
  return rgba
}

describe('png: フィルタの復元（0–4 × RGB/RGBA）', () => {
  for (const channels of [3, 4]) {
    const label = channels === 4 ? 'RGBA' : 'RGB'
    for (const filterType of [0, 1, 2, 3, 4]) {
      it(`${label}・フィルタ ${filterType} が元の画素に戻る`, async () => {
        const image = makeImage(channels)
        const decoded = await decodePng(await encodePng(image, filterType))
        expect(decoded.width).toBe(image.width)
        expect(decoded.height).toBe(image.height)
        expect([...decoded.rgba]).toEqual([...toRgba(image)])
      })
    }

    it(`${label}・IDAT が 2 つに分かれていても読める`, async () => {
      const image = makeImage(channels)
      const decoded = await decodePng(await encodePng(image, 4, true))
      expect([...decoded.rgba]).toEqual([...toRgba(image)])
    })
  }

  it('RGB はアルファを 255 で埋める（透明扱いにしない）', async () => {
    const image = makeImage(3)
    const decoded = await decodePng(await encodePng(image, 0))
    expect(pixelAt(decoded, 3, 5).a).toBe(255)
  })
})

describe('png: 画素の読み出しと色', () => {
  it('座標から RGBA を読み、#RRGGBB に整える', async () => {
    const pixels = Uint8Array.from([0xff, 0xb7, 0xb7, 0xff, 0x00, 0x00, 0x00, 0x00])
    const png = await encodePng({ width: 2, height: 1, channels: 4, pixels }, 0)
    const decoded = await decodePng(png)
    expect(pixelAt(decoded, 0, 0)).toEqual({ r: 0xff, g: 0xb7, b: 0xb7, a: 0xff })
    expect(hexOf(pixelAt(decoded, 0, 0))).toBe('#FFB7B7') // 公式凡例「3〜5m 未満」
    expect(pixelAt(decoded, 1, 0).a).toBe(0) // 塗られていない＝区域外
  })

  it('範囲外・不正な座標は文脈付きで throw する', async () => {
    const decoded = await decodePng(await encodePng(makeImage(4), 0))
    expect(() => pixelAt(decoded, 17, 0)).toThrow(/範囲外/)
    expect(() => pixelAt(decoded, -1, 0)).toThrow(/不正/)
    expect(() => pixelAt(decoded, 1.5, 0)).toThrow(/不正/)
  })
})

describe('png: 対応外は静かに読まずに落とす', () => {
  it('シグネチャが違うものは throw', async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3]))).rejects.toThrow(/シグネチャ/)
  })

  it('インタレースありは throw（黙って歪んだ色を返さない）', async () => {
    const png = await encodePng(makeImage(4), 0)
    png[8 + 8 + 12] = 1 // IHDR の interlace を Adam7 に書き換える
    await expect(decodePng(png)).rejects.toThrow(/対応していない PNG/)
  })

  it('パレット PNG（カラータイプ 3）は throw', async () => {
    const png = await encodePng(makeImage(4), 0)
    png[8 + 8 + 9] = 3
    await expect(decodePng(png)).rejects.toThrow(/カラータイプ 3/)
  })

  it('IHDR が無いものは throw', async () => {
    const png = Uint8Array.from([...SIGNATURE, ...chunk('IEND', new Uint8Array(0))])
    await expect(decodePng(png)).rejects.toThrow(/IHDR/)
  })
})
