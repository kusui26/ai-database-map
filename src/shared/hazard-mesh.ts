/**
 * 250m メッシュ・ハザードの配布アーティファクトを読む（純関数・依存なし）。
 *
 * `pipeline/build_hazard_mesh.py` が書き出したタイルの**唯一のデコーダ**。
 * 書き手（Python）と読み手（TypeScript）で規約がずれると静かに壊れるので、
 * 規約はここと `pipeline/mesh_grid.py` の 2 箇所だけに書き、テストで実物を突き合わせる。
 *
 * ## 規約（`public/hazard/index.json` の `encodingJa` と同じ）
 *
 * - 1 タイル ＝ 1 次メッシュ ＝ **320 × 320 セル**（1 セル 250m）
 * - 添字は **row 0 ＝ 南端・col 0 ＝ 西端**、行優先（`row * 320 + col`）
 * - 1 セル **4 ビット**。バイト i の**上位ニブルがセル 2i、下位ニブルがセル 2i+1**
 * - 値は**国土数値情報のコード値**（浸水深 1–6・継続時間 1–7・危険区域区分 1–2）。**0 ＝ 該当なし**
 * - 該当の判定は「250m セルの**代表点（中心）**が区域に入るか」。地図に描く公式タイルの表示と
 *   一致する（無作為 800 セルで 99.8%）。セルの端だけが区域にかかる場合は取りこぼすので、
 *   **利用側は隣接セルも見て補う**（セルを塗り潰すより「隣が危ない」と言えるほうが役に立つ）
 * - 標高は別ファイルで **int16 リトルエンディアンのデシメートル**、`-32768` が欠損
 * - ファイルは gzip（取得側で解いてから渡す。ブラウザは `DecompressionStream('gzip')`）
 *
 * 設計の正は `docs/260824_flood.md` §5.3・§5.8。
 *
 * ## ⚠ フォーマット v2 への変更が決まっている（未実装・同 §5.9／§8.2b）
 *
 * セル 1 個に 1 値だと、**点で聞かれたときに 7.7% 誤答する**（250m セルの 33% が
 * 区域と非区域の混在で、代表点はその片方しか表せないため）。v2 では 1 セルを
 * **1 バイト＝上位ニブル「セル内の最大ランク」＋下位ニブル「被覆率 0–15」**にして、
 * **両端（0＝一切かからない／15＝全域）だけを確定的な主張に使う**。
 * `index.json` の `version` で判別する（現行は 1）。
 */

import { z } from 'zod'
import { CELLS_PER_PRIMARY, isCellIndex, type MeshCell } from './mesh'

/** 1 タイルのセル数（320 × 320）。 */
export const CELLS_PER_TILE = CELLS_PER_PRIMARY * CELLS_PER_PRIMARY

/** ハザードタイル 1 枚のバイト数（ニブル詰め）。 */
export const HAZARD_TILE_BYTES = CELLS_PER_TILE / 2

/** 標高タイル 1 枚のバイト数（int16）。 */
export const ELEVATION_TILE_BYTES = CELLS_PER_TILE * 2

/** 標高の欠損値（海・データ未整備）。 */
export const ELEVATION_MISSING_DM = -32768

/** 標高の格納単位（デシメートル → メートル）。 */
const DECIMETRES_PER_METRE = 10

/** ニブルの上限（4 ビット）。 */
const MAX_NIBBLE = 15

// --- 型ガード -------------------------------------------------------------

/** ハザードタイルとして扱えるバイト列か。 */
export function isHazardTile(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === HAZARD_TILE_BYTES
}

/** 標高タイルとして扱えるバイト列か。 */
export function isElevationTile(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === ELEVATION_TILE_BYTES
}

// --- 読み出し -------------------------------------------------------------

/** タイル内の添字（0–102,399）を検証する。 */
function assertOffset(offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset >= CELLS_PER_TILE) {
    throw new Error(`タイル添字は 0–${CELLS_PER_TILE - 1}（受領: ${offset}）`)
  }
}

/** セル位置 → タイル内の添字（行優先）。 */
export function offsetOfCell(cell: MeshCell): number {
  if (!isCellIndex(cell.row) || !isCellIndex(cell.col)) {
    throw new Error(`row/col は 0–${CELLS_PER_PRIMARY - 1}（受領: ${cell.row}, ${cell.col}）`)
  }
  return cell.row * CELLS_PER_PRIMARY + cell.col
}

/**
 * ハザードタイルから 1 セルの**原典コード値**を読む（0 ＝ 該当なし）。
 * 意味（ラベル・危険度）はカタログの `ranks[].sourceCode` から引く。
 */
export function rankAtOffset(tile: Uint8Array, offset: number): number {
  if (tile.byteLength !== HAZARD_TILE_BYTES) {
    throw new Error(`ハザードタイルは ${HAZARD_TILE_BYTES} バイト（受領: ${tile.byteLength}）`)
  }
  assertOffset(offset)
  const byte = tile[offset >> 1] ?? 0
  return offset % 2 === 0 ? byte >> 4 : byte & MAX_NIBBLE
}

/** ハザードタイルから 1 セルの原典コード値を読む（セル位置指定）。 */
export function rankAtCell(tile: Uint8Array, cell: MeshCell): number {
  return rankAtOffset(tile, offsetOfCell(cell))
}

/**
 * 標高タイルから 1 セルの平均標高（メートル）を読む。欠損は null。
 * バイト列は int16 リトルエンディアン・デシメートル。
 */
export function elevationAtOffset(tile: Uint8Array, offset: number): number | null {
  if (tile.byteLength !== ELEVATION_TILE_BYTES) {
    throw new Error(`標高タイルは ${ELEVATION_TILE_BYTES} バイト（受領: ${tile.byteLength}）`)
  }
  assertOffset(offset)
  const view = new DataView(tile.buffer, tile.byteOffset, tile.byteLength)
  const decimetres = view.getInt16(offset * 2, true)
  return decimetres === ELEVATION_MISSING_DM ? null : decimetres / DECIMETRES_PER_METRE
}

/** 標高タイルから 1 セルの平均標高（メートル）を読む（セル位置指定）。 */
export function elevationAtCell(tile: Uint8Array, cell: MeshCell): number | null {
  return elevationAtOffset(tile, offsetOfCell(cell))
}

// --- 索引（public/hazard/index.json） -------------------------------------

/**
 * 配布アーティファクトの索引。**どの 1 次メッシュにどのレイヤがあるか**を持ち、
 * 取得側は「無いものを取りに行かない」ことができる（404 を待たない）。
 */
export const hazardMeshIndexSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  generatedFrom: z.string(),
  /** 原典の説明（出典表示に使う）。 */
  sourceJa: z.string(),
  cellsPerPrimary: z.number().int(),
  tileBytes: z.number().int(),
  encodingJa: z.string(),
  /** 該当判定の考え方（代表点であること・取りこぼしの補い方の明示）。 */
  matchJa: z.string(),
  elevation: z.object({
    path: z.string(),
    dtype: z.literal('int16-le'),
    unit: z.literal('decimetre'),
    missing: z.number().int(),
    primaries: z.array(z.string()),
  }),
  layers: z.record(
    z.string(),
    z.object({
      path: z.string(),
      gzipBytes: z.number().int(),
      primaries: z.array(z.string()),
    }),
  ),
})
export type HazardMeshIndex = z.infer<typeof hazardMeshIndexSchema>

/** そのレイヤ・1 次メッシュのタイルが配布されているか（無ければ取りに行かない）。 */
export function hasTile(index: HazardMeshIndex, layerKey: string, primary: string): boolean {
  return index.layers[layerKey]?.primaries.includes(primary) === true
}

/** タイルの取得パス（`index.json` からの相対）。 */
export function tilePath(index: HazardMeshIndex, layerKey: string, primary: string): string | null {
  const layer = index.layers[layerKey]
  if (layer === undefined || !layer.primaries.includes(primary)) return null
  return layer.path.replace('{primary}', primary)
}

/** 標高タイルの取得パス（無ければ null）。 */
export function elevationTilePath(index: HazardMeshIndex, primary: string): string | null {
  if (!index.elevation.primaries.includes(primary)) return null
  return index.elevation.path.replace('{primary}', primary)
}
