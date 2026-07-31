"""P2b/P5d — CSV → Supabase 投入（冪等・COPY・カタログ同期）。

- metric_columns を catalog.json に同期（列順で id 採番・DB はミラー）。RPC は key で id を
  解決するため、列順が変わっても再採番は安全。
- stations 9,273行（station_id=1..N・pax_latest 算出込み・lp_near_use / operators を文字列属性として保持）
- 数値メトリクス列を melt（NaN スキップ）して station_values（≈490万行）へ COPY
- 文字列メトリクス lp_near_use は float8 の station_values に入らないため stations に置く

冪等性: metric_columns 再シード → stations/station_values 再投入を単一トランザクションで実行
（失敗時はロールバック＝旧データ保持）。live app は commit まで旧データを読む（無停止）。
接続: .env の SUPABASE_DB_URL を分解し kwargs で psycopg に渡す（パスワードは生値・URL encode 不要）。

    python3 pipeline/load_to_supabase.py
"""

from __future__ import annotations

import io
import json
import re
import time
from pathlib import Path

import pandas as pd
import psycopg

from load_station_routes import ROUTES_CSV, copy_station_routes

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "derived" / "station_dataset.csv"
CATALOG_PATH = ROOT / "src" / "shared" / "catalog" / "catalog.json"
PAX_DESC = [f"pax_{y}" for y in range(2024, 2010, -1)]  # 2024..2011（新しい順）
COPY_CHUNK = 500_000

STATION_COLUMNS = [
    "id", "grp", "station_name", "label", "search_label", "prefecture",
    "lon", "lat", "n_op", "operators", "pax_latest", "lp_near_use",
    "level_complete",
]


def db_params() -> dict[str, object]:
    """SUPABASE_DB_URL を分解（パスワードは生値のまま kwargs へ）。"""
    raw = re.search(r"^SUPABASE_DB_URL=(.*)$", (ROOT / ".env").read_text(encoding="utf-8"), re.M)
    if raw is None:
        raise SystemExit(".env に SUPABASE_DB_URL がありません")
    url = raw.group(1).strip().strip('"').strip("'")
    _, after = url.split("://", 1)
    creds, hostpart = after.rsplit("@", 1)
    user, password = creds.split(":", 1)
    hostport, dbname = hostpart.split("/", 1)
    host, _, port = hostport.partition(":")
    return {
        "host": host,
        "port": int(port or "5432"),
        "user": user,
        "password": password,
        "dbname": dbname.split("?")[0],
        "sslmode": "require",
    }


def _int_or_none(value: object) -> int | None:
    return None if pd.isna(value) else int(round(float(value)))


def _bool_or_none(value: object) -> bool | None:
    return None if pd.isna(value) else bool(value)


def _text_or_none(value: object) -> str | None:
    return None if pd.isna(value) else str(value)


def main() -> int:
    print("reading CSV...")
    df = pd.read_csv(CSV_PATH, low_memory=False)
    n = len(df)
    station_id = range(1, n + 1)
    df["__sid"] = station_id
    df["pax_latest"] = df[PAX_DESC].bfill(axis=1).iloc[:, 0]

    # metric_columns は catalog.json のミラー。列順で id を 1..N 採番し、DB を同期する
    # （列順が変わっても RPC は key で id を解決するため id 再採番は安全）。
    entries = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["entries"]
    colid: dict[str, int] = {e["key"]: i for i, e in enumerate(entries, start=1)}

    value_keys = [k for k in df.columns if k in colid]
    # bool の値列（flag_covid/flag_yoy 等の信頼性フラグ）は 0/1 に正規化する。
    # station_values は float8 列で、bool のままだと COPY で失敗するため。2列の特別扱いではなく
    # 「bool の値列は一律 0/1」という汎用ルール（将来 bool フラグが増えても自動追従・リファクタ耐性）。
    for k in value_keys:
        if pd.api.types.is_bool_dtype(df[k]):
            df[k] = df[k].astype("int8")
    text_value = [k for k in value_keys if not pd.api.types.is_numeric_dtype(df[k])]
    if text_value != ["lp_near_use"]:
        raise SystemExit(f"想定外の非数値メトリクス列: {text_value}（stations 側の対応が必要）")
    numeric_keys = [k for k in value_keys if k != "lp_near_use"]
    print(f"stations={n} / metric_columns={len(entries)} / value cols={len(value_keys)}"
          f"（numeric {len(numeric_keys)} + text {text_value}）")

    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            # --- セッション設定＋FK 一時解除 ---
            # 数百万行の per-row FK チェック（FOR KEY SHARE）は statement timeout に達するため、
            # timeout を無効化し、FK を外して高速 COPY → 後で一括検証つきで再付与する。
            cur.execute("set statement_timeout = 0")
            cur.execute(
                "select conname from pg_constraint "
                "where conrelid = 'public.station_values'::regclass and contype = 'f'"
            )
            for (fk_name,) in cur.fetchall():
                cur.execute(f'alter table public.station_values drop constraint "{fk_name}"')

            # --- 冪等リセット（値・駅・カタログミラーを truncate） ---
            cur.execute("truncate public.station_values")
            cur.execute("truncate public.stations cascade")
            cur.execute("truncate public.metric_columns")

            # --- metric_columns を catalog.json に同期（列順＝id・単一トランザクション内） ---
            t0 = time.time()
            with cur.copy("copy public.metric_columns (id, key, meta) from stdin") as cp:
                for i, e in enumerate(entries, start=1):
                    cp.write_row([i, e["key"], json.dumps(e, ensure_ascii=False)])
            print(f"  metric_columns {len(entries)} 行 synced in {time.time() - t0:.1f}s")

            # --- stations を COPY（operators 追加） ---
            t0 = time.time()
            stations = pd.DataFrame(
                {
                    "id": station_id,
                    "grp": df["grp"], "station_name": df["station_name"], "label": df["label"],
                    "search_label": df["search_label"], "prefecture": df["prefecture"],
                    "lon": df["lon"], "lat": df["lat"], "n_op": df["n_op"],
                    "operators": df["operators"],
                    "pax_latest": df["pax_latest"], "lp_near_use": df["lp_near_use"],
                    "level_complete": df["level_complete"],
                }
            )
            with cur.copy(f"copy public.stations ({','.join(STATION_COLUMNS)}) from stdin") as cp:
                for row in stations.itertuples(index=False):
                    cp.write_row([
                        int(row.id), str(row.grp), str(row.station_name), str(row.label),
                        str(row.search_label), str(row.prefecture),
                        float(row.lon), float(row.lat),
                        _int_or_none(row.n_op), _text_or_none(row.operators),
                        _int_or_none(row.pax_latest), _text_or_none(row.lp_near_use),
                        _bool_or_none(row.level_complete),
                    ])
            print(f"  stations copied in {time.time() - t0:.1f}s")

            # --- station_routes（路線・260731）を同じトランザクションで入れ直す ---
            # stations の truncate cascade で消えるため、全量投入のたびに再投入する。
            # CSV が無い環境（路線を生成していない）ではスキップし、投入自体は止めない。
            if ROUTES_CSV.exists():
                t0 = time.time()
                routes_written = copy_station_routes(cur, ROUTES_CSV)
                print(f"  station_routes ({routes_written:,} 行) copied in {time.time() - t0:.1f}s")
            else:
                print(f"  station_routes: {ROUTES_CSV.name} が無いためスキップ")

            # --- 数値メトリクスを melt（NaN スキップ）→ station_values を COPY ---
            t0 = time.time()
            long = df[["__sid"] + numeric_keys].melt(
                id_vars="__sid", var_name="key", value_name="value"
            )
            long = long.dropna(subset=["value"])
            long["column_id"] = long["key"].map(colid).astype("int32")
            long = long[["column_id", "__sid", "value"]]
            print(f"  melted {len(long):,} 非NaN 値 in {time.time() - t0:.1f}s")

            t0 = time.time()
            with cur.copy(
                "copy public.station_values (column_id, station_id, value) from stdin with (format csv)"
            ) as cp:
                for start in range(0, len(long), COPY_CHUNK):
                    buf = io.StringIO()
                    long.iloc[start : start + COPY_CHUNK].to_csv(buf, index=False, header=False)
                    cp.write(buf.getvalue())
            print(f"  station_values ({len(long):,} 行) copied in {time.time() - t0:.1f}s")

            # --- FK 再付与（効率的な一括検証で整合性を担保） ---
            t0 = time.time()
            cur.execute(
                "alter table public.station_values add constraint station_values_column_id_fkey "
                "foreign key (column_id) references public.metric_columns(id)"
            )
            cur.execute(
                "alter table public.station_values add constraint station_values_station_id_fkey "
                "foreign key (station_id) references public.stations(id)"
            )
            print(f"  FK 再付与・一括検証 in {time.time() - t0:.1f}s")

        conn.commit()

    print("✓ load complete（commit 済み）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
