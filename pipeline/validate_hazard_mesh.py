"""250m メッシュ・ハザードの全数検証（Phase 1b・`docs/260824_flood.md` §10.2）。

**「動いた」ではなく「合っている」**を確かめる。独立した 3 つの物差しに当てる。

1. **§4 の外部サンプリングの再現** — 2020 年国勢調査の 250m メッシュ（人口 > 0）を母集団に、
   自前メッシュで「洪水浸水想定区域（想定最大規模）に入るメッシュ／人口の割合」を**全数**で出す。
   §4 は同じ母集団を**メッシュの代表点**で判定して 28.7% / 45.8% を得ている。配布メッシュも同じ
   代表点判定なので、これが §4 の信頼区間に入れば、独立な 2 経路（公式タイルの画素 × 自前のベクタ処理）が一致したことになる。
2. **公式タイルとの画素照合** — 無作為なセルについて、自前の判定と重ねるハザードマップの
   タイル画素（塗られているか）を突き合わせる。
3. **アーティファクトの自己整合** — バイト数・索引の整合・ニブル詰めの往復・値域。

    python3 pipeline/validate_hazard_mesh.py              # 1 と 3（ネットワーク不要）
    python3 pipeline/validate_hazard_mesh.py --tiles 800  # 2 も実行（公式タイルへ 800 セル問い合わせ）
"""

from __future__ import annotations

import csv
import glob
import gzip
import io
import json
import math
import random
import sys
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_grid import (  # noqa: E402
    CELL_LAT_DEG,
    CELL_LON_DEG,
    CELLS_PER_PRIMARY,
    TILE_BYTES,
    cell_of_mesh_code,
    primary_bounds,
    unpack_nibbles,
)

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public" / "hazard"
TOUCHING_DIR = ROOT / "data" / "derived" / "hazard_touching"
CENSUS_DIR = ROOT / "data" / "国勢調査_人口及び世帯_2020_mesh250"

# §4 の実測（`docs/260824_flood.md` §4.2）。メッシュ代表点での判定・n=1,200 の標本。
REFERENCE_MESH_PCT, REFERENCE_MESH_CI = 28.7, 2.6
REFERENCE_POP_PCT, REFERENCE_POP_CI = 45.8, 6.8
# 2020 年国勢調査の公表総人口（母集団の検算）。
CENSUS_TOTAL_POPULATION = 126_146_099

FLOOD_L2 = "flood_l2"
TILE_URL = "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png"
TILE_ZOOM = 14
USER_AGENT = "Mozilla/5.0 (AI Database Map / hazard mesh validation)"


def read_census_meshes() -> list[tuple[str, int]]:
    """2020 年国勢調査 250m メッシュの (メッシュコード, 人口)。人口 > 0 のみ。"""
    rows: list[tuple[str, int]] = []
    for path in sorted(glob.glob(str(CENSUS_DIR / "mesh250_*.csv"))):
        with open(path, encoding="utf-8-sig", errors="replace") as handle:
            started, header = False, None
            for row in csv.reader(handle):
                if not row:
                    continue
                if row[0] == "VALUE":
                    started, header = True, None
                    continue
                if not started:
                    continue
                if header is None:
                    header = row
                    continue
                if len(row) < 8 or row[0] != "0010":  # 0010 ＝ 人口（総数）
                    continue
                try:
                    population = int(row[7])
                except ValueError:
                    continue
                if population > 0:
                    rows.append((row[4], population))
    return rows


def load_tiles(base: Path, layer: str) -> dict[str, np.ndarray]:
    """`{primary: 320×320 の uint8}` を読み込む（gzip を解いてニブルを展開）。"""
    tiles: dict[str, np.ndarray] = {}
    for path in sorted((base / layer).glob("*.bin.gz")):
        payload = gzip.decompress(path.read_bytes())
        tiles[path.name.removesuffix(".bin.gz")] = unpack_nibbles(payload)
    return tiles


def exposure(meshes: list[tuple[str, int]], tiles: dict[str, np.ndarray]) -> tuple[int, int, int, int]:
    """(該当メッシュ数, 全メッシュ数, 該当人口, 全人口)。"""
    hit_meshes = hit_population = total_population = 0
    for code, population in meshes:
        total_population += population
        primary, row, col = cell_of_mesh_code(code)
        tile = tiles.get(primary)
        if tile is None or tile[row, col] == 0:
            continue
        hit_meshes += 1
        hit_population += population
    return hit_meshes, len(meshes), hit_population, total_population


def report_exposure(label: str, result: tuple[int, int, int, int]) -> tuple[float, float]:
    hit, total, hit_pop, total_pop = result
    mesh_pct = 100 * hit / max(total, 1)
    pop_pct = 100 * hit_pop / max(total_pop, 1)
    print(f"  {label:16s} メッシュ {hit:9,}/{total:,} = {mesh_pct:5.2f}%  ／  人口 {hit_pop:12,} = {pop_pct:5.2f}%")
    return mesh_pct, pop_pct


def check_reference(mesh_pct: float, pop_pct: float) -> list[str]:
    """§4 の実測（標本）の信頼区間に、全数の結果が収まっているか。"""
    failures = []
    if abs(mesh_pct - REFERENCE_MESH_PCT) > REFERENCE_MESH_CI:
        failures.append(
            f"メッシュ % が §4 の {REFERENCE_MESH_PCT}%±{REFERENCE_MESH_CI}pt の外（{mesh_pct:.2f}%）"
        )
    if abs(pop_pct - REFERENCE_POP_PCT) > REFERENCE_POP_CI:
        failures.append(f"人口 % が §4 の {REFERENCE_POP_PCT}%±{REFERENCE_POP_CI}pt の外（{pop_pct:.2f}%）")
    return failures


def check_artifacts(index: dict) -> list[str]:
    """アーティファクトの自己整合（バイト数・索引・値域）。"""
    failures: list[str] = []
    if index["tileBytes"] != TILE_BYTES:
        failures.append(f"index.tileBytes が {TILE_BYTES} でない（{index['tileBytes']}）")
    if index["cellsPerPrimary"] != CELLS_PER_PRIMARY:
        failures.append(f"index.cellsPerPrimary が {CELLS_PER_PRIMARY} でない")
    for layer, meta in index["layers"].items():
        listed = set(meta["primaries"])
        on_disk = {p.name.removesuffix(".bin.gz") for p in (PUBLIC_DIR / layer).glob("*.bin.gz")}
        if listed != on_disk:
            failures.append(f"{layer}: 索引 {len(listed)} 枚 と 実体 {len(on_disk)} 枚 が不一致")
        for primary in sorted(listed)[:5]:  # 抜き取りで中身を検査
            tile = unpack_nibbles(gzip.decompress((PUBLIC_DIR / layer / f"{primary}.bin.gz").read_bytes()))
            if tile.max(initial=0) > 15:
                failures.append(f"{layer}/{primary}: ニブルに入らない値")
            if not tile.any():
                failures.append(f"{layer}/{primary}: 全セル 0（空のタイルは配らない）")
    elevation = index["elevation"]
    for primary in sorted(elevation["primaries"])[:5]:
        raw = gzip.decompress((PUBLIC_DIR / "terrain" / "elev" / f"{primary}.bin.gz").read_bytes())
        if len(raw) != CELLS_PER_PRIMARY * CELLS_PER_PRIMARY * 2:
            failures.append(f"標高 {primary}: バイト数が {len(raw)}")
    return failures


def tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int, int, int]:
    scale = 2**zoom * 256
    x = (lon + 180.0) / 360.0 * scale
    sin = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * scale
    return int(x // 256), int(y // 256), int(x % 256), int(y % 256)


def compare_with_official(tiles: dict[str, np.ndarray], sample_size: int) -> list[str]:
    """自前メッシュ（代表点判定）と公式タイルの画素を突き合わせる。"""
    from PIL import Image  # 遅延 import（この検査を使うときだけ要る）

    random.seed(20260825)
    primaries = sorted(tiles)
    cells = [
        (primary, random.randrange(CELLS_PER_PRIMARY), random.randrange(CELLS_PER_PRIMARY))
        for primary in random.choices(primaries, k=sample_size)
    ]
    images: dict[tuple[int, int], object] = {}
    agree = checked = 0
    for primary, row, col in cells:
        west, south, _, _ = primary_bounds(primary)
        lon = west + (col + 0.5) * CELL_LON_DEG
        lat = south + (row + 0.5) * CELL_LAT_DEG
        tx, ty, px, py = tile_xy(lon, lat, TILE_ZOOM)
        if (tx, ty) not in images:
            images[(tx, ty)] = fetch_tile(tx, ty)
        image = images[(tx, ty)]
        official = image is not None and image.getpixel((px, py))[3] > 0  # type: ignore[union-attr]
        ours = tiles[primary][row, col] > 0
        checked += 1
        agree += int(official == ours)
    rate = 100 * agree / max(checked, 1)
    print(f"  公式タイルとの一致率: {agree:,}/{checked:,} = {rate:.1f}%（無作為 {sample_size} セル・z{TILE_ZOOM}）")
    return [] if rate >= 95 else [f"公式タイルとの一致率が 95% 未満（{rate:.1f}%）"]


def fetch_tile(x: int, y: int):  # noqa: ANN201 — PIL の型は遅延 import のため書けない
    from PIL import Image

    url = TILE_URL.format(z=TILE_ZOOM, x=x, y=y)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return Image.open(io.BytesIO(response.read())).convert("RGBA")
    except Exception:  # noqa: BLE001 — 404（データが無い区画）は正常なので None を返す
        return None


def main(argv: list[str]) -> int:
    index = json.loads((PUBLIC_DIR / "index.json").read_text(encoding="utf-8"))
    failures: list[str] = []

    print("① アーティファクトの自己整合")
    failures += check_artifacts(index)
    print(f"  レイヤ {len(index['layers'])} 種 / 標高 {len(index['elevation']['primaries'])} メッシュ")

    print("② §4 の再現（2020 年国勢調査 250m メッシュ・全数）")
    meshes = read_census_meshes()
    total_population = sum(population for _, population in meshes)
    print(f"  母集団: {len(meshes):,} メッシュ / {total_population:,} 人")
    if total_population != CENSUS_TOTAL_POPULATION:
        failures.append(f"母集団の合計人口が公表値と違う（{total_population:,}）")

    tiles = load_tiles(PUBLIC_DIR, FLOOD_L2)
    if not tiles:
        failures.append("配布タイルが無い（build_hazard_mesh.py を実行してください）")
        return report(failures)
    mesh_pct, pop_pct = report_exposure("配布（代表点）", exposure(meshes, tiles))
    failures += check_reference(mesh_pct, pop_pct)
    print(f"  §4 の標本: メッシュ {REFERENCE_MESH_PCT}%±{REFERENCE_MESH_CI}pt / 人口 {REFERENCE_POP_PCT}%±{REFERENCE_POP_CI}pt")
    touching_tiles = load_tiles(TOUCHING_DIR, FLOOD_L2)
    if touching_tiles:
        report_exposure("（参考）重なり判定", exposure(meshes, touching_tiles))

    if "--tiles" in argv:
        print("③ 公式タイルとの画素照合")
        sample_size = int(argv[argv.index("--tiles") + 1])
        failures += compare_with_official(tiles, sample_size)

    return report(failures)


def report(failures: list[str]) -> int:
    print()
    if failures:
        print(f"✗ FAIL {len(failures)} 件")
        for line in failures:
            print("   -", line)
        return 1
    print("✓ すべて PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
