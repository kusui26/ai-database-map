"""B4 — 駅周辺のプロフィールの順位（県内・市内）のゴールデンテスト（本物の DB・2026-10-09）。

migration `20261009190000_station_profile.sql` の station_profile_ranks(in_grp, keys, area) を確かめる。
期待値は RPC を通さずに `station_values` から直接数える（経路が違うのに同じ結果になることが、双方の正しさの裏付け）。

  1. 順位と比べた駅の数が、直接の計算と一致（県内・市内・政令市は全区・東京 23 区は区）
  2. 同じ値は同じ順位（バス停 0 の駅）・駅に値の無い指標と知らない key は行を返さない・知らない駅は 0 行
  3. 市内は駅自身がその中にあるときだけ（違う市・「%」・空は null）
  4. anon が実行できる・PostgREST（anon・名前つき引数）からも同じ結果・1 駅 11 指標が速い

    python3 pipeline/golden_profile_test.py           # 当てたあと：全 PASS で exit 0
    python3 pipeline/golden_profile_test.py --trial   # 当てる前：migration をトランザクションの中で当てて確かめ、ロールバック（REST は見ない）
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import ROOT, db_params  # noqa: E402

MIGRATION = ROOT / "supabase" / "migrations" / "20261009190000_station_profile.sql"
#: プロフィールが 1km で引く指標（アプリの `src/domain/profile/items.ts` と同じ顔ぶれ）。
KEYS_1KM = [
    "pop_2020_1km",
    "pop_gr_2020_2015_1km",
    "pop_gr_pred_2024_2040_1km",
    "inc_pc_2025_1km",
    "lp_med_2026_1km",
    "lp_gr_2026_2021_1km",
    "emp_n_2021_1km",
    "estab_n_2021_1km",
    "sales_dest_2021_1km",
    "pax_2024",
    "bus_n_1km",
]
#: (駅, 市内の値)。政令市（横浜市＝全区）・東京 23 区（千代田区）・市（立川市）・市内なし。
CASES = [("横浜#0", "横浜市"), ("東京#0", "千代田区"), ("立川#0", "立川市"), ("新宿#0", "新宿区"), ("府中#0", None)]
#: バス停 0 の駅が多い指標（同じ値の扱いを見る）。
TIE_KEY = "bus_n_500m"
#: 速さの目安（1 駅 11 指標・東京都 654 駅。実測 30〜50ms）。
FAST_MS = 300
#: float4 の有効桁（約 7 桁）ぶんの相対誤差。
FLOAT4_RELATIVE = 1e-6


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


Row = tuple[str, float, int, int, int | None, int | None]


def ranks(cur: psycopg.Cursor, grp: str, keys: list[str], area: str | None) -> dict[str, Row]:
    cur.execute("select * from public.station_profile_ranks(in_grp => %s, keys => %s, area => %s)", (grp, keys, area))
    return {row[0]: row for row in cur.fetchall()}


def expected(cur: psycopg.Cursor, grp: str, key: str, area: str | None) -> Row | None:
    """直接の計算（RPC を通さない）。駅に値が無ければ None。"""
    cur.execute(
        "select s.prefecture, s.municipality, v.value from public.stations s "
        "join public.station_values v on v.station_id = s.id "
        "join public.metric_columns mc on mc.id = v.column_id where s.grp = %s and mc.key = %s",
        (grp, key),
    )
    own = cur.fetchone()
    if own is None:
        return None
    prefecture, municipality, value = own
    cur.execute(
        "select s.municipality, v.value from public.station_values v "
        "join public.stations s on s.id = v.station_id "
        "join public.metric_columns mc on mc.id = v.column_id where mc.key = %s and s.prefecture = %s",
        (key, prefecture),
    )
    peers = cur.fetchall()
    in_area = area is not None and area != "" and (municipality or "").startswith(area)
    area_peers = [peer for peer in peers if in_area and (peer[0] or "").startswith(area or "")]
    return (
        key,
        float(value),
        1 + sum(1 for _, other in peers if other > value),
        len(peers),
        1 + sum(1 for _, other in area_peers if other > value) if in_area else None,
        len(area_peers) if in_area else None,
    )


def same_float4(a: float, b: float) -> bool:
    """値は real（float4）。RPC は double に広げて返し、psycopg は real を短い 10 進で読むので、有効桁 7 桁で比べる。"""
    return abs(a - b) <= FLOAT4_RELATIVE * max(1.0, abs(b))


def check_matches(checks: Checks, cur: psycopg.Cursor) -> None:
    for grp, area in CASES:
        got = ranks(cur, grp, KEYS_1KM, area)
        mismatches = []
        for key in KEYS_1KM:
            want = expected(cur, grp, key, area)
            have = got.get(key)
            if want is None:
                if have is not None:
                    mismatches.append(f"{key}: 値が無いのに行がある")
                continue
            if have is None or have[2:] != want[2:] or not same_float4(have[1], want[1]):
                mismatches.append(f"{key}: {have} != {want}")
        checks.add(not mismatches, f"{grp}（市内＝{area}）の順位が直接の計算と一致", "; ".join(mismatches) or f"{len(got)} 指標")
    yokohama = ranks(cur, "横浜#0", ["pop_2020_1km"], "横浜市")["pop_2020_1km"]
    cur.execute("select count(*) from public.stations where municipality like '横浜市%%'")
    stations = cur.fetchone()[0]
    checks.add(yokohama[5] == stations, "政令市の市内は全区（横浜市の駅数と一致）", f"{yokohama[5]} / {stations}")


def check_edges(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute(
        "select s.grp from public.station_values v join public.stations s on s.id = v.station_id "
        "join public.metric_columns mc on mc.id = v.column_id where mc.key = %s and v.value = 0 "
        "and s.prefecture = '北海道' order by s.grp limit 2",
        (TIE_KEY,),
    )
    pair = [row[0] for row in cur.fetchall()]
    tied = [ranks(cur, grp, [TIE_KEY], None).get(TIE_KEY) for grp in pair]
    same = len(tied) == 2 and all(row is not None for row in tied) and tied[0][2] == tied[1][2]
    checks.add(same, "同じ値は同じ順位（北海道のバス停 0 の 2 駅）", f"{[row[2] if row else None for row in tied]}")
    if same and tied[0] is not None:
        want = expected(cur, pair[0], TIE_KEY, None)
        checks.add(want is not None and tied[0][2:4] == want[2:4], "同じ値の順位＝1＋自分より大きい駅の数", f"{tied[0][2:4]}")
    cur.execute(
        "select s.grp from public.stations s where not exists (select 1 from public.station_values v "
        "join public.metric_columns mc on mc.id = v.column_id where v.station_id = s.id and mc.key = 'lp_med_2026_500m') limit 1"
    )
    missing = cur.fetchone()[0]
    got = ranks(cur, missing, ["lp_med_2026_500m", "pop_2020_500m"], None)
    checks.add(set(got) == {"pop_2020_500m"}, "駅に値の無い指標は行を返さない", f"{missing}: {sorted(got)}")
    got = ranks(cur, "横浜#0", ["pop_2020_1km", "no_such_key"], None)
    checks.add(set(got) == {"pop_2020_1km"}, "知らない key は行を返さない", f"{sorted(got)}")
    checks.add(ranks(cur, "no_such_station#0", KEYS_1KM, None) == {}, "知らない駅は 0 行", "")
    checks.add(ranks(cur, "横浜#0", [], None) == {}, "key が空なら 0 行", "")


def check_area_guard(checks: Checks, cur: psycopg.Cursor) -> None:
    for area, label in (("川崎市", "違う市"), ("%", "「%」"), ("", "空"), (None, "null")):
        row = ranks(cur, "横浜#0", ["pop_2020_1km"], area)["pop_2020_1km"]
        checks.add(row[4] is None and row[5] is None, f"市内は駅がその中にあるときだけ（{label}は null）", f"{row}")
    row = ranks(cur, "横浜#0", ["pop_2020_1km"], "横浜市西区")["pop_2020_1km"]
    cur.execute("select count(*) from public.stations where municipality = '横浜市西区'")
    checks.add(row[5] == cur.fetchone()[0], "区まで渡せば区内（横浜市西区）", f"{row}")


def check_security_and_speed(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute("select bool_and(has_function_privilege('anon', oid, 'execute')) from pg_proc where proname = 'station_profile_ranks'")
    checks.add(bool(cur.fetchone()[0]), "anon が実行できる", "")
    cur.execute("select prosecdef, proconfig from pg_proc where proname = 'station_profile_ranks'")
    definer, config = cur.fetchone()
    checks.add(not definer and config == ["search_path=\"\""], "SECURITY INVOKER・search_path は空に固定", f"{definer} {config}")
    ranks(cur, "東京#0", KEYS_1KM, "千代田区")  # 温める
    started = time.perf_counter()
    ranks(cur, "東京#0", KEYS_1KM, "千代田区")
    elapsed_ms = (time.perf_counter() - started) * 1000
    checks.add(elapsed_ms < FAST_MS, f"1 駅 11 指標が {FAST_MS}ms 未満（東京都 654 駅）", f"{elapsed_ms:.0f}ms")


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
    direct = ranks(cur, "横浜#0", KEYS_1KM, "横浜市")
    rows = rest("station_profile_ranks", {"in_grp": "横浜#0", "keys": KEYS_1KM, "area": "横浜市"})
    same = isinstance(rows, list) and len(rows) == len(direct) and all(
        (row["pref_rank"], row["pref_total"], row["area_rank"], row["area_total"]) == direct[row["key"]][2:]
        for row in rows
    )
    checks.add(same, "REST（anon）からも同じ順位", f"{len(rows) if isinstance(rows, list) else rows} 行")
    rows = rest("station_profile_ranks", {"in_grp": "横浜#0", "keys": ["pop_2020_1km"]})
    checks.add(isinstance(rows, list) and rows and rows[0]["area_total"] is None, "REST：area を省けば市内は null", f"{rows}")


def run(cur: psycopg.Cursor, checks: Checks, with_rest: bool) -> None:
    check_matches(checks, cur)
    check_edges(checks, cur)
    check_area_guard(checks, cur)
    check_security_and_speed(checks, cur)
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
