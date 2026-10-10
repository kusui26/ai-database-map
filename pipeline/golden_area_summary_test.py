"""B5b — エリア要約の共通 API の読み口（SQL）のゴールデンテスト（本物の DB・2026-10-10）。

migration `20261010210000_area_summary.sql` の 5 つの関数を確かめる。期待値は関数を通さずに、表から直接（別の書き方の SQL と
Python で）数える——経路が違うのに同じ結果になることが、双方の正しさの裏付け。

  1. area_rows：値が area_values と一致・内訳の子（政令市 → 区・東京 23 区 → 23 の区・全国 → 都道府県）・駅の数
  2. area_catalog：行政区域 1,961・駅の数（全国＝都道府県の和＝市区町村と区の和＝9,273・政令市＝区の和）
  3. area_station_stats：エリアの駅の値の数・⚠ の数・四分位・上位と下位が、直接の計算（numpy の線形補間＝percentile_cont）と一致。
     エリアの写し方 6 通り（都道府県・政令市の名前の前方一致・東京 23 区のコード「131」・市区町村のコード・路線・起点から 5km・範囲）
  4. station_metric_values：駅の集合・値・⚠ が直接の計算と一致
  5. SECURITY INVOKER・search_path 空・anon が実行できる・速さ・PostgREST（anon）から呼べる

    python3 pipeline/golden_area_summary_test.py           # 当てたあと：全 PASS で exit 0
    python3 pipeline/golden_area_summary_test.py --trial   # 当てる前：migration をトランザクションの中で当てて確かめ、ロールバック（REST は見ない）
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import ROOT, db_params  # noqa: E402

MIGRATION = ROOT / "supabase" / "migrations" / "20261010210000_area_summary.sql"
FUNCTIONS = ("area_station_counts", "area_rows", "area_catalog", "area_station_stats", "station_metric_values")
#: 分布を見る指標（エリア要約の既定の顔ぶれ＋フラグのある増減率）。
KEYS = ["pop_2020_1km", "pop_gr_2020_2015_1km", "pop_gr_pred_2024_2050_1km", "lp_med_2026_1km", "emp_n_2021_1km"]
#: 横浜の地図（B3 の評価と同じくらいの範囲）。
YOKOHAMA_BBOX = (139.55, 35.40, 139.72, 35.53)
TAKEBASHI = "竹橋#0"
NEAR_M = 5000.0
TOYOKO = 26001
#: 速さの目安（全国 9,273 駅 × 5 指標の分布・東京都の内訳つきの行）。
FAST_STATS_MS = 1500
FAST_ROWS_MS = 500
RELATIVE = 1e-9


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


# --- エリア → 絞り込み（関数の引数）と、直接の駅の集合（別の書き方の SQL） ---------------------------


def area_cases(cur: psycopg.Cursor) -> list[tuple[str, dict[str, object], str, tuple[object, ...]]]:
    """(名前, 関数の絞り込み, 直接の駅の集合の where 句, その引数)。"""
    cur.execute("select lon, lat from public.stations where grp = %s", (TAKEBASHI,))
    lon, lat = cur.fetchone()  # type: ignore[misc]
    west, south, east, north = YOKOHAMA_BBOX
    return [
        ("東京都（都道府県）", {"prefs": ["東京都"]}, "s.prefecture = %s", ("東京都",)),
        ("横浜市（政令市・名前の前方一致）", {"muni": "横浜市"}, "s.municipality like %s", ("横浜市%",)),
        ("東京 23 区（コード 131）", {"muni": "131"}, "s.municipality_code like %s", ("131%",)),
        ("大磯町（市区町村のコード）", {"muni": "14341"}, "s.municipality_code = %s", ("14341",)),
        ("東急東横線（路線）", {"line_cds": [TOYOKO]},
         "exists (select 1 from public.line_stations ls where ls.station_id = s.id and ls.line_cd = %s)", (TOYOKO,)),
        ("竹橋から 5km（近傍）", {"near_lon": lon, "near_lat": lat, "near_radius_m": NEAR_M},
         "extensions.st_dwithin(s.geom::extensions.geography, "
         "extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)::extensions.geography, %s)", (lon, lat, NEAR_M)),
        ("横浜の地図（範囲）", {"west": west, "south": south, "east": east, "north": north},
         "s.geom operator(extensions.&&) extensions.st_makeenvelope(%s, %s, %s, %s, 4326)", (west, south, east, north)),
    ]


def call(cur: psycopg.Cursor, fn: str, first: str, first_value: object, filters: dict[str, object]) -> object:
    names = [f"{first} => %({first})s", *(f"{k} => %({k})s" for k in filters)]
    cur.execute(f"select public.{fn}({', '.join(names)})", {first: first_value, **filters})
    return cur.fetchone()[0]  # type: ignore[index]


def direct_values(cur: psycopg.Cursor, where: str, params: tuple[object, ...], key: str) -> list[tuple[str, float, bool]]:
    """(grp, 値, ⚠) を表から直接（フラグはカタログのメタの reliabilityFlagKey）。値は関数と同じく real → text → numeric（24.3 は 24.3）。"""
    cur.execute(f"""
        select s.grp, v.value::text::numeric::double precision, coalesce(fv.value = 1, false)
        from public.stations s
        join public.metric_columns m on m.key = %s
        join public.station_values v on v.station_id = s.id and v.column_id = m.id
        left join public.metric_columns f on f.key = (m.meta ->> 'reliabilityFlagKey')
        left join public.station_values fv on fv.station_id = s.id and fv.column_id = f.id
        where {where}
    """, (key, *params))
    return [(row[0], float(row[1]), bool(row[2])) for row in cur.fetchall()]


def close(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= RELATIVE * max(1.0, abs(b))


# --- 1・2. 区域の行と一覧 ---------------------------------------------------------------------


def check_rows(checks: Checks, cur: psycopg.Cursor) -> None:
    rows = call(cur, "area_rows", "keys", ["muni:14100"], {"with_children": True})
    by_key = {row["key"]: row for row in rows}  # type: ignore[union-attr]
    city = by_key.get("muni:14100", {})
    wards = [row for row in by_key.values() if row["parent_key"] == "muni:14100"]
    cur.execute("""
        select count(*) from public.area_values v join public.areas a on a.id = v.area_id
        join public.area_metrics m on m.id = v.metric_id where a.key = 'muni:14100'
    """)
    value_count = cur.fetchone()[0]  # type: ignore[index]
    cur.execute("""
        select m.key, v.value from public.area_values v join public.areas a on a.id = v.area_id
        join public.area_metrics m on m.id = v.metric_id where a.key = 'muni:14100'
    """)
    direct = dict(cur.fetchall())
    same_values = city.get("values") == direct and len(direct) == value_count
    cur.execute("select count(*) from public.stations where municipality like '横浜市%'")
    yokohama_stations = cur.fetchone()[0]  # type: ignore[index]
    ward_counts_ok = True
    for ward in wards:
        cur.execute("select count(*) from public.stations where municipality_code = %s", (ward["code"],))
        ward_counts_ok &= ward["station_count"] == cur.fetchone()[0]  # type: ignore[index]
    checks.add(
        len(rows) == 19 and len(wards) == 18 and same_values and city.get("station_count") == yokohama_stations
        and ward_counts_ok and sum(w["station_count"] for w in wards) == yokohama_stations,
        "area_rows：横浜市と 18 区・値が area_values と一致・駅の数（市＝区の和）",
        f"{len(rows)} 行・値 {len(direct)}・駅 {city.get('station_count')}／{yokohama_stations}",
    )

    rows = call(cur, "area_rows", "keys", ["muni:13100"], {"with_children": True})
    members = [r for r in rows if r["group_key"] == "muni:13100"]  # type: ignore[union-attr]
    cur.execute("select count(*) from public.stations where municipality_code like %s", ("131%",))
    special = cur.fetchone()[0]  # type: ignore[index]
    total = next(r for r in rows if r["key"] == "muni:13100")["station_count"]  # type: ignore[union-attr]
    checks.add(len(members) == 23 and total == special == sum(m["station_count"] for m in members),
               "area_rows：東京 23 区（特別区部）と 23 の区・駅の数", f"区 {len(members)}・駅 {total}／{special}")

    rows = call(cur, "area_rows", "keys", ["jp", "line:26001@1000"], {"with_children": False})
    keys = [r["key"] for r in rows]  # type: ignore[union-attr]
    line = next((r for r in rows if r["key"] == "line:26001@1000"), {})  # type: ignore[union-attr]
    checks.add(keys == ["jp", "line:26001@1000"] and line.get("station_count") == 21 and len(line.get("values", {})) == 19
               and line.get("width_m") == 1000 and line.get("line_cd") == TOYOKO,
               "area_rows：子なしは指定した区域だけ・沿線は路線の駅の数と 19 の値", f"{keys}")

    rows = call(cur, "area_rows", "keys", ["jp"], {"with_children": True})
    prefs = [r for r in rows if r["kind"] == "prefecture"]  # type: ignore[union-attr]
    country = next(r for r in rows if r["key"] == "jp")  # type: ignore[union-attr]
    cur.execute("select count(*) from public.stations")
    all_stations = cur.fetchone()[0]  # type: ignore[index]
    checks.add(len(prefs) == 47 and country["station_count"] == all_stations == sum(p["station_count"] for p in prefs),
               "area_rows：全国と 47 都道府県・駅の数（全国＝都道府県の和）", f"{all_stations} 駅")

    unknown = call(cur, "area_rows", "keys", ["muni:99999", "pref:99"], {"with_children": True})
    checks.add(unknown == [], "area_rows：知らない区域は 0 行（空の配列）", f"{unknown}")


def check_catalog(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select public.area_catalog()")
    catalog = cur.fetchone()[0]  # type: ignore[index]
    kinds: dict[str, int] = {}
    for row in catalog:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
    base = sum(r["station_count"] for r in catalog if r["kind"] in ("municipality", "ward"))
    prefectures = sum(r["station_count"] for r in catalog if r["kind"] == "prefecture")
    country = next(r for r in catalog if r["kind"] == "country")["station_count"]
    by_key = {r["key"]: r for r in catalog}
    cities_ok = all(
        r["station_count"] == sum(w["station_count"] for w in catalog if w["parent_key"] == r["key"])
        for r in catalog if r["kind"] == "city"
    )
    without = sum(1 for r in catalog if r["kind"] in ("municipality", "ward") and r["station_count"] == 0)
    checks.add(
        len(catalog) == 1_961 and "line" not in kinds and country == prefectures == base == 9_273 and cities_ok,
        "area_catalog：行政区域 1,961（沿線なし）・駅の数（全国＝都道府県の和＝市区町村と区の和・政令市＝区の和）",
        f"{json.dumps(kinds, ensure_ascii=False)}・駅の無い市区町村と区 {without}",
    )
    iwaki = by_key.get("muni:07204", {})
    checks.add(any("pop_pred_2024_2050" in m["keys"] for m in iwaki.get("missing", [])),
               "area_catalog：無い値の理由を持つ（いわき市の推計）", f"{len(iwaki.get('missing', []))} 件")


# --- 3・4. 分布と色分けの入力 ------------------------------------------------------------------


def expected_stats(rows: list[tuple[str, float, bool]]) -> dict[str, object]:
    kept = sorted((value, grp) for grp, value, flagged in rows if not flagged)
    values = np.array([v for v, _ in kept])
    quartiles = [None, None, None] if len(values) == 0 else [float(np.percentile(values, q)) for q in (25, 50, 75)]
    return {
        "n": len(kept),
        "flagged_n": sum(1 for _, _, flagged in rows if flagged),
        "q1": quartiles[0], "median": quartiles[1], "q3": quartiles[2],
        "top": [v for v, _ in sorted(kept, key=lambda item: -item[0])[:3]],
        "bottom": [v for v, _ in kept[:3]],
    }


def check_stats(checks: Checks, cur: psycopg.Cursor) -> None:
    for name, filters, where, params in area_cases(cur):
        result = call(cur, "area_station_stats", "keys", KEYS, filters)
        cur.execute(f"select count(*) from public.stations s where {where}", params)
        want_count = cur.fetchone()[0]  # type: ignore[index]
        problems = []
        if result["station_count"] != want_count:  # type: ignore[index]
            problems.append(f"駅 {result['station_count']}≠{want_count}")  # type: ignore[index]
        stats = {s["key"]: s for s in result["stats"]}  # type: ignore[index]
        if list(stats) != KEYS:
            problems.append(f"並び {list(stats)}")
        for key in KEYS:
            got, want = stats.get(key, {}), expected_stats(direct_values(cur, where, params, key))
            for field in ("n", "flagged_n"):
                if got.get(field) != want[field]:
                    problems.append(f"{key} {field} {got.get(field)}≠{want[field]}")
            for field in ("q1", "median", "q3"):
                if not close(got.get(field), want[field]):  # type: ignore[arg-type]
                    problems.append(f"{key} {field} {got.get(field)}≠{want[field]}")
            for field in ("top", "bottom"):
                values = [entry["value"] for entry in got.get(field, [])]
                if len(values) != len(want[field]) or not all(close(a, b) for a, b in zip(values, want[field])):  # type: ignore[arg-type]
                    problems.append(f"{key} {field} {values}≠{want[field]}")
        checks.add(not problems, f"area_station_stats：{name}（{want_count} 駅）", "; ".join(problems[:4]))

    result = call(cur, "area_station_stats", "keys", ["pop_2020_1km", "no_such_key"], {"muni": "99999"})
    stats = result["stats"]  # type: ignore[index]
    checks.add(
        result["station_count"] == 0 and len(stats) == 1 and stats[0]["n"] == 0 and stats[0]["median"] is None
        and stats[0]["top"] == [],  # type: ignore[index]
        "area_station_stats：駅の無いエリアは 0 駅・値なし、知らない key は返らない", json.dumps(result, ensure_ascii=False),
    )


def check_values(checks: Checks, cur: psycopg.Cursor) -> None:
    for name, filters, where, params in area_cases(cur)[:3] + area_cases(cur)[4:]:
        key = "pop_gr_2020_2015_1km"
        result = call(cur, "station_metric_values", "column_key", key, filters)
        rows = result["values"]  # type: ignore[index]
        got = {grp: (value, flag == 1) for grp, value, flag in rows if value is not None}
        empty = [grp for grp, value, flag in rows if value is None and flag == 0]
        want = {grp: (value, flagged) for grp, value, flagged in direct_values(cur, where, params, key)}
        cur.execute(f"select count(*) from public.stations s where {where}", params)
        count = cur.fetchone()[0]  # type: ignore[index]
        same = got.keys() == want.keys() and all(close(got[g][0], want[g][0]) and got[g][1] == want[g][1] for g in want)
        flagged = sum(1 for _, flag in got.values() if flag)
        checks.add(same and len(rows) == count == result["station_count"] and len(empty) == count - len(want),  # type: ignore[index]
                   f"station_metric_values：{name}（値の無い駅も null で返す）",
                   f"駅 {count}・値 {len(got)}・値なし {len(empty)}・⚠ {flagged}")
    result = call(cur, "station_metric_values", "column_key", "pop_2020_1km", {})
    checks.add(len(result["values"]) == 9_273 and result["station_count"] == 9_273,  # type: ignore[index]
               "station_metric_values：絞らなければ全国 9,273 駅（1,000 行の上限を超えて 1 回で）", f"{len(result['values'])}")  # type: ignore[index]


# --- 5. 権限・速さ・REST ------------------------------------------------------------------------


def check_security_and_speed(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("""
        select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any(%s)
    """, (list(FUNCTIONS),))
    rows = cur.fetchall()
    expected = ['search_path=""', "extra_float_digits=3"]
    ok = len(rows) == len(FUNCTIONS) and all(not definer and config == expected and anon
                                             for _, definer, config, anon in rows)
    checks.add(ok, "SECURITY INVOKER・search_path は空・extra_float_digits=3・anon が実行できる（5 関数）",
               f"{[(name, config) for name, _, config, _ in rows][:2]}…")

    def timed(sql: str, params: dict[str, object]) -> float:
        cur.execute(sql, params)
        cur.fetchall()  # 温める
        started = time.perf_counter()
        cur.execute(sql, params)
        cur.fetchall()
        return (time.perf_counter() - started) * 1000

    stats_ms = timed("select public.area_station_stats(keys => %(keys)s)", {"keys": KEYS})
    values_ms = timed("select public.station_metric_values(column_key => %(key)s)", {"key": "pop_gr_2020_2015_1km"})
    rows_ms = timed("select public.area_rows(keys => %(keys)s, with_children => true)", {"keys": ["pref:13"]})
    catalog_ms = timed("select public.area_catalog()", {})
    checks.add(stats_ms < FAST_STATS_MS and values_ms < FAST_STATS_MS,
               f"全国の分布（9,273 駅 × 5 指標）・全国の値が {FAST_STATS_MS}ms 未満", f"{stats_ms:.0f}ms・{values_ms:.0f}ms")
    checks.add(rows_ms < FAST_ROWS_MS and catalog_ms < FAST_ROWS_MS,
               f"東京都と内訳の行・行政区域の一覧が {FAST_ROWS_MS}ms 未満", f"{rows_ms:.0f}ms・{catalog_ms:.0f}ms")


def rest(fn: str, args: dict[str, object]) -> object:
    env = (ROOT / ".env").read_text(encoding="utf-8")
    url = re.search(r"^SUPABASE_URL=(.*)$", env, re.M).group(1).strip().strip('"')  # type: ignore[union-attr]
    key = re.search(r"^SUPABASE_ANON_KEY=(.*)$", env, re.M).group(1).strip().strip('"')  # type: ignore[union-attr]
    request = urllib.request.Request(
        f"{url}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def check_rest(checks: Checks, cur: psycopg.Cursor) -> None:
    direct = call(cur, "area_station_stats", "keys", KEYS, {"muni": "横浜市"})
    over_rest = rest("area_station_stats", {"keys": KEYS, "muni": "横浜市"})
    checks.add(over_rest == direct, "REST（anon・名前つき引数）：area_station_stats が同じ結果", f"{over_rest['station_count']} 駅")  # type: ignore[index]
    catalog = rest("area_catalog", {})
    rows = rest("area_rows", {"keys": ["muni:14100"], "with_children": True})
    values = rest("station_metric_values", {"column_key": "pop_2020_1km", "line_cds": [TOYOKO]})
    checks.add(isinstance(catalog, list) and len(catalog) == 1_961 and isinstance(rows, list) and len(rows) == 19
               and len(values["values"]) == 21,  # type: ignore[index]
               "REST（anon）：area_catalog・area_rows・station_metric_values",
               f"{len(catalog)}・{len(rows)}・{len(values['values'])}")  # type: ignore[index, arg-type]
    # PostgREST の接続は extra_float_digits = 0。関数に付けた設定が効かないと、20km 圏の人口（1,000 万人台）が有効 6 桁に丸まる。
    large = rest("station_metric_values", {"column_key": "pop_2020_20km", "prefs": ["東京都"]})
    exact = {grp: value for grp, value, _ in direct_values(cur, "s.prefecture = %s", ("東京都",), "pop_2020_20km")}
    rounded = [grp for grp, value, _ in large["values"] if value is not None and value != exact[grp]]  # type: ignore[index]
    sample = next(((grp, value) for grp, value, _ in large["values"] if (value or 0) >= 10_000_000), None)  # type: ignore[index]
    checks.add(not rounded and len(exact) == 654, "REST（anon）：1,000 万人台の値も丸めずに返す（extra_float_digits）",
               f"丸まった駅 {len(rounded)}・例 {sample}")


def main() -> int:
    trial = "--trial" in sys.argv
    checks = Checks()
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            if trial:
                cur.execute(MIGRATION.read_text(encoding="utf-8"))
                print("（試し：migration をトランザクションの中で当てた。最後にロールバックする）")
            check_rows(checks, cur)
            check_catalog(checks, cur)
            check_stats(checks, cur)
            check_values(checks, cur)
            check_security_and_speed(checks, cur)
            if not trial:
                check_rest(checks, cur)
        if trial:
            conn.rollback()
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
