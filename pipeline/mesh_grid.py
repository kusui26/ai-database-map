"""標準地域メッシュの格子演算（`src/shared/mesh.ts` の Python 版・純ロジック）。

TypeScript 側と**同じ規約**を持つ。ずれると配布バイナリの添字がずれて静かに壊れるので、
規約はここに 1 箇所だけ書き、`build_hazard_mesh.py` と `validate_hazard_mesh.py` が共有する。

- 1 次メッシュは緯度 40 分 × 経度 1 度で、250m（5 次）まで割ると **ちょうど 320 × 320**
- 添字は **row 0 ＝ 南端・col 0 ＝ 西端**、オフセットは `row * 320 + col`（行優先）
- 配布バイナリは 1 セル **4 ビット**（0＝該当なし、1 以上＝原典のコード値）。
  バイト i の**上位ニブルがセル 2i、下位ニブルがセル 2i+1**

（Phase 0 で、実データ 1,163,757 メッシュについて TS 版と重心が最大 3.2 ナノメートル差で
一致することを確認済み。`docs/260824_flood.md` §5.6）
"""

from __future__ import annotations

import numpy as np

# --- 格子の定数（src/shared/mesh.ts と同値） -----------------------------

MESH_SIZE_M = 250
CELLS_PER_PRIMARY = 320
CELLS_PER_DEG_LAT = 480
CELLS_PER_DEG_LON = 320
PRIMARY_LON_ORIGIN_DEG = 100
PRIMARY_LAT_FACTOR = 1.5

CELLS_PER_TILE = CELLS_PER_PRIMARY * CELLS_PER_PRIMARY  # 102,400
TILE_BYTES = CELLS_PER_TILE // 2  # ニブル詰めで 51,200 バイト

# 1 セルの大きさ（度）。ラスタ化の transform に使う。
CELL_LAT_DEG = 1.0 / CELLS_PER_DEG_LAT
CELL_LON_DEG = 1.0 / CELLS_PER_DEG_LON


def primary_bounds(primary: str) -> tuple[float, float, float, float]:
    """1 次メッシュコード（4 桁）→ (west, south, east, north)。"""
    if len(primary) != 4 or not primary.isdigit():
        raise ValueError(f"1 次メッシュコードは 4 桁の数字（受領: {primary}）")
    south = int(primary[0:2]) / PRIMARY_LAT_FACTOR
    west = int(primary[2:4]) + PRIMARY_LON_ORIGIN_DEG
    return west, south, west + 1.0, south + 1.0 / PRIMARY_LAT_FACTOR


def cell_of_mesh_code(code: str) -> tuple[str, int, int]:
    """250m（10 桁）メッシュコード → (1 次メッシュ, row, col)。row は南から、col は西から。"""
    if len(code) != 10 or not code.isdigit():
        raise ValueError(f"250m メッシュコードは 10 桁の数字（受領: {code}）")
    row = int(code[4]) * 40 + int(code[6]) * 4
    col = int(code[5]) * 40 + int(code[7]) * 4
    quaternary, quinary = int(code[8]) - 1, int(code[9]) - 1
    if not (0 <= quaternary <= 3 and 0 <= quinary <= 3):
        raise ValueError(f"4 次・5 次の区画番号は 1–4（受領: {code}）")
    row += (quaternary // 2) * 2 + (quinary // 2)
    col += (quaternary % 2) * 2 + (quinary % 2)
    return code[0:4], row, col


def mesh_code_of_cell(primary: str, row: int, col: int) -> str:
    """(1 次メッシュ, row, col) → 250m メッシュコード（10 桁）。`cell_of_mesh_code` の逆。"""
    if not (0 <= row < CELLS_PER_PRIMARY and 0 <= col < CELLS_PER_PRIMARY):
        raise ValueError(f"row/col は 0–{CELLS_PER_PRIMARY - 1}（受領: {row}, {col}）")
    secondary = f"{row // 40}{col // 40}"
    tertiary = f"{(row % 40) // 4}{(col % 40) // 4}"
    quaternary = (row % 4) // 2 * 2 + (col % 4) // 2 + 1
    quinary = (row % 2) * 2 + (col % 2) + 1
    return f"{primary}{secondary}{tertiary}{quaternary}{quinary}"


def primaries_covering(west: float, south: float, east: float, north: float) -> list[str]:
    """緯度経度の矩形に重なる 1 次メッシュコードを列挙する。"""
    p_from, p_to = int(south * PRIMARY_LAT_FACTOR), int(north * PRIMARY_LAT_FACTOR)
    q_from, q_to = int(west) - PRIMARY_LON_ORIGIN_DEG, int(east) - PRIMARY_LON_ORIGIN_DEG
    return [
        f"{p:02d}{q:02d}"
        for p in range(p_from, p_to + 1)
        for q in range(q_from, q_to + 1)
        if 0 <= p <= 99 and 0 <= q <= 99
    ]


def pack_nibbles(tile: np.ndarray) -> bytes:
    """320×320 の uint8（0–15）→ 51,200 バイト。上位ニブルが偶数番目のセル。"""
    if tile.shape != (CELLS_PER_PRIMARY, CELLS_PER_PRIMARY):
        raise ValueError(f"タイルは {CELLS_PER_PRIMARY}×{CELLS_PER_PRIMARY}（受領: {tile.shape}）")
    if tile.max(initial=0) > 15:
        raise ValueError(f"ニブルに入らない値がある（最大 {tile.max()}）")
    flat = tile.reshape(-1).astype(np.uint8)
    return ((flat[0::2] << 4) | flat[1::2]).tobytes()


def unpack_nibbles(payload: bytes) -> np.ndarray:
    """51,200 バイト → 320×320 の uint8。`pack_nibbles` の逆（検証用）。"""
    if len(payload) != TILE_BYTES:
        raise ValueError(f"タイルは {TILE_BYTES} バイト（受領: {len(payload)}）")
    raw = np.frombuffer(payload, dtype=np.uint8)
    flat = np.empty(CELLS_PER_TILE, dtype=np.uint8)
    flat[0::2] = raw >> 4
    flat[1::2] = raw & 0x0F
    return flat.reshape(CELLS_PER_PRIMARY, CELLS_PER_PRIMARY)
