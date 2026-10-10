"""エリアの区域の値（B5a・2026-10-10）— 公表値を e-Stat から取る。

設計は `docs/261001_fix_user_feedback_ui.md` §6.12.4、データの説明は `docs/area_values.md`。
取る表は `area_rules.ESTAT_TABLES`（国勢調査 1995〜2025・経済センサス 2012/2016/2021・面積）。あわせて、推計の照合に
使う社人研の結果表（xlsx）も落とす（照合だけに使い、配信しない）。

    python3 pipeline/fetch_area_stats.py           # 未取得の表だけ取る
    python3 pipeline/fetch_area_stats.py --force   # すべて取り直す

落とし先は `data/area_raw/`（gitignore）。**appId と完全な URL は出力しない**（`.claude/CLAUDE.md` §5）——
例外の文には URL（appId を含む）が入るので、失敗の理由は型と HTTP の状態だけを書く（e-Stat の呼び方は `estat_api.py`）。
取得した直後に、全国の値を既知の公表値と照合する（崩れたら保存しない）。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_common import ESTAT_DIR, IPSS_XLSX, ROOT, numeric  # noqa: E402
from area_rules import (  # noqa: E402
    ANCHORS,
    ECON_TABS,
    ESTAT_TABLES,
    IPSS_XLSX_URL,
    SSDS_EMP_ITEM,
    SSDS_ESTAB_ITEM,
    SSDS_POP_ITEM,
    EstatTable,
)
import estat_api  # noqa: E402  （appId を足して呼び、失敗の理由に URL・appId を出さない）

DATA_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
API_LIMIT = 100_000
TIMEOUT_S = 180
#: 再試行の間隔（試行の回数 × この秒数・大きい表なので共通の既定より長め）。
RETRY_WAIT_S = 3.0


def get_json(params: dict[str, str | int], context: str) -> dict[str, object]:
    """getStatsData を呼ぶ（3 回まで再試行）。失敗の理由に URL・appId を含めない（`estat_api.py`）。"""
    return estat_api.get_json(
        DATA_ENDPOINT, params, context=context, root="GET_STATS_DATA", timeout_s=TIMEOUT_S, wait_s=RETRY_WAIT_S
    )


def fetch_table(table: EstatTable) -> dict[str, object]:
    """1 つの表を全件取る（10 万件を超えたら続きから）。"""
    values: list[dict[str, str]] = []
    classes: list[dict[str, object]] = []
    start = 1
    while True:
        params: dict[str, str | int] = {
            "statsDataId": table.stats_data_id,
            "limit": API_LIMIT,
            "startPosition": start,
            "metaGetFlg": "Y" if start == 1 else "N",
            **dict(table.params),
        }
        payload = get_json(params, f"{table.name} {start} 件目〜")
        data = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]  # type: ignore[index]
        if start == 1:
            classes = data["CLASS_INF"]["CLASS_OBJ"]  # type: ignore[index]
        page = data.get("DATA_INF", {}).get("VALUE", [])  # type: ignore[union-attr]
        values.extend(page if isinstance(page, list) else [page])
        next_key = data["RESULT_INF"].get("NEXT_KEY")  # type: ignore[index]
        if not next_key:
            break
        start = int(next_key)
    return {
        "name": table.name,
        "statsDataId": table.stats_data_id,
        "titleJa": table.titleJa,
        "params": dict(table.params),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "classes": classes,
        "values": values,
    }


def _national(payload: dict[str, object], **where: str) -> float | None:
    """全国（00000）の値を 1 つ取り出す（地域の分類の id は表ごとに違う）。"""
    for row in payload["values"]:  # type: ignore[union-attr]
        if not isinstance(row, dict):
            continue
        area = next((v for k, v in row.items() if k.startswith("@") and v == "00000"), None)
        if area is None:
            continue
        if all(row.get(f"@{key}") == value for key, value in where.items()):
            return numeric(row.get("$"))
    return None


def check_national(table: EstatTable, payload: dict[str, object]) -> list[str]:
    """取得した表の全国の値を、既知の公表値（area_rules.ANCHORS）と照合する。"""
    checks: list[tuple[str, float | None, int]] = []
    if table.name == "ssds_pref_pop":
        for year in (1995, 2000, 2005, 2010, 2015, 2020):
            checks.append((f"人口 {year}", _national(payload, cat01=SSDS_POP_ITEM, time=f"{year}100000"),
                           ANCHORS[("jp", f"pop_{year}")]))
    elif table.name == "census2025_pop":
        checks.append(("人口 2025", _national(payload), ANCHORS[("jp", "pop_2025")]))
    elif table.name == "census2025_change":
        checks.append(("2020 年の人口（組替）", _national(payload, tab="2025_03"), ANCHORS[("jp", "pop_2020")]))
    elif table.name.startswith("econ"):
        year = int(table.name.removeprefix("econ"))
        estab_tab, emp_tab = ECON_TABS[year]
        checks.append((f"事業所 {year}", _national(payload, tab=estab_tab), ANCHORS[("jp", f"estab_n_{year}")]))
        checks.append((f"従業者 {year}", _national(payload, tab=emp_tab), ANCHORS[("jp", f"emp_n_{year}")]))
    elif table.name in ("ssds_muni_pop", "ssds_muni_econ"):
        # 市区町村の表に全国の行は無い（全国の照合は build で基本単位を足して行う）。件数だけ見る。
        items = (SSDS_POP_ITEM,) if table.name == "ssds_muni_pop" else (SSDS_ESTAB_ITEM, SSDS_EMP_ITEM)
        seen = {row.get("@cat01") for row in payload["values"] if isinstance(row, dict)}  # type: ignore[union-attr]
        missing = [item for item in items if item not in seen]
        return [f"{table.name}: 項目 {missing} が無い"] if missing else []
    failures = []
    for label, got, want in checks:
        ok = got is not None and round(got) == want
        print(f"    {'OK  ' if ok else 'FAIL'} 全国の{label}: {got} / 公表値 {want:,}")
        if not ok:
            failures.append(f"{table.name}: 全国の{label}が {got}（公表値 {want:,}）")
    return failures


def fetch_ipss(force: bool) -> None:
    """社人研の地域別推計の結果表（照合用・配信しない）。"""
    if IPSS_XLSX.exists() and not force:
        print(f"  skip {IPSS_XLSX.name}（取得済み）")
        return
    try:
        response = requests.get(IPSS_XLSX_URL, timeout=TIMEOUT_S)
    except requests.RequestException as error:
        raise SystemExit(f"社人研の結果表の取得に失敗しました: {type(error).__name__}") from None
    if response.status_code != 200 or not response.content.startswith(b"PK"):
        raise SystemExit(f"社人研の結果表の取得に失敗しました: HTTP {response.status_code}")
    IPSS_XLSX.write_bytes(response.content)
    print(f"  OK   {IPSS_XLSX.name}（{len(response.content):,} bytes）")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--force", action="store_true", help="取得済みの表も取り直す")
    args = parser.parse_args()

    ESTAT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    for table in ESTAT_TABLES:
        path = ESTAT_DIR / f"{table.name}.json"
        if path.exists() and not args.force:
            print(f"  skip {table.name}（取得済み）")
            continue
        payload = fetch_table(table)
        print(f"  get  {table.name}（{table.stats_data_id}・{len(payload['values']):,} 件）")  # type: ignore[arg-type]
        problems = check_national(table, payload)
        if problems:
            failures.extend(problems)
            continue  # 照合が崩れた表は保存しない
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    fetch_ipss(args.force)
    if failures:
        print("\n".join(["照合が崩れた（保存していない）:", *failures]))
        return 1
    print(f"OK {ESTAT_DIR.relative_to(ROOT)}/ に {len(ESTAT_TABLES)} 表")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
