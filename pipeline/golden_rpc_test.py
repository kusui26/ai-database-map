"""P2c — RPC ゴールデンテスト（DB 関数の結果を CSV と照合）。

psycopg で各 RPC を SELECT 呼び出しし、CSV から独立に導いた期待値と一致するか検証する。
anon 実行可否は別途 REST（run スクリプト側の curl）で確認する。

`station_values.value` が `real`（float4）の DB では、比較の前に**期待値（CSV）を float4 に
丸める**（許容誤差は緩めない・260816）。

    python3 pipeline/golden_rpc_test.py   # 全 PASS で exit 0
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd
import psycopg
from psycopg.rows import dict_row, tuple_row

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import (  # noqa: E402
    CSV_PATH,
    db_params,
    round_to_stored,
    value_column_type,
)


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

    with psycopg.connect(**db_params(), row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute("set statement_timeout = '60s'")

        # 期待値を DB の保存精度（float8 / float4）に合わせてから比較する。
        # 行を取り出す前に丸めること（取り出した Series は df の変更を追わないため）。
        with conn.cursor(row_factory=tuple_row) as tcur:
            vtype = value_column_type(tcur)
            tcur.execute("select key from public.metric_columns")
            metric_keys = [k for (k,) in tcur.fetchall() if k in df.columns and k != "lp_near_use"]
        round_to_stored(df, metric_keys, vtype)
        print(f"station_values.value = {vtype}"
              + ("（期待値も float4 に丸めて比較）\n" if vtype == "real" else "\n"))

        tokyo = station_row("東京")
        chiba = df[df["prefecture"] == "千葉県"]

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

        # 9) 駅詳細：東京 5km 人口2020 = CSV値
        res = call("select * from public.station_bundle(%s)", (tokyo["grp"],))
        bundle = {r["key"]: r["value"] for r in res}
        check(close(bundle.get("pop_2020_5km"), tokyo["pop_2020_5km"]),
              "station_bundle(東京) の pop_2020_5km = CSV値",
              f"db={bundle.get('pop_2020_5km')} csv={tokyo['pop_2020_5km']}")

        # 9b) 所得（260812 追加）：新カテゴリが RPC まで通ることを 1 本で押さえる。
        #     1 人当たりは低分母フラグ（inc_lown_2025_1km）を同梱するのが正（docs/income.md §5.1）。
        check(close(bundle.get("inc_pc_2025_5km"), tokyo["inc_pc_2025_5km"]),
              "station_bundle(東京) の inc_pc_2025_5km = CSV値",
              f"db={bundle.get('inc_pc_2025_5km')} csv={tokyo['inc_pc_2025_5km']}")
        expinc = df.loc[df["inc_pc_2025_1km"].idxmax()]
        res = call("select * from public.rank_by_column(%s,%s,%s,%s)", ("inc_pc_2025_1km", None, "desc", 1))
        check(res and close(res[0]["value"], expinc["inc_pc_2025_1km"]),
              "rank inc_pc_2025_1km desc Top1 = CSV argmax",
              f"db={res[0]['value'] if res else None} csv={expinc['inc_pc_2025_1km']}")

        # 9b-2) 信頼性フラグの同梱（260816 に規約変更）：**フラグの 0 は格納しない**ので、
        #       立っている駅は flag_value=1、立っていない駅は行が無く NULL で返るのが正。
        #       1 県ぶんを全数照合して「1 と NULL の付き方が CSV と完全に一致する」ことを見る。
        def flag_join(metric: str, flag_col: str) -> tuple[int, int, int]:
            pref = df[df[flag_col] == 1].iloc[0]["prefecture"]
            sub = df[(df["prefecture"] == pref) & df[metric].notna()]
            want = {row.grp: (1.0 if getattr(row, flag_col) == 1 else None) for row in sub.itertuples()}
            rows = call("select * from public.rank_by_column(%s,%s,%s,%s)", (metric, [pref], "desc", 9999))
            bad = [r["grp"] for r in rows if want.get(r["grp"], "?") != r["flag_value"]]
            return len(rows), sum(1 for v in want.values() if v == 1), len(bad)

        for metric, flag_col in (("pop_gr_2020_2015_1km", "pop_lowbase_2015_1km"),
                                 ("inc_pc_2025_1km", "inc_lown_2025_1km")):
            n_rows, n_flagged, n_bad = flag_join(metric, flag_col)
            check(n_rows > 0 and n_flagged > 0 and n_bad == 0,
                  f"rank({metric}) の flag_value が CSV と全数一致"
                  f"（{n_rows}駅中フラグ{n_flagged}件・0 は行が無く NULL）",
                  f"不一致 {n_bad} 件")

        # 9c) 売上（260816 追加）：新カテゴリが RPC まで通ること ＋ **フラグの 0 を格納しない**
        #     規約（対策A）が消費側で従来どおり効くこと（行が無い＝0）を 4 本で押さえる。
        check(close(bundle.get("sales_dest_2021_1km"), tokyo["sales_dest_2021_1km"]),
              "station_bundle(東京) の sales_dest_2021_1km = CSV値",
              f"db={bundle.get('sales_dest_2021_1km')} csv={tokyo['sales_dest_2021_1km']}")
        # 東京の低分母フラグは 0 ＝ 行が無い（bundle に現れない）。UI は「無い＝0」と読む。
        check(float(tokyo["sales_lown_2021_1km"]) == 0 and "sales_lown_2021_1km" not in bundle,
              "フラグ 0 の駅は station_bundle に行が無い（対策A）",
              f"csv={tokyo['sales_lown_2021_1km']} bundle={'有' if 'sales_lown_2021_1km' in bundle else '無'}")
        expsales = df.loc[df["sales_dest_2021_1km"].idxmax()]
        res = call("select * from public.rank_by_column(%s,%s,%s,%s)", ("sales_dest_2021_1km", None, "desc", 1))
        check(res and res[0]["grp"] == expsales["grp"] and close(res[0]["value"], expsales["sales_dest_2021_1km"]),
              "rank sales_dest_2021_1km desc Top1 = CSV argmax",
              f"db={res[0]['grp'] if res else None}/{res[0]['value'] if res else None}"
              f" csv={expsales['grp']}/{expsales['sales_dest_2021_1km']}")
        # 低分母を除外しても上位は変わらない（フラグ駅は小さい駅だけ）＋ 除外で件数が減る
        lown = df[df["sales_lown_2021_1km"] == 1]
        res = call("select * from public.rank_by_column(%s,%s,%s,%s,%s,%s)",
                   ("sales_dest_2021_1km", None, "desc", 1, 0, True))
        check(res and res[0]["grp"] == expsales["grp"]
              and res[0]["total"] == len(df) - len(lown),
              "rank sales（低分母を除外）＝ 上位は不変・件数はフラグ駅ぶん減る",
              f"db_total={res[0]['total'] if res else None} csv={len(df) - len(lown)}")

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
