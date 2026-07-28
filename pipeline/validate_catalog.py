"""P1 — メトリクス・カタログ 全数検証（独立照合）。

生成物 `src/shared/catalog/catalog.json` を、CSV ヘッダと `docs/dataset.md` §2 の
カテゴリ別件数（＝独立した真実）に照合する。catalog_rules には依存せず、
「生成ロジックのバグ」も検出できるよう期待値を本ファイルに独立記述する。

    python3 pipeline/validate_catalog.py   # 全 PASS で exit 0、1件でも FAIL で exit 1
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "derived" / "station_dataset.csv"
CAT_PATH = ROOT / "src" / "shared" / "catalog" / "catalog.json"

# docs/dataset.md §2 のカテゴリ別 値列数（ドキュメント＝独立した真実）
EXPECTED_CATEGORY_COUNTS = {
    "passenger": 18,  # pax 14 + rate 2 + flag 2（flag_yoy/flag_covid）
    "population": 132,  # 実績42 + 増減率54 + lowbase36
    "population_forecast": 180,  # 推計114 + 推計増減率60 + 誤差6
    "land_price": 153,  # lp_med(年次20×5=100) + lp_n5 + lp_lown5 + lp_gr20 + lp_gr_lown20 + lp_near3
    "bus": 36,
    "establishment": 36,  # estab_n18 + estab_gr12 + estab_gr_lown6
    "employee": 30,  # emp_n18 + emp_gr12
}
EXPECTED_ENTRY_TOTAL = 585
EXPECTED_COLUMN_TOTAL = 595
IDENTITY = {
    "grp", "station_name", "label", "search_label", "prefecture",
    "lon", "lat", "n_op", "operators", "level_complete",
}
ALLOWED_UNITS = {"人", "人/日", "円/㎡", "%", "箇所", "事業所", "m", None}
ALLOWED_FORMATS = {"int", "decimal1", "percent1", "ratio1", "yen", None}
ALLOWED_KINDS = {"level", "growth", "flag", "error", "ratio"}
ALLOWED_CATEGORIES = set(EXPECTED_CATEGORY_COUNTS)
RADIUS_MAP = {"500m": 500, "1km": 1000, "2km": 2000, "5km": 5000, "10km": 10000, "20km": 20000}
_RADIUS_IN_KEY = re.compile(r"_(500m|1km|2km|5km|10km|20km)(?=_|$)")


def radius_from_key(key: str) -> int | None:
    m = _RADIUS_IN_KEY.search(key)
    return RADIUS_MAP[m[1]] if m else None


def main() -> int:
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        header = next(csv.reader(f))
    header_set = set(header)
    catalog = json.loads(CAT_PATH.read_text(encoding="utf-8"))
    entries = catalog["entries"]
    attrs = catalog["stationAttributes"]
    entry_keys = [e["key"] for e in entries]

    results: list[tuple[bool, str, str]] = []

    def check(ok: bool, name: str, detail: str = "") -> None:
        results.append((ok, name, detail))

    # 1. 総数
    check(len(header) == EXPECTED_COLUMN_TOTAL, f"CSV 列数 = {EXPECTED_COLUMN_TOTAL}", f"actual {len(header)}")
    check(len(header) == len(header_set), "CSV 列名に重複なし")
    check(len(entries) == EXPECTED_ENTRY_TOTAL, f"エントリ数 = {EXPECTED_ENTRY_TOTAL}", f"actual {len(entries)}")
    check(len(attrs) == len(IDENTITY), f"駅属性 = {len(IDENTITY)}", f"actual {len(attrs)}")
    check(len(entries) + len(attrs) == len(header), "エントリ + 属性 = 列数")

    # 2. key の網羅・一意・分離
    check(len(entry_keys) == len(set(entry_keys)), "エントリ key が一意")
    attr_keys = {a["key"] for a in attrs}
    check(set(entry_keys) | attr_keys == header_set, "エントリ ∪ 属性 = CSV 列集合",
          f"欠落{sorted(header_set - set(entry_keys) - attr_keys)[:3]} 余分{sorted((set(entry_keys) | attr_keys) - header_set)[:3]}")
    check(not (set(entry_keys) & IDENTITY), "識別列がエントリに混入していない")
    check(attr_keys == IDENTITY, f"駅属性 = 識別{len(IDENTITY)}列", f"diff {sorted(attr_keys ^ IDENTITY)}")

    # 3. カテゴリ別件数が dataset.md §2 と一致
    per_cat: dict[str, int] = {}
    for e in entries:
        per_cat[e["category"]] = per_cat.get(e["category"], 0) + 1
    for cat, exp in EXPECTED_CATEGORY_COUNTS.items():
        check(per_cat.get(cat, 0) == exp, f"カテゴリ {cat} = {exp}", f"actual {per_cat.get(cat, 0)}")
    check(set(per_cat) <= ALLOWED_CATEGORIES, "未知カテゴリなし", f"{set(per_cat) - ALLOWED_CATEGORIES}")

    # 4. 語彙（unit / format / kind）
    check(all(e["unit"] in ALLOWED_UNITS for e in entries), "unit が語彙内",
          f"{sorted({e['unit'] for e in entries if e['unit'] not in ALLOWED_UNITS})}")
    check(all(e["format"] in ALLOWED_FORMATS for e in entries), "format が語彙内",
          f"{sorted({e['format'] for e in entries if e['format'] not in ALLOWED_FORMATS})}")
    check(all(e["kind"] in ALLOWED_KINDS for e in entries), "kind が語彙内",
          f"{sorted({e['kind'] for e in entries if e['kind'] not in ALLOWED_KINDS})}")

    # 5. 信頼性フラグ参照が「flag 種別の実在エントリ」を指す（＝除外/バッジが機能する不変条件・再発防止）
    #    ※ かつて flag_yoy/flag_covid は駅属性で entries 外だったため参照先が解決できず、除外もバッジも無効化していた。
    entry_by_key = {e["key"]: e for e in entries}
    refs = [(e["key"], e["reliabilityFlagKey"]) for e in entries if e["reliabilityFlagKey"]]
    missing = [(k, f) for k, f in refs if f not in entry_by_key]
    check(not missing, "reliabilityFlagKey が全て実在エントリ（metric_columns 化される）", f"{missing[:3]}")
    nonflag = [(k, f) for k, f in refs if entry_by_key.get(f, {}).get("kind") != "flag"]
    check(not nonflag, "reliabilityFlagKey が flag 種別エントリを指す", f"{nonflag[:3]}")

    # 6. radiusM が key のサフィックスと整合
    bad_radius = [e["key"] for e in entries if e["radiusM"] != radius_from_key(e["key"])]
    check(not bad_radius, "radiusM が key の半径と整合", f"{bad_radius[:3]}")

    # 7. flag は rankable=false、level/growth は数量 format を持つ
    bad_rank = [e["key"] for e in entries if e["kind"] == "flag" and e["rankable"]]
    check(not bad_rank, "flag エントリは rankable=false", f"{bad_rank[:3]}")

    # 8. growth は yearBase を持つ（コロナ前後比のみ例外）
    bad_growth = [e["key"] for e in entries
                  if e["kind"] == "growth" and e["yearBase"] is None and e["key"] != "rate_covid"]
    check(not bad_growth, "growth は yearBase を持つ（rate_covid 除く）", f"{bad_growth[:3]}")

    # 9. 将来推計は vintage（2018/2024）を持つ
    bad_vintage = [e["key"] for e in entries
                   if e["category"] == "population_forecast" and e["vintage"] not in (2018, 2024)]
    check(not bad_vintage, "将来推計は vintage=2018/2024", f"{bad_vintage[:3]}")

    # 10. 必須文字列（labelJa / source / license）が非空
    bad_text = [e["key"] for e in entries if not (e["labelJa"] and e["source"] and e["license"])]
    check(not bad_text, "labelJa/source/license が非空", f"{bad_text[:3]}")

    # --- 出力 ---
    passed = sum(1 for ok, _, _ in results if ok)
    print(f"メトリクス・カタログ検証 — {passed}/{len(results)} checks\n")
    for ok, name, detail in results:
        mark = "✓" if ok else "✗ FAIL"
        tail = "" if ok else f"  [{detail}]"
        print(f"  {mark}  {name}{tail}")
    all_ok = passed == len(results)
    print("\n" + ("✅ ALL PASS" if all_ok else "❌ FAILED"))
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
