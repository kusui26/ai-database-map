"""エリアの区域の値（B5a・2026-10-10）の投入 — CSV → Supabase（冪等・COPY）。

build_area_values.py・build_line_corridors.py が書いた CSV と、区域の指標のカタログ
（`src/shared/catalog/area-catalog.json`）を、`public.area_metrics`・`areas`・`area_values` へ入れる。

冪等性：truncate → COPY → 投入後の確認を**単一トランザクション**で行い、確認が 1 つでも崩れたらロールバック（旧データを保持）。
areas は stations を参照しないので、全量投入（load_to_supabase.py）の truncate では消えない。路線や駅を作り直したときは
build_line_corridors.py → このスクリプトの順に回す（沿線が全路線 × 3 幅そろうことは投入後の確認が見る）。

    python3 pipeline/build_area_values.py && python3 pipeline/build_line_corridors.py
    python3 pipeline/validate_area_values.py
    python3 pipeline/load_area_values.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_common import (  # noqa: E402
    AREA_CATALOG_JSON,
    AREA_UNITS_CSV,
    AREA_VALUES_CSV,
    KINDS,
    LINE_CORRIDOR_VALUES_CSV,
    LINE_CORRIDORS_CSV,
    read_csv,
)
from area_rules import ANCHORS, LINE_WIDTHS_M  # noqa: E402

AREA_COLUMNS = [
    "id", "key", "kind", "code", "line_cd", "width_m", "name_ja", "label_ja", "prefecture", "parent_key", "group_key",
    "station_count", "area_km2", "missing",
]


def _none(text: str) -> str | None:
    return text if text != "" else None


def area_rows() -> list[list[object]]:
    """行政区域（種類の順・コードの順）→ 沿線（路線コード・幅の順）。id は 1 から。"""
    units = read_csv(AREA_UNITS_CSV)
    corridors = read_csv(LINE_CORRIDORS_CSV)
    units.sort(key=lambda u: (KINDS.index(u["kind"]), u["code"]))
    corridors.sort(key=lambda c: (int(c["line_cd"]), int(c["width_m"])))
    rows: list[list[object]] = []
    for unit in units:
        rows.append([
            None, unit["key"], unit["kind"], _none(unit["code"]), None, None, unit["name"], unit["label"],
            _none(unit["prefecture"]), _none(unit["parent_key"]), _none(unit["group_key"]), None,
            float(unit["area_km2"]), unit["missing"],
        ])
    for corridor in corridors:
        rows.append([
            None, corridor["key"], "line", None, int(corridor["line_cd"]), int(corridor["width_m"]), corridor["name"],
            corridor["label"], None, None, None, int(corridor["station_count"]), float(corridor["area_km2"]), "[]",
        ])
    for number, row in enumerate(rows, start=1):
        row[0] = number
    return rows


def copy_area_values(cur: psycopg.Cursor) -> tuple[int, int, int]:
    """カタログと CSV を 3 つの表へ COPY する（呼び出し側のトランザクション内で実行）。"""
    catalog = json.loads(AREA_CATALOG_JSON.read_text(encoding="utf-8"))
    metric_id = {metric["key"]: number for number, metric in enumerate(catalog["metrics"], start=1)}
    areas = area_rows()
    area_id = {row[1]: row[0] for row in areas}
    values = read_csv(AREA_VALUES_CSV) + read_csv(LINE_CORRIDOR_VALUES_CSV)
    stray = sorted({v["area_key"] for v in values} - set(area_id)) + sorted({v["metric_key"] for v in values} - set(metric_id))
    if stray:
        raise SystemExit(f"区域・指標に無い鍵の値がある（CSV とカタログがずれている）: {stray[:5]}")

    cur.execute("truncate public.area_values, public.areas, public.area_metrics")
    with cur.copy("copy public.area_metrics (id, key, meta) from stdin") as copy:
        for metric in catalog["metrics"]:
            copy.write_row([metric_id[metric["key"]], metric["key"], json.dumps(metric, ensure_ascii=False)])
    with cur.copy(f"copy public.areas ({','.join(AREA_COLUMNS)}) from stdin") as copy:
        for row in areas:
            copy.write_row(row)
    with cur.copy("copy public.area_values (area_id, metric_id, value) from stdin") as copy:
        for value in values:
            copy.write_row([area_id[value["area_key"]], metric_id[value["metric_key"]], float(value["value"])])
    return len(catalog["metrics"]), len(areas), len(values)


def _value_sql(area_key: str, metric_key: str) -> str:
    return (
        "select round(v.value) from public.area_values v join public.areas a on a.id = v.area_id "
        "join public.area_metrics m on m.id = v.metric_id "
        f"where a.key = '{area_key}' and m.key = '{metric_key}'"
    )


#: 投入後の確認（SQL・期待値）。崩れたらロールバックする。
POST_LOAD_CHECKS: tuple[tuple[str, str, object], ...] = (
    *(
        (f"固定値 {key} {metric}", _value_sql(key, metric), want)
        for (key, metric), want in ANCHORS.items()
    ),
    (
        "どの路線にも 3 幅の沿線がある（lines と areas がずれていない）",
        "select count(*) from public.lines l where (select count(*) from public.areas a where a.line_cd = l.line_cd) "
        f"<> {len(LINE_WIDTHS_M)}",
        0,
    ),
    (
        "沿線の駅の数が lines の駅の数と合う",
        "select count(*) from public.areas a join public.lines l using (line_cd) where a.station_count <> l.station_count",
        0,
    ),
    (
        "沿線にはどれも 19 の値がある（人口 2・推計 11・事業所 3・従業者 3）",
        "select count(*) from public.areas a where a.kind = 'line' and "
        "(select count(*) from public.area_values v where v.area_id = a.id) <> 19",
        0,
    ),
    (
        "どの行政区域にも 2025 年の人口がある",
        "select count(*) from public.areas a where a.kind <> 'line' and not exists ("
        "select 1 from public.area_values v join public.area_metrics m on m.id = v.metric_id "
        "where v.area_id = a.id and m.key = 'pop_2025')",
        0,
    ),
    (
        "政令市の区の 2025 年の人口の和＝市（20 市）",
        "select count(*) from public.areas c where c.kind = 'city' and abs(("
        "select v.value from public.area_values v join public.area_metrics m on m.id = v.metric_id "
        "where v.area_id = c.id and m.key = 'pop_2025') - ("
        "select sum(v.value) from public.areas w join public.area_values v on v.area_id = w.id "
        "join public.area_metrics m on m.id = v.metric_id where w.parent_key = c.key and m.key = 'pop_2025')) > 0.5",
        0,
    ),
)


def run_post_load_checks(cur: psycopg.Cursor) -> list[str]:
    failures = []
    for name, sql, expected in POST_LOAD_CHECKS:
        cur.execute(sql)
        row = cur.fetchone()
        actual = None if row is None or row[0] is None else (int(row[0]) if isinstance(expected, int) else row[0])
        status = "PASS" if actual == expected else "FAIL"
        print(f"  {status}  {name}（{actual}）")
        if actual != expected:
            failures.append(name)
    return failures


def main() -> int:
    from load_to_supabase import db_params

    with psycopg.connect(**db_params()) as conn:
        with conn.cursor() as cur:
            metrics, areas, values = copy_area_values(cur)
            print(f"投入：指標 {metrics}・区域 {areas:,}・値 {values:,}")
            failures = run_post_load_checks(cur)
            if failures:
                conn.rollback()
                print(f"投入後の確認が崩れたのでロールバックした：{failures}")
                return 1
            for table in ("area_metrics", "areas", "area_values"):
                cur.execute(f"analyze public.{table}")
        conn.commit()
    print("コミットした")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
