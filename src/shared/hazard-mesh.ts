/**
 * 250m メッシュ・ハザードの配布アーティファクトを読む（純関数・依存なし）。
 *
 * `pipeline/build_hazard_mesh.py` が書き出したタイルの**唯一のデコーダ**。
 * 書き手（Python）と読み手（TypeScript）で規約がずれると静かに壊れるので、
 * 規約はここと `pipeline/mesh_grid.py` の 2 箇所だけに書き、テストで実物を突き合わせる。
 *
 * ## 規約（`public/hazard/index.json` の `encodingJa` と同じ・**フォーマット v2**）
 *
 * - 1 タイル ＝ 1 次メッシュ ＝ **320 × 320 セル**（1 セル 250m）
 * - 添字は **row 0 ＝ 南端・col 0 ＝ 西端**、行優先（`row * 320 + col`）
 * - 1 セル **1 バイト**。**上位ニブル＝最大ランク、下位ニブル＝被覆率 0–15**
 * - 標高は別ファイルで **int16 リトルエンディアンのデシメートル**、`-32768` が欠損
 * - ファイルは gzip（取得側で解いてから渡す。ブラウザは `DecompressionStream('gzip')`）
 *
 * ## セルは点ではなく「区間」である
 *
 * 250m セルの **33% は区域と非区域が混在**している。だから 1 セルに 1 値を持たせると、
 * 点で聞かれたときに必ず嘘をつく（代表点なら 7.7% を「区域外」と誤答した）。
 * v2 は 1 セルを **区間**として表す。
 *
 * | 読むもの | 意味 | 使いどころ |
 * |---|---|---|
 * | **最大ランク** | セル内のどこかにある**最悪**。真値は必ずこれ以下（**上界**）| 発災時。広めに見るのが正しい |
 * | **被覆率** | セルのどれだけが区域か（8×8 の 64 サブセルで測定）| 平時の言い方・人口按分 |
 *
 * **厳密なのは両端だけ。** `certaintyAtCell` が `'outside'`（被覆率 0 ＝一切かからない）と
 * `'inside'`（被覆率 15 ＝全域）を返したときだけ確定した主張ができる。`'partial'` は
 * 「一部」としか言えないので、**点で確定させたいときは浸水ナビ API か公式タイルの画素に降りる**
 * （優先順位は §6.3）。どの経路に降りても答えは必ず **(0, 最大ランク] の区間に入る**。
 *
 * 設計の正は `docs/260824_flood.md` §5.9・§8.2b。
 */

import { z } from 'zod'
import { CELLS_PER_PRIMARY, isCellIndex, type MeshCell } from './mesh'

/** 1 タイルのセル数（320 × 320）。 */
export const CELLS_PER_TILE = CELLS_PER_PRIMARY * CELLS_PER_PRIMARY

/** ハザードタイル 1 枚のバイト数（1 セル 1 バイト・v2）。 */
export const HAZARD_TILE_BYTES = CELLS_PER_TILE

/** 読み手が理解できる配布フォーマットの版（`index.json` の `version`）。 */
export const MESH_FORMAT_VERSION = 2

/** 被覆率の刻み。`0` と `COVERAGE_STEPS` だけが厳密で、間は約 6.7 ポイント刻みの近似。 */
export const COVERAGE_STEPS = 15

/** 標高タイル 1 枚のバイト数（int16）。 */
export const ELEVATION_TILE_BYTES = CELLS_PER_TILE * 2

/** 標高の欠損値（海・データ未整備）。 */
export const ELEVATION_MISSING_DM = -32768

/** 標高の格納単位（デシメートル → メートル）。 */
const DECIMETRES_PER_METRE = 10

/** 下位ニブルの取り出し。 */
const LOW_NIBBLE = 0x0f

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

/** セルが区域とどう重なっているか。**確定した主張ができるのは両端だけ**。 */
export type CellCertainty =
  /** 区域が**一切かからない**（被覆率 0）。「区域ではない」と言い切れる。 */
  | 'outside'
  /** セルの**一部**が区域（被覆率 1–14）。「一部かかる」までしか言えない。 */
  | 'partial'
  /** セル**全域**が区域（被覆率 15）。「区域内」と言い切れる。 */
  | 'inside'

/** 1 セルの中身。`rank` は上界、`coverage` は 0–1 の割合。 */
export type HazardCell = {
  /** セル内の**最大**の原典コード値（0 ＝ 該当なし）。真値は必ずこれ以下。 */
  readonly rank: number
  /** セルのうち区域が占める割合（0–1）。1/15 刻みに量子化されている。 */
  readonly coverage: number
  readonly certainty: CellCertainty
}

function certaintyOf(steps: number): CellCertainty {
  if (steps === 0) return 'outside'
  return steps === COVERAGE_STEPS ? 'inside' : 'partial'
}

/**
 * ハザードタイルから 1 セルを読む（添字指定）。
 * `rank` の意味（ラベル・危険度）はカタログの `ranks[].sourceCode` から引く。
 */
export function cellAtOffset(tile: Uint8Array, offset: number): HazardCell {
  if (tile.byteLength !== HAZARD_TILE_BYTES) {
    throw new Error(`ハザードタイルは ${HAZARD_TILE_BYTES} バイト（受領: ${tile.byteLength}）`)
  }
  assertOffset(offset)
  const byte = tile[offset] ?? 0
  const steps = byte & LOW_NIBBLE
  return { rank: byte >> 4, coverage: steps / COVERAGE_STEPS, certainty: certaintyOf(steps) }
}

/** ハザードタイルから 1 セルを読む（セル位置指定）。 */
export function cellAt(tile: Uint8Array, cell: MeshCell): HazardCell {
  return cellAtOffset(tile, offsetOfCell(cell))
}

/** セル内の**最大**の原典コード値（0 ＝ 該当なし）。真値は必ずこれ以下。 */
export function rankAtOffset(tile: Uint8Array, offset: number): number {
  return cellAtOffset(tile, offset).rank
}

/** セル内の最大の原典コード値（セル位置指定）。 */
export function rankAtCell(tile: Uint8Array, cell: MeshCell): number {
  return cellAt(tile, cell).rank
}

/** セルのうち区域が占める割合（0–1）。**0 と 1 だけが厳密**。 */
export function coverageAtCell(tile: Uint8Array, cell: MeshCell): number {
  return cellAt(tile, cell).coverage
}

/** そのセルについて確定した主張ができるか（`'partial'` なら「一部」としか言えない）。 */
export function certaintyAtCell(tile: Uint8Array, cell: MeshCell): CellCertainty {
  return cellAt(tile, cell).certainty
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
  /** 被覆率の刻み数（15）。読み手の `COVERAGE_STEPS` と一致していること。 */
  coverageSteps: z.number().int(),
  /** 被覆率を測ったサブセル数（64）。「どれくらいの粒度で測ったか」の記録。 */
  subcellsPerCell: z.number().int(),
  encodingJa: z.string(),
  /** 該当判定の考え方（最大は上界であること・厳密なのは被覆率の両端だけであること）。 */
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

/**
 * 索引を読み、**規約が読み手と一致していることまで**確かめる。
 *
 * 版やバイト数がずれたまま読むと、例外ではなく**静かに間違った答え**が出る
 * （v1 のニブル詰めを v2 として読むと、隣のセルの値を返してしまう）。
 * だからここで落とす。**素の `hazardMeshIndexSchema.parse` ではなくこちらを使う。**
 */
export function parseHazardMeshIndex(value: unknown): HazardMeshIndex {
  const index = hazardMeshIndexSchema.parse(value)
  if (index.version !== MESH_FORMAT_VERSION) {
    throw new Error(
      `ハザードメッシュの版が読み手と違う（索引: ${index.version} / 読み手: ${MESH_FORMAT_VERSION}）。` +
        'pipeline/build_hazard_mesh.py を実行し直してください',
    )
  }
  if (index.tileBytes !== HAZARD_TILE_BYTES || index.coverageSteps !== COVERAGE_STEPS) {
    throw new Error(
      `ハザードメッシュの規約が読み手と違う（${index.tileBytes} バイト / 被覆率 ${index.coverageSteps} 段）`,
    )
  }
  return index
}

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
