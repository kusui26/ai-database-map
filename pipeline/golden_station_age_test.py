"""人口の年齢の列の投入の黄金テスト（2026-11-24・人口の年齢 PR-2・計画書 261122 §10）。

`station_age.csv` の 78 列（第 1 段 66 列・フラグ 12 列）が DB にそのまま入ったかを、**全駅・全列・全セル**で確かめる。
`validate_load.py`（全列の件数・無作為 300 セル・全国計）では、年齢の列は数十セルしか値を比べない。

1. `metric_columns` がカタログ（`catalog.json`）の全項目と、id（列の並び）・key・meta で一致する。年齢の列は末尾
2. 年齢の列の値が CSV と 1 セル残らず一致する（`station_values.value` が float4 なら float4 の値どうしで比べる。
   許容誤差は置かない）。NaN のセルとフラグの 0 には行が無い（「行が無い＝0」の規約）
3. カタログに無い列の行が無い（`--append` が余分な行を残していない）

    python3 pipeline/golden_station_age_test.py   # 全 PASS で exit 0
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from age_rules import FLAG_PREFIXES, METRIC_PREFIXES  # noqa: E402
from load_to_supabase import db_params, value_column_type  # noqa: E402
from station_columns import JOIN_KEY, STATION_AGE_CSV  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "src" / "shared" / "catalog" / "catalog.json"
RADIUS_COUNT = 6
#: 年齢の列より前（main の catalog・2026-11-24 時点）の項目数。年齢の列の id はこのあとに続く。
ENTRIES_BEFORE_AGE = 796
STATEMENT_TIMEOUT = "180s"
#: 1 列の不一致を出すときに見せる駅の数。
SHOWN_MISMATCHES = 3

Check = tuple[bool, str, str]


def read_age_frame() -> tuple[pd.DataFrame, list[str]]:
    """年齢の CSV（grp を索引に）と、値の列の並び。"""
    frame = pd.read_csv(STATION_AGE_CSV).set_index(JOIN_KEY)
    return frame, list(frame.columns)


def fetch_age_values(cur: psycopg.Cursor, first_id: int, last_id: int) -> pd.DataFrame:
    """DB の年齢の列の行（grp・column_id・value）。COPY で一度に読む（60 万行）。"""
    sql = (
        "copy (select s.grp, v.column_id, v.value from public.station_values v "
        "join public.stations s on s.id = v.station_id "
        f"where v.column_id between {int(first_id)} and {int(last_id)}) to stdout with (format csv)"
    )
    buffer = io.BytesIO()
    with cur.copy(sql) as copy:
        for chunk in copy:
            buffer.write(chunk)
    buffer.seek(0)
    return pd.read_csv(buffer, names=["grp", "column_id", "value"], dtype={"grp": str})


def as_stored(values: pd.Series, value_type: str) -> np.ndarray:
    """値を DB の保存精度にそろえる（float4 なら float32 の値どうしで比べる）。"""
    return values.to_numpy(dtype="float32" if value_type == "real" else "float64")


def column_problems(key: str, csv: pd.Series, db: pd.Series, value_type: str, is_flag: bool) -> str:
    """1 列の CSV と DB の違い（無ければ空文字）。フラグは 1 のセルだけ行がある。"""
    expected = csv[csv == 1] if is_flag else csv.dropna()
    missing = expected.index.difference(db.index)
    extra = db.index.difference(expected.index)
    if len(missing) > 0 or len(extra) > 0:
        return f"{key}: 行が足りない {len(missing)}（{list(missing[:SHOWN_MISMATCHES])}）・余分 {len(extra)}"
    db_aligned = db.reindex(expected.index)
    differs = as_stored(expected, value_type) != as_stored(db_aligned, value_type)
    if differs.any():
        where = expected.index[differs][:SHOWN_MISMATCHES]
        pairs = [(grp, float(expected[grp]), float(db_aligned[grp])) for grp in where]
        return f"{key}: 値の違い {int(differs.sum())} セル（{pairs}）"
    return ""


def catalog_checks(cur: psycopg.Cursor, entries: list[dict], age_keys: list[str]) -> list[Check]:
    """1. metric_columns ＝ カタログ（id・key・meta）。年齢の列は末尾で、CSV の並びのとおり。"""
    cur.execute("select id, key, meta from public.metric_columns order by id")
    rows = cur.fetchall()
    id_key_bad = [(row[0], row[1]) for index, (row, entry) in enumerate(zip(rows, entries), start=1)
                  if row[0] != index or row[1] != entry["key"]]
    meta_bad = [row[1] for row, entry in zip(rows, entries) if row[2] != entry]
    tail = [entry["key"] for entry in entries[ENTRIES_BEFORE_AGE:]]
    age_ids = [row[0] for row in rows if row[1] in set(age_keys)]
    expected_ids = list(range(ENTRIES_BEFORE_AGE + 1, ENTRIES_BEFORE_AGE + len(age_keys) + 1))
    return [
        (len(rows) == len(entries), f"metric_columns の行数 = カタログの項目数 = {len(entries)}", f"db={len(rows)}"),
        (not id_key_bad, "metric_columns の id と key がカタログの並びのとおり", f"{id_key_bad[:3]}"),
        (not meta_bad, "metric_columns の meta がカタログの項目と同じ（全項目）", f"{meta_bad[:3]}"),
        (tail == age_keys, f"カタログの末尾 {len(age_keys)} 項目 = 年齢の CSV の列（並びも同じ）", f"{tail[:3]}"),
        (age_ids == expected_ids, f"年齢の列の id = {expected_ids[0]}〜{expected_ids[-1]}（既存の id は動かない）",
         f"{age_ids[:3]}…"),
    ]


def value_checks(cur: psycopg.Cursor, age: pd.DataFrame, entries: list[dict]) -> list[Check]:
    """2. 年齢の列の全セル（CSV）＝ DB の行。"""
    value_type = value_column_type(cur)
    ids = {entry["key"]: index for index, entry in enumerate(entries, start=1) if entry["key"] in age.columns}
    db = fetch_age_values(cur, min(ids.values()), max(ids.values()))
    flags = {entry["key"] for entry in entries if entry["key"] in ids and entry["kind"] == "flag"}
    by_column = {column_id: group.set_index("grp")["value"] for column_id, group in db.groupby("column_id")}
    empty = pd.Series(dtype="float64")
    problems = [column_problems(key, age[key], by_column.get(column_id, empty), value_type, key in flags)
                for key, column_id in ids.items()]
    problems = [problem for problem in problems if problem]
    expected_rows = sum(int((age[key] == 1).sum()) if key in flags else int(age[key].notna().sum()) for key in ids)
    flag_rows = int(db[db["column_id"].isin([ids[key] for key in flags])]["value"].ne(1).sum())
    precision = "float4 の値どうし" if value_type == "real" else "float8 のまま"
    return [
        (len(db) == expected_rows, f"年齢の列の行数 = CSV の値のあるセル − フラグの 0 = {expected_rows:,}", f"db={len(db):,}"),
        (not problems, f"年齢の {len(ids)} 列 × {len(age):,} 駅の全セルが CSV と一致（{precision}で厳密に）",
         "; ".join(problems[:3])),
        (flag_rows == 0, f"フラグ {len(flags)} 列の行はどれも 1（0 は行が無い）", f"1 以外 {flag_rows:,} 行"),
    ]


def leftover_checks(cur: psycopg.Cursor, entries: list[dict]) -> list[Check]:
    """3. カタログに無い列の行が無い。"""
    cur.execute("select count(*) from public.station_values where column_id > %s or column_id < 1", (len(entries),))
    (stray,) = cur.fetchone()
    return [(stray == 0, f"カタログに無い列（id > {len(entries)}）の行が無い", f"{stray:,} 行")]


def main() -> int:
    entries = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["entries"]
    age, age_keys = read_age_frame()
    expected_columns = (len(METRIC_PREFIXES) + len(FLAG_PREFIXES)) * RADIUS_COUNT
    checks: list[Check] = [(len(age_keys) == expected_columns,
                            f"年齢の CSV の列 = (指標 {len(METRIC_PREFIXES)} ＋ フラグ {len(FLAG_PREFIXES)}) × 半径 6 = {expected_columns}",
                            f"{len(age_keys)}")]
    with psycopg.connect(**db_params()) as conn, conn.cursor() as cur:
        cur.execute(f"set statement_timeout = '{STATEMENT_TIMEOUT}'")
        checks += catalog_checks(cur, entries, age_keys)
        checks += value_checks(cur, age, entries)
        checks += leftover_checks(cur, entries)

    passed = sum(1 for ok, _, _ in checks if ok)
    print(f"人口の年齢の投入の黄金テスト — {passed}/{len(checks)}\n")
    for ok, name, detail in checks:
        print(f"  {'✓' if ok else '✗ FAIL'}  {name}" + ("" if ok else f"  [{detail}]"))
    print("\n" + ("✅ ALL PASS" if passed == len(checks) else "❌ FAILED"))
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
