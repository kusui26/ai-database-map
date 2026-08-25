"""250m メッシュ・ハザードの検証（Phase 1b／PR-1・`docs/260824_flood.md` §10.2）。

**「動いた」ではなく「合っている」**を確かめる。独立した 4 つの物差しに当てる。

1. **アーティファクトの自己整合** — バイト数・索引の整合・値域・往復・不変条件。
2. **§4 の外部サンプリングの再現** — 2020 年国勢調査の 250m メッシュ（人口 > 0）を母集団に、
   「洪水浸水想定区域（想定最大規模）に入るメッシュ／人口の割合」を**全数**で出す。
   §4 は同じ母集団を**メッシュの代表点**で判定して 28.7% / 45.8% を得た。代表点判定は
   面積の**不偏推定**なので、比べる相手は**被覆率加重**（＝面積・人口の期待値）である。
   最大ランクは**上界**なので必ず大きく出る。両方を並べる。
3. **乱点での不変条件**（`--points`）— ここが本丸。セル内に**一様乱点**を打ち、公式タイルの
   画素から真値を読んで、**真値 ≤ 最大ランク**（区間が真値を含む）と**被覆率 0 ⇒ 区域外**を
   確かめる。**セルの中心で照合しても意味がない**——配布メッシュもタイルも同じ点を見るので、
   同じ問いを二度聞くことになる（v1 の「99.8% 一致」はこれだった。§5.8 の訂正）。
4. **中心での照合**（`--centres`）— 3 の代わりにはならないが、**ジオメトリ・添字・上下反転**の
   検査としては有効なので、目的を明記して残す。

    python3 pipeline/validate_hazard_mesh.py                 # 1 と 2（ネットワーク不要）
    python3 pipeline/validate_hazard_mesh.py --points 400    # 3 も実行（400 セル × 25 点）
    python3 pipeline/validate_hazard_mesh.py --centres 800   # 4 も実行
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
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mesh_grid import (  # noqa: E402
    CELL_LAT_DEG,
    CELL_LON_DEG,
    CELLS_PER_PRIMARY,
    COVERAGE_STEPS,
    MESH_FORMAT_VERSION,
    SUBCELLS_PER_CELL,
    TILE_BYTES,
    cell_of_mesh_code,
    primary_bounds,
    unpack_cells,
)

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public" / "hazard"
CATALOG = ROOT / "src" / "shared" / "hazard" / "hazard-catalog.json"
CENSUS_DIR = ROOT / "data" / "国勢調査_人口及び世帯_2020_mesh250"

# §4 の実測（`docs/260824_flood.md` §4.2）。メッシュ代表点での判定・n=1,200 の標本。
REFERENCE_MESH_PCT, REFERENCE_MESH_CI = 28.7, 2.6
REFERENCE_POP_PCT, REFERENCE_POP_CI = 45.8, 6.8
# 2020 年国勢調査の公表総人口（母集団の検算）。
CENSUS_TOTAL_POPULATION = 126_146_099

FLOOD_L2 = "flood_l2"
TILE_URL = "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png"
TILE_ZOOM = 14
TILE_PIXELS = 256
USER_AGENT = "Mozilla/5.0 (AI Database Map / hazard mesh validation)"
# 乱点の既定本数と乱数の種（何度実行しても同じ標本になるように固定する）。
POINTS_PER_CELL = 25
SAMPLE_SEED = 20260825

# 「周囲 9×9 セルにも区域が無いのに公式タイルは塗られている」＝ 原典どうしの差と見なす窓。
# ここまで見て何も無ければ、境界のズレでは説明できない（実測：違反 4 セルすべてが該当し、
# A31b の原典にも半径 2km 以内に図形が 1 つも無かった）。
ISOLATION_WINDOW = 4
# 原典の欠落を許す上限（区域外セルに対する割合）。実測 1.7%。**増えたら原典を疑う**。
SOURCE_GAP_CEILING_PCT = 5.0


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


def load_tiles(layer: str) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """`{primary: (最大ランク, 被覆率)}` を読み込む（gzip を解いて 1 バイトを分解）。"""
    return {
        path.name.removesuffix(".bin.gz"): unpack_cells(gzip.decompress(path.read_bytes()))
        for path in sorted((PUBLIC_DIR / layer).glob("*.bin.gz"))
    }


# --- ① アーティファクトの自己整合 -----------------------------------------


def check_index(index: dict) -> list[str]:
    """索引が読み手の規約と一致しているか。"""
    expected = {
        "version": MESH_FORMAT_VERSION,
        "tileBytes": TILE_BYTES,
        "cellsPerPrimary": CELLS_PER_PRIMARY,
        "coverageSteps": COVERAGE_STEPS,
        "subcellsPerCell": SUBCELLS_PER_CELL,
    }
    return [f"index.{key} が {value} でない（{index.get(key)}）" for key, value in expected.items() if index.get(key) != value]


def check_tile(layer: str, primary: str, largest: np.ndarray, coverage: np.ndarray) -> list[str]:
    """1 枚ぶんの値域と不変条件。"""
    failures = []
    if largest.max(initial=0) > COVERAGE_STEPS or coverage.max(initial=0) > COVERAGE_STEPS:
        failures.append(f"{layer}/{primary}: ニブルに入らない値")
    if np.any((largest > 0) != (coverage > 0)):
        failures.append(f"{layer}/{primary}: 不変条件（最大 > 0 ⟺ 被覆率 > 0）が破れている")
    if not largest.any():
        failures.append(f"{layer}/{primary}: 全セル 0（空のタイルは配らない）")
    return failures


def check_artifacts(index: dict) -> list[str]:
    """索引と実体の一致＋抜き取りでタイルの中身。"""
    failures = check_index(index)
    for layer, meta in index["layers"].items():
        listed = set(meta["primaries"])
        on_disk = {p.name.removesuffix(".bin.gz") for p in (PUBLIC_DIR / layer).glob("*.bin.gz")}
        if listed != on_disk:
            failures.append(f"{layer}: 索引 {len(listed)} 枚 と 実体 {len(on_disk)} 枚 が不一致")
        for primary in sorted(listed)[:5]:  # 抜き取りで中身を検査
            payload = gzip.decompress((PUBLIC_DIR / layer / f"{primary}.bin.gz").read_bytes())
            failures += check_tile(layer, primary, *unpack_cells(payload))
    for primary in sorted(index["elevation"]["primaries"])[:5]:
        raw = gzip.decompress((PUBLIC_DIR / "terrain" / "elev" / f"{primary}.bin.gz").read_bytes())
        if len(raw) != CELLS_PER_PRIMARY * CELLS_PER_PRIMARY * 2:
            failures.append(f"標高 {primary}: バイト数が {len(raw)}")
    return failures


# --- ② §4 の再現 -----------------------------------------------------------


def exposure(meshes: list[tuple[str, int]], tiles: dict, weighted: bool) -> tuple[float, float]:
    """(該当メッシュ %, 該当人口 %)。`weighted` なら被覆率で按分（＝面積の期待値）。"""
    hit_meshes = hit_population = total_population = 0.0
    for code, population in meshes:
        total_population += population
        primary, row, col = cell_of_mesh_code(code)
        planes = tiles.get(primary)
        if planes is None or planes[0][row, col] == 0:
            continue
        share = float(planes[1][row, col]) / COVERAGE_STEPS if weighted else 1.0
        hit_meshes += share
        hit_population += population * share
    return 100 * hit_meshes / max(len(meshes), 1), 100 * hit_population / max(total_population, 1)


def check_reference(mesh_pct: float, pop_pct: float) -> list[str]:
    """§4 の実測（標本）の信頼区間に、全数の結果が収まっているか。"""
    failures = []
    if abs(mesh_pct - REFERENCE_MESH_PCT) > REFERENCE_MESH_CI:
        failures.append(f"メッシュ % が §4 の {REFERENCE_MESH_PCT}%±{REFERENCE_MESH_CI}pt の外（{mesh_pct:.2f}%）")
    if abs(pop_pct - REFERENCE_POP_PCT) > REFERENCE_POP_CI:
        failures.append(f"人口 % が §4 の {REFERENCE_POP_PCT}%±{REFERENCE_POP_CI}pt の外（{pop_pct:.2f}%）")
    return failures


# --- 公式タイルの画素 → 原典コード -----------------------------------------


def source_palette(layer: str) -> dict[tuple[int, int, int], int]:
    """カタログから {RGB: 原典コード} を作る。**色の定義はカタログが唯一の正**。"""
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    ranks = next(entry for entry in catalog["layers"] if entry["key"] == layer)["ranks"]
    return {
        (int(rank["color"][1:3], 16), int(rank["color"][3:5], 16), int(rank["color"][5:7], 16)): rank["sourceCode"]
        for rank in ranks
    }


def tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int, int, int]:
    scale = 2**zoom * TILE_PIXELS
    x = (lon + 180.0) / 360.0 * scale
    sin = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * scale
    return int(x // TILE_PIXELS), int(y // TILE_PIXELS), int(x % TILE_PIXELS), int(y % TILE_PIXELS)


@dataclass
class OfficialTiles:
    """公式タイルの画素を引く（1 枚は 1 度だけ取得する）。404 ＝ その区画にデータ無し。"""

    palette: dict[tuple[int, int, int], int]
    images: dict[tuple[int, int], object] = field(default_factory=dict)
    fetched: int = 0
    approximated: int = 0

    def code_at(self, lon: float, lat: float) -> int:
        """その緯度経度の**原典コード値**（0 ＝ 塗られていない）。"""
        tx, ty, px, py = tile_xy(lon, lat, TILE_ZOOM)
        if (tx, ty) not in self.images:
            self.images[(tx, ty)] = self._fetch(tx, ty)
            self.fetched += 1
        image = self.images[(tx, ty)]
        if image is None:
            return 0
        red, green, blue, alpha = image.getpixel((px, py))  # type: ignore[union-attr]
        if alpha == 0:
            return 0
        exact = self.palette.get((red, green, blue))
        if exact is not None:
            return exact
        self.approximated += 1  # 境界の中間色。最も近い階級に寄せる
        return min(self.palette.items(), key=lambda item: sum((a - b) ** 2 for a, b in zip(item[0], (red, green, blue))))[1]

    def _fetch(self, x: int, y: int):  # noqa: ANN202 — PIL の型は遅延 import のため書けない
        from PIL import Image

        url = TILE_URL.format(z=TILE_ZOOM, x=x, y=y)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return Image.open(io.BytesIO(response.read())).convert("RGBA")
        except Exception:  # noqa: BLE001 — 404（データが無い区画）は正常なので None を返す
            return None


# --- ③ 乱点での不変条件 ----------------------------------------------------


@dataclass
class Probe:
    """乱点の集計。**誤答の数**が主で、一致率は副次的な指標にすぎない。

    区間から外れた点は**原因で 2 つに分ける**。混ぜると、直せる欠陥が原典の差に埋もれる。

    - `edge_violations` … 隣（9×9）に区域があるのに外した ＝ **こちらの焼き方の欠陥**。0 でなければならない
    - `gap_violations` … 周囲 9×9 にも区域が無いのに公式タイルは塗られている ＝ **原典どうしの差**
    """

    points: int = 0
    contained: int = 0  # 真値 ≤ 最大ランク（区間が真値を含む）
    class_exact: int = 0  # 真値 == 最大ランク
    binary_exact: int = 0  # 区域内／外の二値が一致
    edge_violations: list[str] = field(default_factory=list)
    gap_violations: list[str] = field(default_factory=list)
    inside_violations: list[str] = field(default_factory=list)  # 被覆率 15 なのに白かった
    outside_cells: int = 0  # 被覆率 0 のセル数（原典欠落の割合の分母）
    gap_cells: int = 0
    coverage_error: list[float] = field(default_factory=list)  # |実測の被覆率 − 格納値|

    def record(self, truth: int, largest: int, coverage: int, isolated: bool, where: str) -> None:
        """1 点ぶん。**区間が真値を含むか**が主で、一致・不一致は参考。"""
        self.points += 1
        self.contained += int(truth <= largest)
        self.class_exact += int(truth == largest)
        self.binary_exact += int((truth > 0) == (largest > 0))
        if truth > largest:
            bucket = self.gap_violations if isolated and largest == 0 else self.edge_violations
            bucket.append(where)
        if coverage == COVERAGE_STEPS and truth == 0:
            self.inside_violations.append(where)


def sample_cells(meshes: list[tuple[str, int]], tiles: dict, size: int) -> tuple[list[tuple[str, int, int]], int]:
    """人口メッシュ（＝人がいる場所）から一様に抽出する。戻り値は (標本, タイルが無くて捨てた数)。

    タイルが無い 1 次メッシュは「80km 四方に浸水想定区域が 1 つも無い」区画なので、
    答えは自明に「区域外」。混ぜても薄まるだけなので除き、**除いた数を報告する**。
    """
    rng = random.Random(SAMPLE_SEED)
    seen: set[int] = set()
    picked: list[tuple[str, int, int]] = []
    while len(picked) < size and len(seen) < len(meshes):
        index = rng.randrange(len(meshes))
        if index in seen:
            continue
        seen.add(index)
        cell = cell_of_mesh_code(meshes[index][0])
        if cell[0] in tiles:
            picked.append(cell)
    return picked, len(seen) - len(picked)


def neighbourhood_max(plane: np.ndarray, row: int, col: int) -> int:
    """そのセルを中心とする 9×9 の最大ランク（境界のズレか原典の欠落かを分ける材料）。"""
    window = plane[
        max(0, row - ISOLATION_WINDOW) : row + ISOLATION_WINDOW + 1,
        max(0, col - ISOLATION_WINDOW) : col + ISOLATION_WINDOW + 1,
    ]
    return int(window.max(initial=0))


def probe_cell(official: OfficialTiles, probe: Probe, cell: tuple[str, int, int], planes: tuple) -> None:
    """1 セルに一様乱点を打ち、区間が真値を含むかを数える。"""
    primary, row, col = cell
    largest, coverage = int(planes[0][row, col]), int(planes[1][row, col])
    isolated = neighbourhood_max(planes[0], row, col) == 0
    probe.outside_cells += int(coverage == 0)
    west, south, _, _ = primary_bounds(primary)
    rng = random.Random(f"{SAMPLE_SEED}:{primary}:{row}:{col}")
    hits = 0
    for _ in range(POINTS_PER_CELL):
        lon = west + (col + rng.random()) * CELL_LON_DEG
        lat = south + (row + rng.random()) * CELL_LAT_DEG
        truth = official.code_at(lon, lat)
        hits += int(truth > 0)
        where = f"{primary} r{row} c{col} ({lat:.5f},{lon:.5f}) 真値 {truth} / 最大 {largest} / 被覆率 {coverage}"
        probe.record(truth, largest, coverage, isolated, where)
    probe.gap_cells += int(isolated and coverage == 0 and hits > 0)
    probe.coverage_error.append(abs(hits / POINTS_PER_CELL - coverage / COVERAGE_STEPS))


def report_probe(probe: Probe) -> list[str]:
    """受け入れ基準は「区間が真値を含む」こと。一致率は参考として並べる。"""
    total = max(probe.points, 1)
    gap_points = len(probe.gap_violations)
    clean = 100 * (probe.contained + gap_points) / total  # 原典の欠落を除いた含有率
    print(f"  区間が真値を含む       {probe.contained:6,}/{probe.points:,} = {100 * probe.contained / total:6.2f}%")
    print(f"  同・原典の欠落を除く   {clean:6.2f}%  ← 受け入れ基準（100% でなければ焼き方の欠陥）")
    print(f"  （参考）最大 == 真値   {100 * probe.class_exact / total:6.2f}%")
    print(f"  （参考）二値が一致     {100 * probe.binary_exact / total:6.2f}%")
    print(f"  被覆率の実測との差     平均 {100 * float(np.mean(probe.coverage_error or [0])):.1f}pt")
    return check_violations(probe)


def check_violations(probe: Probe) -> list[str]:
    """3 つの破れ方を、原因別に見る。"""
    failures = []
    gap_pct = 100 * probe.gap_cells / max(probe.outside_cells, 1)
    print(f"  境界のズレで外した            {len(probe.edge_violations):5,} 点  ← 0 でなければならない")
    print(f"  原典の欠落（周囲 9×9 にも無い）{probe.gap_cells:5,}/{probe.outside_cells:,} セル = {gap_pct:.1f}%")
    print(f"  被覆率 15 なのに区域外だった   {len(probe.inside_violations):5,} 点")
    if probe.edge_violations:
        failures.append(f"境界のズレで {len(probe.edge_violations)} 点外した（例: {probe.edge_violations[0]}）")
    if probe.inside_violations:
        failures.append(f"「全域が区域」が {len(probe.inside_violations)} 点で外れた（例: {probe.inside_violations[0]}）")
    if gap_pct > SOURCE_GAP_CEILING_PCT:
        failures.append(f"原典の欠落が {gap_pct:.1f}%（上限 {SOURCE_GAP_CEILING_PCT}%）— 原典の取得漏れを疑う")
    for line in (probe.edge_violations + probe.gap_violations)[:10]:
        print(f"    ⚠ 含まれない点: {line}")
    return failures


def run_probe(meshes: list[tuple[str, int]], tiles: dict, size: int) -> list[str]:
    official, probe = OfficialTiles(source_palette(FLOOD_L2)), Probe()
    cells, skipped = sample_cells(meshes, tiles, size)
    touched = sum(1 for primary, row, col in cells if tiles[primary][0][row, col] > 0)
    print(f"  標本: {len(cells):,} セル × {POINTS_PER_CELL} 点（うち区域にかかるセル {touched:,}／"
          f"タイルの無い区画を {skipped:,} 件除外）")
    for index, cell in enumerate(cells, start=1):
        probe_cell(official, probe, cell, tiles[cell[0]])
        if index % 100 == 0 or index == len(cells):
            print(f"    {index}/{len(cells)}（公式タイル {official.fetched} 枚）", flush=True)
    print(f"  中間色で近い階級に寄せた画素: {official.approximated:,}")
    return report_probe(probe)


# --- ④ 中心での照合（ジオメトリ・添字の検査） ------------------------------


def compare_at_centres(tiles: dict, size: int) -> list[str]:
    """**同義反復に近いので正しさの証拠にはならない**。添字・上下反転の検査としてのみ使う。"""
    rng = random.Random(SAMPLE_SEED)
    official = OfficialTiles(source_palette(FLOOD_L2))
    primaries = sorted(tiles)
    agree = 0
    for _ in range(size):
        primary = rng.choice(primaries)
        row, col = rng.randrange(CELLS_PER_PRIMARY), rng.randrange(CELLS_PER_PRIMARY)
        west, south, _, _ = primary_bounds(primary)
        truth = official.code_at(west + (col + 0.5) * CELL_LON_DEG, south + (row + 0.5) * CELL_LAT_DEG)
        agree += int((truth > 0) == (tiles[primary][0][row, col] > 0))
    rate = 100 * agree / max(size, 1)
    print(f"  中心での二値一致: {agree:,}/{size:,} = {rate:.1f}%（添字・上下反転の検査）")
    return [] if rate >= 90 else [f"中心での一致率が 90% 未満（{rate:.1f}%）— 添字か上下反転が壊れている疑い"]


# --- 主処理 ---------------------------------------------------------------


def argument(argv: list[str], flag: str) -> int | None:
    return int(argv[argv.index(flag) + 1]) if flag in argv else None


def main(argv: list[str]) -> int:
    index = json.loads((PUBLIC_DIR / "index.json").read_text(encoding="utf-8"))
    failures: list[str] = []

    print("① アーティファクトの自己整合")
    failures += check_artifacts(index)
    print(f"  レイヤ {len(index['layers'])} 種 / 標高 {len(index['elevation']['primaries'])} メッシュ / v{index.get('version')}")

    print("② §4 の再現（2020 年国勢調査 250m メッシュ・全数）")
    meshes = read_census_meshes()
    total_population = sum(population for _, population in meshes)
    print(f"  母集団: {len(meshes):,} メッシュ / {total_population:,} 人")
    if total_population != CENSUS_TOTAL_POPULATION:
        failures.append(f"母集団の合計人口が公表値と違う（{total_population:,}）")

    tiles = load_tiles(FLOOD_L2)
    if not tiles:
        failures.append("配布タイルが無い（build_hazard_mesh.py を実行してください）")
        return report(failures)
    weighted = exposure(meshes, tiles, weighted=True)
    upper = exposure(meshes, tiles, weighted=False)
    print(f"  被覆率加重（面積の期待値） メッシュ {weighted[0]:5.2f}% ／ 人口 {weighted[1]:5.2f}%  ← §4 と比べる相手")
    print(f"  最大 > 0（上界・発災時）   メッシュ {upper[0]:5.2f}% ／ 人口 {upper[1]:5.2f}%")
    print(f"  §4 の標本: メッシュ {REFERENCE_MESH_PCT}%±{REFERENCE_MESH_CI}pt / 人口 {REFERENCE_POP_PCT}%±{REFERENCE_POP_CI}pt")
    failures += check_reference(*weighted)

    points = argument(argv, "--points")
    if points:
        print("③ 乱点での不変条件（公式タイルの画素を真値とする）")
        failures += run_probe(meshes, tiles, points)

    centres = argument(argv, "--centres")
    if centres:
        print("④ 中心での照合（同義反復に近い。添字・上下反転の検査）")
        failures += compare_at_centres(tiles, centres)

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
