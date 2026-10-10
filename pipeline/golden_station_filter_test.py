"""B5 で見つけたこと 2 — 駅の絞り込みを「条件に合う駅の集合」にする（本物の DB・2026-10-10）。

migration `20261010230100_station_filter_set.sql` を確かめる。以前は、会社・法令上の路線・種別・路線（運行系統）で絞ると、
駅ごとに展開できない関数を呼んでいた（約 160ms）。

  1. 同じ駅：20 通りの条件で、5 つの RPC（rank_by_column・scatter_points・list_stations・area_station_stats・
     station_metric_values）の駅の集合が、関数を通さない直接の SQL（以前の述語と同じ意味）と一致する。
     --trial では、当てる前の関数の結果そのもの（一覧の並び・順位と値・散布の点・分布・色分けの値）とも比べる
  2. 速さ：会社・法令上の路線・種別・路線で絞っても速く（以前の 160ms 台に対して）、絞らないときも遅くならない
  3. 形：絞り込みは 1 つ（stations_matching_filters）・SET を持たない・呼び出し側に展開され、会社・路線の副問い合わせは
     1 回だけ引いてハッシュにする・古い述語は無い・呼び出し側の設定は以前のまま・anon が実行できる
  4. PostgREST（anon）からも同じ（当てたあとだけ）

    python3 pipeline/golden_station_filter_test.py           # 当てたあと：全 PASS で exit 0
    python3 pipeline/golden_station_filter_test.py --trial   # 当てる前：migration をトランザクションの中で当てて確かめ、ロールバック
"""

from __future__ import annotations

import json
import re
import statistics
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import ROOT, db_params  # noqa: E402

MIGRATION = ROOT / "supabase" / "migrations" / "20261010230100_station_filter_set.sql"
PRECISION_MIGRATION = ROOT / "supabase" / "migrations" / "20261010230000_jsonb_number_precision.sql"
CALLERS = ("rank_by_column", "scatter_points", "list_stations", "area_station_stats", "station_metric_values")
OLD_PREDICATES = ("station_matches_filters", "station_matches_railway")
#: 全駅に値がある指標（駅の集合の大きさと比べられる）と、散布のもう 1 軸。
FULL_METRIC, SECOND_METRIC = "pop_2020_1km", "pop_2015_1km"
#: 呼び出し側の設定（以前のまま保つ）。
EXPECTED_CONFIG = {
    "rank_by_column": ['search_path=""'],
    "list_stations": ['search_path=""'],
    "scatter_points": ['search_path=""', "extra_float_digits=3"],
    "area_station_stats": ['search_path=""', "extra_float_digits=3"],
    "station_metric_values": ['search_path=""', "extra_float_digits=3"],
}
TAKEBASHI = "竹橋#0"
TOKYO_BOX = (139.5, 35.5, 140.0, 35.8)
#: 速さの目安（順位表・サーバの中の時間・ms）。以前は会社・路線などで絞ると 180〜225ms（駅ごとに関数を呼んでいた）、
#: 直したあとは 50ms 前後。絞らない順位表（全駅を並べる・約 95ms）より遅くならないことも見る。
FAST_MS = 100.0
RUNS = 7


@dataclass(frozen=True)
class Case:
    label: str
    prefs: list[str] | None = None
    muni: str | None = None
    ops: list[str] | None = None
    routes: list[str] | None = None
    types: list[int] | None = None
    lines: list[int] | None = None
    bbox: tuple[float, float, float, float] | None = None
    near_m: float | None = None
    railway: bool = field(default=False)


CASES = [
    Case("絞らない"),
    Case("都道府県（東京都）", prefs=["東京都"]),
    Case("市区町村の名前（横浜市）", muni="横浜市"),
    Case("市区町村のコード（13101）", muni="13101"),
    Case("範囲（首都圏）", bbox=TOKYO_BOX),
    Case("竹橋から 5km", near_m=5000.0),
    Case("路線（東急東横線）", lines=[26001], railway=True),
    Case("路線 2 本（東横線・山手線）", lines=[26001, 11302], railway=True),
    Case("会社（東京地下鉄）", ops=["東京地下鉄"], railway=True),
    Case("会社（JR東日本）", ops=["東日本旅客鉄道"], railway=True),
    # 会社は「どれか」（東京メトロか都営）。「すべて」だと 29 駅しかない
    Case("会社 2 つ（東京地下鉄・東京都）", ops=["東京地下鉄", "東京都"], railway=True),
    Case("法令上の路線（東横線）", routes=["東横線"], railway=True),
    Case("会社＋法令上の路線（JR東日本・中央線）", ops=["東日本旅客鉄道"], routes=["中央線"], railway=True),
    Case("種別（地下鉄）", types=[4], railway=True),
    Case("会社＋種別（東京地下鉄・地下鉄）", ops=["東京地下鉄"], types=[4], railway=True),
    Case("会社＋路線（東急電鉄・東横線）", ops=["東急電鉄"], lines=[26001], railway=True),
    Case("都道府県＋路線（東京都・山手線）", prefs=["東京都"], lines=[11302], railway=True),
    Case("市区町村＋会社（横浜市・東急電鉄）", muni="横浜市", ops=["東急電鉄"], railway=True),
    Case("範囲＋会社（首都圏・東京地下鉄）", bbox=TOKYO_BOX, ops=["東京地下鉄"], railway=True),
    Case("竹橋から 5km＋路線（山手線）", near_m=5000.0, lines=[11302], railway=True),
]


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


# --- 条件 → RPC の引数・直接の SQL ---------------------------------------------------------


def origin(cur: psycopg.Cursor) -> tuple[float, float]:
    cur.execute("select lon, lat from public.stations where grp = %s", (TAKEBASHI,))
    lon, lat = cur.fetchone()
    return float(lon), float(lat)


def rpc_args(case: Case, lon_lat: tuple[float, float], routes_name: str = "routes") -> dict[str, object]:
    """RPC の名前つき引数（無い条件は null）。"""
    west, south, east, north = case.bbox if case.bbox else (None, None, None, None)
    near = case.near_m is not None
    return {
        "prefs": case.prefs, "muni": case.muni, "ops": case.ops, routes_name: case.routes,
        "route_types": case.types, "line_cds": case.lines,
        "west": west, "south": south, "east": east, "north": north,
        "near_lon": lon_lat[0] if near else None, "near_lat": lon_lat[1] if near else None, "near_radius_m": case.near_m,
    }


def railway_sql(case: Case, params: list[object]) -> list[str]:
    """会社・法令上の路線・種別・路線の条件（以前の述語と同じ意味を、別の書き方で）。"""
    conds: list[str] = []
    if case.routes or case.types:
        alts = []
        if case.routes:
            alts.append("sr.route = any(%s)")
            params.append(case.routes)
        if case.types:
            alts.append("sr.route_type = any(%s)")
            params.append(case.types)
        same_operator = " and sr.operator = any(%s)" if case.ops else ""
        if case.ops:
            params.append(case.ops)
        conds.append(f"exists (select 1 from public.station_routes sr where sr.station_id = s.id and ({' or '.join(alts)}){same_operator})")
    elif case.ops:
        conds.append("string_to_array(coalesce(s.operators, ''), '・') && %s")
        params.append(case.ops)
    if case.lines:
        conds.append("exists (select 1 from public.line_stations ls where ls.station_id = s.id and ls.line_cd = any(%s))")
        params.append(case.lines)
    return conds


def expected_grps(cur: psycopg.Cursor, case: Case, lon_lat: tuple[float, float]) -> set[str]:
    """関数を通さない直接の SQL で、条件に合う駅。"""
    conds: list[str] = ["true"]
    params: list[object] = []
    if case.prefs:
        conds.append("s.prefecture = any(%s)")
        params.append(case.prefs)
    if case.muni:
        conds.append("(starts_with(coalesce(s.municipality, ''), %s) or starts_with(coalesce(s.municipality_code, ''), %s))")
        params += [case.muni, case.muni]
    if case.bbox:
        conds.append("s.geom && extensions.st_makeenvelope(%s, %s, %s, %s, 4326)")
        params += list(case.bbox)
    if case.near_m is not None:
        conds.append("extensions.st_dwithin(s.geom::extensions.geography, "
                     "extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)::extensions.geography, %s)")
        params += [lon_lat[0], lon_lat[1], case.near_m]
    conds += railway_sql(case, params)
    cur.execute(f"select s.grp from public.stations s where {' and '.join(conds)}", params)
    return {row[0] for row in cur.fetchall()}


# --- RPC を呼ぶ（この接続で直接） -----------------------------------------------------------


def call(cur: psycopg.Cursor, fn: str, args: dict[str, object], returns_table: bool) -> object:
    names = list(args)
    placeholders = ", ".join(f"{name} => %({name})s" for name in names)
    if returns_table:
        cur.execute(f"select * from public.{fn}({placeholders})", args)
        return cur.fetchall()
    cur.execute(f"select public.{fn}({placeholders})", args)
    return cur.fetchone()[0]


def outputs(cur: psycopg.Cursor, case: Case, lon_lat: tuple[float, float]) -> dict[str, object]:
    """5 つの RPC の結果（比べやすい形に整えて）。"""
    args = rpc_args(case, lon_lat)
    ranked = call(cur, "rank_by_column", {"column_key": FULL_METRIC, "lim": 20000, **args}, True)
    points = call(cur, "scatter_points", {"x_key": FULL_METRIC, "y_key": SECOND_METRIC, **args}, False)
    listed = call(cur, "list_stations", {**rpc_args(case, lon_lat, "routes_in"), "lim": 2000}, True)
    stats = call(cur, "area_station_stats", {"keys": [FULL_METRIC, "pop_gr_2020_2015_1km"], **args}, False)
    values = call(cur, "station_metric_values", {"column_key": FULL_METRIC, **args}, False)
    return {
        # 順位表：同じ値の駅の並びは決まっていない（以前から）ので、駅・値・旗・距離・総数の組と、値の順に並んでいることを見る
        "rank_rows": sorted((row[0], row[6], row[7], row[9], row[10]) for row in ranked),
        "rank_ordered": all(a[6] >= b[6] for a, b in zip(ranked, ranked[1:], strict=False)),
        "scatter": sorted(json.dumps(point, sort_keys=True, ensure_ascii=False) for point in points),
        "list": listed,
        "stats": stats,
        "values": values,
    }


#: 一覧（list_stations）が返す駅の上限（関数の仕様・乗降客数の多い順で切る）。
LIST_LIMIT = 2000


def grps_from(out: dict[str, object]) -> dict[str, set[str]]:
    return {
        "rank_by_column": {row[0] for row in out["rank_rows"]},
        "station_metric_values": {row[0] for row in out["values"]["values"]},
    }


def list_matches(listed: list[tuple[object, ...]], truth: set[str]) -> bool:
    """一覧は上限（2,000）で切るので、多いときは上限の数だけ、条件に合う駅から返ることを見る。"""
    grps = {row[0] for row in listed}
    if len(truth) <= LIST_LIMIT:
        return grps == truth
    return len(grps) == LIST_LIMIT and grps <= truth


# --- 検査 ---------------------------------------------------------------------------------


def check_same_stations(checks: Checks, cur: psycopg.Cursor, results: dict[str, dict[str, object]]) -> None:
    lon_lat = origin(cur)
    for case in CASES:
        truth = expected_grps(cur, case, lon_lat)
        out = results[case.label]
        sets = grps_from(out)
        cur.execute("select count(*) from public.stations s join public.station_values v on v.station_id = s.id "
                    "join public.metric_columns mc on mc.id = v.column_id where mc.key = %s and s.grp = any(%s)",
                    (SECOND_METRIC, list(truth)))
        both = cur.fetchone()[0]
        ok = (all(found == truth for found in sets.values())
              and list_matches(out["list"], truth)
              and out["stats"]["station_count"] == len(truth)
              and out["values"]["station_count"] == len(truth)
              and len(out["scatter"]) == both
              and out["rank_ordered"])
        detail = f"{len(truth)} 駅" + ("" if ok else f"・{ {name: len(found) for name, found in sets.items()} }・一覧 {len(out['list'])}・分布 {out['stats']['station_count']}")
        checks.add(ok, f"同じ駅：{case.label}（5 つの RPC・直接の SQL と一致）", detail)


def check_same_as_before(checks: Checks, before: dict[str, dict[str, object]], after: dict[str, dict[str, object]]) -> None:
    differing = [label for label in before if before[label] != after[label]]
    checks.add(not differing, f"当てる前の関数と同じ結果（{len(before)} 通り × 一覧の並び・順位と値・散布・分布・色分けの値）",
               ", ".join(differing))


def server_ms(cur: psycopg.Cursor, sql: str, params: dict[str, object], rtt: float) -> float:
    samples = []
    for _ in range(RUNS):
        start = time.perf_counter()
        cur.execute(sql, params)
        cur.fetchall()
        samples.append((time.perf_counter() - start) * 1000 - rtt)
    return statistics.median(samples)


def round_trip_ms(cur: psycopg.Cursor) -> float:
    samples = []
    for _ in range(15):
        start = time.perf_counter()
        cur.execute("select 1")
        cur.fetchall()
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples)


def rank_ms(cur: psycopg.Cursor, case: Case, lon_lat: tuple[float, float], rtt: float) -> float:
    args = {"column_key": FULL_METRIC, "lim": 50, **rpc_args(case, lon_lat)}
    placeholders = ", ".join(f"{name} => %({name})s" for name in args)
    return server_ms(cur, f"select * from public.rank_by_column({placeholders})", args, rtt)


def check_speed(checks: Checks, cur: psycopg.Cursor, label: str) -> dict[str, float]:
    """順位表の速さ（anon・サーバの中の時間）。絞らないときと、会社・路線などで絞ったとき。"""
    lon_lat = origin(cur)
    rtt = round_trip_ms(cur)
    cur.execute("set local role anon")
    timings = {case.label: rank_ms(cur, case, lon_lat, rtt) for case in CASES if case.railway or case.label == "絞らない"}
    cur.execute("reset role")
    base = timings["絞らない"]
    slowest = max((ms, name) for name, ms in timings.items() if name != "絞らない")
    detail = f"絞らない {base:.0f}ms・最も遅い {slowest[1]} {slowest[0]:.0f}ms"
    if label:
        checks.add(slowest[0] < FAST_MS and slowest[0] <= base, f"{label}：会社・路線などで絞っても速い（{FAST_MS:.0f}ms 未満・絞らないときより遅くない）", detail)
    return timings


def check_shape(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select count(*) from pg_proc where proname = any(%s)", (list(OLD_PREDICATES),))
    checks.add(cur.fetchone()[0] == 0, "古い述語（station_matches_filters・station_matches_railway）は無い", "")
    cur.execute(
        "select pg_get_function_identity_arguments(p.oid), p.proconfig, p.prosecdef, p.proretset, p.provolatile, l.lanname "
        "from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'stations_matching_filters'"
    )
    rows = cur.fetchall()
    one = len(rows) == 1 and len(rows[0][0].split(", ")) == 13
    plain = one and rows[0][1] is None and not rows[0][2] and rows[0][3] and rows[0][4] == "s" and rows[0][5] == "sql"
    checks.add(plain, "絞り込みは 1 つ（条件 13）・SET を持たない・security invoker・集合を返す stable な SQL", f"{rows}")
    cur.execute(
        "explain (format text) select count(*) from public.stations_matching_filters("
        "array['東京都'], null, null, null, null, null, null, null, null, null, null, null, null)"
    )
    plan = "\n".join(row[0] for row in cur.fetchall())
    checks.add("Function Scan" not in plan and "prefecture" in plan, "呼び出し側に展開される（実行計画に関数の走査が出ず、都道府県の比較が出る）", "")
    check_hashed(checks, cur)
    check_callers(checks, cur)


#: 本体の計画を見るときの引数（汎用の計画なので値は形だけ。会社・法令上の路線・種別・路線を全部入れて、副問い合わせを 2 つとも出す）。
BODY_VALUES: dict[str, dict[str, object]] = {
    "rank_by_column": {"column_key": FULL_METRIC, "dir": "desc", "lim": 50, "off": 0, "exclude_lown": False},
    "scatter_points": {"x_key": FULL_METRIC, "y_key": SECOND_METRIC},
    "list_stations": {"lim": 300},
    "area_station_stats": {"keys": [FULL_METRIC]},
    "station_metric_values": {"column_key": FULL_METRIC},
}
RAILWAY_VALUES = {"ops": ["東京地下鉄"], "routes": ["東横線"], "routes_in": ["東横線"], "route_types": [4], "line_cds": [26001]}


def body_plan(cur: psycopg.Cursor, fn: str) -> str:
    """RPC の本体を、引数を $n にした PREPARE にして、汎用の計画（SQL の関数の中と同じ）を返す。
    Supabase では auto_explain を読み込めないので、関数の中の計画はこの形で見る。"""
    cur.execute("select p.prosrc, p.proargnames, p.proargtypes::regtype[]::text[] from pg_proc p "
                "join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = %s", (fn,))
    src, names, types = cur.fetchone()
    names = names[: len(types)]
    for index, name in enumerate(names, start=1):
        src = re.sub(rf"(?<![.\w]){re.escape(name)}(?!\w)", f"${index}", src)
    values = {**RAILWAY_VALUES, **BODY_VALUES[fn]}
    args = sql.SQL(", ").join(
        sql.SQL("{}::{}").format(sql.Literal(values.get(name)), sql.SQL(kind)) for name, kind in zip(names, types, strict=True)
    )
    cur.execute(f"prepare body({', '.join(types)}) as {src}")
    cur.execute(sql.SQL("explain (format text) execute body({})").format(args))
    plan = "\n".join(row[0] for row in cur.fetchall())
    cur.execute("deallocate body")
    return plan


def check_hashed(checks: Checks, cur: psycopg.Cursor) -> None:
    """5 つの RPC の本体（汎用の計画）で、会社・法令上の路線と路線の副問い合わせは 1 回だけ引いてハッシュにする。
    EXISTS で書くと、順位表の中では駅ごとの索引の引き直しを選ぶ（`= any (select …)` は必ずハッシュになる）。
    EXPLAIN は副計画を「参照（hashed SubPlan 2）」と「見出し（SubPlan 2）」の 2 か所に書くので、Filter の中の参照だけを数える。"""
    cur.execute("set local plan_cache_mode = force_generic_plan")
    found = {}
    for fn in CALLERS:
        filters = "\n".join(line for line in body_plan(cur, fn).splitlines() if line.strip().startswith("Filter:"))
        references = re.findall(r"(hashed )?SubPlan \d+\)", filters)
        found[fn] = (len([match for match in references if match]), len(references))
    cur.execute("reset plan_cache_mode")
    ok = all(hashed == total == 2 for hashed, total in found.values())
    checks.add(ok, "5 つの RPC の中で、会社・法令上の路線と路線の副問い合わせはどちらもハッシュ（1 回だけ引く）",
               f"{ {fn: f'{hashed}/{total}' for fn, (hashed, total) in found.items()} }")


def check_callers(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select p.proname, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                "where n.nspname = 'public' and p.proname = any(%s)", (list(CALLERS),))
    rows = {name: (config, src) for name, config, src in cur.fetchall()}
    uses = all("public.stations_matching_filters(" in src and "station_matches_filters" not in src for _, src in rows.values())
    checks.add(len(rows) == len(CALLERS) and uses, "5 つの RPC が絞り込みの集合を使う（古い述語を呼ばない）", "")
    configs = {name: sorted(config or []) for name, (config, _) in rows.items()}
    expected = {name: sorted(config) for name, config in EXPECTED_CONFIG.items()}
    checks.add(configs == expected, "呼び出し側の設定は以前のまま（search_path 空・数を書く 3 つは extra_float_digits = 3）", f"{configs}")
    missing = []
    for fn in (*CALLERS, "stations_matching_filters"):
        cur.execute("select bool_and(has_function_privilege('anon', oid, 'execute')) from pg_proc where proname = %s", (fn,))
        if not cur.fetchone()[0]:
            missing.append(fn)
    checks.add(not missing, "anon が絞り込みと 5 つの RPC を実行できる", f"{missing}" if missing else "")


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
    lon_lat = origin(cur)
    for case in [c for c in CASES if c.label in ("路線（東急東横線）", "会社（東京地下鉄）", "会社＋種別（東京地下鉄・地下鉄）")]:
        truth = expected_grps(cur, case, lon_lat)
        args = {key: value for key, value in rpc_args(case, lon_lat).items() if value is not None}
        ranked = rest("rank_by_column", {"column_key": FULL_METRIC, "lim": 1, **args})
        total = ranked[0]["total"] if isinstance(ranked, list) and ranked else None
        listed = rest("list_stations", {**{k if k != "routes" else "routes_in": v for k, v in args.items()}, "lim": 2000})
        grps = {row["grp"] for row in listed} if isinstance(listed, list) else set()
        checks.add(total == len(truth) and grps == truth, f"REST（anon）：{case.label} の順位表の総数と一覧の駅", f"{total}・{len(grps)}")


def run(cur: psycopg.Cursor, checks: Checks, before: dict[str, dict[str, object]] | None) -> None:
    lon_lat = origin(cur)
    after = {case.label: outputs(cur, case, lon_lat) for case in CASES}
    check_same_stations(checks, cur, after)
    if before is not None:
        check_same_as_before(checks, before, after)
    check_shape(checks, cur)
    check_speed(checks, cur, "当てたあと")


def main() -> int:
    trial = "--trial" in sys.argv
    checks = Checks()
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            before = None
            if trial:
                cur.execute(PRECISION_MIGRATION.read_text(encoding="utf-8"))
                lon_lat = origin(cur)
                before = {case.label: outputs(cur, case, lon_lat) for case in CASES}
                timings = check_speed(checks, cur, "")
                slow = {name: round(ms) for name, ms in timings.items()}
                print(f"（当てる前の順位表の速さ ms：{slow}）")
                cur.execute(MIGRATION.read_text(encoding="utf-8"))
                print("（試し：migration をトランザクションの中で当てた。最後にロールバックする）")
            run(cur, checks, before)
            if not trial:
                check_rest(checks, cur)
        if trial:
            conn.rollback()
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
