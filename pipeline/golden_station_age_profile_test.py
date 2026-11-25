"""年齢別の人口のグラフ用の表の黄金テスト（2026-11-25・人口の年齢 PR-3・計画書 261122 §10）。

`station_age_profiles`（1 駅 1 行の配列）と、それを読む関数 `station_age_profile(in_grp)` を確かめる。
配列の並びを知っているのは投入（`load_station_age.py`）と関数だけなので、**関数の出力を CSV の全行と照合**して、
2 つが同じ並びで読み書きしていることを確かめる。

1. 全駅に 1 行・表の大きさ（計画は約 8MB）
2. 関数の出力（全駅 × 48 行＝445,104 行）が `station_age_profiles.csv` と 1 セル残らず一致する（整数なので許容誤差なし）。
   わざと 1 セル壊すと、違いが 1 つだけ見つかる（照合が空振りしていない）
3. 4 区分の和 ＝ 既存の総数の列（2015・2020 は `pop_<年>_*`、2025〜2050 は `pop_pred_2024_<年>_*`）・全駅・全半径・全年
4. 2020 年の 15〜64 歳 ＝ 第 1 段の `pop15_64_2020_*`（グラフとチップが同じ人数になる）
5. 守り：RLS が有効・anon は SELECT だけ・関数は SECURITY INVOKER で search_path は空・anon が実行できる
6. PostgREST（anon・名前つき引数）からも同じ 48 行・知らない駅は 0 行・anon は書き込めない・1 駅が速い

    python3 pipeline/golden_station_age_profile_test.py   # 全 PASS で exit 0
"""

from __future__ import annotations

import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from age_rules import CENSUS_YEARS, PROFILE_YEARS  # noqa: E402
from load_station_age import BAND_COLUMNS, CSV_COLUMNS, read_profiles  # noqa: E402
from load_to_supabase import db_params, value_column_type  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "src" / "shared" / "catalog" / "catalog.json"
STATEMENT_TIMEOUT = "180s"
#: 表の大きさの上限（計画書 §3.5 の見積もり約 8MB・実測 8.8MB に余裕を持たせる）。
TABLE_SIZE_LIMIT_MB = 12
#: 1 駅の関数の速さの目安（往復込み・温めたあと）。
FAST_MS = 150
CHECK_GRP = "武蔵小杉#0"
#: R6 推計（将来推計人口メッシュ）の版。2025 年からの総数の列は pop_pred_2024_<年>_*。
R6_VINTAGE = 2024
KEY_COLUMNS = ["grp", "radius_m", "year"]

Check = tuple[bool, str, str]


def fetch_function_rows(cur: psycopg.Cursor) -> tuple[pd.DataFrame, pd.Series]:
    """全駅について関数の出力を読む（COPY で一度に・約 45 万行）。CSV と同じ列と、推計の年か（projected）。"""
    columns = ", ".join(f"a.{column}" for column in CSV_COLUMNS[1:])
    sql = (
        f"copy (select s.grp, {columns}, a.projected from public.stations s "
        "cross join lateral public.station_age_profile(s.grp) a) to stdout with (format csv)"
    )
    buffer = io.BytesIO()
    with cur.copy(sql) as copy:
        for chunk in copy:
            buffer.write(chunk)
    buffer.seek(0)
    frame = pd.read_csv(buffer, names=[*CSV_COLUMNS, "projected"], dtype={"grp": str, "projected": str})
    projected = frame.pop("projected").eq("t")
    return frame.astype({"age_unknown": "Int64"}), projected


def mismatch_count(expected: pd.DataFrame, actual: pd.DataFrame) -> tuple[int, list[tuple[object, ...]]]:
    """（駅・半径・年）で並べた 2 つの表の、違うセルの数と例。行の集合が違えば行の数の差も数える。"""
    left = expected.set_index(KEY_COLUMNS).sort_index()
    right = actual.set_index(KEY_COLUMNS).sort_index()
    if not left.index.equals(right.index):
        return abs(len(left) - len(right)) + len(left.index.symmetric_difference(right.index)), []
    # 片方だけ空も違い（ne が NA を返すので True に倒す）・両方とも空（推計の年の不詳）は同じ。
    differs = (left.ne(right).fillna(True) & ~(left.isna() & right.isna())).astype(bool)
    where = differs.stack()
    where = where[where]
    return int(where.sum()), list(where.index[:3])


def catalog_keys(entries: list[dict], base_metric: str, vintage: int | None) -> dict[tuple[int, int], str]:
    """（半径・年）→ key（カタログから。key の綴りを書き写さない）。"""
    return {(entry["radiusM"], entry["year"]): entry["key"] for entry in entries
            if entry["baseMetric"] == base_metric and entry["vintage"] == vintage and entry["radiusM"] is not None}


def fetch_values(cur: psycopg.Cursor, keys: list[str]) -> pd.DataFrame:
    """値の表から key の値（grp・key・value）。"""
    cur.execute(
        "select s.grp, mc.key, v.value from public.station_values v "
        "join public.stations s on s.id = v.station_id join public.metric_columns mc on mc.id = v.column_id "
        "where mc.key = any(%s)", (keys,),
    )
    return pd.DataFrame(cur.fetchall(), columns=["grp", "key", "value"])


def stored(values: pd.Series, value_type: str) -> np.ndarray:
    return values.to_numpy(dtype="float32" if value_type == "real" else "float64")


def table_checks(cur: psycopg.Cursor) -> list[Check]:
    """1. 全駅に 1 行・大きさ。"""
    cur.execute("select (select count(*) from public.station_age_profiles), (select count(*) from public.stations), "
                "pg_total_relation_size('public.station_age_profiles')")
    rows, stations, size = cur.fetchone()
    size_mb = size / 1024 / 1024
    return [
        (rows == stations, f"全駅に 1 行（{stations:,} 駅）", f"{rows:,} 行"),
        (size_mb < TABLE_SIZE_LIMIT_MB, f"表の大きさ < {TABLE_SIZE_LIMIT_MB}MB（計画は約 8MB）", f"{size_mb:.1f}MB"),
    ]


def csv_checks(expected: pd.DataFrame, actual: pd.DataFrame, projected: pd.Series) -> list[Check]:
    """2. 関数の出力 ＝ CSV（全行）。わざと壊すと 1 つだけ見つかる。推計の年の印は国勢調査の年でない年。"""
    count, examples = mismatch_count(expected, actual)
    broken = expected.copy()
    broken.loc[broken.index[len(broken) // 2], "age65_74"] += 1
    found, _ = mismatch_count(broken, actual)
    wrong_projected = int((projected != ~actual["year"].isin(CENSUS_YEARS)).sum())
    return [
        (len(actual) == len(expected), f"関数の出力の行数 ＝ CSV の行数 = {len(expected):,}", f"{len(actual):,}"),
        (count == 0, "関数の出力が CSV と 1 セル残らず一致（4 区分・年齢不詳・推計の年の不詳は空）", f"{count} セル {examples}"),
        (found == 1, "わざと 1 セル壊すと、違いが 1 つだけ見つかる（照合が空振りしていない）", f"{found}"),
        (wrong_projected == 0, f"推計の印（projected）は {CENSUS_YEARS} 以外の年だけ", f"違う {wrong_projected:,} 行"),
    ]


def total_checks(cur: psycopg.Cursor, actual: pd.DataFrame, entries: list[dict]) -> list[Check]:
    """3〜4. 4 区分の和 ＝ 既存の総数の列（全駅・全半径・全年）／2020 年の 15〜64 歳 ＝ 第 1 段の列。"""
    value_type = value_column_type(cur)
    totals = {**{key: value for key, value in catalog_keys(entries, "pop", None).items() if key[1] in CENSUS_YEARS},
              **{key: value for key, value in catalog_keys(entries, "pop_pred", R6_VINTAGE).items()
                 if key[1] in PROFILE_YEARS and key[1] not in CENSUS_YEARS}}
    working = {key: value for key, value in catalog_keys(entries, "pop15_64", None).items() if key[1] == 2020}
    values = fetch_values(cur, [*totals.values(), *working.values()]).set_index(["grp", "key"])["value"]
    frame = actual.assign(total=actual[list(BAND_COLUMNS)].sum(axis=1))
    frame["total_key"] = [totals.get((r, y)) for r, y in zip(frame["radius_m"], frame["year"])]
    frame["working_key"] = [working.get((r, y)) for r, y in zip(frame["radius_m"], frame["year"])]
    total_db = values.reindex(pd.MultiIndex.from_arrays([frame["grp"], frame["total_key"]]))
    total_bad = int((stored(frame["total"].astype("float64"), value_type) != stored(total_db, value_type)).sum())
    picked = frame[frame["working_key"].notna()]
    working_db = values.reindex(pd.MultiIndex.from_arrays([picked["grp"], picked["working_key"]]))
    working_bad = int((stored(picked["age15_64"].astype("float64"), value_type) != stored(working_db, value_type)).sum())
    return [
        (len(totals) == len(PROFILE_YEARS) * 6, "総数の列をカタログから引けた（8 年 × 6 半径）", f"{len(totals)}"),
        (total_bad == 0, f"4 区分の和 ＝ 総数の列（全駅・全半径・全年の {len(frame):,} 組）", f"違う {total_bad:,} 組"),
        (working_bad == 0, f"2020 年の 15〜64 歳 ＝ pop15_64_2020_*（{len(picked):,} 組）", f"違う {working_bad:,} 組"),
    ]


def security_checks(cur: psycopg.Cursor) -> list[Check]:
    """5. RLS・anon の権限・関数の守り。"""
    cur.execute("select relrowsecurity from pg_class where oid = 'public.station_age_profiles'::regclass")
    (rls,) = cur.fetchone()
    # privilege_type は information_schema のドメイン型で、そのまま配列にすると psycopg が '{SELECT}' の文字列で返す。text にしてから集める。
    cur.execute("select array_agg(distinct privilege_type::text order by privilege_type::text) "
                "from information_schema.role_table_grants "
                "where table_schema = 'public' and table_name = 'station_age_profiles' and grantee = 'anon'")
    (anon_privileges,) = cur.fetchone()
    cur.execute("select prosecdef, proconfig, has_function_privilege('anon', oid, 'execute') from pg_proc "
                "where proname = 'station_age_profile'")
    definer, config, executable = cur.fetchone()
    return [
        (bool(rls), "RLS が有効", f"{rls}"),
        (anon_privileges == ["SELECT"], "anon は SELECT だけ", f"{anon_privileges}"),
        (not definer and config == ['search_path=""'], "関数は SECURITY INVOKER・search_path は空に固定", f"{definer} {config}"),
        (bool(executable), "anon が関数を実行できる", f"{executable}"),
    ]


def env_value(name: str) -> str:
    match = re.search(rf"^{name}=(.*)$", (ROOT / ".env").read_text(encoding="utf-8"), re.M)
    if match is None:
        raise SystemExit(f".env に {name} がありません")
    return match.group(1).strip().strip('"').strip("'")


def rest(path: str, body: object) -> tuple[int, object]:
    """PostgREST を anon で呼ぶ（URL と鍵は出さない）。"""
    key = env_value("SUPABASE_ANON_KEY")
    request = urllib.request.Request(
        f"{env_value('SUPABASE_URL')}/rest/v1/{path}", data=json.dumps(body).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def rest_checks(cur: psycopg.Cursor, expected: pd.DataFrame) -> list[Check]:
    """6. PostgREST（anon）からも同じ・知らない駅は 0 行・書き込めない・速い。"""
    status, rows = rest("rpc/station_age_profile", {"in_grp": CHECK_GRP})
    columns = list(CSV_COLUMNS[1:])
    want = expected[expected["grp"] == CHECK_GRP].sort_values(["radius_m", "year"])[columns]
    want_rows = [tuple(None if pd.isna(value) else int(value) for value in row) for row in want.itertuples(index=False)]
    got = [tuple(row[column] for column in columns) for row in rows] if isinstance(rows, list) else []
    same = status == 200 and got == want_rows
    unknown_status, unknown_rows = rest("rpc/station_age_profile", {"in_grp": "存在しない駅#9"})
    write_status, _ = rest("station_age_profiles", {"station_id": 1, "counts": [0] * 192, "unknown": [0] * 12})
    cur.execute("select * from public.station_age_profile(%s)", (CHECK_GRP,))  # 温める
    started = time.perf_counter()
    cur.execute("select * from public.station_age_profile(%s)", (CHECK_GRP,))
    cur.fetchall()
    elapsed_ms = (time.perf_counter() - started) * 1000
    return [
        (same, f"REST（anon・名前つき引数）からも {CHECK_GRP} の 48 行が同じ", f"HTTP {status}・{len(got)} 行"),
        (unknown_status == 200 and unknown_rows == [], "REST：知らない駅は 0 行（エラーにしない）", f"HTTP {unknown_status}"),
        (write_status in (401, 403), "REST：anon は書き込めない", f"HTTP {write_status}"),
        (elapsed_ms < FAST_MS, f"1 駅の関数が {FAST_MS}ms 未満（往復込み）", f"{elapsed_ms:.0f}ms"),
    ]


def main() -> int:
    entries = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["entries"]
    expected = read_profiles().astype({"age_unknown": "Int64"})
    with psycopg.connect(**db_params()) as conn, conn.cursor() as cur:
        cur.execute(f"set statement_timeout = '{STATEMENT_TIMEOUT}'")
        actual, projected = fetch_function_rows(cur)
        checks = [*table_checks(cur), *csv_checks(expected, actual, projected), *total_checks(cur, actual, entries),
                  *security_checks(cur), *rest_checks(cur, expected)]

    passed = sum(1 for ok, _, _ in checks if ok)
    print(f"年齢別の人口のグラフ用の表の黄金テスト — {passed}/{len(checks)}\n")
    for ok, name, detail in checks:
        print(f"  {'✓' if ok else '✗ FAIL'}  {name}" + ("" if ok else f"  [{detail}]"))
    print("\n" + ("✅ ALL PASS" if passed == len(checks) else "❌ FAILED"))
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
