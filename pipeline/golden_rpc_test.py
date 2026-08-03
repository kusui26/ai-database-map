"""P2c — RPC ゴールデンテスト（DB 関数の結果を CSV と照合）。

psycopg で各 RPC を SELECT 呼び出しし、CSV から独立に導いた期待値と一致するか検証する。
anon 実行可否は別途 REST（run スクリプト側の curl）で確認する。

    python3 pipeline/golden_rpc_test.py   # 全 PASS で exit 0
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd
import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import CSV_PATH, db_params  # noqa: E402


def close(a: object, b: object) -> bool:
    if a is None or b is None:
        return False
    return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-6)


def main() -> int:
    df = pd.read_csv(CSV_PATH, low_memory=False)
    checks: list[tuple[bool, str, str]] = []

    def check(cond: object, name: str, detail: str = "") -> None:
        checks.append((bool(cond), name, detail))

    def station_row(name: str):
        sub = df[df["station_name"] == name].sort_values("pax_2024", ascending=False)
        return None if sub.empty else sub.iloc[0]

    tokyo = station_row("東京")
    chiba = df[df["prefecture"] == "千葉県"]

    with psycopg.connect(**db_params(), row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute("set statement_timeout = '60s'")

        def call(sql: str, params: tuple) -> list[dict]:
            cur.execute(sql, params)
            return cur.fetchall()

        # 1-3) 検索（漢字）の #1 が該当駅（駅名一致を優先する順序）
        for name in ["東京", "新宿", "二月田"]:
            row = station_row(name)
            res = call("select * from public.search_stations(%s)", (name,))
            check(row is not None and res and res[0]["grp"] == row["grp"],
                  f"search_stations('{name}') の #1 が該当駅",
                  f"expect={None if row is None else row['grp']} got={res[0]['grp'] if res else None}")

        # 4) 最寄：東京座標 → #1 が東京・dist≈0・5件
        res = call("select * from public.nearest_stations(%s,%s,%s)",
                   (float(tokyo["lon"]), float(tokyo["lat"]), 5))
        check(res and res[0]["grp"] == tokyo["grp"] and res[0]["dist_m"] < 50 and len(res) == 5,
              "nearest_stations(東京座標) → #1 東京・dist<50m・5件",
              f"#1={res[0]['grp'] if res else None} dist={round(res[0]['dist_m']) if res else None} n={len(res)}")

        # 5) bbox：東京周辺 → 東京を含む
        d = 0.02
        res = call("select * from public.stations_in_bbox(%s,%s,%s,%s,%s)",
                   (float(tokyo["lon"]) - d, float(tokyo["lat"]) - d,
                    float(tokyo["lon"]) + d, float(tokyo["lat"]) + d, 2000))
        check(tokyo["grp"] in {r["grp"] for r in res}, "stations_in_bbox(東京周辺) が東京を含む")

        # 6) ランキング desc Top1 = CSV argmax（grp・値）
        exp = df.loc[df["pop_2020_1km"].idxmax()]
        res = call("select * from public.rank_by_column(%s,%s,%s,%s)", ("pop_2020_1km", None, "desc", 1))
        check(res and res[0]["grp"] == exp["grp"] and close(res[0]["value"], exp["pop_2020_1km"]),
              "rank pop_2020_1km desc Top1 = CSV argmax",
              f"db={res[0]['grp'] if res else None}/{res[0]['value'] if res else None} csv={exp['grp']}/{exp['pop_2020_1km']}")

        # 7) ランキング asc Bottom1 = CSV argmin（値）
        expmin = df.loc[df["pop_2020_1km"].idxmin()]
        res = call("select * from public.rank_by_column(%s,%s,%s,%s)", ("pop_2020_1km", None, "asc", 1))
        check(res and close(res[0]["value"], expmin["pop_2020_1km"]),
              "rank pop_2020_1km asc Bottom1 = CSV argmin",
              f"db={res[0]['value'] if res else None} csv={expmin['pop_2020_1km']}")

        # 8) 千葉県 増減率 desc Top1 = CSV（grp・値）＋信頼性フラグ同梱
        expc = chiba.loc[chiba["pop_gr_2020_2015_1km"].idxmax()]
        res = call("select * from public.rank_by_column(%s,%s,%s,%s)",
                   ("pop_gr_2020_2015_1km", ["千葉県"], "desc", 1))
        check(res and res[0]["grp"] == expc["grp"] and close(res[0]["value"], expc["pop_gr_2020_2015_1km"]),
              "rank 千葉県 pop_gr_2020_2015_1km desc Top1 = CSV",
              f"db={res[0]['grp'] if res else None}/{res[0]['value'] if res else None} csv={expc['grp']}/{expc['pop_gr_2020_2015_1km']}")
        check(res and res[0]["flag_value"] is not None, "rank(growth) が信頼性フラグ値を同梱",
              f"flag_value={res[0]['flag_value'] if res else None}")

        # 9) 駅詳細：東京 5km 人口2020 = CSV値
        res = call("select * from public.station_bundle(%s)", (tokyo["grp"],))
        bundle = {r["key"]: r["value"] for r in res}
        check(close(bundle.get("pop_2020_5km"), tokyo["pop_2020_5km"]),
              "station_bundle(東京) の pop_2020_5km = CSV値",
              f"db={bundle.get('pop_2020_5km')} csv={tokyo['pop_2020_5km']}")

        # 10) 散布（千葉県）の値が CSV と一致（260804：values_for_columns → scatter_points）
        res = call("select * from public.scatter_points(%s,%s,%s,%s,%s)",
                   ("pop_2020_1km", "pax_2024", None, None, ["千葉県"]))
        points = {r["grp"]: r for r in res[0]["scatter_points"]}
        c0 = chiba.iloc[0]
        check(close(points.get(c0["grp"], {}).get("x"), c0["pop_2020_1km"]),
              "scatter_points(千葉県) の pop_2020_1km が CSV と一致",
              f"db={points.get(c0['grp'], {}).get('x')} csv={c0['pop_2020_1km']}")
        check(close(points.get(c0["grp"], {}).get("y"), c0["pax_2024"]),
              "scatter_points(千葉県) の pax_2024 が CSV と一致",
              f"db={points.get(c0['grp'], {}).get('y')} csv={c0['pax_2024']}")
        # 畳んだ形＝1 駅 1 行（縦持ち時代は 1 駅 × キー数の行が返っていた）
        check(len(points) == len(res[0]["scatter_points"]),
              "scatter_points は駅ごとに 1 行（重複なし）",
              f"駅 {len(points)} / 行 {len(res[0]['scatter_points'])}")

        # 11) セキュリティ：不正 key はホワイトリスト照合で空（注入不能）
        res = call("select * from public.rank_by_column(%s,%s,%s,%s)",
                   ("'; drop table public.stations; --", None, "desc", 5))
        check(len(res) == 0, "不正な column_key は空を返す（動的 SQL なし・注入不能）", f"rows={len(res)}")

    passed = sum(1 for ok, _, _ in checks if ok)
    all_ok = passed == len(checks)
    print(f"RPC ゴールデンテスト — {passed}/{len(checks)}\n")
    for ok, name, detail in checks:
        print(f"  {'✓' if ok else '✗ FAIL'}  {name}" + ("" if ok else f"  [{detail}]"))
    print("\n" + ("✅ ALL PASS" if all_ok else "❌ FAILED"))
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
