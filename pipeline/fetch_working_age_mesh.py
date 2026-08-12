"""15〜64 歳人口メッシュの取得（260812）— 所得を駅×半径へ按分するときの重み。

所得（課税対象所得・納税義務者数）は**市区町村単位でしか存在しない**ので、半径円の中に
どれだけ入るかは別の量で按分するしかない。**総人口より 15〜64 歳人口の方が納税義務者数を
よく再現する**ことを実測で確かめてある（再現誤差の中央値 13.9% → **5.1%**・
`docs/260805_research_add_dataset_economy.md` §11.1）。

取得する表は**人口総数とまったく同じ**（`docs/population_mesh.md` §3 の手順）。
`cdCat01` を `0100`（１５～６４歳人口 総数）に変えるだけで、区画の分け方も CSV の形も同じ。

| 年 | 解像度 | 表（TITLE の頭）| cat01 |
|---|---|---|---|
| 2020 | 250m | 人口及び世帯 | `0100` |
| 2015 | 250m | **その１ 人口等基本集計に関する事項** | `0100` |

⚠ **2010 年以前は年齢別が存在しない**（500m・1km とも 4 項目のみ）。所得の年次を
2015 / 2020 / 2025 年度の 3 点に絞ったのはこのため（`docs/260811_income.md` §2.3）。
2025 年度は 2020 年の分布を重みに使う（2025 年国勢調査のメッシュは未公表）。

⚠ 保存名を `age1564_*.csv` にしているのは、ノートブックの人口ローダが
`mesh*.csv` を glob で拾うため。**`mesh...` で始まる名前にすると既存の読み込みに混ざる。**

    python3 pipeline/fetch_working_age_mesh.py [--force] [--year 2020]
    → data/国勢調査_人口及び世帯_{2015,2020}_mesh250/age1564_<区画>.csv（151 区画）
      ＋ _manifest_age1564.csv ＋ 全国計を国勢調査の公式値と照合

再開可能（取得済みの区画は skip）・3 回リトライ。appId と完全な URL は**出力しない**。
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]

LIST_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList"
DATA_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/getSimpleStatsData"
CENSUS_CODE = "00200521"

#: 15〜64 歳人口 総数。人口総数（0010）と同じ表に入っている。
WORKING_AGE_CAT01 = "0100"

#: 年 → (保存先ディレクトリ, 対象表を選ぶための TITLE の頭)
YEARS: dict[int, tuple[str, str]] = {
    2015: ("国勢調査_人口及び世帯_2015_mesh250", "その１"),
    2020: ("国勢調査_人口及び世帯_2020_mesh250", "人口及び世帯"),
}

#: 既知の全国計（2026-08-12 実測・社会人口統計体系 A1302 と一致）。
#: 政令市計 21 コードを除いた市区町村の合計＝メッシュ全数の合計になるはず。
EXPECTED_TOTALS: dict[int, int] = {2015: 76_288_736, 2020: 72_922_764}

#: 全国は第1次地域区画 151 区画で完備（docs/population_mesh.md §1）。
EXPECTED_REGIONS = 151

API_LIMIT = 100_000
RETRIES = 3
TIMEOUT_S = 300


def app_id() -> str:
    """`.env` から e-Stat の appId を読む（値は決してログに出さない）。"""
    env = ROOT / ".env"
    if not env.exists():
        raise SystemExit(f"{env.relative_to(ROOT)} がありません（ESTAT_APP_ID が要ります）")
    for line in env.read_text(encoding="utf-8").splitlines():
        found = re.match(r'\s*(?:export\s+)?ESTAT_APP_ID\s*=\s*"?([^"\s#]+)"?', line)
        if found:
            return found.group(1)
    raise SystemExit("ESTAT_APP_ID が .env にありません")


def text_of(node: object) -> str:
    """e-Stat の JSON は値が dict（`{"$": ...}`）になることがあるので剥がす。"""
    if isinstance(node, dict):
        return str(node.get("$", ""))
    return "" if node is None else str(node)


def with_retry(call: object, context: str) -> object:
    """3 回リトライして返す（失敗時は文脈付きで落とす。URL は出さない）。"""
    last = ""
    for attempt in range(1, RETRIES + 1):
        try:
            return call()  # type: ignore[operator]
        except Exception as error:  # noqa: BLE001 — 文脈を付けて上位へ渡す
            last = f"{type(error).__name__}: {error}"
            if attempt < RETRIES:
                time.sleep(2 * attempt)
    raise SystemExit(f"取得に失敗しました（{context}・{RETRIES} 回試行）: {last}")


def list_regions(year: int) -> list[tuple[str, str]]:
    """その年の 250m メッシュ表を列挙する。戻り値は (区画コード, statsDataId)。"""
    _, title_head = YEARS[year]

    def call() -> dict[str, object]:
        response = requests.get(
            LIST_ENDPOINT,
            params={
                "appId": app_id(),
                "statsCode": CENSUS_CODE,
                "searchKind": "2",
                "surveyYears": str(year),
                "limit": 3000,
                "explanationGetFlg": "N",
            },
            timeout=TIMEOUT_S,
        )
        response.raise_for_status()
        return response.json()

    payload = with_retry(call, f"{year}年 表一覧")
    tables = payload["GET_STATS_LIST"]["DATALIST_INF"].get("TABLE_INF", [])  # type: ignore[index]
    tables = tables if isinstance(tables, list) else [tables]

    regions: list[tuple[str, str]] = []
    for table in tables:
        if "250M" not in text_of(table.get("STATISTICS_NAME")):
            continue
        title = text_of(table.get("TITLE"))
        if not title.startswith(title_head):
            continue
        found = re.search(r"1次メッシュ\s+(M\d{4})", title)
        if found is None:
            continue
        regions.append((found.group(1), str(table["@id"])))
    return sorted(set(regions))


def fetch_region(stats_data_id: str, context: str) -> str:
    """1 区画分の CSV を取る（10 万件を超える区画はページングして VALUE 行を連結）。"""

    def call(start: int) -> str:
        response = requests.get(
            DATA_ENDPOINT,
            params={
                "appId": app_id(),
                "statsDataId": stats_data_id,
                "cdCat01": WORKING_AGE_CAT01,
                "metaGetFlg": "Y",
                "sectionHeaderFlg": "1",
                "limit": API_LIMIT,
                "startPosition": start,
            },
            timeout=TIMEOUT_S,
        )
        response.raise_for_status()
        response.encoding = "utf-8"
        return response.text

    first = str(with_retry(lambda: call(1), context))
    total = total_number(first)
    if total <= API_LIMIT:
        return first

    # 2 ページ目以降は VALUE セクションの本体行だけを足す（メタとヘッダーは 1 ページ目のものを使う）。
    merged = first.splitlines()
    fetched = API_LIMIT
    while fetched < total:
        page = str(with_retry(lambda start=fetched + 1: call(start), f"{context} {fetched + 1}件目〜"))
        merged.extend(value_rows(page))
        fetched += API_LIMIT
    return "\n".join(merged) + "\n"


def total_number(csv_text: str) -> int:
    """CSV 冒頭のメタから TOTAL_NUMBER を読む。"""
    found = re.search(r'^"TOTAL_NUMBER","(\d+)"', csv_text, re.M)
    return int(found.group(1)) if found else 0


def value_rows(csv_text: str) -> list[str]:
    """`"VALUE"` セクションの**データ行だけ**（見出し行を除く）。"""
    lines = csv_text.splitlines()
    start = next((i for i, line in enumerate(lines) if line == '"VALUE"'), None)
    return [] if start is None else lines[start + 2 :]


def sum_values(csv_text: str) -> int:
    """`"VALUE"` セクションの value 列を合計する（数値でない行は 0 とみなす）。"""
    lines = csv_text.splitlines()
    start = next((i for i, line in enumerate(lines) if line == '"VALUE"'), None)
    if start is None:
        return 0
    reader = csv.reader(lines[start + 1 :])
    header = next(reader, [])
    if "value" not in header:
        return 0
    at = header.index("value")
    return sum(int(row[at]) for row in reader if at < len(row) and row[at].lstrip("-").isdigit())


def fetch_year(year: int, force: bool) -> list[str]:
    """1 年分（151 区画）を取り、全国計を照合する。戻り値は失敗の一覧。"""
    directory = ROOT / "data" / YEARS[year][0]
    if not directory.exists():
        return [f"{directory.relative_to(ROOT)} がありません（人口メッシュを先に取得してください）"]

    regions = list_regions(year)
    print(f"[{year}年] 250m メッシュ表 {len(regions)} 区画")
    manifest: list[tuple[str, str, int, str]] = []
    total = 0
    for index, (region, stats_data_id) in enumerate(regions, start=1):
        path = directory / f"age1564_{region}.csv"
        if path.exists() and not force:
            body = path.read_text(encoding="utf-8")
        else:
            body = fetch_region(stats_data_id, f"{year}年 {region}")
            path.write_text(body, encoding="utf-8")
        records = total_number(body)
        population = sum_values(body)
        total += population
        manifest.append((region, stats_data_id, records, path.name))
        if index % 30 == 0 or index == len(regions):
            print(f"  {index}/{len(regions)} 区画  累計 {total:,} 人")

    manifest_path = directory / "_manifest_age1564.csv"
    with manifest_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(("region", "statsDataId", "records", "file"))
        writer.writerows(manifest)

    want = EXPECTED_TOTALS[year]
    print(f"  全国 15〜64 歳人口 {total:,} 人（公式 {want:,} 人）")
    failures: list[str] = []
    if len(regions) != EXPECTED_REGIONS:
        failures.append(f"{year}年: 区画数が {EXPECTED_REGIONS} と異なる: {len(regions)}")
    if total != want:
        failures.append(f"{year}年: 全国計が公式値と異なる: {total:,}（公式 {want:,}）")
    return failures


def main(force: bool, only: int | None) -> int:
    failures: list[str] = []
    for year in YEARS:
        if only is not None and year != only:
            continue
        failures.extend(fetch_year(year, force))
    if failures:
        for failure in failures:
            print(f"NG: {failure}")
        return 1
    print("\nOK: 全国 15〜64 歳人口が国勢調査の公式値と 1 人単位で一致しました")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="15〜64 歳人口の 250m メッシュを取得する（所得の按分の重み）")
    parser.add_argument("--force", action="store_true", help="取得済みでも取り直す")
    parser.add_argument("--year", type=int, choices=sorted(YEARS), help="この年だけ取得する")
    args = parser.parse_args()
    sys.exit(main(args.force, args.year))
