"""2016 の 500m メッシュを**産業別**で取り直す（260816）— 売上の按分に使う従業者数。

売上は「**メッシュの産業別従業者数 × 市区町村の 1 人当たり売上**」で駅×半径へ落とす
（設計は `docs/260816_sales.md` §2.2・§3）。

| 年 | いま持っているもの | 産業別 | 対応 |
|---|---|---|---|
| 2021 | `2021/tblT001162H{区画}.zip`（生テーブル 47 列）| **あり**（`T001162032` Ｉ / `036` Ｍ / `037` Ｎ）| 再取得は不要 |
| **2016** | `2016/eco2016_{区画}.csv`（`KEY_CODE, estab, emp` の 3 列）| **なし** | **本スクリプトで取得** |
| 2012 | `2012/eco2012_{区画}.csv` | **統計自体に存在しない**（総数 2 項目のみ）| 対象外 |

取得するのは従業者数の 3 産業（`docs/260816_sales.md` §2.2 の実測コード）：

    0290 Ｉ卸売業，小売業 ／ 0330 Ｍ宿泊業，飲食サービス業 ／ 0340 Ｎ生活関連サービス業，娯楽業

⚠ **保存先を `2016_industry/` に分ける。** ノートブックの既存ローダは `2016/eco2016_*.csv` を
glob で拾うので、同じフォルダに似た名前で置くと**既存の読み込みに混ざる**
（所得のとき `mesh*.csv` で踏んだのと同じ罠・`docs/260811_income.md` §6）。

検証は 2 段構え。**照合用に総数（`0200` Ａ〜Ｒ）も一緒に取り**、
① 区画ごとに既存 `eco2016_{区画}.csv` の `emp` と 1 人単位で一致するか
② 全国計が公式の民営確報 **56,872,826 人** と一致するか
を確かめる。①が通れば、同じ応答から取った産業別の値も信頼できる。

    python3 pipeline/fetch_industry_mesh.py [--force] [--region 5339]
    → data/経済センサス_活動調査_事業所数及び従業者数/2016_industry/eco2016ind_{区画}.csv（149 区画）
      （列: KEY_CODE, emp_i, emp_m, emp_n）＋ _manifest.csv

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
ECO_DIR = ROOT / "data" / "経済センサス_活動調査_事業所数及び従業者数"
SRC_DIR = ECO_DIR / "2016"  # 既存（総数のみ）＝照合相手
OUT_DIR = ECO_DIR / "2016_industry"

LIST_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList"
DATA_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/getSimpleStatsData"
ECO_CODE = "00200553"  # 経済センサス‑活動調査
SURVEY_YEAR = "2016"
MESH_NAME = "500M"  # STATISTICS_NAME に含まれる解像度（1KM メッシュ表と分ける）

#: 取得する項目（cat01）。総数は照合用で、CSV には書かない。
TOTAL_CAT01 = "0200"  # 従業者数＿Ａ〜Ｒ全産業（Ｓ公務を除く）＝民営
INDUSTRY_CAT01 = {"emp_i": "0290", "emp_m": "0330", "emp_n": "0340"}

#: 全国計（`docs/establishment_employee.md` §4 の公式 民営確報）。
EXPECTED_TOTAL = 56_872_826
EXPECTED_REGIONS = 149

RETRIES = 3
TIMEOUT_S = 300
API_LIMIT = 100_000
HEADERS = ("KEY_CODE", "emp_i", "emp_m", "emp_n")


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


def with_retry(call, context: str):  # noqa: ANN001, ANN201 — 呼び出し側で型が決まる
    """3 回リトライして返す（失敗時は文脈付きで落とす。URL は出さない）。"""
    last = ""
    for attempt in range(1, RETRIES + 1):
        try:
            return call()
        except Exception as error:  # noqa: BLE001 — 文脈を付けて上位へ渡す
            last = f"{type(error).__name__}: {error}"
            if attempt < RETRIES:
                time.sleep(2 * attempt)
    raise SystemExit(f"取得に失敗しました（{context}・{RETRIES} 回試行）: {last}")


def list_regions() -> list[tuple[str, str]]:
    """2016 の 500m メッシュ表を列挙する。戻り値は (区画コード, statsDataId)。"""

    def call() -> dict[str, object]:
        response = requests.get(
            LIST_ENDPOINT,
            params={
                "appId": app_id(),
                "statsCode": ECO_CODE,
                "searchKind": "2",
                "surveyYears": SURVEY_YEAR,
                "limit": 3000,
                "explanationGetFlg": "N",
            },
            timeout=TIMEOUT_S,
        )
        response.raise_for_status()
        return response.json()

    payload = with_retry(call, "2016年 メッシュ表一覧")
    tables = payload["GET_STATS_LIST"]["DATALIST_INF"].get("TABLE_INF", [])  # type: ignore[index]
    tables = tables if isinstance(tables, list) else [tables]

    regions: list[tuple[str, str]] = []
    for table in tables:
        if MESH_NAME not in text_of(table.get("STATISTICS_NAME")):
            continue
        found = re.search(r"1次メッシュ\s+M(\d{4})", text_of(table.get("TITLE")))
        if found is not None:
            regions.append((found.group(1), str(table["@id"])))
    return sorted(set(regions))


def fetch_region(stats_data_id: str, context: str) -> str:
    """1 区画分の CSV（総数＋3 産業）を取る。件数が上限を超えたら落とす（現状は超えない）。"""

    def call() -> str:
        response = requests.get(
            DATA_ENDPOINT,
            params={
                "appId": app_id(),
                "statsDataId": stats_data_id,
                "cdCat01": ",".join([TOTAL_CAT01, *INDUSTRY_CAT01.values()]),
                "metaGetFlg": "N",
                "sectionHeaderFlg": "1",
                "limit": API_LIMIT,
            },
            timeout=TIMEOUT_S,
        )
        response.raise_for_status()
        response.encoding = "utf-8"
        return response.text

    body = str(with_retry(call, context))
    total = total_number(body)
    if total > API_LIMIT:
        raise SystemExit(f"{context}: 件数 {total:,} が上限 {API_LIMIT:,} を超えました（ページングが要ります）")
    return body


def total_number(csv_text: str) -> int:
    """CSV 冒頭のメタから TOTAL_NUMBER を読む。"""
    found = re.search(r'^"TOTAL_NUMBER","(\d+)"', csv_text, re.M)
    return int(found.group(1)) if found else 0


def parse_values(csv_text: str) -> tuple[dict[str, list[int]], int, int]:
    """VALUE セクション → {メッシュコード: [Ｉ, Ｍ, Ｎ]}・総数（Ａ〜Ｒ）・非数値の件数。

    e-Stat は値の無い組み合わせを返さないので、産業の欠けは 0 として扱う
    （2021 の生テーブルでも同じ意味＝その産業の従業者がいないメッシュ）。
    """
    lines = csv_text.splitlines()
    start = next((i for i, line in enumerate(lines) if line == '"VALUE"'), None)
    if start is None:
        raise SystemExit("応答に VALUE セクションがありません")
    reader = csv.reader(lines[start + 1 :])
    header = next(reader, [])
    for column in ("cat01_code", "area_code", "value"):
        if column not in header:
            raise SystemExit(f"VALUE の見出しに {column} がありません: {header}")
    at_cat, at_area, at_value = (header.index(c) for c in ("cat01_code", "area_code", "value"))
    order = list(INDUSTRY_CAT01.values())

    meshes: dict[str, list[int]] = {}
    total = 0
    skipped = 0
    for row in reader:
        if len(row) <= max(at_cat, at_area, at_value):
            continue
        raw = row[at_value]
        if not re.fullmatch(r"-?\d+", raw):
            skipped += 1
            continue
        value, code, category = int(raw), row[at_area], row[at_cat]
        if category == TOTAL_CAT01:
            total += value
            continue
        if category in order:
            meshes.setdefault(code, [0, 0, 0])[order.index(category)] = value
    return meshes, total, skipped


def existing_total(region: str) -> int | None:
    """既存 `2016/eco2016_{区画}.csv` の従業者合計（照合相手）。無ければ None。"""
    path = SRC_DIR / f"eco2016_{region}.csv"
    if not path.exists():
        return None
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return sum(int(row["emp"]) for row in reader if row["emp"].lstrip("-").isdigit())


def write_region(region: str, meshes: dict[str, list[int]]) -> Path:
    """区画別 CSV（メッシュコード昇順・3 産業とも 0 のメッシュは書かない）。"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"eco2016ind_{region}.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADERS)
        writer.writerows(
            [code, *values] for code, values in sorted(meshes.items()) if any(values)
        )
    return path


def read_region(path: Path) -> dict[str, list[int]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return {row["KEY_CODE"]: [int(row["emp_i"]), int(row["emp_m"]), int(row["emp_n"])] for row in reader}


def fetch_all(
    regions: list[tuple[str, str]], force: bool, only: str | None
) -> tuple[list[int], int, int, list[tuple[str, str, int]], list[str]]:
    """全区画を取る。戻り値は (産業別の全国計, 民営Ａ〜Ｒの全国計, 照合できた区画数, manifest, 失敗)。"""
    nation = [0, 0, 0]
    nation_all_industries = 0
    checked = 0
    manifest: list[tuple[str, str, int]] = []
    failures: list[str] = []
    for index, (region, stats_data_id) in enumerate(regions, start=1):
        if only is not None and region != only:
            continue
        path = OUT_DIR / f"eco2016ind_{region}.csv"
        if path.exists() and not force:
            meshes = read_region(path)
            nation_all_industries += existing_total(region) or 0
        else:
            meshes, total, skipped = parse_values(fetch_region(stats_data_id, f"2016年 区画 {region}"))
            nation_all_industries += total
            want = existing_total(region)
            if want is not None and total != want:
                failures.append(f"区画 {region}: 総数が既存ファイルと不一致 {total:,}（既存 {want:,}）")
            elif want is not None:
                checked += 1
            if skipped:
                print(f"  区画 {region}: 数値でない値を {skipped} 件スキップしました")
            write_region(region, meshes)
        for values in meshes.values():
            for at in range(3):
                nation[at] += values[at]
        manifest.append((region, stats_data_id, len(meshes)))
        if index % 30 == 0 or index == len(regions):
            print(f"  {index}/{len(regions)} 区画  Ｉ {nation[0]:,} / Ｍ {nation[1]:,} / Ｎ {nation[2]:,} 人")
    return nation, nation_all_industries, checked, manifest, failures


def write_manifest(manifest: list[tuple[str, str, int]]) -> None:
    """区画 → statsDataId → メッシュ数の一覧（取得の再現性のため）。"""
    with (OUT_DIR / "_manifest.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(("region", "statsDataId", "meshes"))
        writer.writerows(manifest)


def main(force: bool, only: str | None) -> int:
    regions = list_regions()
    print(f"[2016年] 500m メッシュ表 {len(regions)} 区画")
    failures: list[str] = []
    if len(regions) != EXPECTED_REGIONS and only is None:
        failures.append(f"区画数が {EXPECTED_REGIONS} と異なる: {len(regions)}")

    nation, nation_all_industries, checked, manifest, fetch_failures = fetch_all(regions, force, only)
    failures.extend(fetch_failures)
    if only is None:
        write_manifest(manifest)

        print(
            f"  全国（メッシュ）Ｉ {nation[0]:,} ／ Ｍ {nation[1]:,} ／ Ｎ {nation[2]:,} 人"
            f"　※市区町村表との比は Ｉ {nation[0] / 11_262_136:.3f} ／ Ｍ {nation[1] / 4_810_856:.3f}"
            f" ／ Ｎ {nation[2] / 2_205_975:.3f}（売上表は売上を集計できた事業所だけなので 1.0 より大きい）"
        )
        print(f"  全国（民営Ａ〜Ｒ）{nation_all_industries:,} 人（公式 {EXPECTED_TOTAL:,} 人）")
        if nation_all_industries != EXPECTED_TOTAL:
            failures.append(f"全国計が公式値と異なる: {nation_all_industries:,}（公式 {EXPECTED_TOTAL:,}）")
    else:
        print(f"  区画 {only} だけ取得しました（Ｉ {nation[0]:,} ／ Ｍ {nation[1]:,} ／ Ｎ {nation[2]:,} 人）")
    if checked:
        print(f"  区画ごとの総数照合: {checked} 区画で既存ファイルと 1 人単位で一致")

    if failures:
        for failure in failures:
            print(f"NG: {failure}")
        return 1
    print("\nOK: 2016 の産業別従業者数を取得しました（総数は既存ファイルと一致）")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="2016 の 500m メッシュ 産業別従業者数を取得する（売上の按分）")
    parser.add_argument("--force", action="store_true", help="取得済みでも取り直す")
    parser.add_argument("--region", help="この区画だけ取得する（例 5339）")
    args = parser.parse_args()
    sys.exit(main(args.force, args.region))
