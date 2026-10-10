"""L2 — 路線（運行系統）の条件 `line_cds` のゴールデンテスト（本物の DB・2026-10-08）。

migration `20261008150000_lines_filter.sql` が、述語 station_matches_filters と 3 つの RPC（rank_by_column・
scatter_points・list_stations）に足した `line_cds` と、一覧 `line_names()` を確かめる。期待値は RPC を通さずに
`line_stations`・`stations` から直接数える（経路が違うのに同じ結果になることが、双方の正しさの裏付け）。

  1. 路線ごとの駅の集合：list_stations(line_cds=[路線]) が line_stations と**完全一致**（抜き取り＋主な路線）
  2. 路線どうしは OR・ほかの条件とは AND（会社・都道府県）
  3. ランキング・散布でも同じ件数
  4. 一覧 line_names()：路線数・駅数・都道府県（駅の多い順）
  5. 以前の呼び方（line_cds なし）は以前と同じ結果・旧 5 引数の述語は残っていない・anon が実行できる
  6. PostgREST（anon・名前つき引数）からも同じ結果（アプリは supabase-js＝REST で呼ぶ）

    python3 pipeline/golden_lines_test.py   # 全 PASS で exit 0

2026-10-10：述語は「条件に合う駅の集合」を返す stations_matching_filters に作り直した（migration
`20261010230100_station_filter_set.sql`・`golden_station_filter_test.py`）。5 の形の検査はそれに合わせてある。
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import ROOT, db_params  # noqa: E402

#: 全駅に値がある指標（ランキング・散布の件数を、駅の集合の大きさと比べられる）。
FULL_METRIC = "pop_2020_1km"
FULL_METRIC_2 = "pop_2020_2km"
#: 主な路線（L1 の固定の確認と同じ顔ぶれ）。
YAMANOTE, FUKUTOSHIN, TOZAI, ASAKUSA = 11302, 28010, 28004, 99302
#: 抜き取り：路線コードの順で何本おきに見るか（601 路線 → 約 40 本）。
SAMPLE_EVERY = 15


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def line_grps(cur: psycopg.Cursor, line_cd: int) -> set[str]:
    cur.execute(
        "select s.grp from public.line_stations ls join public.stations s on s.id = ls.station_id where ls.line_cd = %s",
        (line_cd,),
    )
    return {row[0] for row in cur.fetchall()}


def listed(cur: psycopg.Cursor, **args: object) -> set[str]:
    names = ", ".join(f"{key} => %({key})s" for key in args)
    cur.execute(f"select grp from public.list_stations({names}, lim => 2000)", args)
    return {row[0] for row in cur.fetchall()}


def check_sets(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select line_cd from public.lines order by line_cd")
    codes = [row[0] for row in cur.fetchall()]
    sample = sorted(set(codes[::SAMPLE_EVERY]) | {YAMANOTE, FUKUTOSHIN, TOZAI, ASAKUSA})
    mismatched = [code for code in sample if listed(cur, line_cds=[code]) != line_grps(cur, code)]
    checks.add(not mismatched, "list_stations(line_cds) が line_stations と完全一致", f"{len(sample)} 路線" + (f"・不一致 {mismatched}" if mismatched else ""))
    union = line_grps(cur, YAMANOTE) | line_grps(cur, FUKUTOSHIN)
    checks.add(listed(cur, line_cds=[YAMANOTE, FUKUTOSHIN]) == union, "路線どうしは OR（山手線＋副都心線＝和集合）", f"{len(union)} 駅")
    cur.execute("select grp from public.stations where string_to_array(coalesce(operators, ''), '・') && array['東京地下鉄']")
    metro = {row[0] for row in cur.fetchall()}
    expected = line_grps(cur, YAMANOTE) & metro
    got = listed(cur, line_cds=[YAMANOTE], ops=["東京地下鉄"])
    checks.add(got == expected, "会社とは AND（山手線 × 東京地下鉄＝乗換駅）", f"{len(got)} 駅")
    cur.execute("select grp from public.stations where prefecture = '千葉県'")
    chiba = {row[0] for row in cur.fetchall()}
    got = listed(cur, line_cds=[TOZAI], prefs=["千葉県"])
    checks.add(got == line_grps(cur, TOZAI) & chiba, "都道府県とは AND（東西線 × 千葉県）", f"{len(got)} 駅")


def check_rank_scatter(checks: Checks, cur: psycopg.Cursor) -> None:
    yamanote = len(line_grps(cur, YAMANOTE))
    cur.execute("select total from public.rank_by_column(column_key => %s, line_cds => %s, lim => 1)", (FULL_METRIC, [YAMANOTE]))
    total = cur.fetchone()[0]
    checks.add(total == yamanote == 30, "rank_by_column(line_cds=山手線) の件数＝30", f"{total}")
    cur.execute(
        "select jsonb_array_length(public.scatter_points(x_key => %s, y_key => %s, line_cds => %s))",
        (FULL_METRIC, FULL_METRIC_2, [YAMANOTE]),
    )
    points = cur.fetchone()[0]
    checks.add(points == yamanote, "scatter_points(line_cds=山手線) の点＝30", f"{points}")
    cur.execute(
        "select total from public.rank_by_column(column_key => %s, prefs => %s, line_cds => %s, lim => 1)",
        (FULL_METRIC, ["千葉県"], [TOZAI]),
    )
    row = cur.fetchone()
    cur.execute(
        "select count(*) from public.line_stations ls join public.stations s on s.id = ls.station_id "
        "where ls.line_cd = %s and s.prefecture = '千葉県'",
        (TOZAI,),
    )
    expected = cur.fetchone()[0]
    checks.add(row is not None and row[0] == expected, "rank_by_column(東西線 × 千葉県) の件数", f"{row[0] if row else 0}（期待 {expected}）")


def check_catalog(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select line_cd, name, station_count, prefectures from public.line_names()")
    rows = {row[0]: row for row in cur.fetchall()}
    cur.execute("select count(*) from public.lines")
    checks.add(len(rows) == cur.fetchone()[0] == 601, "line_names() の路線数＝601", f"{len(rows)}")
    cur.execute("select line_cd, count(*) from public.line_stations group by line_cd")
    counts = dict(cur.fetchall())
    wrong = [code for code, row in rows.items() if row[2] != counts.get(code)]
    checks.add(not wrong, "line_names() の駅数＝line_stations の行数", f"{wrong[:5]}" if wrong else "")
    empty = [code for code, row in rows.items() if not row[3]]
    checks.add(not empty, "どの路線にも都道府県が付く", f"{empty[:5]}" if empty else "")
    checks.add(rows[YAMANOTE][3] == ["東京都"], "JR山手線の都道府県＝東京都", f"{rows[YAMANOTE][3]}")
    checks.add(rows[TOZAI][3] == ["東京都", "千葉県"], "東京メトロ東西線の都道府県（駅の多い順）＝東京都・千葉県", f"{rows[TOZAI][3]}")


def check_compat(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select count(*) from public.stations")
    stations = cur.fetchone()[0]
    cur.execute("select total from public.rank_by_column(column_key => %s, lim => 1)", (FULL_METRIC,))
    checks.add(cur.fetchone()[0] == stations, "line_cds なしのランキングは全駅（以前と同じ）", f"{stations}")
    cur.execute("select grp from public.stations where string_to_array(coalesce(operators, ''), '・') && array['東急電鉄']")
    tokyu = {row[0] for row in cur.fetchall()}
    checks.add(listed(cur, ops=["東急電鉄"]) == tokyu, "line_cds なしの一覧（会社）は以前と同じ集合", f"{len(tokyu)} 駅")
    cur.execute("select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'stations_matching_filters'")
    signatures = [row[0] for row in cur.fetchall()]
    # 述語は B2（20261008210000）で駅の列＋条件 13 に、2026-10-10（20261010230100）で「条件に合う駅の集合」に作り直した。
    one = len(signatures) == 1 and "line_cds integer[]" in signatures[0]
    checks.add(one, "絞り込みは 1 つだけで line_cds を受ける（旧版は落とした）", f"{len(signatures)} 個")
    missing = []
    for fn in ("rank_by_column", "scatter_points", "list_stations", "line_names", "stations_matching_filters"):
        cur.execute("select bool_and(has_function_privilege('anon', oid, 'execute')) from pg_proc where proname = %s", (fn,))
        if not cur.fetchone()[0]:
            missing.append(fn)
    checks.add(not missing, "anon が新しい関数を実行できる", f"{missing}" if missing else "")


def rest(fn: str, args: dict[str, object]) -> object:
    env = (ROOT / ".env").read_text(encoding="utf-8")
    url = re.search(r"^SUPABASE_URL=(.*)$", env, re.M).group(1).strip().strip('"')
    key = re.search(r"^SUPABASE_ANON_KEY=(.*)$", env, re.M).group(1).strip().strip('"')
    request = urllib.request.Request(
        f"{url}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def check_rest(checks: Checks, cur: psycopg.Cursor) -> None:
    rows = rest("list_stations", {"line_cds": [YAMANOTE], "lim": 100})
    grps = {row["grp"] for row in rows} if isinstance(rows, list) else set()
    checks.add(grps == line_grps(cur, YAMANOTE), "REST（anon）の list_stations(line_cds) も同じ集合", f"{len(grps)} 駅")
    ranked = rest("rank_by_column", {"column_key": FULL_METRIC, "line_cds": [FUKUTOSHIN], "lim": 1})
    total = ranked[0]["total"] if isinstance(ranked, list) and ranked else None
    checks.add(total == 16, "REST（anon）の rank_by_column(副都心線) の件数＝16", f"{total}")


def main() -> int:
    checks = Checks()
    with psycopg.connect(**db_params()) as conn, conn.cursor() as cur:
        check_sets(checks, cur)
        check_rank_scatter(checks, cur)
        check_catalog(checks, cur)
        check_compat(checks, cur)
        check_rest(checks, cur)
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
