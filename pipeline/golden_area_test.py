"""B2 — 市区町村・範囲・近傍の条件のゴールデンテスト（本物の DB・2026-10-08）。

migration `20261008210000_area_filters.sql` が、述語 station_matches_filters に寄せた市区町村（muni）・範囲（bbox）・
近傍（near）と、rank_by_column・scatter_points・list_stations が返す起点からの距離（dist_m）、全駅の索引
station_catalog() を確かめる。期待値は RPC を通さずに `stations` から直接数える（経路が違うのに同じ結果に
なることが、双方の正しさの裏付け）。

  1. 市区町村：前方一致（横浜市＝全区）・JIS コード・都道府県と AND（府中市 × 東京都）・「%」を特別扱いしない
  2. 範囲・近傍：駅の集合が直接の計算と一致・距離が半径の内側・計画書の例（竹橋から 5km の最寄地価 1 位＝新宿三丁目）
  3. ランキング・散布・一覧で同じ件数。路線・会社とも AND
  4. 以前の呼び方（新しい引数なし）は以前と同じ結果・述語は 1 つだけ・anon が実行できる・索引
  5. PostgREST（anon・名前つき引数）からも同じ結果（アプリは supabase-js＝REST で呼ぶ）

    python3 pipeline/golden_area_test.py           # 当てたあと：全 PASS で exit 0
    python3 pipeline/golden_area_test.py --trial   # 当てる前：migration をトランザクションの中で当てて確かめ、ロールバック（REST は見ない）

2026-10-10：述語は「条件に合う駅の集合」を返す stations_matching_filters に作り直した（migration
`20261010230100_station_filter_set.sql`・`golden_station_filter_test.py`）。4 の形の検査はそれに合わせてある。--trial は
この migration を当てる前に使ったもので、いまは当てたあとの検査だけを使う（--trial は古い述語を当て直してしまう）。
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

MIGRATION = ROOT / "supabase" / "migrations" / "20261008210000_area_filters.sql"
#: 全駅に値がある指標（件数を駅の集合の大きさと比べられる）。
FULL_METRIC = "pop_2020_1km"
FULL_METRIC_2 = "pop_2020_2km"
#: 最寄地価（計画書 §6.1.1 の例）。
LAND_PRICE = "lp_near_price"
TAKEBASHI, TACHIKAWA = "竹橋#0", "立川#0"
NEAR_5KM = 5000.0
#: 東急東横線（路線コード・L1）。
TOYOKO = 26001
#: 首都圏の範囲（地図の初期表示に近い）。
TOKYO_BOX = (139.5, 35.5, 140.0, 35.8)


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def grps_of(cur: psycopg.Cursor, where: str, params: tuple[object, ...] = ()) -> set[str]:
    cur.execute(f"select s.grp from public.stations s where {where}", params)
    return {row[0] for row in cur.fetchall()}


def listed(cur: psycopg.Cursor, **args: object) -> set[str]:
    names = ", ".join([*(f"{key} => %({key})s" for key in args), "lim => 2000"])
    cur.execute(f"select grp from public.list_stations({names})", args)
    return {row[0] for row in cur.fetchall()}


def ranked_total(cur: psycopg.Cursor, metric: str, **args: object) -> int:
    names = "".join(f", {key} => %({key})s" for key in args)
    cur.execute(f"select total from public.rank_by_column(column_key => %(metric)s{names}, lim => 1)", {"metric": metric, **args})
    row = cur.fetchone()
    return 0 if row is None else int(row[0])


def scatter_count(cur: psycopg.Cursor, **args: object) -> int:
    names = "".join(f", {key} => %({key})s" for key in args)
    cur.execute(
        f"select jsonb_array_length(public.scatter_points(x_key => %(x)s, y_key => %(y)s{names}))",
        {"x": FULL_METRIC, "y": FULL_METRIC_2, **args},
    )
    return int(cur.fetchone()[0])


def origin(cur: psycopg.Cursor, grp: str) -> tuple[float, float]:
    cur.execute("select lon, lat from public.stations where grp = %s", (grp,))
    lon, lat = cur.fetchone()
    return float(lon), float(lat)


def near_args(cur: psycopg.Cursor, grp: str, radius_m: float) -> dict[str, object]:
    lon, lat = origin(cur, grp)
    return {"near_lon": lon, "near_lat": lat, "near_radius_m": radius_m}


def within(cur: psycopg.Cursor, grp: str, radius_m: float) -> set[str]:
    lon, lat = origin(cur, grp)
    return grps_of(
        cur,
        "extensions.st_dwithin(s.geom::extensions.geography, "
        "extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)::extensions.geography, %s)",
        (lon, lat, radius_m),
    )


def check_municipality(checks: Checks, cur: psycopg.Cursor) -> None:
    yokohama = grps_of(cur, "s.municipality like '横浜市%%'")
    got = listed(cur, muni="横浜市")
    checks.add(got == yokohama and len(got) > 100, "市区町村「横浜市」は全区（前方一致）", f"{len(got)} 駅")
    kohoku = grps_of(cur, "s.municipality = '横浜市港北区'")
    checks.add(listed(cur, muni="14109") == kohoku, "JIS コードの前方一致（14109＝横浜市港北区）", f"{len(kohoku)} 駅")
    fuchu = grps_of(cur, "s.municipality = '府中市' and s.prefecture = '東京都'")
    got = listed(cur, muni="府中市", prefs=["東京都"])
    checks.add(got == fuchu and len(got) > 0, "都道府県と AND（府中市 × 東京都＝広島県の府中市を含まない）", f"{len(got)} 駅")
    checks.add(len(listed(cur, muni="%")) == 0, "「%」は特別扱いしない（LIKE ではなく starts_with）", "")
    checks.add(listed(cur, muni="") == listed(cur), "空の市区町村は絞らない", "")
    total = ranked_total(cur, FULL_METRIC, muni="横浜市")
    checks.add(total == len(yokohama), "rank_by_column(muni=横浜市) の件数＝横浜市の駅数", f"{total}")
    points = scatter_count(cur, muni="横浜市")
    checks.add(points == len(yokohama), "scatter_points(muni=横浜市) の点＝横浜市の駅数", f"{points}")


def check_bbox(checks: Checks, cur: psycopg.Cursor) -> None:
    west, south, east, north = TOKYO_BOX
    expected = grps_of(
        cur,
        "s.geom operator(extensions.&&) extensions.st_makeenvelope(%s, %s, %s, %s, 4326)",
        TOKYO_BOX,
    )
    box = {"west": west, "south": south, "east": east, "north": north}
    got = listed(cur, **box)
    checks.add(got == expected and len(got) > 500, "範囲（首都圏）の駅の集合が直接の計算と一致", f"{len(got)} 駅")
    checks.add(ranked_total(cur, FULL_METRIC, **box) == len(expected), "rank_by_column(bbox) の件数", f"{len(expected)}")
    checks.add(scatter_count(cur, **box) == len(expected), "scatter_points(bbox) の点", "")
    partial = listed(cur, west=west, south=south, east=east)
    checks.add(partial == listed(cur), "範囲は 4 値すべて揃ったときだけ効く（3 値は絞らない）", "")


def check_near(checks: Checks, cur: psycopg.Cursor) -> None:
    args = near_args(cur, TAKEBASHI, NEAR_5KM)
    expected = within(cur, TAKEBASHI, NEAR_5KM)
    got = listed(cur, **args)
    checks.add(got == expected and len(got) > 100, "近傍（竹橋から 5km）の駅の集合が直接の計算と一致", f"{len(got)} 駅")
    checks.add(ranked_total(cur, FULL_METRIC, **args) == len(expected), "rank_by_column(near) の件数", f"{len(expected)}")
    checks.add(scatter_count(cur, **args) == len(expected), "scatter_points(near) の点", "")
    cur.execute(
        "select grp, dist_m from public.rank_by_column(column_key => %(m)s, near_lon => %(near_lon)s, "
        "near_lat => %(near_lat)s, near_radius_m => %(near_radius_m)s, lim => 100)",
        {"m": LAND_PRICE, **args},
    )
    rows = cur.fetchall()
    top = rows[0] if rows else (None, None)
    checks.add(top[0] == "新宿三丁目#0", "竹橋から 5km の最寄地価 1 位＝新宿三丁目（計画書 §6.1.1）", f"{top}")
    checks.add(top[1] is not None and 4850 < top[1] < 4900, "新宿三丁目までの距離は約 4.9km（楕円体）", f"{top[1]}")
    checks.add(all(dist is not None and dist <= NEAR_5KM for _, dist in rows), "距離はどれも半径の内側", f"{len(rows)} 行")
    cur.execute("select grp, dist_m from public.list_stations(near_lon => %(near_lon)s, near_lat => %(near_lat)s, near_radius_m => %(near_radius_m)s, lim => 2000)", args)
    listed_rows = dict(cur.fetchall())
    checks.add(listed_rows.get(TAKEBASHI) is not None and listed_rows[TAKEBASHI] < 1, "一覧も距離を返す（起点の駅は 0m）", f"{listed_rows.get(TAKEBASHI)}")
    cur.execute("select dist_m from public.rank_by_column(column_key => %s, lim => 1)", (FULL_METRIC,))
    checks.add(cur.fetchone()[0] is None, "近傍でなければ距離は null", "")
    args = near_args(cur, TACHIKAWA, NEAR_5KM)
    cur.execute(
        "select grp from public.rank_by_column(column_key => %(m)s, near_lon => %(near_lon)s, "
        "near_lat => %(near_lat)s, near_radius_m => %(near_radius_m)s, lim => 2)",
        {"m": LAND_PRICE, **args},
    )
    top2 = [row[0] for row in cur.fetchall()]
    checks.add(set(top2) == {"立川#0", "立川北#0"}, "立川から 5km の最寄地価の上位＝立川・立川北（郊外・計画書 §6.1.1）", f"{top2}")


def check_and(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute(
        "select s.grp from public.line_stations ls join public.stations s on s.id = ls.station_id "
        "where ls.line_cd = %s and s.municipality like '横浜市%%'",
        (TOYOKO,),
    )
    expected = {row[0] for row in cur.fetchall()}
    got = listed(cur, muni="横浜市", line_cds=[TOYOKO])
    checks.add(got == expected and len(got) > 3, "路線とも AND（東急東横線 × 横浜市）", f"{len(got)} 駅")
    tokyu = grps_of(cur, "string_to_array(coalesce(s.operators, ''), '・') && array['東急電鉄'] and s.municipality like '横浜市%%'")
    got = listed(cur, muni="横浜市", ops=["東急電鉄"])
    checks.add(got == tokyu, "会社とも AND（東急電鉄 × 横浜市）", f"{len(got)} 駅")
    args = near_args(cur, TAKEBASHI, NEAR_5KM)
    expected = within(cur, TAKEBASHI, NEAR_5KM) & grps_of(cur, "s.municipality = '千代田区'")
    got = listed(cur, muni="千代田区", **args)
    checks.add(got == expected, "近傍と市区町村も AND（竹橋から 5km × 千代田区）", f"{len(got)} 駅")


def check_compat(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select count(*) from public.stations")
    stations = cur.fetchone()[0]
    checks.add(ranked_total(cur, FULL_METRIC) == stations, "新しい引数なしのランキングは全駅（以前と同じ）", f"{stations}")
    tokyu = grps_of(cur, "string_to_array(coalesce(s.operators, ''), '・') && array['東急電鉄']")
    checks.add(listed(cur, ops=["東急電鉄"]) == tokyu, "新しい引数なしの一覧（会社）は以前と同じ集合", f"{len(tokyu)} 駅")
    # 絞り込みは 2026-10-10 に「条件に合う駅の集合」を返す関数に作り直した（20261010230100・古い述語は落とした）。
    cur.execute("select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'stations_matching_filters'")
    signatures = [row[0] for row in cur.fetchall()]
    one = len(signatures) == 1 and len(signatures[0].split(", ")) == 13 and signatures[0].endswith("near_radius_m double precision")
    cur.execute("select count(*) from pg_proc where proname in ('station_matches_filters', 'station_matches_railway')")
    checks.add(one and cur.fetchone()[0] == 0, "絞り込みは 1 つだけ（条件 13・古い述語は落とした）", f"{len(signatures)} 個")
    cur.execute("select proconfig from pg_proc where proname = 'stations_matching_filters'")
    config = cur.fetchone()[0]
    checks.add(config is None, "絞り込みは SET を持たない（呼び出し側に展開されるため）", f"{config}")
    cur.execute(
        "explain (format text) select count(*) from public.stations_matching_filters("
        "array['東京都'], null, null, null, null, null, null, null, null, null, null, null, null)"
    )
    plan = "\n".join(row[0] for row in cur.fetchall())
    checks.add("Function Scan" not in plan and "prefecture" in plan, "絞り込みは展開される（実行計画に関数の走査が出ず、都道府県の比較が出る）", "")
    missing = []
    for fn in ("rank_by_column", "scatter_points", "list_stations", "stations_matching_filters", "station_distance_m", "station_catalog"):
        cur.execute("select bool_and(has_function_privilege('anon', oid, 'execute')) from pg_proc where proname = %s", (fn,))
        if not cur.fetchone()[0]:
            missing.append(fn)
    checks.add(not missing, "anon が新しい関数を実行できる", f"{missing}" if missing else "")
    cur.execute("select public.station_catalog()")
    catalog = cur.fetchone()[0]
    keys = set(catalog[0]) if catalog else set()
    expected_keys = {"grp", "name", "label", "prefecture", "municipality", "municipality_code", "lon", "lat", "pax"}
    checks.add(len(catalog) == stations and keys == expected_keys, "station_catalog() は全駅（名前・都道府県・市区町村・座標）", f"{len(catalog)} 駅")


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
    yokohama = grps_of(cur, "s.municipality like '横浜市%%'")
    ranked = rest("rank_by_column", {"column_key": FULL_METRIC, "muni": "横浜市", "lim": 1})
    total = ranked[0]["total"] if isinstance(ranked, list) and ranked else None
    checks.add(total == len(yokohama), "REST（anon）の rank_by_column(muni) の件数", f"{total}")
    args = near_args(cur, TAKEBASHI, NEAR_5KM)
    rows = rest("list_stations", {**args, "lim": 1000})
    ok = isinstance(rows, list) and all(row.get("dist_m") is not None and row["dist_m"] <= NEAR_5KM for row in rows)
    checks.add(ok and len(rows) == len(within(cur, TAKEBASHI, NEAR_5KM)), "REST（anon）の list_stations(near) は距離つき", f"{len(rows) if isinstance(rows, list) else rows}")
    catalog = rest("station_catalog", {})
    checks.add(isinstance(catalog, list) and len(catalog) > 9000, "REST（anon）の station_catalog() は 1,000 件で切れない", f"{len(catalog) if isinstance(catalog, list) else catalog}")


def run(cur: psycopg.Cursor, checks: Checks, with_rest: bool) -> None:
    check_municipality(checks, cur)
    check_bbox(checks, cur)
    check_near(checks, cur)
    check_and(checks, cur)
    check_compat(checks, cur)
    if with_rest:
        check_rest(checks, cur)


def main() -> int:
    trial = "--trial" in sys.argv
    checks = Checks()
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            if trial:
                cur.execute(MIGRATION.read_text(encoding="utf-8"))
                print("（試し：migration をトランザクションの中で当てた。最後にロールバックする）")
            run(cur, checks, with_rest=not trial)
        if trial:
            conn.rollback()
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
