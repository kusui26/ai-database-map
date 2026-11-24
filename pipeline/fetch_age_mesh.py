"""国勢調査 250m メッシュの年齢の項目を、e-Stat の統計 GIS から取る（2026-11-24・人口の年齢 PR-1）。

e-Stat の API（getSimpleStatsData）でも同じ値が取れるが、**秘匿したセルの合算先（`HTKSAKI`）が無い**。国勢調査のメッシュは、
小さなセルの年齢の値を合算先のセルに足し上げている（総数だけはセルごと）。合算先が分からないと、年齢の内訳が
近くのセルの人の分だけずれる（駅の 500m 圏で最大 24%）。統計 GIS のファイルには合算先があり、値は API と同じ
（2015・2020 年とも区画 M5339 の全項目で 1 人の差もないことを確かめた・2026-11-24）。統計 GIS は appId が要らない。

| 年 | 表（統計 GIS） | 項目（列の番号） |
|---|---|---|
| 2015 | T000876「その１ 人口等基本集計」 | 総数 001・0〜14 004・15 以上 007・15〜64 010・65 以上 **016**・75 以上 **019** |
| 2020 | T001102「人口及び世帯」 | 総数 001・0〜14 004・15 以上 007・15〜64 010・65 以上 **019**・75 以上 **022** |

    python3 pipeline/fetch_age_mesh.py              # 151 区画 × 2 年（取得済みの区画は読み直して確かめるだけ）
    python3 pipeline/fetch_age_mesh.py --year 2020  # この年だけ
    python3 pipeline/fetch_age_mesh.py --force      # 取り直す

保存先は `data/国勢調査_人口及び世帯_{年}_mesh250/gis/tbl<表>Q<区画>.zip`（統計 GIS の名前のまま）。ノートブックが拾う
`mesh*.csv`・所得の重みの `age1564_*.csv` とはフォルダが違うので混ざらない。区画ごとに確かめ、崩れたら保存しない：

- 2 行目の見出しで項目を確かめる（2015 年と 2020 年は項目の並びが違う）
- セルの集合と総数が、既存の API のファイル（`mesh250_<区画>.csv`）と 1 人単位で一致する
- 15〜64 歳が、所得の重みのファイル（`age1564_<区画>.csv`・API）と 1 人単位で一致する
- 秘匿していないセルは 15 歳以上 ＝ 15〜64 歳 ＋ 65 歳以上・75 歳以上 ≤ 65 歳以上

最後に、全国の総数と 15〜64 歳を国勢調査の公表値と照合し、合算先のつながり（区画をまたぐものも）を確かめる。
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from age_cells import check_items, check_secrecy, read_gis_zip  # noqa: E402
from age_rules import CENSUS_YEARS, EXPECTED_REGIONS, GIS_DOWNLOAD_URL, MESH_TABLES, ROOT, MeshTable, gis_zip_name  # noqa: E402
from area_mesh import CENSUS_MESH_DIRS  # noqa: E402
from area_rules import ANCHORS  # noqa: E402
from fetch_working_age_mesh import EXPECTED_TOTALS as WORKING_AGE_TOTALS  # noqa: E402

TIMEOUT_S = 300
RETRIES = 3
#: 再試行の間隔（試行の回数 × この秒数）。
RETRY_WAIT_S = 5.0
#: 区画ごとの間隔（配信に負担をかけない）。
REQUEST_INTERVAL_S = 1.0
#: zip の先頭。誤りの頁（HTML）を zip として保存しない。
ZIP_MAGIC = b"PK"
#: 既存の API のファイルの項目（cat01）：人口総数・15〜64 歳。
API_TOTAL_CAT01 = "0010"
API_WORKING_AGE_CAT01 = "0100"


def regions(year: int) -> list[str]:
    """区画（`M5339`）の一覧＝既存の API のファイル（`mesh250_<区画>.csv`）がある区画。"""
    names = sorted(path.stem.removeprefix("mesh250_") for path in CENSUS_MESH_DIRS[year].glob("mesh250_M*.csv"))
    if len(names) != EXPECTED_REGIONS:
        raise SystemExit(f"{CENSUS_MESH_DIRS[year].relative_to(ROOT)} の mesh250_*.csv が {len(names)} 区画（{EXPECTED_REGIONS} のはず）")
    return names


def api_values(path: Path, cat01: str) -> pd.Series:
    """既存の API のファイル（e-Stat の CSV）→ セル → 値（その項目だけ）。"""
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line == '"VALUE"')
    table = pd.read_csv(io.StringIO("\n".join(lines[start + 1 :])), dtype=str)
    rows = table[table["cat01_code"] == cat01]
    return pd.Series(pd.to_numeric(rows["value"], errors="coerce").fillna(0.0).to_numpy(), index=rows["area_code"].to_numpy())


def download(table: MeshTable, region: str) -> bytes:
    """統計 GIS から 1 区画の zip を取る（3 回まで）。失敗の理由は型と HTTP の状態だけ。"""
    params = {"statsId": table.stats_id, "code": region.removeprefix("M"), "downloadType": "2"}
    last = ""
    for attempt in range(1, RETRIES + 1):
        try:
            response = requests.get(GIS_DOWNLOAD_URL, params=params, timeout=TIMEOUT_S)
            if response.status_code == 200 and response.content.startswith(ZIP_MAGIC):
                return response.content
            last = f"HTTP {response.status_code}（zip でない）"
        except requests.RequestException as error:
            last = type(error).__name__
        time.sleep(RETRY_WAIT_S * attempt)
    raise SystemExit(f"取得に失敗しました（{table.year} 年 {region}・{RETRIES} 回試行）: {last}")


def check_region(year: int, region: str, cells: pd.DataFrame) -> list[str]:
    """1 区画：セルの決まりと、既存の API のファイルとの 1 人単位の一致（総数・15〜64 歳）。"""
    source = f"{year} 年 {region}"
    problems = check_items(cells, source)
    directory = CENSUS_MESH_DIRS[year]
    totals = api_values(directory / f"mesh250_{region}.csv", API_TOTAL_CAT01)
    working = api_values(directory / f"age1564_{region}.csv", API_WORKING_AGE_CAT01)
    indexed = cells.set_index("code")
    if set(indexed.index) != set(totals.index):
        problems.append(f"{source}: セルの集合が API と違う（統計 GIS {len(indexed):,}・API {len(totals):,}）")
        return problems
    if (indexed["total"].reindex(totals.index) != totals).any():
        problems.append(f"{source}: 総数が API と違うセルがある")
    if (indexed["a15_64"].fillna(0.0).reindex(working.index) != working).any():
        problems.append(f"{source}: 15〜64 歳が API（age1564）と違うセルがある")
    return problems


def region_cells(table: MeshTable, region: str, force: bool) -> tuple[pd.DataFrame, list[str]]:
    """1 区画を取る（取得済みなら読むだけ）。確かめて崩れていなければ保存する。"""
    path = table.directory / gis_zip_name(table, region)
    fetched = force or not path.exists()
    if fetched:
        time.sleep(REQUEST_INTERVAL_S)
    payload = download(table, region) if fetched else path.read_bytes()
    cells = read_gis_zip(table, payload, path.name)
    problems = check_region(table.year, region, cells)
    if fetched and not problems:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    return cells, problems


def check_national(year: int, cells: pd.DataFrame) -> list[str]:
    """全国：総数と 15〜64 歳を公表値と、合算先のつながり（区画をまたぐものも）を確かめる。"""
    problems = check_secrecy(cells, f"{year} 年")
    total, working = cells["total"].sum(), cells["a15_64"].sum()
    for label, got, want in (("総数", total, ANCHORS[("jp", f"pop_{year}")]), ("15〜64 歳", working, WORKING_AGE_TOTALS[year])):
        print(f"  全国の{label} {got:,.0f}（公表値 {want:,}）")
        if round(got) != want:
            problems.append(f"{year} 年：全国の{label}が公表値と違う {got:,.0f}（{want:,}）")
    return problems


def write_manifest(table: MeshTable, rows: list[tuple[str, str, int, int, int, int]]) -> None:
    with (table.directory / "_manifest_gis.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(("region", "file", "cells", "hidden", "targets", "total"))
        writer.writerows(rows)


def fetch_year(year: int, force: bool) -> list[str]:
    table = MESH_TABLES[year]
    names = regions(year)
    print(f"[{year} 年] 統計 GIS {table.stats_id}：{len(names)} 区画")
    frames, manifest, problems = [], [], []
    for index, region in enumerate(names, start=1):
        cells, found = region_cells(table, region, force)
        problems.extend(found)
        frames.append(cells)
        counts = cells["secrecy"].value_counts()
        manifest.append((region, gis_zip_name(table, region), len(cells), int(counts.get("2", 0)), int(counts.get("1", 0)),
                         int(cells["total"].sum())))
        if index % 30 == 0 or index == len(names):
            print(f"  {index}/{len(names)} 区画")
    problems.extend(check_national(year, pd.concat(frames, ignore_index=True)))
    if not problems:
        write_manifest(table, manifest)
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="国勢調査 250m メッシュの年齢の項目を統計 GIS から取る")
    parser.add_argument("--force", action="store_true", help="取得済みでも取り直す")
    parser.add_argument("--year", type=int, choices=CENSUS_YEARS, help="この年だけ")
    args = parser.parse_args()
    problems = [p for year in CENSUS_YEARS if args.year in (None, year) for p in fetch_year(year, args.force)]
    if problems:
        print("\n".join(["NG（崩れた区画は保存していない）:", *problems[:40]]))
        return 1
    print("\nOK：統計 GIS の年齢の項目が API と 1 人単位で一致し、全国の総数・15〜64 歳が公表値と一致しました")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
