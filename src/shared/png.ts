/**
 * 最小の PNG デコーダ（純関数・依存なし・**公式ハザードタイル専用**）。
 *
 * 地点のハザードを「地図に描いてあるものと同じ」で答えるには、公式ラスタタイルの
 * **画素の色**を読む必要がある（`docs/260824_flood.md` §6.3 の優先順位 ②）。
 * ブラウザなら `createImageBitmap` で済むが、**意味づけはサーバで決める**という原則
 * （.claude/CLAUDE.md §2）があるので、Node 側でも同じことができなければならない。
 *
 * そのためだけに画像ライブラリを足すのは重いので、**実際に配信されている形式に絞った**
 * デコーダをここに置く。配信タイルを全レイヤ実測して確かめた前提は次のとおり。
 *
 * | 前提 | 実測（2026-08-26・全 15 レイヤ／2026-09-03 追補） |
 * |---|---|
 * | 256×256・ビット深度 8 | 全レイヤで一致 |
 * | カラータイプ 6（RGBA）・2（RGB）・**3（パレット）** | ハザード 11 種は RGBA、地形 1 種が RGB。**高潮の一部地域（広島湾岸で実測）だけパレット形式** |
 * | インタレースなし | 全レイヤで 0 |
 * | IDAT が複数に分かれることがある | あり（地形レイヤ）。連結してから展開する |
 *
 * パレット（カラータイプ 3）は PLTE を RGB に展開し、tRNS があれば透明度も適用する
 * （タイルの「塗られていない」＝α0 の判定が成立するために必須）。
 *
 * **前提を外れた PNG は読まずに throw する。** 静かに間違った色を返すと、
 * 「地図は白いのにカードは浸水域」より悪い——**間違った浸水深を断定してしまう**。
 */

/** RGBA 8bit の 1 画素。 */
export type Rgba = {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** 展開済みの画像（RGBA8・行優先）。 */
export type DecodedImage = {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/**
 * カラータイプ → 1 画素のバイト数（フィルタ復元の単位）。
 * 3＝パレット（1 バイト＝パレット索引。RGB への展開は書き出し時に行う）。
 */
const CHANNELS: ReadonlyMap<number, number> = new Map([
  [2, 3],
  [3, 1],
  [6, 4],
])
const SUPPORTED_BIT_DEPTH = 8
const CHUNK_HEADER_BYTES = 8
const CHUNK_CRC_BYTES = 4
const IHDR_BYTES = 13
const PALETTE_COLOR_TYPE = 3
/** PLTE の 1 色ぶん（R, G, B）。 */
const PALETTE_ENTRY_BYTES = 3

type Header = {
  readonly width: number
  readonly height: number
  readonly colorType: number
  readonly channels: number
}

type Chunks = {
  readonly header: Uint8Array
  readonly data: Uint8Array[]
  /** PLTE（RGB の並び）。パレット形式でなければ null。 */
  readonly palette: Uint8Array | null
  /** tRNS（パレット索引ごとの α。無い索引は不透明）。 */
  readonly alpha: Uint8Array | null
}

/** PNG のチャンク列から IHDR・IDAT・PLTE・tRNS を取り出す（他のチャンクは読み飛ばす）。 */
function readChunks(bytes: Uint8Array): Chunks {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const data: Uint8Array[] = []
  let header: Uint8Array | null = null
  let palette: Uint8Array | null = null
  let alpha: Uint8Array | null = null
  let offset = SIGNATURE.length
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + CHUNK_HEADER_BYTES, offset + CHUNK_HEADER_BYTES + length)
    if (type === 'IHDR') header = body
    if (type === 'IDAT') data.push(body)
    if (type === 'PLTE') palette = body
    if (type === 'tRNS') alpha = body
    if (type === 'IEND') break
    offset += CHUNK_HEADER_BYTES + length + CHUNK_CRC_BYTES
  }
  if (header === null) throw new Error('PNG に IHDR チャンクがありません')
  return { header, data, palette, alpha }
}

/** IHDR を読み、**対応できない形式ならここで落とす**（静かに間違えない）。 */
function readHeader(ihdr: Uint8Array): Header {
  if (ihdr.length < IHDR_BYTES) throw new Error(`PNG の IHDR が短すぎます（${ihdr.length} バイト）`)
  const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
  const depth = ihdr[8]
  const colorType = ihdr[9] ?? -1
  const interlace = ihdr[12]
  const channels = CHANNELS.get(colorType)
  if (depth !== SUPPORTED_BIT_DEPTH || channels === undefined || interlace !== 0) {
    throw new Error(
      `対応していない PNG です（ビット深度 ${depth} / カラータイプ ${colorType} / インタレース ${interlace}）。` +
        'ビット深度 8・カラータイプ 2・3・6・インタレースなしのみ読めます',
    )
  }
  return { width: view.getUint32(0), height: view.getUint32(4), colorType, channels }
}

/** zlib（PNG の IDAT）を展開する。ブラウザと Node のどちらでも同じ実装が動く。 */
async function inflate(chunks: readonly Uint8Array[]): Promise<Uint8Array> {
  const stream = new Blob(chunks.map((chunk) => chunk.slice())).stream()
  const inflated = stream.pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(inflated).arrayBuffer())
}

/** Paeth 予測子（PNG 仕様 9.4）。左・上・左上のうち予測値に最も近いものを選ぶ。 */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const [dl, du, dul] = [
    Math.abs(estimate - left),
    Math.abs(estimate - up),
    Math.abs(estimate - upLeft),
  ]
  if (dl <= du && dl <= dul) return left
  return du <= dul ? up : upLeft
}

/** 1 バイトぶんのフィルタ復元（`type` は PNG 仕様 9.2 の 0–4）。 */
function unfilterByte(type: number, raw: number, a: number, b: number, c: number): number {
  if (type === 0) return raw
  if (type === 1) return raw + a
  if (type === 2) return raw + b
  if (type === 3) return raw + ((a + b) >> 1)
  if (type === 4) return raw + paeth(a, b, c)
  throw new Error(`未知の PNG フィルタ種別: ${type}`)
}

/** 1 走査線を復元する（`previous` は復元済みの前行。先頭行は 0 埋め）。 */
function unfilterLine(
  filterType: number,
  raw: Uint8Array,
  previous: Uint8Array,
  channels: number,
): Uint8Array {
  const line = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    const a = index >= channels ? (line[index - channels] ?? 0) : 0
    const b = previous[index] ?? 0
    const c = index >= channels ? (previous[index - channels] ?? 0) : 0
    line[index] = unfilterByte(filterType, raw[index] ?? 0, a, b, c) & 0xff
  }
  return line
}

/** 復元済みの走査線を RGBA8 のバッファへ書き出す（RGB は不透明として扱う）。 */
function writeLine(rgba: Uint8Array, line: Uint8Array, row: number, header: Header): void {
  const { width, channels } = header
  for (let column = 0; column < width; column += 1) {
    const from = column * channels
    const to = (row * width + column) * 4
    rgba[to] = line[from] ?? 0
    rgba[to + 1] = line[from + 1] ?? 0
    rgba[to + 2] = line[from + 2] ?? 0
    rgba[to + 3] = channels === 4 ? (line[from + 3] ?? 0) : 0xff
  }
}

/**
 * パレット形式の走査線を RGBA8 へ展開する（PLTE の索引 → RGB・tRNS → α）。
 * **範囲外の索引は throw**——壊れたタイルから間違った色を作らない。
 */
function writePaletteLine(
  rgba: Uint8Array,
  line: Uint8Array,
  row: number,
  header: Header,
  palette: Uint8Array,
  alpha: Uint8Array | null,
): void {
  const entries = Math.floor(palette.length / PALETTE_ENTRY_BYTES)
  for (let column = 0; column < header.width; column += 1) {
    const index = line[column] ?? 0
    if (index >= entries) {
      throw new Error(`PNG のパレット索引が範囲外です（${index}/${entries} 色）`)
    }
    const from = index * PALETTE_ENTRY_BYTES
    const to = (row * header.width + column) * 4
    rgba[to] = palette[from] ?? 0
    rgba[to + 1] = palette[from + 1] ?? 0
    rgba[to + 2] = palette[from + 2] ?? 0
    // tRNS は先頭の索引ぶんだけ持てる（無い索引は不透明・PNG 仕様 11.3.2）。
    rgba[to + 3] = alpha === null || index >= alpha.length ? 0xff : (alpha[index] ?? 0xff)
  }
}

/**
 * PNG を RGBA8 に展開する。**対応外の形式・壊れたデータは文脈付きで throw**。
 */
export async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error(`PNG のシグネチャがありません（先頭 ${bytes.length} バイト）`)
  }
  const { header: ihdr, data, palette, alpha } = readChunks(bytes)
  const header = readHeader(ihdr)
  if (header.colorType === PALETTE_COLOR_TYPE && palette === null) {
    throw new Error('パレット形式（カラータイプ 3）なのに PLTE チャンクがありません')
  }
  const raw = await inflate(data)
  const stride = header.width * header.channels
  const expected = (stride + 1) * header.height
  if (raw.length < expected) {
    throw new Error(`PNG の画素データが足りません（${raw.length}/${expected} バイト）`)
  }
  const rgba = new Uint8Array(header.width * header.height * 4)
  let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(stride)
  for (let row = 0; row < header.height; row += 1) {
    const at = row * (stride + 1)
    const filtered = raw.subarray(at + 1, at + 1 + stride)
    const line = unfilterLine(raw[at] ?? 0, filtered, previous, header.channels)
    if (header.colorType === PALETTE_COLOR_TYPE && palette !== null) {
      writePaletteLine(rgba, line, row, header, palette, alpha)
    } else {
      writeLine(rgba, line, row, header)
    }
    previous = line
  }
  return { width: header.width, height: header.height, rgba }
}

/** 画素を読む（範囲外は throw＝黙って端の色を返さない）。 */
export function pixelAt(image: DecodedImage, x: number, y: number): Rgba {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error(`画素の座標が不正です（${x}, ${y}）`)
  }
  if (x >= image.width || y >= image.height) {
    throw new Error(`画素の座標が範囲外です（${x}, ${y} / ${image.width}×${image.height}）`)
  }
  const at = (y * image.width + x) * 4
  return {
    r: image.rgba[at] ?? 0,
    g: image.rgba[at + 1] ?? 0,
    b: image.rgba[at + 2] ?? 0,
    a: image.rgba[at + 3] ?? 0,
  }
}

/** `#RRGGBB`（大文字）。カタログの `ranks[].color` と同じ表記に揃える。 */
export function hexOf(pixel: Rgba): string {
  const part = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase()
  return `#${part(pixel.r)}${part(pixel.g)}${part(pixel.b)}`
}
