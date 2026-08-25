"""水害ハザードを 250m メッシュへ落とす（Phase 1b・`docs/260824_flood.md` §8.2）。

`data/hazard_raw/`（`fetch_hazard_mesh.py` が取得）から、

1. **A31b** 洪水 5 種（計画規模・想定最大規模・浸水継続時間・家屋倒壊 2 種）
2. **A51** 内水（雨水出水）
3. **G04-d** 標高（平均・最低・海面下フラグ）

を 1 次メッシュごとの **320 × 320 の 250m 格子**へ落とし、次を書き出す。

| 成果物 | 中身 |
|---|---|
| `public/hazard/{layer}/{primary}.bin.gz` | 判定用。1 セル **1 バイト**・102,400 バイトを gzip |
| `public/hazard/terrain/elev/{primary}.bin.gz` | 平均標高（int16 リトルエンディアン・デシメートル）|
| `public/hazard/index.json` | どの 1 次メッシュにどのレイヤがあるか＋生成の記録 |
| `data/derived/hazard_mesh.csv` | 解析用。**ハザードに該当したセルだけ**（被覆率・標高を添えて）|

## 設計の要点

- **投影しない。** 面積を測らないので正積投影が要らず、原典（EPSG:6668）のまま
  緯度経度の格子にラスタ化する。プランは Albers を挙げていたが、それは面積按分の話
  （`docs/260824_flood.md` §5.8 に記録）。再投影の誤差もゼロになる。
- **1 セルに (最大ランク, 被覆率) の 2 つを持たせる**（フォーマット v2・§5.9）。
  250m セルの **33% は区域と非区域の混在**なので、1 値では点で聞かれたときに必ず嘘をつく——
  代表点なら **7.7% を「区域外」と誤答**し、重なり判定なら台地や尾根まで「区域内」になる。
  **どちらを選ぶかの問題ではなく、表現が足りていなかった。**
  - **最大ランク**（`all_touched=True`）… セル内のどこかにある**最悪**。発災時の判断に使う。
    真値は必ずこれ以下（**上界**）
  - **被覆率**（0–15）… セルのどれだけが区域か。**8×8 のサブセル 64 点**（1 点 ≒ 31.25m）の
    中心で測って量子化する。**両端だけが厳密**——`0` は「一切かからない」、`15` は「全域」。
    平時の言い方（「全域／一部／ごく一部」）と人口按分に使う
  - 不変条件：**真値 ∈ (0, 最大]** かつ **被覆率 0 ⟺ 区域外**。この 2 つを検証で毎回確かめる
- **セルに複数のランクが載ったら最大を採る**（安全側）。ランク昇順に焼けば後勝ちで
  最大が残り、ファイルをまたぐ合成は `np.maximum` で行う。**被覆率は最大では合成できない**
  （左半分と右半分を別ファイルが持てば、和は全域なのに最大は半分）ので、
  **サブセルの真偽を OR で合成してから**最後に被覆率へ落とす。
- **格納するのは原典のコード値**（浸水深 1–6・継続時間 1–7・危険区域区分 1–2）。
  カタログの `ranks[].sourceCode` が意味（ラベル・危険度）への橋渡しになる。
  A51 は詳細版（8 階級）の文字列で来るが、**6 階級へ粗くして格納する**——
  細かい方に合わせると A31b 側に無い精度を捏造することになるため。

    python3 pipeline/build_hazard_mesh.py              # 全部作る（並列度は実メモリから決める）
    python3 pipeline/build_hazard_mesh.py --workers 2  # 並列度を手で指定する
    python3 pipeline/build_hazard_mesh.py --limit 5    # 先頭 5 次メッシュだけ（動作確認用）
"""

from __future__ import annotations

import gc
import gzip
import json
import os
import re
import sys
import warnings
import zipfile
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_grid import (  # noqa: E402
    CELL_LAT_DEG,
    CELL_LON_DEG,
    CELLS_PER_PRIMARY,
    COVERAGE_STEPS,
    MESH_FORMAT_VERSION,
    SUB_LAT_DEG,
    SUB_LON_DEG,
    SUBCELLS_PER_CELL,
    SUBCELLS_PER_SIDE,
    SUBCELLS_PER_TILE_SIDE,
    TILE_BYTES,
    cell_of_mesh_code,
    coverage_fraction,
    mesh_code_of_cell,
    pack_cells,
    primaries_covering,
    primary_bounds,
    quantise_coverage,
)

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "hazard_raw"
DERIVED_DIR = ROOT / "data" / "derived"
CSV_OUT = DERIVED_DIR / "hazard_mesh.csv"
PUBLIC_DIR = ROOT / "public" / "hazard"

# 標高は int16 のデシメートル（0.1m 刻み）。表せるのは ±3,276.7m まで。
ELEVATION_SCALE_DM = 10
ELEVATION_MIN_DM, ELEVATION_MAX_DM = -32767, 32767
# 標高が無いセル（海・データ未整備）の番人。int16 の最小値を占有する。
ELEVATION_MISSING_DM = -32768
# 最低標高コード 5 ＝ 海面下（国土数値情報 G04-d の仕様）。
BELOW_SEA_LEVEL_CODE = "5"

# 浸水深 6 階級（国土数値情報 浸水深ランクコード）の上限（m）。A51 の文字列を畳むのに使う。
DEPTH_CLASS_UPPER_M = [0.5, 3.0, 5.0, 10.0, 20.0, float("inf")]

# 1 次メッシュ 1 枚を焼くとピークで **約 1.2GB** 使う（実測：A31b の最大ファイル 457MB で 1.16GB、
# 197MB で 1.23GB。図形オブジェクトの数で決まるのでファイル容量には比例しない）。
# 同時に走ると OS のページキャッシュも食い合うので、実測値に安全率 1.5 を掛けて見積もる。
WORKER_PEAK_BYTES = int(1.2e9 * 1.5)
# OS とエディタのために残す量。
RESERVED_BYTES = int(3.0e9)


def default_workers() -> int:
    """**CPU 数ではなく実メモリ**で並列度を決める。

    スワップに落ちると、GC の走査がページフォルトを撒き散らして**数倍遅くなる**
    （実測：8.6GB のマシンで 6 並列にしたら 40 分経っても 115 枚中 10 枚すら終わらず、
    ワーカのスタックを取ったら 1,722 サンプル全部が `gc_collect_main` の中だった）。
    """
    physical = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    by_memory = int((physical - RESERVED_BYTES) / WORKER_PEAK_BYTES)
    return max(1, min(os.cpu_count() or 1, by_memory))


@dataclass(frozen=True)
class FloodLayer:
    """A31b の 1 カテゴリ（zip 内のサブディレクトリ 1 つ）。"""

    key: str  # カタログのレイヤ key
    directory_prefix: str  # zip 内のディレクトリ先頭（'20_' など）
    code_column: str  # ランクが入る属性名


A31B_LAYERS: list[FloodLayer] = [
    FloodLayer("flood_l1", "10_", "A31b_101"),
    FloodLayer("flood_l2", "20_", "A31b_201"),
    FloodLayer("flood_duration", "30_", "A31b_301"),
    FloodLayer("flood_kaoku_hanran", "41_", "A31b_401"),
    FloodLayer("flood_kaoku_kagan", "42_", "A31b_401"),
]
NAISUI_LAYER = "naisui"
ALL_LAYERS = [layer.key for layer in A31B_LAYERS] + [NAISUI_LAYER]


# --- ラスタ化（最大ランク ＋ 被覆率） --------------------------------------

# 1 セルぶんの空の格子。空判定と初期化に使い回す。
EMPTY_MAX = np.zeros((CELLS_PER_PRIMARY, CELLS_PER_PRIMARY), dtype=np.uint8)


@contextmanager
def deferred_gc():
    """巡回参照の回収を一時的に止める。**ここが効かないと全体が数倍遅くなる。**

    ラスタ化のあいだは数十万個の図形が生存しているので、世代別 GC が走るたびに
    その全体を辿ることになり、生存数に比例したコストが何千回も掛かる
    （実測：ワーカの CPU のほぼ全部が `gc_collect_main` → `list_traverse` に消えていた）。
    図形は参照循環を作らないので、止めても参照カウントで回収される。
    pandas が作る循環のために、**抜けるときに 1 度だけ**まとめて回収する。
    """
    gc.disable()
    try:
        yield
    finally:
        gc.enable()
        gc.collect()


def rasterize_into(geometries: list, codes: list[int], primary: str, cells_per_side: int) -> np.ndarray:
    """ポリゴンを 1 次メッシュの格子へ焼く（row 0 ＝ 南端）。

    `cells_per_side` が 320 なら**セル単位・`all_touched`**（＝最大ランク用の上界）、
    2,560 ならサブセル単位・**中心判定**（＝被覆率用の面積推定）になる。
    面積を測るのに `all_touched` を使うと必ず過大評価になるので、ここを分けている。
    """
    shapes = [(geometry, code) for geometry, code in zip(geometries, codes) if code > 0]
    if not shapes:
        return np.zeros((cells_per_side, cells_per_side), dtype=np.uint8)
    west, _, _, north = primary_bounds(primary)
    subdivided = cells_per_side != CELLS_PER_PRIMARY
    size = (SUB_LON_DEG, SUB_LAT_DEG) if subdivided else (CELL_LON_DEG, CELL_LAT_DEG)
    burned = rasterize(
        # ランク昇順に焼くと、重なったセルには後勝ちで**最大**が残る（安全側）。
        sorted(shapes, key=lambda pair: pair[1]),
        out_shape=(cells_per_side, cells_per_side),
        transform=from_origin(west, north, *size),
        fill=0,
        all_touched=not subdivided,
        dtype="uint8",
    )
    # rasterio は row 0 ＝ 北端。こちらの規約（row 0 ＝ 南端）へ上下反転する。
    return np.flipud(burned)


# 1 レイヤぶんの確定済みタイル。値は (最大ランク 320×320, 被覆率 320×320)。
PrimaryTiles = dict[str, tuple[np.ndarray, np.ndarray]]


class LayerGrid:
    """1 レイヤぶんの (最大ランク, サブセルの被覆) を 1 次メッシュごとに貯める。

    **被覆率ではなくサブセルの真偽を貯める**のが要点。被覆率は最大でも和でも合成できない
    （重なりを二重に数える）ので、`OR` で union を作ってから最後に 1 度だけ被覆率へ落とす。
    """

    def __init__(self) -> None:
        self.max_plane: dict[str, np.ndarray] = {}
        self.sub_mask: dict[str, np.ndarray] = {}

    def burn(self, geometries: list, codes: list[int], primary: str) -> None:
        """1 ファイルぶんのポリゴンを 1 次メッシュへ足し込む。"""
        largest = rasterize_into(geometries, codes, primary, CELLS_PER_PRIMARY)
        if not largest.any():
            return  # データが無い区画。高価なサブセル焼きに進まない
        subdivided = rasterize_into(geometries, codes, primary, SUBCELLS_PER_TILE_SIDE) > 0
        self.absorb(primary, largest, subdivided)

    def absorb(self, primary: str, largest: np.ndarray, subdivided: np.ndarray) -> None:
        """焼けた格子を足し込む。**合成の規則が 2 面で違う**のがここの要点。"""
        current = self.max_plane.get(primary)
        self.max_plane[primary] = largest if current is None else np.maximum(current, largest)
        seen = self.sub_mask.get(primary)
        self.sub_mask[primary] = subdivided if seen is None else (seen | subdivided)

    def finalise(self) -> PrimaryTiles:
        """(最大ランク, 被覆率 0–15) に確定させ、サブセルの格子を捨てる。"""
        tiles = {
            primary: (largest, quantise_coverage(coverage_fraction(self.sub_mask[primary]), largest))
            for primary, largest in sorted(self.max_plane.items())
        }
        self.sub_mask.clear()
        return tiles


# --- A31b（洪水 5 種・1 次メッシュ単位） ----------------------------------


def shapefiles_in(zip_path: Path, prefix: str = "") -> list[str]:
    """zip 内の .shp を列挙する（区切りを / に正規化。Windows 製 zip 対策）。"""
    with zipfile.ZipFile(zip_path) as archive:
        names = [name.replace("\\", "/") for name in archive.namelist()]
    return [name for name in names if name.endswith(".shp") and name.startswith(prefix)]


def process_a31b(zip_path: Path, primary: str, grids: dict[str, LayerGrid]) -> None:
    for layer in A31B_LAYERS:
        inner = shapefiles_in(zip_path, layer.directory_prefix)
        if not inner:
            continue
        frame = gpd.read_file(f"zip://{zip_path}!{inner[0]}")
        if len(frame) == 0 or layer.code_column not in frame.columns:
            continue
        codes = frame[layer.code_column].fillna(0).astype(int).tolist()
        grids[layer.key].burn(frame.geometry.tolist(), codes, primary)


# --- A51（内水・都道府県単位） --------------------------------------------

_DEPTH_NUMBER = re.compile(r"(\d+(?:\.\d+)?)\s*m")


def depth_code_of_text(text: str) -> int | None:
    """A51 の「浸水深の区分」文字列 → 浸水深ランクコード（1–6）。読めなければ None。

    詳細版（0.3m 未満など 8 階級）で来るが、A31b が 6 階級なので**6 階級へ粗くする**。
    階級の**上限**で畳む（「0.3m未満」も「0.3m以上0.5m未満」も上限 0.5m 以下＝コード 1）。
    """
    numbers = [float(value) for value in _DEPTH_NUMBER.findall(text)]
    if not numbers:
        return None
    upper = float("inf") if ("以上" in text and "未満" not in text) else max(numbers)
    for index, boundary in enumerate(DEPTH_CLASS_UPPER_M, start=1):
        if upper <= boundary:
            return index
    return len(DEPTH_CLASS_UPPER_M)


def process_a51(zip_path: Path, grid: LayerGrid, unknown: set[str]) -> None:
    for inner in shapefiles_in(zip_path):
        frame = gpd.read_file(f"zip://{zip_path}!{inner}")
        if len(frame) == 0 or "A51_005" not in frame.columns:
            continue
        codes = []
        for text in frame["A51_005"].astype(str):
            code = depth_code_of_text(text)
            if code is None:
                unknown.add(text)
            codes.append(code or 0)
        west, south, east, north = frame.total_bounds
        geometries = frame.geometry.tolist()
        for primary in primaries_covering(west, south, east, north):
            grid.burn(geometries, codes, primary)


# --- G04-d（標高・メッシュコードで直接置く） -------------------------------


def new_elevation_tile() -> np.ndarray:
    return np.full((CELLS_PER_PRIMARY, CELLS_PER_PRIMARY), ELEVATION_MISSING_DM, dtype=np.int16)


def to_decimetres(metres: object) -> int:
    """m → デシメートル（int16 に収める）。欠損は番人。"""
    try:
        value = float(metres)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return ELEVATION_MISSING_DM
    if np.isnan(value):
        return ELEVATION_MISSING_DM
    return max(ELEVATION_MIN_DM, min(ELEVATION_MAX_DM, int(round(value * ELEVATION_SCALE_DM))))


def process_g04d(
    zip_path: Path,
    mean_dm: dict[str, np.ndarray],
    min_dm: dict[str, np.ndarray],
    below: dict[str, np.ndarray],
) -> int:
    """標高はポリゴンではなくメッシュコードで来るので、ラスタ化せず添字で置く（誤差ゼロ）。"""
    clamped = 0
    for inner in shapefiles_in(zip_path):
        frame = gpd.read_file(
            f"zip://{zip_path}!{inner}",
            columns=["G04d_001", "G04d_002", "G04d_004", "G04d_005"],
            ignore_geometry=True,
        )
        for code, mean_m, low_m, sea in zip(
            frame["G04d_001"].astype(str), frame["G04d_002"], frame["G04d_004"], frame["G04d_005"]
        ):
            primary, row, col = cell_of_mesh_code(code)
            for store in (mean_dm, min_dm, below):
                store.setdefault(primary, new_elevation_tile())
            value = to_decimetres(mean_m)
            if value in (ELEVATION_MIN_DM, ELEVATION_MAX_DM):
                clamped += 1
            mean_dm[primary][row, col] = value
            min_dm[primary][row, col] = to_decimetres(low_m)
            below[primary][row, col] = 1 if str(sea) == BELOW_SEA_LEVEL_CODE else 0
    return clamped


# --- 出力 -----------------------------------------------------------------


def write_gzip(path: Path, payload: bytes) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    path.write_bytes(compressed)
    return len(compressed)


def write_layer_tiles(layer: str, tiles: PrimaryTiles) -> tuple[list[str], int]:
    written, total = [], 0
    for primary, (largest, coverage) in sorted(tiles.items()):
        total += write_gzip(PUBLIC_DIR / layer / f"{primary}.bin.gz", pack_cells(largest, coverage))
        written.append(primary)
    return written, total


def write_elevation_tiles(tiles: dict[str, np.ndarray]) -> tuple[list[str], int]:
    written, total = [], 0
    for primary, tile in sorted(tiles.items()):
        total += write_gzip(PUBLIC_DIR / "terrain" / "elev" / f"{primary}.bin.gz", tile.astype("<i2").tobytes())
        written.append(primary)
    return written, total


@dataclass(frozen=True)
class Terrain:
    """標高の 3 面（平均・最低・海面下フラグ）。CSV に添えるためだけに持ち回る。"""

    mean_dm: dict[str, np.ndarray]
    min_dm: dict[str, np.ndarray]
    below: dict[str, np.ndarray]

    def at(self, primary: str, row: int, col: int) -> list[str]:
        """1 セルぶんの CSV 断片（平均 m・最低 m・海面下 0/1）。欠損は空欄。"""
        def metres(store: dict[str, np.ndarray]) -> str:
            plane = store.get(primary)
            value = int(plane[row, col]) if plane is not None else ELEVATION_MISSING_DM
            return "" if value == ELEVATION_MISSING_DM else f"{value / ELEVATION_SCALE_DM:.1f}"

        sea = self.below.get(primary)
        return [metres(self.mean_dm), metres(self.min_dm), str(int(sea[row, col])) if sea is not None else "0"]


def csv_header() -> str:
    """レイヤごとに「原典コード」と「被覆率（0.00–1.00）」を並べる。"""
    columns = [column for layer in ALL_LAYERS for column in (layer, f"{layer}_cov")]
    return ",".join(["mesh_code", *columns, "elev_mean_m", "elev_min_m", "below_sea_level"])


def csv_rows_for_primary(primary: str, grids: dict[str, PrimaryTiles], terrain: Terrain) -> list[str]:
    """1 次メッシュぶんの CSV 行（**ハザードに該当したセルだけ**）。"""
    empty = (EMPTY_MAX, EMPTY_MAX)
    planes = [grids[key].get(primary, empty) for key in ALL_LAYERS]
    stack = np.stack([largest for largest, _ in planes])
    rows, cols = np.nonzero(stack.any(axis=0))
    lines = []
    for row, col in zip(rows.tolist(), cols.tolist()):
        values = [
            value
            for largest, coverage in planes
            for value in (str(int(largest[row, col])), f"{coverage[row, col] / COVERAGE_STEPS:.2f}")
        ]
        lines.append(",".join([mesh_code_of_cell(primary, row, col), *values, *terrain.at(primary, row, col)]))
    return lines


def write_csv(grids: dict[str, PrimaryTiles], terrain: Terrain) -> int:
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    primaries = sorted({primary for tiles in grids.values() for primary in tiles})
    count = 0
    with open(CSV_OUT, "w", encoding="utf-8") as handle:
        handle.write(csv_header() + "\n")
        for primary in primaries:
            lines = csv_rows_for_primary(primary, grids, terrain)
            if lines:
                handle.write("\n".join(lines) + "\n")
            count += len(lines)
    return count


ENCODING_NOTE = (
    "1 セル 1 バイト（上位ニブル＝セル内の最大ランク・下位ニブル＝被覆率 0–15）・"
    "row 0 は南端・col 0 は西端・行優先（row * 320 + col）・"
    "最大ランクは国土数値情報のコード値で 0 は該当なし。ファイルは gzip"
)

MATCH_NOTE = (
    "1 セルは点ではなく 250m の**区間**。**最大ランク**はセル内のどこかにある最悪"
    "（少しでも重なれば計上する上界。真値は必ずこれ以下）、**被覆率**はセルのどれだけが"
    f"区域かを 8×8 の {SUBCELLS_PER_CELL} サブセル（1 点 ≒ 31.25m）の中心で測って "
    f"0–{COVERAGE_STEPS} に量子化したもの。**両端だけが厳密**——0 は「区域が一切かからない」、"
    f"{COVERAGE_STEPS} は「セル全域が区域」と確定して言える。1–14 は「一部」であり、"
    "点で確定させたいときは浸水ナビ API か公式タイルの画素に降りる"
)


def build_index(
    layer_primaries: dict[str, list[str]],
    elevation_primaries: list[str],
    bytes_by_layer: dict[str, int],
    source_note: str,
) -> dict[str, object]:
    return {
        "version": MESH_FORMAT_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "generatedFrom": "pipeline/build_hazard_mesh.py",
        "sourceJa": source_note,
        "cellsPerPrimary": CELLS_PER_PRIMARY,
        "tileBytes": TILE_BYTES,
        "coverageSteps": COVERAGE_STEPS,
        "subcellsPerCell": SUBCELLS_PER_CELL,
        "encodingJa": ENCODING_NOTE,
        "matchJa": MATCH_NOTE,
        "elevation": {
            "path": "terrain/elev/{primary}.bin.gz",
            "dtype": "int16-le",
            "unit": "decimetre",
            "missing": ELEVATION_MISSING_DM,
            "primaries": elevation_primaries,
        },
        "layers": {
            layer: {
                "path": f"{layer}/{{primary}}.bin.gz",
                "gzipBytes": bytes_by_layer.get(layer, 0),
                "primaries": primaries,
            }
            for layer, primaries in layer_primaries.items()
        },
    }


# --- 主処理 ---------------------------------------------------------------


def a31b_files() -> dict[str, list[Path]]:
    grouped: dict[str, list[Path]] = defaultdict(list)
    for path in sorted(RAW_DIR.glob("A31b-25_*_SHP.zip")):
        match = re.fullmatch(r"A31b-25_\d+_(\d{4})_SHP\.zip", path.name)
        if match:
            grouped[match.group(1)].append(path)
    return grouped


def a31b_primary_tiles(item: tuple[str, list[Path]]) -> tuple[str, dict[str, PrimaryTiles]]:
    """1 次メッシュ 1 枚ぶんを焼いて確定させる（プロセスプールの 1 単位）。

    A31b はファイルが 1 次メッシュ単位なので、**メッシュどうしは完全に独立**に処理できる。
    ここだけ並列にすれば全体が数倍速くなり、合成の順序にも依存しない。
    独立だから**被覆率までワーカ内で確定できる**——2,560×2,560 のサブセル格子（1 枚 6.6MB）を
    プロセス間で運ばずに済み、親へ返るのは 320×320 が 2 枚だけになる。
    """
    primary, paths = item
    grids = {key: LayerGrid() for key in ALL_LAYERS}
    with deferred_gc():
        for path in paths:
            process_a31b(path, primary, grids)
        return primary, {key: grid.finalise() for key, grid in grids.items()}


def collect_a31b(limit: int | None, workers: int) -> dict[str, PrimaryTiles]:
    """洪水 5 種を 1 次メッシュ単位に並列で焼く。"""
    grouped = a31b_files()
    primaries = sorted(grouped)[:limit] if limit else sorted(grouped)
    items = [(primary, grouped[primary]) for primary in primaries]
    print(f"A31b: {len(items)} 次メッシュ / {sum(len(paths) for _, paths in items)} ファイル（並列 {workers}）", flush=True)
    # 大きいメッシュから流すと、最後に 1 枚だけ残って待つ形になりにくい。
    items.sort(key=lambda item: -sum(path.stat().st_size for path in item[1]))
    collected: dict[str, PrimaryTiles] = {key: {} for key in ALL_LAYERS}
    with ProcessPoolExecutor(max_workers=workers) as executor:
        for done, (_, tiles) in enumerate(executor.map(a31b_primary_tiles, items), start=1):
            for key, per_primary in tiles.items():
                collected[key].update(per_primary)
            if done % 10 == 0 or done == len(items):
                print(f"    A31b {done}/{len(items)}", flush=True)
    return collected


def collect_a51(limit: int | None, unknown: set[str]) -> PrimaryTiles:
    """内水を都道府県ごとに焼く。**県境をまたぐ 1 次メッシュがある**ので、
    サブセルの真偽を全県ぶん OR してから最後に一度だけ被覆率へ落とす。"""
    files = sorted(RAW_DIR.glob("A51-25_*_GML.zip"))[:limit]
    print(f"A51: {len(files)} 都道府県", flush=True)
    grid = LayerGrid()
    with deferred_gc():
        for path in files:
            process_a51(path, grid, unknown)
    return grid.finalise()


def collect_g04d(limit: int | None) -> tuple[Terrain, int]:
    """標高はポリゴンではなくメッシュコードで来るので、ラスタ化せず添字で置く。"""
    files = sorted(RAW_DIR.glob("G04-d-11_*-jgd_GML.zip"))[:limit]
    print(f"G04-d: {len(files)} 次メッシュ", flush=True)
    terrain = Terrain({}, {}, {})
    clamped = 0
    with deferred_gc():
        for index, path in enumerate(files, start=1):
            clamped += process_g04d(path, terrain.mean_dm, terrain.min_dm, terrain.below)
            if index % 20 == 0 or index == len(files):
                print(f"    G04-d {index}/{len(files)}", flush=True)
    return terrain, clamped


def report_layer(layer: str, tiles: PrimaryTiles, written: list[str], total_bytes: int) -> None:
    """該当セル数と、その内訳（全域 ／ 面積換算）を出す。**混在セルの多さが一目で分かる**。"""
    touched = sum(int((largest > 0).sum()) for largest, _ in tiles.values())
    whole = sum(int((coverage == COVERAGE_STEPS).sum()) for _, coverage in tiles.values())
    area = sum(float(coverage.sum()) for _, coverage in tiles.values()) / COVERAGE_STEPS
    mixed = 100 * (touched - whole) / max(touched, 1)
    print(
        f"  {layer:20s} {len(written):3d} メッシュ / かかるセル {touched:9,}"
        f"（うち全域 {whole:9,} ／ 面積換算 {area:11,.0f} ／ 混在 {mixed:4.1f}%）/ {total_bytes / 1e6:6.1f} MB"
    )


def main(argv: list[str]) -> int:
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    workers = int(argv[argv.index("--workers") + 1]) if "--workers" in argv else default_workers()
    unknown: set[str] = set()
    grids = collect_a31b(limit, workers)
    grids[NAISUI_LAYER] = collect_a51(limit, unknown)
    terrain, clamped = collect_g04d(limit)

    if unknown:
        print(f"⚠ 読めなかった浸水深の表記 {len(unknown)} 種: {sorted(unknown)[:5]}")
    if clamped:
        print(f"⚠ int16 に収まらず丸めた標高セル: {clamped:,}（±3,276.7m 超）")

    layer_primaries: dict[str, list[str]] = {}
    bytes_by_layer: dict[str, int] = {}
    for layer in ALL_LAYERS:
        written, total = write_layer_tiles(layer, grids[layer])
        layer_primaries[layer] = written
        bytes_by_layer[layer] = total
        report_layer(layer, grids[layer], written, total)

    elevation_written, elevation_bytes = write_elevation_tiles(terrain.mean_dm)
    print(f"  {'elevation':20s} {len(elevation_written):3d} メッシュ / {elevation_bytes / 1e6:6.1f} MB")

    source_note = (
        "国土数値情報 洪水浸水想定区域（1次メッシュ単位・A31b・2025年度）／"
        "雨水出水（内水）浸水想定区域（A51・2025年度）／標高・傾斜度5次メッシュ（G04-d・2011年度）"
    )
    index = build_index(layer_primaries, elevation_written, bytes_by_layer, source_note)
    (PUBLIC_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    rows = write_csv(grids, terrain)
    total_mb = (sum(bytes_by_layer.values()) + elevation_bytes) / 1e6
    print(f"✓ {PUBLIC_DIR.relative_to(ROOT)} — 合計 {total_mb:.1f} MB（gzip 済み）")
    print(f"✓ {CSV_OUT.relative_to(ROOT)} — {rows:,} 行（ハザードに該当したセルのみ）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
