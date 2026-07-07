"""P2b — 投入の全数検証（独立照合・監査レポート生成）。

CSV を独立に読み、DB（Supabase）の投入結果と照合する：
  (a) station_values 件数 = CSV 非NaN セル数（487 数値列）
  (b) 列ごとの件数一致（487列）
  (c) 無作為 300 セルの値一致
  (d) 全国計（sum）一致：代表列
  (e) DB サイズ実測（< 400MB ゲート）
  ＋ stations/metric_columns 件数・lp_near_use・pax_latest の健全性

    python3 pipeline/validate_load.py   # 全 PASS で exit 0、docs/p2b_load_report.md を出力
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import pandas as pd
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from load_to_supabase import CSV_PATH, PAX_DESC, db_params  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs" / "p2b_load_report.md"
SAMPLE_N = 300
SEED = 42
SPOT_COLUMNS = [
    "pax_2024", "pop_2020_1km", "pop_gr_2020_2015_2km",
    "lp_med_1km", "bus_n_1km", "estab_n_2021_1km", "emp_n_2021_1km",
]


def main() -> int:
    df = pd.read_csv(CSV_PATH, low_memory=False)
    n = len(df)
    checks: list[tuple[bool, str, str]] = []
    facts: dict[str, str] = {}

    def check(ok: bool, name: str, detail: str = "") -> None:
        checks.append((ok, name, detail))

    with psycopg.connect(**db_params()) as conn, conn.cursor() as cur:
        cur.execute("select key, id from public.metric_columns")
        colid: dict[str, int] = dict(cur.fetchall())
        value_keys = [k for k in df.columns if k in colid]
        numeric_keys = [k for k in value_keys if k != "lp_near_use"]

        # metric_columns / stations 件数
        cur.execute("select count(*) from public.metric_columns")
        db_metrics = cur.fetchone()[0]
        check(db_metrics == 488, "metric_columns 件数 = 488", f"db={db_metrics}")

        cur.execute("select count(*) from public.stations")
        db_stations = cur.fetchone()[0]
        facts["stations"] = f"{db_stations:,}"
        check(db_stations == n == 9273, "stations 件数 = CSV 行数 = 9273", f"db={db_stations} csv={n}")

        # (a) 総件数 = CSV 非NaN セル数
        csv_cells = int(df[numeric_keys].notna().to_numpy().sum())
        cur.execute("select count(*) from public.station_values")
        db_values = cur.fetchone()[0]
        facts["station_values"] = f"{db_values:,}"
        check(db_values == csv_cells, "(a) station_values 件数 = CSV 非NaN セル数（487列）",
              f"db={db_values:,} csv={csv_cells:,}")

        # (b) 列ごとの件数一致
        cur.execute("select column_id, count(*) from public.station_values group by column_id")
        db_percol = {cid: c for cid, c in cur.fetchall()}
        col_mismatch = [
            (k, int(df[k].notna().sum()), db_percol.get(colid[k], 0))
            for k in numeric_keys
            if int(df[k].notna().sum()) != db_percol.get(colid[k], 0)
        ]
        check(not col_mismatch, f"(b) 列ごとの件数一致（{len(numeric_keys)}列）", f"{col_mismatch[:3]}")

        # (c) 無作為 300 セルの値一致
        rng = random.Random(SEED)
        samples: list[tuple[int, int, float, str]] = []
        while len(samples) < SAMPLE_N:
            ri = rng.randrange(n)
            k = numeric_keys[rng.randrange(len(numeric_keys))]
            val = df.iat[ri, df.columns.get_loc(k)]
            if pd.notna(val):
                samples.append((colid[k], ri + 1, float(val), k))
        cids = [s[0] for s in samples]
        sids = [s[1] for s in samples]
        cur.execute(
            "select sv.column_id, sv.station_id, sv.value from unnest(%s::int[], %s::int[]) "
            "as u(column_id, station_id) join public.station_values sv using (column_id, station_id)",
            (cids, sids),
        )
        dbmap = {(cid, sid): v for cid, sid, v in cur.fetchall()}
        cell_bad = [
            (k, sid, csvval, dbmap.get((cid, sid)))
            for cid, sid, csvval, k in samples
            if dbmap.get((cid, sid)) is None
            or not math.isclose(dbmap[(cid, sid)], csvval, rel_tol=1e-9, abs_tol=1e-6)
        ]
        check(not cell_bad, f"(c) 無作為 {SAMPLE_N} セルの値一致", f"{cell_bad[:3]}")

        # (d) 全国計（sum）一致
        sum_bad = []
        for k in SPOT_COLUMNS:
            if k not in colid:
                continue
            csv_sum = float(df[k].sum())
            cur.execute("select sum(value) from public.station_values where column_id=%s", (colid[k],))
            db_sum = float(cur.fetchone()[0])
            if not math.isclose(db_sum, csv_sum, rel_tol=1e-6):
                sum_bad.append((k, csv_sum, db_sum))
        check(not sum_bad, f"(d) 全国計（sum）一致：{len(SPOT_COLUMNS)}列", f"{sum_bad[:3]}")

        # lp_near_use（stations）
        cur.execute("select count(lp_near_use) from public.stations")
        db_use = cur.fetchone()[0]
        csv_use = int(df["lp_near_use"].notna().sum())
        check(db_use == csv_use, "lp_near_use（stations）非null件数一致", f"db={db_use} csv={csv_use}")

        # pax_latest 健全性（抜取）
        expected_pax = df[PAX_DESC].bfill(axis=1).iloc[:, 0]
        cur.execute("select id, pax_latest from public.stations")
        db_pax = dict(cur.fetchall())
        idxs = [0, n // 2, n - 1] + [rng.randrange(n) for _ in range(20)]
        pax_bad = []
        for ri in idxs:
            exp = expected_pax.iloc[ri]
            exp_i = None if pd.isna(exp) else int(round(exp))
            if db_pax.get(ri + 1) != exp_i:
                pax_bad.append((ri + 1, exp_i, db_pax.get(ri + 1)))
        check(not pax_bad, "pax_latest = 最新非NaN乗降客数（抜取23件）", f"{pax_bad[:3]}")

        # (e) DB サイズ
        cur.execute("select pg_database_size(current_database())")
        db_bytes = cur.fetchone()[0]
        cur.execute(
            "select sum(pg_total_relation_size(c)) from "
            "(values ('public.stations'::regclass),('public.metric_columns'),('public.station_values')) t(c)"
        )
        tables_bytes = cur.fetchone()[0]
        db_mb = db_bytes / 1024 / 1024
        facts["db_size"] = f"{db_mb:.0f} MB"
        facts["tables_size"] = f"{tables_bytes / 1024 / 1024:.0f} MB"
        check(db_mb < 400, "(e) DB サイズ < 400MB", f"{db_mb:.0f} MB")

    passed = sum(1 for ok, _, _ in checks if ok)
    all_ok = passed == len(checks)

    lines = [
        "# P2b 投入検証レポート（自動生成）",
        "",
        f"`pipeline/validate_load.py` が CSV と Supabase を独立照合。**{passed}/{len(checks)} PASS**"
        + ("（✅ ALL PASS）" if all_ok else "（❌ FAILED）"),
        "",
        "## 実測値",
        "",
        f"- stations: **{facts['stations']}** 行",
        f"- station_values: **{facts['station_values']}** 行",
        f"- DB サイズ: **{facts['db_size']}**（うち 3テーブル {facts['tables_size']}）",
        "",
        "## チェック結果",
        "",
    ]
    for ok, name, detail in checks:
        lines.append(f"- [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" → {detail}"))
    lines.append("")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("\n".join(lines))
    print(f"\n→ {REPORT.relative_to(ROOT)}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
