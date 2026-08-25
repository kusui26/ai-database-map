"""水害ハザードを 250m メッシュへ落とす（Phase 1b・`docs/260824_flood.md` §8.2）。

`data/hazard_raw/`（`fetch_hazard_mesh.py` が取得）から、

1. **A31b** 洪水 5 種（計画規模・想定最大規模・浸水継続時間・家屋倒壊 2 種）
2. **A51** 内水（雨水出水）
3. **G04-d** 標高（平均・最低・海面下フラグ）

を 1 次メッシュごとの **320 × 320 の 250m 格子**へ落とし、次を書き出す。

| 成果物 | 中身 |
|---|---|
| `public/hazard/{layer}/{primary}.bin.gz` | 判定用。1 セル 4 ビット・51,200 バイトを gzip |
| `public/hazard/terrain/elev/{primary}.bin.gz` | 平均標高（int16 リトルエンディアン・デシメートル）|
| `public/hazard/index.json` | どの 1 次メッシュにどのレイヤがあるか＋生成の記録 |
| `data/derived/hazard_mesh.csv` | 解析用。**ハザードに該当したセルだけ**（標高を添えて）|
| `data/derived/hazard_touching/…` | 比較用。重なり判定版のタイル（gitignore）|

## 設計の要点

- **投影しない。** 面積を測らないので正積投影が要らず、原典（EPSG:6668）のまま
  緯度経度の格子にラスタ化する。プランは Albers を挙げていたが、それは面積按分の話
  （`docs/260824_flood.md` §5.8 に記録）。再投影の誤差もゼロになる。
- **配布するのは「セルの代表点（中心）が区域に入るか」。** 当初は「少しでも重なれば該当」
  （`all_touched`）を安全側として選んだが、実測で棄却した——**それだと台地や尾根の上まで
  「浸水想定区域内」になり**（細い谷の浸水域が 250m セルを掠めるため）、
  人口メッシュの 26.1% → 42.5% に膨らむ。アプリは**公式タイルを地図に描く**ので、
  「地図は白いのにカードは浸水域」という矛盾が起きるのが致命的だった。
  代表点判定は**公式タイルと 99.8% 一致**する（`validate_hazard_mesh.py --tiles`）。
  取りこぼし（セルの端だけが浸水域）は、Phase 2 で**隣接セルも見る**ことで補う——
  セルを塗り潰すより「隣が危ない」と言えるほうが役に立つ。
  比較のため、**重なり判定版も同時に作って** `data/derived/hazard_touching/` に残す。
- **セルに複数のランクが載ったら最大を採る**（安全側）。ランク昇順に焼けば後勝ちで
  最大が残り、ファイルをまたぐ合成は `np.maximum` で行う。
- **格納するのは原典のコード値**（浸水深 1–6・継続時間 1–7・危険区域区分 1–2）。
  カタログの `ranks[].sourceCode` が意味（ラベル・危険度）への橋渡しになる。
  A51 は詳細版（8 階級）の文字列で来るが、**6 階級へ粗くして格納する**——
  細かい方に合わせると A31b 側に無い精度を捏造することになるため。

    python3 pipeline/build_hazard_mesh.py            # 全部作る
    python3 pipeline/build_hazard_mesh.py --limit 5  # 先頭 5 次メッシュだけ（動作確認用）
"""

from __future__ import annotations

import gzip
import json
import re
import sys
import warnings
import zipfile
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
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
    TILE_BYTES,
    cell_of_mesh_code,
    mesh_code_of_cell,
    pack_nibbles,
    primaries_covering,
    primary_bounds,
)

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "hazard_raw"
DERIVED_DIR = ROOT / "data" / "derived"
CSV_OUT = DERIVED_DIR / "hazard_mesh.csv"
TOUCHING_DIR = DERIVED_DIR / "hazard_touching"
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

# A31b の並列度。1 枚 200MB 級のメッシュがあるのでメモリに余裕を持たせる。
DEFAULT_WORKERS = 6


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


# --- ラスタ化 -------------------------------------------------------------


def rasterize_into(geometries: list, codes: list[int], primary: str, all_touched: bool) -> np.ndarray:
    """ポリゴンを 1 次メッシュの 320×320 格子へ焼く（row 0 ＝ 南端）。"""
    shapes = [(geometry, code) for geometry, code in zip(geometries, codes) if code > 0]
    if not shapes:
        return np.zeros((CELLS_PER_PRIMARY, CELLS_PER_PRIMARY), dtype=np.uint8)
    west, _, _, north = primary_bounds(primary)
    burned = rasterize(
        # ランク昇順に焼くと、重なったセルには後勝ちで**最大**が残る（安全側）。
        sorted(shapes, key=lambda pair: pair[1]),
        out_shape=(CELLS_PER_PRIMARY, CELLS_PER_PRIMARY),
        transform=from_origin(west, north, CELL_LON_DEG, CELL_LAT_DEG),
        fill=0,
        all_touched=all_touched,
        dtype="uint8",
    )
    # rasterio は row 0 ＝ 北端。こちらの規約（row 0 ＝ 南端）へ上下反転する。
    return np.flipud(burned)


def merge_max(store: dict[str, np.ndarray], primary: str, tile: np.ndarray) -> None:
    if not tile.any():
        return
    current = store.get(primary)
    store[primary] = tile if current is None else np.maximum(current, tile)


def burn_both(
    geometries: list,
    codes: list[int],
    primary: str,
    representative: dict[str, np.ndarray],
    touching: dict[str, np.ndarray],
) -> None:
    """配布用（代表点が入れば該当）と比較用（少しでも重なれば該当）を同時に焼く。"""
    merge_max(representative, primary, rasterize_into(geometries, codes, primary, False))
    merge_max(touching, primary, rasterize_into(geometries, codes, primary, True))


# --- A31b（洪水 5 種・1 次メッシュ単位） ----------------------------------


def shapefiles_in(zip_path: Path, prefix: str = "") -> list[str]:
    """zip 内の .shp を列挙する（区切りを / に正規化。Windows 製 zip 対策）。"""
    with zipfile.ZipFile(zip_path) as archive:
        names = [name.replace("\\", "/") for name in archive.namelist()]
    return [name for name in names if name.endswith(".shp") and name.startswith(prefix)]


def process_a31b(
    zip_path: Path,
    primary: str,
    representative: dict[str, dict[str, np.ndarray]],
    touching: dict[str, dict[str, np.ndarray]],
) -> None:
    for layer in A31B_LAYERS:
        inner = shapefiles_in(zip_path, layer.directory_prefix)
        if not inner:
            continue
        frame = gpd.read_file(f"zip://{zip_path}!{inner[0]}")
        if len(frame) == 0 or layer.code_column not in frame.columns:
            continue
        codes = frame[layer.code_column].fillna(0).astype(int).tolist()
        burn_both(frame.geometry.tolist(), codes, primary, representative[layer.key], touching[layer.key])


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


def process_a51(
    zip_path: Path, representative: dict[str, np.ndarray], touching: dict[str, np.ndarray], unknown: set[str]
) -> None:
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
            burn_both(geometries, codes, primary, representative, touching)


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


def write_layer_tiles(base: Path, layer: str, tiles: dict[str, np.ndarray]) -> tuple[list[str], int]:
    written, total = [], 0
    for primary, tile in sorted(tiles.items()):
        total += write_gzip(base / layer / f"{primary}.bin.gz", pack_nibbles(tile))
        written.append(primary)
    return written, total


def write_elevation_tiles(tiles: dict[str, np.ndarray]) -> tuple[list[str], int]:
    written, total = [], 0
    for primary, tile in sorted(tiles.items()):
        total += write_gzip(PUBLIC_DIR / "terrain" / "elev" / f"{primary}.bin.gz", tile.astype("<i2").tobytes())
        written.append(primary)
    return written, total


def csv_rows_for_primary(
    primary: str,
    representative: dict[str, dict[str, np.ndarray]],
    mean_dm: dict[str, np.ndarray],
    min_dm: dict[str, np.ndarray],
    below: dict[str, np.ndarray],
) -> list[str]:
    """1 次メッシュぶんの CSV 行（**ハザードに該当したセルだけ**）。"""
    zeros = np.zeros((CELLS_PER_PRIMARY, CELLS_PER_PRIMARY), dtype=np.uint8)
    stack = np.stack([representative[key].get(primary, zeros) for key in ALL_LAYERS])
    rows, cols = np.nonzero(stack.any(axis=0))
    if rows.size == 0:
        return []
    elevation = mean_dm.get(primary)
    lowest = min_dm.get(primary)
    sea = below.get(primary)
    lines = []
    for row, col in zip(rows.tolist(), cols.tolist()):
        values = [str(int(stack[index, row, col])) for index in range(len(ALL_LAYERS))]
        mean_value = int(elevation[row, col]) if elevation is not None else ELEVATION_MISSING_DM
        low_value = int(lowest[row, col]) if lowest is not None else ELEVATION_MISSING_DM
        lines.append(
            ",".join(
                [
                    mesh_code_of_cell(primary, row, col),
                    *values,
                    "" if mean_value == ELEVATION_MISSING_DM else f"{mean_value / ELEVATION_SCALE_DM:.1f}",
                    "" if low_value == ELEVATION_MISSING_DM else f"{low_value / ELEVATION_SCALE_DM:.1f}",
                    str(int(sea[row, col])) if sea is not None else "0",
                ]
            )
        )
    return lines


def write_csv(
    representative: dict[str, dict[str, np.ndarray]],
    mean_dm: dict[str, np.ndarray],
    min_dm: dict[str, np.ndarray],
    below: dict[str, np.ndarray],
) -> int:
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    primaries = sorted({primary for layer in representative.values() for primary in layer})
    count = 0
    with open(CSV_OUT, "w", encoding="utf-8") as handle:
        handle.write(",".join(["mesh_code", *ALL_LAYERS, "elev_mean_m", "elev_min_m", "below_sea_level"]) + "\n")
        for primary in primaries:
            lines = csv_rows_for_primary(primary, representative, mean_dm, min_dm, below)
            if lines:
                handle.write("\n".join(lines) + "\n")
            count += len(lines)
    return count


def build_index(
    layer_primaries: dict[str, list[str]],
    elevation_primaries: list[str],
    bytes_by_layer: dict[str, int],
    source_note: str,
) -> dict[str, object]:
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "generatedFrom": "pipeline/build_hazard_mesh.py",
        "sourceJa": source_note,
        "cellsPerPrimary": CELLS_PER_PRIMARY,
        "tileBytes": TILE_BYTES,
        "encodingJa": (
            "1 セル 4 ビット（バイトの上位ニブルが偶数番目のセル）・row 0 は南端・col 0 は西端・"
            "行優先（row * 320 + col）・値は国土数値情報のコード値・0 は該当なし。ファイルは gzip"
        ),
        "matchJa": (
            "250m セルの**代表点（中心）**が区域に入るかで判定。地図に描く公式タイルの表示と一致する"
            "（無作為 800 セルで 99.8%）。セルの端だけが区域にかかる場合は取りこぼすので、"
            "利用側は隣接セルも見て補う"
        ),
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


def a31b_primary_tiles(item: tuple[str, list[Path]]) -> tuple[str, dict[str, np.ndarray], dict[str, np.ndarray]]:
    """1 次メッシュ 1 枚ぶんを焼く（プロセスプールの 1 単位）。

    A31b はファイルが 1 次メッシュ単位なので、**メッシュどうしは完全に独立**に処理できる。
    ここだけ並列にすれば全体が数倍速くなり、合成の順序にも依存しない。
    """
    primary, paths = item
    representative: dict[str, dict[str, np.ndarray]] = {key: {} for key in ALL_LAYERS}
    touching: dict[str, dict[str, np.ndarray]] = {key: {} for key in ALL_LAYERS}
    for path in paths:
        process_a31b(path, primary, representative, touching)
    take = lambda store: {key: tiles[primary] for key, tiles in store.items() if primary in tiles}  # noqa: E731
    return primary, take(representative), take(touching)


def collect(limit: int | None, workers: int) -> tuple[dict, dict, dict, dict, dict, set[str], int]:
    """原典を読み、レイヤごと・1 次メッシュごとの格子を組み立てる。"""
    representative: dict[str, dict[str, np.ndarray]] = {key: {} for key in ALL_LAYERS}
    touching: dict[str, dict[str, np.ndarray]] = {key: {} for key in ALL_LAYERS}
    mean_dm: dict[str, np.ndarray] = {}
    min_dm: dict[str, np.ndarray] = {}
    below: dict[str, np.ndarray] = {}
    unknown: set[str] = set()

    grouped = a31b_files()
    primaries = sorted(grouped)[:limit] if limit else sorted(grouped)
    items = [(primary, grouped[primary]) for primary in primaries]
    print(f"A31b: {len(items)} 次メッシュ / {sum(len(paths) for _, paths in items)} ファイル（並列 {workers}）", flush=True)
    # 大きいメッシュから流すと、最後に 1 枚だけ残って待つ形になりにくい。
    items.sort(key=lambda item: -sum(path.stat().st_size for path in item[1]))
    done = 0
    with ProcessPoolExecutor(max_workers=workers) as executor:
        for primary, representative_tiles, touching_tiles in executor.map(a31b_primary_tiles, items):
            for key, tile in representative_tiles.items():
                merge_max(representative[key], primary, tile)
            for key, tile in touching_tiles.items():
                merge_max(touching[key], primary, tile)
            done += 1
            if done % 10 == 0 or done == len(items):
                print(f"    A31b {done}/{len(items)}", flush=True)

    naisui_files = sorted(RAW_DIR.glob("A51-25_*_GML.zip"))[:limit]
    print(f"A51: {len(naisui_files)} 都道府県", flush=True)
    for path in naisui_files:
        process_a51(path, representative[NAISUI_LAYER], touching[NAISUI_LAYER], unknown)

    elevation_files = sorted(RAW_DIR.glob("G04-d-11_*-jgd_GML.zip"))[:limit]
    print(f"G04-d: {len(elevation_files)} 次メッシュ", flush=True)
    clamped = 0
    for index, path in enumerate(elevation_files, start=1):
        clamped += process_g04d(path, mean_dm, min_dm, below)
        if index % 20 == 0 or index == len(elevation_files):
            print(f"    G04-d {index}/{len(elevation_files)}", flush=True)
    return representative, touching, mean_dm, min_dm, below, unknown, clamped


def main(argv: list[str]) -> int:
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    workers = int(argv[argv.index("--workers") + 1]) if "--workers" in argv else DEFAULT_WORKERS
    representative, touching, mean_dm, min_dm, below, unknown, clamped = collect(limit, workers)

    if unknown:
        print(f"⚠ 読めなかった浸水深の表記 {len(unknown)} 種: {sorted(unknown)[:5]}")
    if clamped:
        print(f"⚠ int16 に収まらず丸めた標高セル: {clamped:,}（±3,276.7m 超）")

    layer_primaries: dict[str, list[str]] = {}
    bytes_by_layer: dict[str, int] = {}
    for layer in ALL_LAYERS:
        written, total = write_layer_tiles(PUBLIC_DIR, layer, representative[layer])
        write_layer_tiles(TOUCHING_DIR, layer, touching[layer])  # 比較用（gitignore）
        layer_primaries[layer] = written
        bytes_by_layer[layer] = total
        cells = sum(int((tile > 0).sum()) for tile in representative[layer].values())
        cells_touching = sum(int((tile > 0).sum()) for tile in touching[layer].values())
        print(
            f"  {layer:20s} {len(written):3d} メッシュ / 該当セル {cells:9,}"
            f"（重なり判定なら {cells_touching:9,}）/ {total / 1e6:6.1f} MB"
        )

    elevation_written, elevation_bytes = write_elevation_tiles(mean_dm)
    print(f"  {'elevation':20s} {len(elevation_written):3d} メッシュ / {elevation_bytes / 1e6:6.1f} MB")

    source_note = (
        "国土数値情報 洪水浸水想定区域（1次メッシュ単位・A31b・2025年度）／"
        "雨水出水（内水）浸水想定区域（A51・2025年度）／標高・傾斜度5次メッシュ（G04-d・2011年度）"
    )
    index = build_index(layer_primaries, elevation_written, bytes_by_layer, source_note)
    (PUBLIC_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    rows = write_csv(representative, mean_dm, min_dm, below)
    total_mb = (sum(bytes_by_layer.values()) + elevation_bytes) / 1e6
    print(f"✓ {PUBLIC_DIR.relative_to(ROOT)} — 合計 {total_mb:.1f} MB（gzip 済み）")
    print(f"✓ {CSV_OUT.relative_to(ROOT)} — {rows:,} 行（ハザードに該当したセルのみ）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
