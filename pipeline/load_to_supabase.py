"""P2b/P5d — CSV → Supabase 投入（冪等・COPY・カタログ同期）。

- metric_columns を catalog.json に同期（列順で id 採番・DB はミラー）。RPC は key で id を
  解決するため、列順が変わっても再採番は安全。
- stations 9,273行（station_id=1..N・pax_latest 算出込み・lp_near_use / operators を文字列属性として保持）
- 数値メトリクス列を melt（NaN スキップ）して station_values（≈600万行）へ COPY
- **フラグ列の 0 は格納しない**（行が無い＝0。`drop_flag_zeros`・260816 の容量対策）
- 文字列メトリクス lp_near_use は float8 の station_values に入らないため stations に置く

冪等性: metric_columns 再シード → stations/station_values 再投入を単一トランザクションで実行
（失敗時はロールバック＝旧データ保持）。live app は commit まで旧データを読む（無停止）。
接続: .env の SUPABASE_DB_URL を分解し kwargs で psycopg に渡す（パスワードは生値・URL encode 不要）。

    python3 pipeline/load_to_supabase.py            # フルロード
    python3 pipeline/load_to_supabase.py --append   # 追記（列を足しただけのとき）

⚠ **フルロードはディスクのピークが定常サイズの約 2 倍**になる。truncate → COPY を単一
トランザクションで行うため、コミットまで旧ファイルと新ファイルが同時に存在するから。
260816 に売上 126 列を足したときは、これで Supabase 無料枠のディスクを使い切り、
**Postgres が起動できなくなった**（トランザクションはロールバックされデータは無事）。
列を追加しただけなら **`--append`** を使うこと。追記モードは

  ① 既存 metric_columns が catalog の先頭 N 件と (id, key) で一致することを確認
     （カタログは CSV の列順で採番するので、**新しい列を末尾に足す限り** 既存 id は動かない）
  ② stations の並びが CSV と一致することを確認（station_id は CSV の行順＝1..N）
  ③ 既存フラグ列の値 0 を削除して VACUUM（先に空きを作る）
  ④ **既存列の meta を catalog に同期**（ラベルや参照フラグの変更を DB に反映）
  ⑤ 新しい列の metric_columns と station_values だけを追記（チャンクごとに commit）

の順で、ピークを「増える分＋WAL」に抑える。
"""

from __future__ import annotations

import io
import json
import re
import sys
import time
from pathlib import Path

import pandas as pd
import psycopg

from load_station_routes import ROUTES_CSV, copy_station_routes
from load_municipality import MUNI_CSV, apply_municipality

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
        # ⚠ Supabase のセッション既定は extra_float_digits=0。この設定だと `real` の**テキスト表現**が
        # 有効数字 6 桁に丸められ（3683268 → "3.68327e+06" → 3683270.0）、psycopg で受けた値が
        # 保存値とずれる。**格納値は正しく、PostgREST も完全精度で返す**（260816 に実測）ので、
        # ずれるのは psycopg のテキスト受信だけ。検証を厳密にするため 3 桁ぶん増やして受け取る。
        "options": "-c extra_float_digits=3",
    }


def value_column_type(cur: psycopg.Cursor) -> str:
    """`station_values.value` の型（`real` / `double precision`）。検証の期待値を保存精度に合わせる。"""
    cur.execute(
        "select format_type(atttypid, atttypmod) from pg_attribute "
        "where attrelid = 'public.station_values'::regclass and attname = 'value' and attnum > 0"
    )
    row = cur.fetchone()
    if row is None:
        raise SystemExit("public.station_values.value が見つかりません（migrations 未適用？）")
    return str(row[0])


def round_to_stored(df: pd.DataFrame, keys: list[str], value_type: str) -> None:
    """value 列が `real` なら、CSV 側（期待値）も float4 に丸める（**破壊的**・列を上書きする）。

    許容誤差を緩めるのではなく**期待値を保存精度に合わせる**。こうすると
    「float4 の丸めが正しく行われたこと」まで厳密比較で検証できる（260816）。
    """
    if value_type == "real":
        df[keys] = df[keys].astype("float32").astype("float64")


def _int_or_none(value: object) -> int | None:
    return None if pd.isna(value) else int(round(float(value)))


def _bool_or_none(value: object) -> bool | None:
    return None if pd.isna(value) else bool(value)


def _text_or_none(value: object) -> str | None:
    return None if pd.isna(value) else str(value)


def drop_flag_zeros(
    long: pd.DataFrame, entries: list[dict[str, object]], colid: dict[str, int]
) -> tuple[pd.DataFrame, int]:
    """**フラグ列の 0 を格納しない**（行が無い＝0）。落とした行数も返す。

    信頼性フラグは 8 割以上が 0 で、その 0 は 1 行 74.5 バイト（本体＋索引）を消費するだけで
    何の情報も持たない。消費側は 3 つとも「行が無い」を 0 と同義に扱うので意味は変わらない：
    ランキング RPC は `fv.value is distinct from 1`（left join で NULL）、散布 RPC は
    `max(value) filter (...)` が NULL、駅詳細は `values.get(key) === 1`。
    docs/260816_sales.md §12.4 の対策 A（これが無いと売上 126 列で無料枠 500MB を超える）。
    """
    flag_ids = {colid[str(e["key"])] for e in entries if e["kind"] == "flag"}
    keep = ~(long["column_id"].isin(flag_ids) & (long["value"] == 0))
    return long[keep], int((~keep).sum())


def read_dataset() -> tuple[pd.DataFrame, list[dict[str, object]], dict[str, int]]:
    """CSV とカタログを読み、bool の値列を 0/1 に正規化して (df, entries, key→id) を返す。

    bool の値列（flag_covid/flag_yoy 等）を正規化するのは、station_values が float8 列で
    bool のままだと COPY に失敗するから。2 列の特別扱いではなく「bool の値列は一律 0/1」
    という汎用ルールにしてある（将来 bool フラグが増えても自動追従する）。
    """
    df = pd.read_csv(CSV_PATH, low_memory=False)
    df["__sid"] = range(1, len(df) + 1)
    df["pax_latest"] = df[PAX_DESC].bfill(axis=1).iloc[:, 0]
    entries = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["entries"]
    colid: dict[str, int] = {str(e["key"]): i for i, e in enumerate(entries, start=1)}
    for key in [k for k in df.columns if k in colid]:
        if pd.api.types.is_bool_dtype(df[key]):
            df[key] = df[key].astype("int8")
    return df, entries, colid


def melt_values(
    df: pd.DataFrame, keys: list[str], entries: list[dict[str, object]], colid: dict[str, int]
) -> tuple[pd.DataFrame, int]:
    """指定列を (column_id, station_id, value) の縦持ちへ。NaN とフラグの 0 は落とす。"""
    long = df[["__sid"] + keys].melt(id_vars="__sid", var_name="key", value_name="value")
    long = long.dropna(subset=["value"])
    long["column_id"] = long["key"].map(colid).astype("int32")
    return drop_flag_zeros(long[["column_id", "__sid", "value"]], entries, colid)


def numeric_value_keys(df: pd.DataFrame, value_keys: list[str]) -> list[str]:
    """数値メトリクス列（文字列の lp_near_use だけは stations 側に置くので外す）。"""
    text_value = [k for k in value_keys if not pd.api.types.is_numeric_dtype(df[k])]
    if text_value not in ([], ["lp_near_use"]):
        raise SystemExit(f"想定外の非数値メトリクス列: {text_value}（stations 側の対応が必要）")
    return [k for k in value_keys if k != "lp_near_use"]


def copy_values(cur: psycopg.Cursor, long: pd.DataFrame) -> None:
    """station_values へ COPY（COPY_CHUNK 行ずつ）。"""
    with cur.copy(
        "copy public.station_values (column_id, station_id, value) from stdin with (format csv)"
    ) as cp:
        for start in range(0, len(long), COPY_CHUNK):
            buf = io.StringIO()
            long.iloc[start : start + COPY_CHUNK].to_csv(buf, index=False, header=False)
            cp.write(buf.getvalue())


def analyze_tables(conn: psycopg.Connection) -> None:
    """投入直後はプランナ統計が空でランキングの初回が遅いので、ANALYZE を打つ。"""
    conn.commit()              # 開いているトランザクションを閉じてから autocommit へ
    conn.autocommit = True
    t0 = time.time()
    with conn.cursor() as cur:
        for table in ("public.station_values", "public.stations", "public.station_routes"):
            cur.execute(f"analyze {table}")
    conn.autocommit = False
    print(f"  ANALYZE（3 テーブル）in {time.time() - t0:.1f}s")


def main() -> int:
    print("reading CSV...")
    df, entries, colid = read_dataset()
    n = len(df)
    station_id = range(1, n + 1)

    # metric_columns は catalog.json のミラー。列順で id を 1..N 採番し、DB を同期する
    # （列順が変わっても RPC は key で id を解決するため id 再採番は安全）。
    value_keys = [k for k in df.columns if k in colid]
    numeric_keys = numeric_value_keys(df, value_keys)
    print(f"stations={n} / metric_columns={len(entries)} / value cols={len(value_keys)}"
          f"（numeric {len(numeric_keys)}）")

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

            # --- 市区町村（サイドカー・260902 PR-4）を同じトランザクションで結合 ---
            # routes と違い**無ければ失敗**させる——list_stations（MCP）の前提なので、
            # 欠けたまま静かにロードが通るとドリフトに気づけない（hard-fail の決定・調査文書 §9.2）。
            t0 = time.time()
            muni_rows = apply_municipality(cur, MUNI_CSV)
            print(f"  municipality ({muni_rows:,} 行) applied in {time.time() - t0:.1f}s")

            # --- 数値メトリクスを melt（NaN・フラグの 0 をスキップ）→ station_values を COPY ---
            t0 = time.time()
            long, skipped = melt_values(df, numeric_keys, entries, colid)
            print(f"  melted {len(long):,} 行 in {time.time() - t0:.1f}s"
                  f"（フラグの 0 を {skipped:,} 行 格納しない・容量対策）")

            t0 = time.time()
            copy_values(cur, long)
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
        analyze_tables(conn)

    print("✓ load complete（commit 済み）")
    return 0


def assert_ids_stable(cur: psycopg.Cursor, entries: list[dict[str, object]]) -> int:
    """DB の metric_columns が catalog の先頭 N 件と (id, key) で一致するか。既存件数 N を返す。

    追記モードは**既存 id を動かさない**ことが前提。カタログは CSV の列順で採番するので、
    新しい列を**末尾に足す**限りこの前提は成り立つ（挿入・削除・並べ替えでは成り立たない）。
    """
    cur.execute("select id, key from public.metric_columns order by id")
    rows = cur.fetchall()
    if len(rows) > len(entries):
        raise SystemExit(f"DB の列が多い（db={len(rows)} catalog={len(entries)}）。追記は使えません")
    for (db_id, db_key), (want_id, entry) in zip(rows, enumerate(entries, start=1)):
        if db_id != want_id or db_key != entry["key"]:
            raise SystemExit(f"既存 metric_columns がカタログとずれています"
                             f"（db: id={db_id} key={db_key} / catalog: id={want_id} key={entry['key']}）。"
                             " 追記は使えません（フルロードが要ります）")
    return len(rows)


def assert_stations_match(cur: psycopg.Cursor, df: pd.DataFrame) -> None:
    """stations の並びが CSV と同じか（station_id は CSV の行順＝1..N なので、ずれると値が別の駅に付く）。"""
    cur.execute("select id, grp from public.stations order by id")
    rows = cur.fetchall()
    grps = df["grp"].tolist()
    if len(rows) != len(grps):
        raise SystemExit(f"stations 件数が CSV と違います（db={len(rows)} csv={len(grps)}）")
    bad = [(i, g, grps[i - 1]) for i, g in rows if g != grps[i - 1]]
    if bad:
        raise SystemExit(f"stations の並びが CSV と違います（例 {bad[:3]}）。追記は使えません")


def sync_existing_meta(conn: psycopg.Connection, entries: list[dict[str, object]], existing: int) -> int:
    """既存 metric_columns の `meta` を catalog に合わせる（id と key は動かさない）。

    追記モードは行を足すだけなので、**既存列のラベルや参照フラグを変えたときに DB が古いまま**になる。
    RPC は `meta ->> 'reliabilityFlagKey'` を見てランキングの除外を決めるため、ここがずれると
    フラグを付け替えても本番に効かない（260817 に `sales_dest_gr` の参照先を変えて気づいた）。
    """
    with conn.cursor() as cur:
        cur.execute("select id, meta from public.metric_columns where id <= %s order by id", (existing,))
        current = dict(cur.fetchall())
        changed = [(i, entry) for i, entry in enumerate(entries[:existing], start=1)
                   if current.get(i) != entry]
        for i, entry in changed:
            cur.execute("update public.metric_columns set meta = %s::jsonb where id = %s",
                        (json.dumps(entry, ensure_ascii=False), i))
    conn.commit()
    return len(changed)


def purge_flag_zeros(conn: psycopg.Connection) -> int:
    """既存フラグ列の値 0 を消す（行が無い＝0）。列ごとに小さく区切って commit する。

    先に空きを作ってから追記することで、ディスクのピークを下げる。
    """
    with conn.cursor() as cur:
        cur.execute("select id from public.metric_columns where meta ->> 'kind' = 'flag' order by id")
        flag_ids = [row[0] for row in cur.fetchall()]
    deleted = 0
    for flag_id in flag_ids:
        with conn.cursor() as cur:
            cur.execute("delete from public.station_values where column_id = %s and value = 0",
                        (flag_id,))
            deleted += cur.rowcount
        conn.commit()
    return deleted


def append() -> int:
    """列を足しただけのときの投入（truncate しない）。ディスクのピークを「増える分」に抑える。"""
    print("reading CSV...")
    df, entries, colid = read_dataset()

    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            cur.execute("set statement_timeout = 0")
            existing = assert_ids_stable(cur, entries)
            assert_stations_match(cur, df)
        new_entries = entries[existing:]
        new_keys = numeric_value_keys(df, [str(e["key"]) for e in new_entries])
        print(f"既存 {existing} 列 ＋ 追記 {len(new_entries)} 列（numeric {len(new_keys)}）")
        updated = sync_existing_meta(conn, entries, existing)
        print(f"  既存列の meta を同期: {updated} 件更新")
        if not new_entries:
            print("追記する列がありません（DB はカタログと同じ）")
            return 0

        t0 = time.time()
        deleted = purge_flag_zeros(conn)
        print(f"  既存フラグの 0 を {deleted:,} 行 削除 in {time.time() - t0:.1f}s")
        conn.commit()              # 開いたままの読み取りトランザクションを閉じてから切り替える
        conn.autocommit = True     # VACUUM はトランザクション内で実行できない
        with conn.cursor() as cur:
            t0 = time.time()
            cur.execute("vacuum (analyze) public.station_values")
            print(f"  VACUUM（空きを再利用可能に）in {time.time() - t0:.1f}s")
        conn.autocommit = False

        with conn.cursor() as cur:
            with cur.copy("copy public.metric_columns (id, key, meta) from stdin") as cp:
                for i, entry in enumerate(new_entries, start=existing + 1):
                    cp.write_row([i, entry["key"], json.dumps(entry, ensure_ascii=False)])
        conn.commit()
        print(f"  metric_columns に {len(new_entries)} 行 追記")

        long, skipped = melt_values(df, new_keys, entries, colid)
        print(f"  melted {len(long):,} 行（フラグの 0 を {skipped:,} 行 格納しない）")
        t0 = time.time()
        for start in range(0, len(long), COPY_CHUNK):    # チャンクごとに commit（WAL を溜めない）
            with conn.cursor() as cur:
                copy_values(cur, long.iloc[start : start + COPY_CHUNK])
            conn.commit()
            print(f"    {min(start + COPY_CHUNK, len(long)):,}/{len(long):,} 行 ({time.time() - t0:.0f}s)")

        analyze_tables(conn)
        with conn.cursor() as cur:
            cur.execute("select count(*), pg_size_pretty(pg_database_size(current_database())) "
                        "from public.station_values")
            rows, size = cur.fetchone()
            print(f"✓ append complete — station_values {rows:,} 行 / DB {size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(append() if "--append" in sys.argv else main())
