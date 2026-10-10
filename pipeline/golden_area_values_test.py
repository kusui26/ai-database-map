"""B5a — エリアの区域の値のゴールデンテスト（本物の DB・2026-10-10）。

migration `20261010200000_area_values.sql` の 3 つの表（area_metrics・areas・area_values）と、投入した値を確かめる。
期待値は CSV を通さずに DB の中で数える（区の和・都道府県の和・駅の値との比べ）か、公表値の固定値で持つ。

  1. 件数と固定値（公表値：横浜市・川崎市・全国…）・カタログの写し
  2. 内訳の和：政令市＝区の和・東京 23 区＝23 の区の和・全国＝都道府県の和
  3. 推計の 2020 年（R6 の市区町村ごとの合計）＝国勢調査の 2020 年（行政区域）
  4. 沿線：幅に対して単調・**DB の駅の値（station_values）と比べて**、最大の駅の円 ≤ 沿線 ≤ 駅の円の和
  5. 無い値の理由（浜松の区の再編・浜通りの推計）
  6. 権限（anon は SELECT だけ・RLS）・大きさ・速さ・PostgREST（anon）から読める・書けない

    python3 pipeline/golden_area_values_test.py           # 当てたあと：全 PASS で exit 0
    python3 pipeline/golden_area_values_test.py --trial   # 当てる前：migration と投入をトランザクションの中で行い、確かめてロールバック（REST は見ない）
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_rules import ANCHORS, LINE_WIDTHS_M, RADIUS_SUFFIX  # noqa: E402
from load_area_values import copy_area_values  # noqa: E402
from load_to_supabase import ROOT, db_params  # noqa: E402

MIGRATION = ROOT / "supabase" / "migrations" / "20261010200000_area_values.sql"
TABLES = ("area_metrics", "areas", "area_values")
#: 3 つの表の大きさの上限（見積もり 6〜9MB・無料枠 500MB の残りを食いつぶさない）。
MAX_TABLES_MB = 12
#: 大きさの単位（Supabase のダッシュボード・pg_size_pretty と同じ 1024 × 1024 バイト）。
MB = 1024 * 1024
#: 横浜市と 18 区の全指標を読む速さの目安。
FAST_MS = 100
#: 駅の値は整数に四捨五入してあるので、駅 1 つにつき 0.5 まで許す。
STATION_ROUNDING = 0.5


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def one(cur: psycopg.Cursor, sql: str, params: tuple[object, ...] = ()) -> object:
    cur.execute(sql, params)
    row = cur.fetchone()
    return None if row is None else row[0]


VALUE_SQL = (
    "select v.value from public.area_values v join public.areas a on a.id = v.area_id "
    "join public.area_metrics m on m.id = v.metric_id where a.key = %s and m.key = %s"
)


def check_counts_and_anchors(checks: Checks, cur: psycopg.Cursor) -> None:
    counts = {t: one(cur, f"select count(*) from public.{t}") for t in TABLES}
    kinds = dict(cur.execute("select kind, count(*) from public.areas group by kind").fetchall())
    checks.add(
        counts["area_metrics"] == 24 and counts["areas"] == 3_764 and counts["area_values"] == 80_994,
        "件数：指標 24・区域 3,764（行政 1,961＋沿線 1,803）・値 80,994", json.dumps(counts),
    )
    checks.add(
        kinds.get("prefecture") == 47 and kinds.get("city") == 20 and kinds.get("ward") == 171
        and kinds.get("special_wards") == 1 and kinds.get("line") == 1_803,
        "種類：都道府県 47・政令市 20・区 171・東京 23 区 1・沿線 1,803", json.dumps(kinds, ensure_ascii=False),
    )
    wrong = []
    for (key, metric), want in ANCHORS.items():
        got = one(cur, VALUE_SQL, (key, metric))
        if got is None or round(float(got)) != want:  # type: ignore[arg-type]
            wrong.append(f"{key} {metric}: {got}")
    checks.add(not wrong, f"固定値（公表値 {len(ANCHORS)} 個）", "; ".join(wrong[:5]))
    catalog = json.loads((ROOT / "src" / "shared" / "catalog" / "area-catalog.json").read_text(encoding="utf-8"))
    mirrored = [row[0] for row in cur.execute("select meta from public.area_metrics order by id").fetchall()]
    checks.add(mirrored == catalog["metrics"], "area_metrics がカタログ（area-catalog.json）の写し", f"{len(mirrored)} 指標")


def check_sums(checks: Checks, cur: psycopg.Cursor) -> None:
    city_wrong = one(cur, """
        select count(*) from public.areas c
        join public.area_values cv on cv.area_id = c.id
        join public.area_metrics m on m.id = cv.metric_id
        cross join lateral (
          select count(*) as n, count(v.value) as have, sum(v.value) as total
          from public.areas w left join public.area_values v on v.area_id = w.id and v.metric_id = m.id
          where w.parent_key = c.key
        ) wards
        where c.kind = 'city' and wards.n = wards.have
          and abs(wards.total - cv.value) > case when m.key like 'pop_pred%%' then 0.01 else 0.5 end
    """)
    compared = one(cur, """
        select count(*) from public.areas c join public.area_values cv on cv.area_id = c.id
        where c.kind = 'city' and not exists (
          select 1 from public.areas w where w.parent_key = c.key
            and not exists (select 1 from public.area_values v where v.area_id = w.id and v.metric_id = cv.metric_id))
    """)
    checks.add(city_wrong == 0 and (compared or 0) > 300, "政令市＝区の和（区がそろう指標すべて）",
               f"比べた {compared} 組・崩れ {city_wrong}")

    special_wrong = one(cur, """
        select count(*) from public.areas s join public.area_values sv on sv.area_id = s.id
        join public.area_metrics m on m.id = sv.metric_id
        where s.kind = 'special_wards' and m.key like 'pop%%' and abs(sv.value - (
          select sum(v.value) from public.areas w join public.area_values v on v.area_id = w.id
          where w.group_key = s.key and v.metric_id = sv.metric_id)) > case when m.key like 'pop_pred%%' then 0.01 else 0.5 end
    """)
    checks.add(special_wrong == 0, "東京 23 区（特別区部）＝23 の区の和（人口・推計の全年）", f"崩れ {special_wrong}")

    country_wrong = one(cur, """
        select count(*) from public.areas j join public.area_values jv on jv.area_id = j.id
        join public.area_metrics m on m.id = jv.metric_id
        where j.kind = 'country' and abs(jv.value - (
          select sum(v.value) from public.areas p join public.area_values v on v.area_id = p.id
          where p.kind = 'prefecture' and v.metric_id = jv.metric_id)) > case when m.key like 'pop_pred%%' then 0.01 else 0.5 end
    """)
    checks.add(country_wrong == 0, "全国＝都道府県の和（全指標）", f"崩れ {country_wrong}")

    base_wrong = one(cur, """
        select count(*) from public.areas a
        join public.area_values c on c.area_id = a.id join public.area_metrics cm on cm.id = c.metric_id and cm.key = 'pop_2020'
        join public.area_values p on p.area_id = a.id join public.area_metrics pm on pm.id = p.metric_id and pm.key = 'pop_pred_2024_2020'
        where a.kind <> 'line' and abs(c.value - p.value) > 0.5
    """)
    checks.add(base_wrong == 0, "推計の 2020 年＝国勢調査の 2020 年（行政区域）", f"崩れ {base_wrong}")


def check_corridors(checks: Checks, cur: psycopg.Cursor) -> None:
    widths = ",".join(str(w) for w in LINE_WIDTHS_M)
    not_monotone = one(cur, f"""
        with v as (
          select a.line_cd, a.width_m, m.key, v.value from public.areas a
          join public.area_values v on v.area_id = a.id join public.area_metrics m on m.id = v.metric_id
          where a.kind = 'line' and a.width_m in ({widths})
        )
        select count(*) from v narrow join v wide
          on wide.line_cd = narrow.line_cd and wide.key = narrow.key and wide.width_m > narrow.width_m
        where wide.value < narrow.value - 1e-6 * greatest(1, narrow.value)
    """)
    checks.add(not_monotone == 0, "沿線は幅を広げても減らない（全路線・全指標）", f"崩れ {not_monotone}")

    for width in LINE_WIDTHS_M:
        station_key = f"pop_2020_{RADIUS_SUFFIX[width]}"
        row = cur.execute("""
            with corridor as (
              select a.line_cd, v.value from public.areas a
              join public.area_values v on v.area_id = a.id join public.area_metrics m on m.id = v.metric_id
              where a.kind = 'line' and a.width_m = %s and m.key = 'pop_2020'
            ), stations as (
              select ls.line_cd, max(sv.value) as top, sum(sv.value) as total, count(*) as n
              from public.line_stations ls
              join public.station_values sv on sv.station_id = ls.station_id
              join public.metric_columns mc on mc.id = sv.column_id and mc.key = %s
              group by ls.line_cd
            )
            select count(*),
                   count(*) filter (where c.value < s.top - %s),
                   count(*) filter (where c.value > s.total + %s * s.n)
            from corridor c join stations s using (line_cd)
        """, (width, station_key, STATION_ROUNDING, STATION_ROUNDING)).fetchone()
        checks.add(
            row is not None and row[0] == 601 and row[1] == 0 and row[2] == 0,
            f"沿線 {RADIUS_SUFFIX[width]}：DB の駅の値と比べて 最大の駅の円 ≤ 沿線の人口（2020）≤ 駅の円の和",
            f"路線 {row[0] if row else '?'}・下回る {row[1] if row else '?'}・上回る {row[2] if row else '?'}",
        )


def check_missing(checks: Checks, cur: psycopg.Cursor) -> None:
    def reasons(key: str) -> list[dict[str, object]]:
        value = one(cur, "select missing from public.areas where key = %s", (key,))
        return value if isinstance(value, list) else []

    hamamatsu = reasons("muni:22138")
    iwaki = reasons("muni:07204")
    yokohama = reasons("muni:14100")
    checks.add(
        any("pop_1995" in r["keys"] and "区の再編" in str(r["reasonJa"]) for r in hamamatsu)
        and any("pop_pred_2024_2050" in r["keys"] for r in iwaki) and yokohama == [],
        "無い値の理由（浜松市中央区の 1995 年・いわき市の推計）・横浜市は欠けなし",
        f"浜松市中央区 {len(hamamatsu)} 件・いわき市 {len(iwaki)} 件",
    )
    no_value_has_reason = one(cur, """
        select count(*) from public.areas a cross join public.area_metrics m
        where a.kind <> 'line'
          and not exists (select 1 from public.area_values v where v.area_id = a.id and v.metric_id = m.id)
          and not exists (select 1 from jsonb_array_elements(a.missing) r where r->'keys' ? m.key)
    """)
    checks.add(no_value_has_reason == 0, "行政区域の無い値には、すべて理由がある", f"理由の無い欠け {no_value_has_reason}")


def check_security_size_speed(checks: Checks, cur: psycopg.Cursor) -> None:
    privileges = cur.execute("""
        select t, has_table_privilege('anon', 'public.' || t, 'select'),
               has_table_privilege('anon', 'public.' || t, 'insert'),
               has_table_privilege('anon', 'public.' || t, 'update'),
               has_table_privilege('anon', 'public.' || t, 'delete'),
               has_table_privilege('anon', 'public.' || t, 'truncate'),
               (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)
        from unnest(%s::text[]) t
    """, (list(TABLES),)).fetchall()
    ok = all(row[1] and not any(row[2:6]) and row[6] for row in privileges)
    checks.add(ok, "anon は SELECT だけ（INSERT/UPDATE/DELETE/TRUNCATE なし）・RLS 有効", f"{privileges}")
    size = one(cur, "select sum(pg_total_relation_size(('public.' || t)::regclass)) from unnest(%s::text[]) t", (list(TABLES),))
    database = one(cur, "select pg_database_size(current_database())")
    size_mb = float(size or 0) / MB
    checks.add(size_mb < MAX_TABLES_MB, f"3 つの表で {MAX_TABLES_MB}MB 未満",
               f"{size_mb:.1f}MB（DB 全体 {float(database or 0) / MB:.0f}MB）")
    sql = """
        select a.key, m.key, v.value from public.areas a
        join public.area_values v on v.area_id = a.id join public.area_metrics m on m.id = v.metric_id
        where a.key = %s or a.parent_key = %s
    """
    cur.execute(sql, ("muni:14100", "muni:14100"))
    cur.fetchall()  # 温める
    started = time.perf_counter()
    cur.execute(sql, ("muni:14100", "muni:14100"))
    rows = cur.fetchall()
    elapsed_ms = (time.perf_counter() - started) * 1000
    checks.add(elapsed_ms < FAST_MS and len(rows) == 19 * 24, f"横浜市と 18 区の全指標を {FAST_MS}ms 未満で読む",
               f"{len(rows)} 値・{elapsed_ms:.0f}ms")


def rest(path: str, method: str = "GET", body: object | None = None) -> tuple[int, object]:
    env = (ROOT / ".env").read_text(encoding="utf-8")
    url = re.search(r"^SUPABASE_URL=(.*)$", env, re.M).group(1).strip().strip('"')  # type: ignore[union-attr]
    key = re.search(r"^SUPABASE_ANON_KEY=(.*)$", env, re.M).group(1).strip().strip('"')  # type: ignore[union-attr]
    request = urllib.request.Request(
        f"{url}/rest/v1/{path}", method=method, data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None  # URL・鍵を含む文は出さない


def check_rest(checks: Checks) -> None:
    status, rows = rest("areas?key=eq.muni%3A14100&select=key,label_ja,kind")
    checks.add(status == 200 and isinstance(rows, list) and len(rows) == 1 and rows[0]["label_ja"] == "神奈川県横浜市",
               "REST（anon）：areas を読める", f"{status} {rows}")
    status, rows = rest("area_values?select=value,areas!inner(key),area_metrics!inner(key)"
                        "&areas.key=eq.muni%3A14100&area_metrics.key=eq.pop_2025")
    checks.add(status == 200 and isinstance(rows, list) and len(rows) == 1 and round(rows[0]["value"]) == 3_750_952,
               "REST（anon）：横浜市の 2025 年の人口を引ける（外部キーで結ぶ）", f"{status} {rows}")
    status, _ = rest("area_values", "POST", {"area_id": 1, "metric_id": 1, "value": 0})
    checks.add(status in (401, 403), "REST（anon）：書き込めない", f"{status}")


def main() -> int:
    trial = "--trial" in sys.argv
    checks = Checks()
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            if trial:
                cur.execute(MIGRATION.read_text(encoding="utf-8"))
                metrics, areas, values = copy_area_values(cur)
                print(f"（試し：migration と投入〔指標 {metrics}・区域 {areas:,}・値 {values:,}〕をトランザクションの中で行った。"
                      "最後にロールバックする）")
            check_counts_and_anchors(checks, cur)
            check_sums(checks, cur)
            check_corridors(checks, cur)
            check_missing(checks, cur)
            check_security_size_speed(checks, cur)
        if trial:
            conn.rollback()
    if not trial:
        check_rest(checks)
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
