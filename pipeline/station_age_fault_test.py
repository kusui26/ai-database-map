"""わざと壊すと落ちることを、本物のデータで確かめる（2026-11-24・人口の年齢 PR-1・計画書 §9）。

全国から選んだ一部の駅で、作り方を 1 か所ずつ壊して作る。壊し方ごとに 2 回作る：

1. そのまま：組み立ての照合（`build_station_age.check_totals` など）か、`validate_station_age.py` のどこかで落ちる
2. 組み立ての照合を外して書き出させる：それでも `validate_station_age.py` だけで落ちる（作る途中の確かめで止まるものは止まる）

壊さない作り方は、組み立ても検証も全部通る。

| 壊し方 | 落ちるはずのところ |
|---|---|
| 年齢不詳を補わない（割り振り比を 0） | 駅の和 ≠ 既存の総数・セルの和 ≠ 総数 |
| 2015 年に 2020 年の項目の番号（65 歳以上＝19 列目） | 統計 GIS の見出しの確かめ |
| 同じ間違いで、見出しの確かめも外す | セルの決まり（15 歳以上 ≠ 15〜64 歳 ＋ 65 歳以上・75 歳以上 > 65 歳以上） |
| 国勢調査の秘匿を無視（セルごとに 不詳 ＝ 総数 − 分かっている人） | 負の値 |
| R6 で PTN（真の総数）の代わりに PT00 | セルの総数が既存の推計と合わない・駅の和 ≠ 既存の総数 |
| R6 で合算先を無視（* の行の構成を黙って 0） | セルの和 ≠ PTN・全国の和・駅の和 |

    python3 pipeline/station_age_fault_test.py   # 約 10 分（壊し方ごとにセルを作り直す・121 駅）
"""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import age_cells  # noqa: E402
import age_muni  # noqa: E402
import build_station_age as bsa  # noqa: E402
import station_radii as sr  # noqa: E402
import validate_station_age  # noqa: E402
from age_rules import CENSUS_YEARS, MESH_TABLES, PRED_YEARS, MeshTable  # noqa: E402

#: 全国から等間隔に選ぶ間隔（駅の CSV の順で）と、必ず入れる駅（年齢不詳の多い駅・秘匿で崩れた駅・計画書の例）。
SAMPLE_EVERY = 80
MUST_STATIONS: tuple[str, ...] = ("矢場町#0", "大安#0", "武蔵小杉#0", "たまプラーザ#0", "東京#0")

#: 差し替え：(モジュールか辞書, 名前か鍵, 値)。
Patch = tuple[object, object, object]


@contextlib.contextmanager
def patched(patches: list[Patch]) -> Iterator[None]:
    """モジュールの名前（か辞書の鍵）を一時的に差し替える。"""
    saved = [(target, name, target[name] if isinstance(target, dict) else getattr(target, str(name)))
             for target, name, _ in patches]
    try:
        for target, name, value in patches:
            _put(target, name, value)
        yield
    finally:
        for target, name, value in saved:
            _put(target, name, value)


def _put(target: object, name: object, value: object) -> None:
    if isinstance(target, dict):
        target[name] = value
    else:
        setattr(target, str(name), value)


# --- 壊し方 -----------------------------------------------------------------------

ORIGINAL_RATIOS_FOR = age_muni.ratios_for
ORIGINAL_READ_CENSUS = age_cells.read_census_gis
ORIGINAL_READ_R6 = age_cells.read_r6_age


def zero_ratios(n03_codes: pd.Series, ratios: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    rates, source = ORIGINAL_RATIOS_FOR(n03_codes, ratios)
    return rates * 0.0, source


def uncached_census(year: int, table: MeshTable | None = None, use_cache: bool = True) -> pd.DataFrame:
    return ORIGINAL_READ_CENSUS(year, table, use_cache=False)


def offsets_2020() -> MeshTable:
    table = MESH_TABLES[2015]
    return MeshTable(2015, table.stats_id, table.directory, {**table.columns, "a65p": "T000876019", "a75p": "T000876022"},
                     table.labels)


def naive_impute(cells: pd.DataFrame, ratios: pd.DataFrame, n03: pd.Series) -> pd.DataFrame:
    """秘匿を無視：セルごとに 不詳 ＝ 総数 − 分かっている人（秘匿したセルは全員が不詳・合算先は負になりうる）。"""
    known = pd.DataFrame({"0_14": cells["a0_14"], "15_64": cells["a15_64"], "65_74": cells["a65p"] - cells["a75p"],
                          "75plus": cells["a75p"]}).fillna(0.0)
    unknown = cells["total"] - known.sum(axis=1)
    codes = n03.reindex(cells["code"]).set_axis(cells.index)
    rates, source = ORIGINAL_RATIOS_FOR(codes, ratios)
    allocated = known.to_numpy() + rates.to_numpy() * unknown.to_numpy()[:, None]
    out = pd.DataFrame({"code": cells["code"], "n03": codes, "total": cells["total"], "unknown": unknown})
    for index, column in enumerate(age_cells.BAND_COLUMNS):
        out[column] = allocated[:, index]
    return out.assign(ratio_area=source.to_numpy()).reset_index(drop=True)


def pt00_raw() -> pd.DataFrame:
    raw = ORIGINAL_READ_R6().copy()
    for year in PRED_YEARS:
        raw[f"PTN_{year}"] = raw[f"PT00_{year}"]
    return raw


def naive_r6_year(raw: pd.DataFrame, year: int) -> pd.DataFrame:
    """合算先を無視：* の行は自分の構成（PT00 ＝ 0 なので無い）を黙って 0 にする。"""
    parts = age_cells.r6_parts(raw, year)
    base = parts.sum(axis=1)
    composition = np.divide(parts, base[:, None], out=np.zeros_like(parts), where=base[:, None] > 0)
    ptn = raw[f"PTN_{year}"].to_numpy(dtype=np.float64)
    values = composition * ptn[:, None]
    columns = {f"total_{year}": ptn, **{f"{c}_{year}": values[:, i] for i, c in enumerate(age_cells.BAND_COLUMNS)}}
    return pd.DataFrame(columns, index=raw.index)


@dataclass(frozen=True)
class Fault:
    name: str
    part: str  # 作り直すセル（census・r6）
    patches: Callable[[], list[Patch]]


FAULTS: tuple[Fault, ...] = (
    Fault("年齢不詳を補わない（割り振り比を 0）", "census", lambda: [(age_cells, "ratios_for", zero_ratios)]),
    Fault("2015 年に 2020 年の項目の番号（65 歳以上＝19 列目）", "census",
          lambda: [(MESH_TABLES, 2015, offsets_2020()), (age_cells, "read_census_gis", uncached_census)]),
    Fault("同じ番号の間違いで、見出しの確かめも外す", "census",
          lambda: [(MESH_TABLES, 2015, offsets_2020()), (age_cells, "read_census_gis", uncached_census),
                   (age_cells, "_check_header", lambda *_: None)]),
    Fault("国勢調査の秘匿を無視（セルごとに 不詳 ＝ 総数 − 分かっている人）", "census",
          lambda: [(age_cells, "impute_census", naive_impute)]),
    Fault("R6 で PTN（真の総数）の代わりに PT00", "r6", lambda: [(age_cells, "read_r6_age", pt00_raw)]),
    Fault("R6 で合算先を無視（* の行の構成を黙って 0）", "r6", lambda: [(age_cells, "_r6_year", naive_r6_year)]),
)


# --- 作る・確かめる ------------------------------------------------------------------


def sample_stations() -> sr.Stations:
    grps = list(pd.read_csv(sr.STATION_DATASET_CSV, usecols=["grp"])["grp"])
    return sr.read_stations(only=tuple(sorted(set(grps[::SAMPLE_EVERY]) | set(MUST_STATIONS))))


def attempt(stations: sr.Stations, out_dir: Path, guard: bool) -> str:
    """作ってみる。戻り値は止まったところ（空なら書き出した）。`guard=False` は組み立ての照合を外す。"""
    unguarded: list[Patch] = [(bsa, "check_totals", lambda *_: []), (bsa, "R6_TOTAL_TOLERANCE", float("inf"))]
    with patched([] if guard else unguarded), contextlib.redirect_stdout(io.StringIO()):
        try:
            problems = bsa.build(stations, out_dir)
        except (SystemExit, ValueError) as error:
            return f"作る途中で止まった：{str(error).splitlines()[-1][:90]}"
    return f"組み立ての照合で止まった：{problems[0][:90]}" if problems else ""


def validation_failures(out_dir: Path) -> list[str]:
    with contextlib.redirect_stdout(io.StringIO()):
        return validate_station_age.run(out_dir).failed


def outcome(stations: sr.Stations, guard: bool) -> str:
    """1 回作って確かめた結果（止まったところか、検証の落ちた項目。全部通れば空）。"""
    with tempfile.TemporaryDirectory() as tmp:
        stopped = attempt(stations, Path(tmp), guard)
        if stopped:
            return stopped
        failed = validation_failures(Path(tmp))
    return f"検証が落ちた：{failed}" if failed else ""


def cached_parts() -> list[Patch]:
    """壊さないセル（国勢調査・R6）を 1 回だけ作り、壊し方ごとには作り直さない。"""
    census = {year: age_cells.census_age_cells(year) for year in CENSUS_YEARS}
    r6 = age_cells.r6_age_cells()
    return [(bsa, "census_age_cells", lambda year: census[year]), (bsa, "r6_age_cells", lambda: r6)]


def main() -> int:
    stations = sample_stations()
    print(f"一部の駅：{len(stations.grps)} 駅（{SAMPLE_EVERY} 駅ごと ＋ {', '.join(MUST_STATIONS)}）")
    failed = 0
    baseline = outcome(stations, guard=True)
    print(f"{'PASS' if not baseline else 'FAIL'}  壊さない作り方は組み立ても検証も全部通る  {baseline}")
    failed += 1 if baseline else 0
    cache = cached_parts()
    for fault in FAULTS:
        reuse = [patch for patch in cache if (patch[1] == "census_age_cells") == (fault.part == "r6")]
        with patched(reuse + fault.patches()):
            results = [outcome(stations, guard) for guard in (True, False)]
        ok = all(results)
        failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {fault.name}\n        そのまま → {results[0] or '落ちない'}"
              f"\n        照合を外す → {results[1] or '落ちない'}")
    print(f"\n{1 + len(FAULTS) - failed} / {1 + len(FAULTS)} PASS")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
