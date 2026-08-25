"""標準地域メッシュの格子演算（`src/shared/mesh.ts` の Python 版・純ロジック）。

TypeScript 側と**同じ規約**を持つ。ずれると配布バイナリの添字がずれて静かに壊れるので、
規約はここに 1 箇所だけ書き、`build_hazard_mesh.py` と `validate_hazard_mesh.py` が共有する。

- 1 次メッシュは緯度 40 分 × 経度 1 度で、250m（5 次）まで割ると **ちょうど 320 × 320**
- 添字は **row 0 ＝ 南端・col 0 ＝ 西端**、オフセットは `row * 320 + col`（行優先）
- 配布バイナリは 1 セル **1 バイト**＝**上位ニブル「セル内の最大ランク」＋下位ニブル
  「被覆率 0–15」**（フォーマット v2）。バイト i がセル i にそのまま対応する

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
TILE_BYTES = CELLS_PER_TILE  # 1 セル 1 バイト（v2）で 102,400 バイト

# 配布フォーマットの版。読み手（`src/shared/hazard-mesh.ts`）と一致していること。
MESH_FORMAT_VERSION = 2

# 被覆率の刻み。0 と 15 だけが**厳密**（0＝一切かからない／15＝全域）で、
# 1–14 は約 6.7 ポイント刻みの近似。理由は `docs/260824_flood.md` §5.9。
COVERAGE_STEPS = 15

# 被覆率を測るサブセルの分割数。8 × 8 ＝ 1 セルあたり 64 点（1 点 ≒ 31.25m）。
SUBCELLS_PER_SIDE = 8
SUBCELLS_PER_CELL = SUBCELLS_PER_SIDE * SUBCELLS_PER_SIDE
SUBCELLS_PER_TILE_SIDE = CELLS_PER_PRIMARY * SUBCELLS_PER_SIDE
SUB_LAT_DEG = 1.0 / (CELLS_PER_DEG_LAT * SUBCELLS_PER_SIDE)
SUB_LON_DEG = 1.0 / (CELLS_PER_DEG_LON * SUBCELLS_PER_SIDE)

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


def coverage_fraction(sub_mask: np.ndarray) -> np.ndarray:
    """2560×2560 の真偽 → 320×320 の被覆率（0.0–1.0・1/64 刻み）。"""
    side = SUBCELLS_PER_TILE_SIDE
    if sub_mask.shape != (side, side):
        raise ValueError(f"サブセル格子は {side}×{side}（受領: {sub_mask.shape}）")
    blocks = sub_mask.reshape(
        CELLS_PER_PRIMARY, SUBCELLS_PER_SIDE, CELLS_PER_PRIMARY, SUBCELLS_PER_SIDE
    )
    return blocks.sum(axis=(1, 3), dtype=np.uint16) / SUBCELLS_PER_CELL


def quantise_coverage(fraction: np.ndarray, max_plane: np.ndarray) -> np.ndarray:
    """被覆率（0.0–1.0）→ 0–15。**両端だけが厳密**になるよう丸める。

    - `0`  … 区域が**一切かからない**（最大ランクも 0）。「区域ではない」と確定して言える
    - `15` … セル**全域**が区域（サブセル 64 点すべてが該当）。「区域内」と確定して言える
    - `1–14` … 中間。**丸めた結果が両端に落ちないよう clamp する**——
      これをしないと「ごく一部かかる」セルが 0 に丸まって「かからない」と嘘をつく

    最大ランクとの整合（`最大 > 0 ⟺ 被覆率 > 0`）もここで担保する。細い区域が
    セルを掠めるだけのとき、サブセルの中心はどれも捕まえられない（＝分数 0）が、
    最大ランクは `all_touched` で 1 以上になる。この場合は被覆率 1（＝ごく一部）にする。
    """
    if fraction.shape != max_plane.shape:
        raise ValueError(f"格子の形が違う（{fraction.shape} 対 {max_plane.shape}）")
    steps = np.clip(np.rint(fraction * COVERAGE_STEPS), 1, COVERAGE_STEPS - 1).astype(np.uint8)
    steps = np.where(fraction >= 1.0, COVERAGE_STEPS, steps).astype(np.uint8)
    return np.where(max_plane > 0, steps, 0).astype(np.uint8)


def pack_cells(max_plane: np.ndarray, coverage: np.ndarray) -> bytes:
    """320×320 の (最大ランク, 被覆率) → 102,400 バイト。1 セル 1 バイト。

    上位ニブルが最大ランク、下位ニブルが被覆率。両者を**交互**ではなく**同じバイト**に
    入れるのは、面を分けるより gzip が効くため（23.5KB 対 29.1KB・§5.9）。
    """
    shape = (CELLS_PER_PRIMARY, CELLS_PER_PRIMARY)
    for name, plane in (("最大ランク", max_plane), ("被覆率", coverage)):
        if plane.shape != shape:
            raise ValueError(f"{name}の格子は {shape}（受領: {plane.shape}）")
        if plane.max(initial=0) > COVERAGE_STEPS:
            raise ValueError(f"{name}がニブルに入らない（最大 {plane.max()}）")
    if np.any((max_plane > 0) != (coverage > 0)):
        raise ValueError("不変条件（最大 > 0 ⟺ 被覆率 > 0）が崩れている")
    packed = (max_plane.astype(np.uint8) << 4) | coverage.astype(np.uint8)
    return packed.reshape(-1).tobytes()


def unpack_cells(payload: bytes) -> tuple[np.ndarray, np.ndarray]:
    """102,400 バイト → (最大ランク, 被覆率)。`pack_cells` の逆（検証用）。"""
    if len(payload) != TILE_BYTES:
        raise ValueError(f"タイルは {TILE_BYTES} バイト（受領: {len(payload)}）")
    raw = np.frombuffer(payload, dtype=np.uint8).reshape(CELLS_PER_PRIMARY, CELLS_PER_PRIMARY)
    return raw >> 4, raw & 0x0F
