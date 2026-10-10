"""B5 で見つけたこと 1 — jsonb で返す関数が駅の値を有効 6 桁に丸めない（本物の DB・2026-10-10）。

migration `20261010230000_jsonb_number_precision.sql` を確かめる。Supabase はサーバの設定で extra_float_digits = 0 で、
PostgREST の接続もこの設定のまま。その設定で real（`station_values.value`）を jsonb にすると、有効 6 桁に丸まっていた
（東京都の 20km の人口 12,407,970 → 12,408,000）。期待値は表の値そのもの（この検査の接続は extra_float_digits = 3 で読む）。

  1. 設定：dataset_rows・scatter_points が extra_float_digits = 3（と search_path 空）を持つ
  2. PostgREST と同じ extra_float_digits = 0 の中で：散布（東京都・20km の人口 2 年）とデータセット（東京都の駅 × 大きい値と
     小数の値）の値が、表の値と 1 桁まで一致する。--trial では、当てる前に丸まっていたこと（ずれる駅の数）も見せる
  3. PostgREST（anon）からも同じ（当てたあとだけ）：散布の全点・データセット・大きな値の例（お台場海浜公園・竹橋の 5km）

    python3 pipeline/golden_number_precision_test.py           # 当てたあと：全 PASS で exit 0
    python3 pipeline/golden_number_precision_test.py --trial   # 当てる前：migration をトランザクションの中で当てて確かめ、ロールバック
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

MIGRATION = ROOT / "supabase" / "migrations" / "20261010230000_jsonb_number_precision.sql"
FUNCTIONS = ("dataset_rows", "scatter_points")
#: 散布の 2 軸（東京都の 20km の人口は 1,000 万人台＝有効 6 桁では足りない）。
X_KEY, Y_KEY = "pop_2020_20km", "pop_2015_20km"
#: データセットの列（大きい値・5km の人口・小数の増減率・小数の所得）。
DATASET_KEYS = ["pop_2020_20km", "pop_2015_5km", "emp_n_2021_20km", "pop_gr_2020_2015_1km", "inc_pc_2025_1km"]
PREFECTURE = "東京都"
#: 大きな値の例（計画書 §6.14 の例）。
ODAIBA, TAKEBASHI = "お台場海浜公園#0", "竹橋#0"


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def stored(cur: psycopg.Cursor, keys: list[str], prefecture: str) -> dict[tuple[str, str], float]:
    """表の値そのもの（この接続は extra_float_digits = 3 なので、real を丸めずに受け取る）。"""
    cur.execute(
        "select s.grp, mc.key, v.value from public.station_values v "
        "join public.stations s on s.id = v.station_id join public.metric_columns mc on mc.id = v.column_id "
        "where mc.key = any(%s) and s.prefecture = %s",
        (keys, prefecture),
    )
    return {(grp, key): float(value) for grp, key, value in cur.fetchall()}


def scatter_mismatches(points: list[dict[str, object]], truth: dict[tuple[str, str], float]) -> int:
    """散布の点のうち、x か y が表の値と違う点の数。"""
    def differs(point: dict[str, object], axis: str, key: str) -> bool:
        return float(point[axis]) != truth.get((str(point["grp"]), key))
    return sum(1 for point in points if differs(point, "x", X_KEY) or differs(point, "y", Y_KEY))


def dataset_mismatches(rows: dict[str, dict[str, float]], truth: dict[tuple[str, str], float]) -> tuple[int, int]:
    """データセットの値のうち、表の値と違う数（と、見た数）。"""
    pairs = [((grp, key), float(value)) for grp, values in rows.items() for key, value in values.items()]
    return sum(1 for pair, value in pairs if truth.get(pair) != value), len(pairs)


def scatter_in_db(cur: psycopg.Cursor) -> list[dict[str, object]]:
    cur.execute("select public.scatter_points(%s, %s, prefs => %s)", (X_KEY, Y_KEY, [PREFECTURE]))
    return cur.fetchone()[0]


def dataset_in_db(cur: psycopg.Cursor, grps: list[str]) -> dict[str, dict[str, float]]:
    cur.execute("select public.dataset_rows(%s, %s)", (grps, DATASET_KEYS))
    return cur.fetchone()[0]


def tokyo_grps(cur: psycopg.Cursor) -> list[str]:
    cur.execute("select grp from public.stations where prefecture = %s order by grp", (PREFECTURE,))
    return [row[0] for row in cur.fetchall()]


def check_settings(checks: Checks, cur: psycopg.Cursor) -> None:
    cur.execute(
        "select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
        "where n.nspname = 'public' and p.proname = any(%s) order by 1",
        (list(FUNCTIONS),),
    )
    configs = {name: config or [] for name, config in cur.fetchall()}
    ok = all("extra_float_digits=3" in configs.get(name, []) and 'search_path=""' in configs.get(name, []) for name in FUNCTIONS)
    checks.add(ok, "dataset_rows・scatter_points は extra_float_digits = 3 と search_path 空を持つ", f"{configs}")


def check_in_postgrest_setting(checks: Checks, cur: psycopg.Cursor, label: str, expect_exact: bool) -> None:
    """PostgREST と同じ extra_float_digits = 0 の中で、散布とデータセットの値を表の値と比べる。"""
    truth = stored(cur, list({X_KEY, Y_KEY, *DATASET_KEYS}), PREFECTURE)
    grps = tokyo_grps(cur)
    cur.execute("set local extra_float_digits = 0")
    points = scatter_in_db(cur)
    rows = dataset_in_db(cur, grps)
    cur.execute("set local extra_float_digits = 3")
    scatter_bad = scatter_mismatches(points, truth)
    dataset_bad, dataset_total = dataset_mismatches(rows, truth)
    detail = f"散布 {scatter_bad}/{len(points)} 点・データセット {dataset_bad}/{dataset_total} 値がずれる"
    if expect_exact:
        checks.add(scatter_bad == 0 and dataset_bad == 0 and len(points) > 600, f"{label}：表の値と 1 桁まで一致", detail)
    else:
        checks.add(scatter_bad > 0, f"{label}：当てる前は丸まっていた（直すものがあった）", detail)


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
    truth = stored(cur, list({X_KEY, Y_KEY, *DATASET_KEYS}), PREFECTURE)
    points = rest("scatter_points", {"x_key": X_KEY, "y_key": Y_KEY, "prefs": [PREFECTURE]})
    bad = scatter_mismatches(points, truth) if isinstance(points, list) else -1
    checks.add(bad == 0 and isinstance(points, list) and len(points) > 600, "REST（anon）の散布：全点が表の値と一致", f"ずれ {bad}・{len(points) if isinstance(points, list) else points} 点")
    rows = rest("dataset_rows", {"grps": tokyo_grps(cur), "keys": DATASET_KEYS})
    dataset_bad, dataset_total = dataset_mismatches(rows, truth) if isinstance(rows, dict) else (-1, 0)
    checks.add(dataset_bad == 0 and dataset_total > 3000, "REST（anon）のデータセット：全値が表の値と一致", f"ずれ {dataset_bad}/{dataset_total}")
    odaiba = next((point for point in points if point.get("grp") == ODAIBA), None) if isinstance(points, list) else None
    checks.add(odaiba is not None and odaiba["x"] == truth[(ODAIBA, X_KEY)], "大きな値の例：お台場海浜公園の 20km の人口を丸めない", f"{odaiba and odaiba['x']}")
    takebashi = rest("dataset_rows", {"grps": [TAKEBASHI], "keys": ["pop_2015_5km"]})
    cur.execute(
        "select v.value from public.station_values v join public.stations s on s.id = v.station_id "
        "join public.metric_columns mc on mc.id = v.column_id where s.grp = %s and mc.key = 'pop_2015_5km'",
        (TAKEBASHI,),
    )
    expected = float(cur.fetchone()[0])
    got = takebashi.get(TAKEBASHI, {}).get("pop_2015_5km") if isinstance(takebashi, dict) else None
    checks.add(got == expected, "竹橋の 5km の 2015 年の人口（駅詳細と同じ 1,163,836）", f"{got}")


def main() -> int:
    trial = "--trial" in sys.argv
    checks = Checks()
    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            if trial:
                check_in_postgrest_setting(checks, cur, "当てる前・extra_float_digits = 0", expect_exact=False)
                cur.execute(MIGRATION.read_text(encoding="utf-8"))
                print("（試し：migration をトランザクションの中で当てた。最後にロールバックする）")
            check_settings(checks, cur)
            check_in_postgrest_setting(checks, cur, "extra_float_digits = 0（PostgREST と同じ）", expect_exact=True)
            if not trial:
                check_rest(checks, cur)
        if trial:
            conn.rollback()
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
