/**
 * 標準地域メッシュ（1 次〜5 次）の純関数。依存なし・framework 非依存。
 *
 * 水害レイヤは「駅×半径」ではなく**メッシュのまま**扱う（`docs/260824_flood.md` §2）。
 * その土台がここで、**緯度経度 → メッシュコード → 配列オフセット**を四則演算だけで往復する。
 * PostGIS も空間インデックスも要らないので、**現在地判定が O(1)・オフラインでも動く**（同 §2.2）。
 * ここが静かに間違うと全部が静かに間違うため、境界値テストを厚く張る（`tests/mesh.test.ts`）。
 *
 * ## 実装の芯：すべてを「5 次メッシュ 1 個ぶん」の整数 index で数える
 *
 * 緯度経度を素直に分割していくと 2/3 度のような無限小数が積み上がって誤差が出る。
 * そこで **最細（5 次＝250m）を単位とする整数 index** を最初に 1 回だけ作り、
 * 以降は整数の除算・剰余だけで扱う。
 *
 * ```
 * latIndex = floor(lat × 480)          … 5 次の緯度幅 = 1/480 度
 * lonIndex = floor((lon − 100) × 320)  … 5 次の経度幅 = 1/320 度・1 次の原点は東経 100 度
 * ```
 *
 * 1 次メッシュは緯度 40 分 × 経度 1 度で、5 次まで割ると **ちょうど 320 × 320** になる
 * （2 次 8 × 3 次 10 × 4 次 2 × 5 次 2 ＝ 320）。この 320 が配布バイナリの一辺でもある（同 §5.3）。
 */

// --- 定数（意味づけの最下層） --------------------------------------------

/** 5 次メッシュ（最細）の一辺の目安（メートル）。表示・単位換算の単一の真実。 */
export const MESH_SIZE_M = 250

/** 1 次メッシュを 5 次メッシュで割ったときの一辺のセル数（2 次 8 × 3 次 10 × 4 次 2 × 5 次 2）。 */
export const CELLS_PER_PRIMARY = 320

/** 5 次メッシュ 1 個ぶんの緯度幅の逆数（1/480 度）。緯度 index はこの単位で数える。 */
const CELLS_PER_DEG_LAT = 480

/** 5 次メッシュ 1 個ぶんの経度幅の逆数（1/320 度）。経度 index はこの単位で数える。 */
const CELLS_PER_DEG_LON = 320

/** 1 次メッシュの経度原点（東経 100 度）。1 次コードの下 2 桁は `floor(経度) − 100`。 */
const PRIMARY_LON_ORIGIN_DEG = 100

/** 1 次コードの上 2 桁を作る係数（`floor(緯度 × 1.5)`）。 */
const PRIMARY_LAT_FACTOR = 1.5

/** メッシュ区画のレベル（1 次〜5 次）。 */
export const MESH_LEVELS = [1, 2, 3, 4, 5] as const
export type MeshLevel = (typeof MESH_LEVELS)[number]

/** レベル → コードの桁数。 */
const CODE_LENGTH: Readonly<Record<MeshLevel, number>> = { 1: 4, 2: 6, 3: 8, 4: 9, 5: 10 }

/** レベル → 1 区画の一辺のセル数（5 次メッシュ単位）。1 次 320 → 5 次 1。 */
const CELLS_PER_LEVEL: Readonly<Record<MeshLevel, number>> = { 1: 320, 2: 40, 3: 4, 4: 2, 5: 1 }

/** 桁数 → レベル（逆引き）。 */
const LEVEL_BY_CODE_LENGTH: ReadonlyMap<number, MeshLevel> = new Map(
  MESH_LEVELS.map((level) => [CODE_LENGTH[level], level]),
)

/** 1 次コードの上 2 桁が 0–99 に収まる緯度の上限（この値を含まない）。 */
const MAX_LAT_DEG_EXCLUSIVE = 100 / PRIMARY_LAT_FACTOR

/** 1 次コードの下 2 桁が 0–99 に収まる経度の上限（この値を含まない）。 */
const MAX_LON_DEG_EXCLUSIVE = PRIMARY_LON_ORIGIN_DEG + 100

// --- 型 -------------------------------------------------------------------

/** 標準地域メッシュコード（4 / 6 / 8 / 9 / 10 桁の数字列）。 */
export type MeshCode = string

/**
 * 1 次メッシュ内のセル位置。配布バイナリの添字（`row * CELLS_PER_PRIMARY + col`）に対応する。
 *
 * ⚠ **row は南から北へ、col は西から東へ数える**（row 0 ＝ 南端・col 0 ＝ 西端）。
 * 画像の慣習（左上原点）とは上下が逆だが、メッシュコードの算術とそのまま一致するので
 * 反転を挟まずに済み、「反転を忘れた／二重に反転した」という事故が起きない。
 */
export type MeshCell = {
  readonly primary: MeshCode
  readonly row: number
  readonly col: number
}

/** メッシュ区画の範囲（南西端を含み、北東端を含まない）。 */
export type MeshBounds = {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

/** 緯度経度の点。 */
export type LonLat = { readonly lon: number; readonly lat: number }

/** 5 次メッシュ単位の整数で表した区画（内部表現。index は区画の南西端のセル）。 */
type MeshExtent = {
  readonly latIndex: number
  readonly lonIndex: number
  readonly cells: number
  readonly level: MeshLevel
}

/** 5 次メッシュ単位のオフセット（緯度・経度）。 */
type IndexOffset = { readonly lat: number; readonly lon: number }

// --- 検証（失敗は文脈付きで throw する） ----------------------------------

/** メッシュコードとして扱える文字列か（桁数と「数字のみ」を見る型ガード）。 */
export function isMeshCode(value: unknown): value is MeshCode {
  if (typeof value !== 'string') return false
  if (!LEVEL_BY_CODE_LENGTH.has(value.length)) return false
  return /^\d+$/.test(value)
}

/** 0 以上 320 未満の整数（1 次メッシュ内のセル添字）か。 */
export function isCellIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < CELLS_PER_PRIMARY
}

/** メッシュコードのレベルを返す（不正なコードは文脈付きで throw）。 */
function levelOf(code: MeshCode): MeshLevel {
  if (!isMeshCode(code)) {
    throw new Error(`メッシュコード: 4/6/8/9/10 桁の数字列のみ（受領: ${String(code)}）`)
  }
  const level = LEVEL_BY_CODE_LENGTH.get(code.length)
  if (level === undefined) throw new Error(`メッシュコード: 未知の桁数（${code}）`)
  return level
}

/** コード内の 1 桁を数値で取り出す（範囲外・非数字は文脈付きで throw）。 */
function digitAt(code: MeshCode, index: number): number {
  const char = code.charAt(index)
  const digit = Number(char)
  if (char === '' || !Number.isInteger(digit)) {
    throw new Error(`メッシュコード: ${index + 1} 桁目が読めない（${code}）`)
  }
  return digit
}

/** 4 次・5 次の区画番号（南西 1・南東 2・北西 3・北東 4）を検証して返す。 */
function quadrantAt(code: MeshCode, index: number, levelName: string): number {
  const quadrant = digitAt(code, index)
  if (quadrant < 1 || quadrant > 4) {
    throw new Error(`メッシュコード: ${levelName}の区画番号は 1–4（${code} の値は ${quadrant}）`)
  }
  return quadrant
}

// --- 緯度経度 → メッシュ --------------------------------------------------

/** 緯度経度を 5 次メッシュ単位の整数 index に落とす（小数を扱うのはここだけ）。 */
function indicesOf(lon: number, lat: number): { latIndex: number; lonIndex: number } {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`メッシュ変換: 経度・緯度が数値ではない（lon=${lon}, lat=${lat}）`)
  }
  if (lat < 0 || lat >= MAX_LAT_DEG_EXCLUSIVE) {
    throw new Error(
      `メッシュ変換: 緯度が範囲外（lat=${lat}・0 以上 ${MAX_LAT_DEG_EXCLUSIVE} 未満）`,
    )
  }
  if (lon < PRIMARY_LON_ORIGIN_DEG || lon >= MAX_LON_DEG_EXCLUSIVE) {
    throw new Error(
      `メッシュ変換: 経度が範囲外（lon=${lon}・${PRIMARY_LON_ORIGIN_DEG} 以上 ${MAX_LON_DEG_EXCLUSIVE} 未満）`,
    )
  }
  return {
    latIndex: Math.floor(lat * CELLS_PER_DEG_LAT),
    lonIndex: Math.floor((lon - PRIMARY_LON_ORIGIN_DEG) * CELLS_PER_DEG_LON),
  }
}

/** 緯度経度 → 1 次メッシュ内のセル位置（row/col は 0–319）。 */
export function meshCellFromLonLat(lon: number, lat: number): MeshCell {
  const { latIndex, lonIndex } = indicesOf(lon, lat)
  const p = Math.floor(latIndex / CELLS_PER_PRIMARY)
  const q = Math.floor(lonIndex / CELLS_PER_PRIMARY)
  return {
    primary: `${String(p).padStart(2, '0')}${String(q).padStart(2, '0')}`,
    row: latIndex % CELLS_PER_PRIMARY,
    col: lonIndex % CELLS_PER_PRIMARY,
  }
}

/** 親区画内の位置から 4 次・5 次の区画番号（1–4）を作る。 */
function quadrantOf(rowInParent: number, colInParent: number, half: number): number {
  return 2 * Math.floor(rowInParent / half) + Math.floor(colInParent / half) + 1
}

/** セル位置（row/col）を 2 次〜5 次の 6 桁に符号化する。 */
function subdivisionDigits(row: number, col: number): string {
  const secondary = `${Math.floor(row / CELLS_PER_LEVEL[2])}${Math.floor(col / CELLS_PER_LEVEL[2])}`
  const tertiaryRow = Math.floor((row % CELLS_PER_LEVEL[2]) / CELLS_PER_LEVEL[3])
  const tertiaryCol = Math.floor((col % CELLS_PER_LEVEL[2]) / CELLS_PER_LEVEL[3])
  const quaternary = quadrantOf(
    row % CELLS_PER_LEVEL[3],
    col % CELLS_PER_LEVEL[3],
    CELLS_PER_LEVEL[4],
  )
  const quinary = quadrantOf(row % CELLS_PER_LEVEL[4], col % CELLS_PER_LEVEL[4], CELLS_PER_LEVEL[5])
  return `${secondary}${tertiaryRow}${tertiaryCol}${quaternary}${quinary}`
}

/** 1 次メッシュ内のセル位置 → 250m（5 次）メッシュコード（10 桁）。 */
export function meshCodeFromCell(cell: MeshCell): MeshCode {
  if (!isMeshCode(cell.primary) || cell.primary.length !== CODE_LENGTH[1]) {
    throw new Error(`メッシュセル: primary は 4 桁の 1 次メッシュコード（受領: ${cell.primary}）`)
  }
  if (!isCellIndex(cell.row) || !isCellIndex(cell.col)) {
    throw new Error(
      `メッシュセル: row/col は 0–${CELLS_PER_PRIMARY - 1}（受領: ${cell.row}, ${cell.col}）`,
    )
  }
  return `${cell.primary}${subdivisionDigits(cell.row, cell.col)}`
}

/** 緯度経度 → 250m（5 次）メッシュコード（10 桁）。 */
export function meshCodeFromLonLat(lon: number, lat: number): MeshCode {
  return meshCodeFromCell(meshCellFromLonLat(lon, lat))
}

/** 1 次メッシュ内のセル位置 → 配布バイナリの添字（行優先・0 起点・0–102,399）。 */
export function meshOffsetInPrimary(cell: MeshCell): number {
  if (!isCellIndex(cell.row) || !isCellIndex(cell.col)) {
    throw new Error(
      `メッシュ添字: row/col は 0–${CELLS_PER_PRIMARY - 1}（受領: ${cell.row}, ${cell.col}）`,
    )
  }
  return cell.row * CELLS_PER_PRIMARY + cell.col
}

// --- メッシュ → 緯度経度 --------------------------------------------------

/** 指定レベルがコードに寄与するオフセット（5 次メッシュ単位）。 */
function offsetOfLevel(code: MeshCode, level: MeshLevel): IndexOffset {
  switch (level) {
    case 1:
      return {
        lat: Number(code.slice(0, 2)) * CELLS_PER_PRIMARY,
        lon: Number(code.slice(2, 4)) * CELLS_PER_PRIMARY,
      }
    case 2:
      return {
        lat: digitAt(code, 4) * CELLS_PER_LEVEL[2],
        lon: digitAt(code, 5) * CELLS_PER_LEVEL[2],
      }
    case 3:
      return {
        lat: digitAt(code, 6) * CELLS_PER_LEVEL[3],
        lon: digitAt(code, 7) * CELLS_PER_LEVEL[3],
      }
    case 4:
      return quadrantOffset(quadrantAt(code, 8, '4 次'), CELLS_PER_LEVEL[4])
    case 5:
      return quadrantOffset(quadrantAt(code, 9, '5 次'), CELLS_PER_LEVEL[5])
  }
}

/** 区画番号（1–4）→ 親区画内のオフセット。 */
function quadrantOffset(quadrant: number, cells: number): IndexOffset {
  return { lat: Math.floor((quadrant - 1) / 2) * cells, lon: ((quadrant - 1) % 2) * cells }
}

/** メッシュコードを 5 次単位の整数区画へ分解する（不正なコードは throw）。 */
function extentOf(code: MeshCode): MeshExtent {
  const level = levelOf(code)
  const sum = MESH_LEVELS.filter((each) => each <= level).reduce<IndexOffset>(
    (acc, each) => {
      const offset = offsetOfLevel(code, each)
      return { lat: acc.lat + offset.lat, lon: acc.lon + offset.lon }
    },
    { lat: 0, lon: 0 },
  )
  return { latIndex: sum.lat, lonIndex: sum.lon, cells: CELLS_PER_LEVEL[level], level }
}

/** メッシュコードのレベル（1 次〜5 次）。不正なコードは throw。 */
export function meshLevelOf(code: MeshCode): MeshLevel {
  return levelOf(code)
}

/** メッシュコード → 区画の範囲（南西端を含み、北東端を含まない）。 */
export function meshBoundsOf(code: MeshCode): MeshBounds {
  const { latIndex, lonIndex, cells } = extentOf(code)
  return {
    south: latIndex / CELLS_PER_DEG_LAT,
    north: (latIndex + cells) / CELLS_PER_DEG_LAT,
    west: lonIndex / CELLS_PER_DEG_LON + PRIMARY_LON_ORIGIN_DEG,
    east: (lonIndex + cells) / CELLS_PER_DEG_LON + PRIMARY_LON_ORIGIN_DEG,
  }
}

/** メッシュコード → 区画の中心（代表点）。 */
export function meshCenterOf(code: MeshCode): LonLat {
  const bounds = meshBoundsOf(code)
  return { lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 }
}

/** メッシュコード → それを含む 1 次メッシュコード（4 桁）。 */
export function primaryMeshOf(code: MeshCode): MeshCode {
  levelOf(code)
  return code.slice(0, CODE_LENGTH[1])
}
