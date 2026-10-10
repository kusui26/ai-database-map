"""エリアの区域の値（B5a・2026-10-10）— 行政区域の公表値と推計を 1 つの表にする。

設計は `docs/261001_fix_user_feedback_ui.md` §6.12.4、データの説明は `docs/area_values.md`。
入力は fetch_area_stats.py が落とした e-Stat の表・N03（行政区域 2026）・将来推計人口メッシュ（R6）。

| 値 | 区・市町村・政令市・東京 23 区 | 都道府県・全国 |
|---|---|---|
| 人口 1995〜2020 | 社会・人口統計体系 市区町村データ（今の境域に組み替え済み） | 同 都道府県データ |
| 人口 2025 | 令和 7 年国勢調査 人口等基本集計 | 同じ表 |
| 将来推計人口 2020〜2070 | R6 メッシュを市区町村コード（SHICODE）ごとに足す | R6 を都道府県・全国で足す |
| 事業所・従業者 2012/2016/2021 | 社会・人口統計体系 市区町村データ（今の境域に組み替え済み） | 経済センサスの各年の公表値（境界未定地域を含む） |
| 面積 | 令和 7 年国勢調査（面積・参考） | 同じ表 |

出力は `data/derived/area_units.csv`・`area_values.csv` と、区域の指標のカタログ
`src/shared/catalog/area-catalog.json`（コミットする契約物・DB の `area_metrics` はこのミラー）。
**照合が 1 つでも崩れたら書かずに落ちる**（足し方・境域・年の取り違えを、ここで止める）。

    python3 pipeline/fetch_area_stats.py && python3 pipeline/build_area_values.py
    python3 pipeline/build_area_values.py --check   # カタログ JSON が規則と一致するかだけ見る（差分があれば exit 1）
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area_common import (  # noqa: E402
    AREA_CATALOG_JSON,
    AREA_UNITS_CSV,
    AREA_VALUES_CSV,
    ROOT,
    EstatData,
    area_key,
    read_estat,
    read_n03_units,
    write_csv,
)
from area_rules import (  # noqa: E402
    ANCHORS,
    BOUNDARY_UNDETERMINED_CODES,
    CENSUS2025_AREA_TAB,
    CENSUS2025_POP2020_TAB,
    ECON_TABS,
    ECON_YEARS,
    HAMADORI_R6_CODE,
    HAMAMATSU_CODE,
    LINE_POP_YEARS,
    LINE_WIDTHS_M,
    MISSING_RULES,
    POP2020_FROM_CENSUS2025,
    PREFECTURE_SUM_EXCEPTIONS,
    POP_YEARS,
    PRED_YEARS,
    R6_CODE_ALIASES,
    SPECIAL_WARDS_CODE,
    SSDS_ECON_TIME,
    SSDS_EMP_ITEM,
    SSDS_ESTAB_ITEM,
    SSDS_POP_ITEM,
    AreaMetric,
    MissingRule,
    area_metrics,
)

KIND_LABELS_JA: dict[str, str] = {
    "country": "全国",
    "prefecture": "都道府県",
    "city": "政令市（市全体）",
    "special_wards": "東京 23 区（特別区部）",
    "municipality": "市区町村",
    "ward": "政令市の区",
    "line": "沿線",
}
#: 再編前の浜松市の 7 区（R6 だけにある）。市全体の推計はこの 7 区の和。
HAMAMATSU_OLD_WARDS: tuple[str, ...] = tuple(f"221{n}" for n in range(31, 38))
#: 値の比べ方：公表値は 1 人単位で一致すること。推計（実数）は浮動小数の誤差だけを許す。
EXACT_TOLERANCE = 0.5
FLOAT_TOLERANCE = 1e-6


@dataclass
class Area:
    key: str
    kind: str
    code: str | None
    name: str
    label: str
    prefecture: str | None
    parent_key: str | None
    group_key: str | None = None
    area_km2: float | None = None
    missing: list[dict[str, object]] = field(default_factory=list)


# --- 単位 -------------------------------------------------------------------------------------


def build_areas(census25: EstatData) -> tuple[list[Area], dict[str, list[str]]]:
    """全国・都道府県・政令市・東京 23 区・市区町村・区。戻り値の 2 つ目は 市全体の鍵 → 区のコード。"""
    area_class = census25.class_of(census25.area_class_id())
    prefectures = {c.code[:2]: c.name for c in area_class.values() if c.level == "2"}
    if len(prefectures) != 47:
        raise SystemExit(f"都道府県が 47 ではない: {len(prefectures)}")

    areas = [Area("jp", "country", None, "全国", "全国", None, None)]
    areas += [
        Area(area_key("prefecture", code), "prefecture", code, name, name, name, "jp")
        for code, name in sorted(prefectures.items())
    ]

    units = read_n03_units()
    wards_of: dict[str, list[str]] = defaultdict(list)
    name_mismatch = []
    for unit in units:
        found = area_class.get(unit.code)
        if found is None:
            raise SystemExit(f"N03 の {unit.code} {unit.name} が令和 7 年国勢調査の表に無い（境域の版がずれている）")
        if found.name != unit.name:
            name_mismatch.append(f"{unit.code} N03「{unit.name}」／国勢調査「{found.name}」")
        pref_code = unit.code[:2]
        label = f"{prefectures[pref_code]}{unit.name}"
        if unit.is_ward:
            parent = area_class.get(found.parent or "")
            if parent is None or parent.level != "4":
                raise SystemExit(f"区 {unit.code} {unit.name} の市が見つからない（親 {found.parent}）")
            wards_of[parent.code].append(unit.code)
            areas.append(Area(area_key("ward", unit.code), "ward", unit.code, unit.name, label,
                              prefectures[pref_code], area_key("city", parent.code)))
        else:
            group = area_key("special_wards", SPECIAL_WARDS_CODE) if _is_special_ward(unit.code) else None
            areas.append(Area(area_key("municipality", unit.code), "municipality", unit.code, unit.name, label,
                              prefectures[pref_code], area_key("prefecture", pref_code), group))
    if name_mismatch:
        raise SystemExit("N03 と国勢調査で名前が違う（コードの取り違え？）:\n  " + "\n  ".join(name_mismatch[:20]))

    for city_code in sorted(wards_of):
        city = area_class[city_code]
        pref_code = city_code[:2]
        areas.append(Area(area_key("city", city_code), "city", city_code, city.name,
                          f"{prefectures[pref_code]}{city.name}", prefectures[pref_code], area_key("prefecture", pref_code)))
    areas.append(Area(area_key("special_wards", SPECIAL_WARDS_CODE), "special_wards", SPECIAL_WARDS_CODE,
                      "東京23区", "東京都の 23 区（特別区部）", "東京都", area_key("prefecture", "13")))

    special = [a for a in areas if a.group_key is not None]
    if len(wards_of) != 20 or len(special) != 23:
        raise SystemExit(f"政令市 {len(wards_of)}（期待 20）・東京 23 区 {len(special)}（期待 23）")
    return areas, dict(wards_of)


def _is_special_ward(code: str) -> bool:
    return code.startswith("131") and code != SPECIAL_WARDS_CODE


# --- 値 -----------------------------------------------------------------------------------------


Values = dict[tuple[str, str], float]


def _put(values: Values, key: str, metric: str, value: float | None) -> None:
    if value is not None:
        values[(key, metric)] = value


def collect_population(areas: list[Area], values: Values) -> None:
    """人口（1995〜2025）。市区町村・政令市・23 区は市区町村データ、都道府県・全国は都道府県データと 2025 年の表。"""
    muni = read_estat("ssds_muni_pop")
    pref = read_estat("ssds_pref_pop")
    census25 = read_estat("census2025_pop")
    change25 = read_estat("census2025_change")
    area_id = census25.area_class_id()
    pop2025 = census25.lookup(area_id)
    pop2020_k = change25.lookup(change25.area_class_id(), tab=CENSUS2025_POP2020_TAB)
    for year in POP_YEARS[:-1]:
        time = f"{year}100000"
        by_muni = muni.lookup(muni.area_class_id(), cat01=SSDS_POP_ITEM, time=time)
        by_pref = pref.lookup(pref.area_class_id(), cat01=SSDS_POP_ITEM, time=time)
        for area in areas:
            metric = f"pop_{year}"
            if area.kind == "country":
                _put(values, area.key, metric, by_pref.get("00000"))
            elif area.kind == "prefecture":
                _put(values, area.key, metric, by_pref.get(f"{area.code}000"))
            else:
                value = by_muni.get(area.code or "")
                if value is None and year == 2020 and area.code in POP2020_FROM_CENSUS2025:
                    value = pop2020_k.get(area.code or "")
                _put(values, area.key, metric, value)
    for area in areas:
        code = "00000" if area.kind == "country" else (f"{area.code}000" if area.kind == "prefecture" else area.code)
        _put(values, area.key, "pop_2025", pop2025.get(code or ""))


def collect_area_km2(areas: list[Area]) -> None:
    change25 = read_estat("census2025_change")
    km2 = change25.lookup(change25.area_class_id(), tab=CENSUS2025_AREA_TAB)
    for area in areas:
        code = "00000" if area.kind == "country" else (f"{area.code}000" if area.kind == "prefecture" else area.code)
        area.area_km2 = km2.get(code or "")
        if area.area_km2 is None:
            raise SystemExit(f"{area.key} {area.name} の面積が無い")


def collect_projection(areas: list[Area], wards_of: dict[str, list[str]], values: Values) -> None:
    """将来推計人口（R6）。区・市町村は SHICODE ごとの和、政令市・23 区・都道府県・全国はその上の和。"""
    from area_mesh import R6_COLUMNS, read_r6_ptn

    table = read_r6_ptn()
    by_code = table.groupby("SHICODE")[list(R6_COLUMNS)].sum()
    unknown = sorted(set(by_code.index) - {a.code for a in areas if a.code} - set(R6_CODE_ALIASES)
                     - set(HAMAMATSU_OLD_WARDS) - {HAMADORI_R6_CODE})
    if unknown:
        raise SystemExit(f"R6 にあって区域に無い市区町村コード（扱いを area_rules.py に書く）: {unknown}")
    by_pref = table.assign(pref=table["SHICODE"].str[:2]).groupby("pref")[list(R6_COLUMNS)].sum()
    total = table[list(R6_COLUMNS)].sum()
    aliases = {new: old for old, new in R6_CODE_ALIASES.items()}

    def row_of(code: str) -> object | None:
        source = aliases.get(code, code)
        return by_code.loc[source] if source in by_code.index else None

    for area in areas:
        if area.kind == "country":
            row: object | None = total
        elif area.kind == "prefecture":
            row = by_pref.loc[area.code] if area.code in by_pref.index else None
        elif area.kind == "city":
            codes = HAMAMATSU_OLD_WARDS if area.code == HAMAMATSU_CODE else wards_of[area.code or ""]
            absent = [c for c in codes if c not in by_code.index]
            if absent:
                raise SystemExit(f"{area.name} の区 {absent} が R6 に無い（市全体の推計が欠ける）")
            row = by_code.loc[list(codes)].sum()
        elif area.kind == "special_wards":
            row = by_code.loc[[a.code for a in areas if a.group_key == area.key]].sum()
        else:
            row = row_of(area.code or "")
        if row is None:
            continue
        for year, column in zip(PRED_YEARS, R6_COLUMNS):
            values[(area.key, f"pop_pred_2024_{year}")] = float(row[column])  # type: ignore[index]


def collect_economy(areas: list[Area], values: Values) -> None:
    """事業所・従業者（民営）。市区町村などは市区町村データ、都道府県・全国は各年の経済センサスの公表値。"""
    muni = read_estat("ssds_muni_econ")
    for year in ECON_YEARS:
        census = read_estat(f"econ{year}")
        census_area = census.area_class_id()
        estab_tab, emp_tab = ECON_TABS[year]
        official = {
            "estab_n": census.lookup(census_area, tab=estab_tab),
            "emp_n": census.lookup(census_area, tab=emp_tab),
        }
        by_muni = {
            "estab_n": muni.lookup(muni.area_class_id(), cat01=SSDS_ESTAB_ITEM, time=f"{SSDS_ECON_TIME[year]}100000"),
            "emp_n": muni.lookup(muni.area_class_id(), cat01=SSDS_EMP_ITEM, time=f"{SSDS_ECON_TIME[year]}100000"),
        }
        for base, _ in official.items():
            metric = f"{base}_{year}"
            for area in areas:
                if area.kind == "country":
                    _put(values, area.key, metric, official[base].get("00000"))
                elif area.kind == "prefecture":
                    _put(values, area.key, metric, official[base].get(f"{area.code}000"))
                else:
                    _put(values, area.key, metric, by_muni[base].get(area.code or ""))


# --- 値が無い理由 -----------------------------------------------------------------------------


def _rule_for(area: Area, metric: str) -> MissingRule | None:
    for rule in MISSING_RULES:
        if rule.codes is not None and area.code not in rule.codes:
            continue
        if rule.kinds is not None and area.kind not in rule.kinds:
            continue
        if any(metric.startswith(prefix) for prefix in rule.metric_prefixes):
            return rule
    return None


def explain_missing(areas: list[Area], metrics: tuple[AreaMetric, ...], values: Values) -> list[str]:
    """無い値に理由を付ける。理由の無い欠け・言い切った規則に値があるときは問題として返す。"""
    problems: list[str] = []
    by_key = {a.key: a for a in areas}
    for area in areas:
        reasons: dict[str, list[str]] = defaultdict(list)
        for metric in metrics:
            present = (area.key, metric.key) in values
            rule = _rule_for(area, metric.key)
            if present:
                if rule is not None and rule.codes is not None:
                    problems.append(f"{area.key} {area.name} の {metric.key} は値があるのに、規則は「無い」と言っている")
                continue
            if rule is None:
                problems.append(f"{area.key} {area.name} の {metric.key} が無い（理由が area_rules.py に無い）")
                continue
            if rule.requires_parent_value and (area.parent_key or "", metric.key) not in values:
                parent = by_key.get(area.parent_key or "")
                problems.append(f"{area.key} {area.name} の {metric.key} が無く、市全体（{parent.name if parent else '?'}）にも無い")
                continue
            reasons[rule.reasonJa].append(metric.key)
        area.missing = [{"keys": keys, "reasonJa": reason} for reason, keys in reasons.items()]
    return problems


# --- 照合 -------------------------------------------------------------------------------------


def _close(a: float, b: float, metric: str) -> bool:
    tolerance = FLOAT_TOLERANCE * max(1.0, abs(b)) if metric.startswith("pop_pred") else EXACT_TOLERANCE
    return abs(a - b) <= tolerance


def check_sums(areas: list[Area], metrics: tuple[AreaMetric, ...], values: Values) -> tuple[list[str], int]:
    """区の和＝政令市、23 区の和＝特別区部、市区町村の和（＋境界未定地域）＝都道府県、都道府県の和＝全国。

    内訳に欠けがあるとき：原典そのものに値が無い区域（浜通りの推計・避難指示区域の 2012 年）は、原典の合計にも
    入っていないので、残りの和で比べる（浜通りの推計は 13 市町村をまとめた 07999 を足す）。区ができる前の年は比べない。
    戻り値の 2 つ目は比べた組の数（照合が空振りしていないことを数で見る）。
    """
    problems: list[str] = []
    compared = 0
    children: dict[str, list[Area]] = defaultdict(list)
    for area in areas:
        if area.parent_key:
            children[area.parent_key].append(area)
    undetermined = _undetermined_values()
    hamadori = _hamadori_r6()

    for area in areas:
        for metric in metrics:
            want = values.get((area.key, metric.key))
            if want is None:
                continue
            if area.kind == "special_wards":
                members = [a for a in areas if a.group_key == area.key]
            elif area.kind in ("country", "prefecture", "city"):
                # 東京 23 区（特別区部）は 23 の区の集まりなので、東京都の内訳には入れない（二重に数える）
                members = [m for m in children[area.key] if m.kind != "special_wards"]
            else:
                continue
            missing = [m for m in members if (m.key, metric.key) not in values]
            rules = [_rule_for(m, metric.key) for m in missing]
            if any(rule is None or rule.in_parent_total for rule in rules):
                continue  # 欠けた値が上の公表値には入っている（区ができる前・区の再編）＝内訳の和は上の値にならない
            got = float(sum(values[(m.key, metric.key)] for m in members if (m.key, metric.key) in values))
            if area.kind == "special_wards":
                # 境界未定地域（13199・東京湾の埋立地）は経済センサスで特別区部に数えられている
                got += undetermined.get((area.code[:2] if area.code else "", metric.key), 0.0)
            if area.kind == "prefecture":
                got += undetermined.get((area.code or "", metric.key), 0.0)
                if area.code == HAMADORI_R6_CODE[:2]:
                    got += hamadori.get(metric.key, 0.0)
                expected_gap, _ = PREFECTURE_SUM_EXCEPTIONS.get((area.code or "", metric.key), (0, ""))
                got += expected_gap
            compared += 1
            if not _close(got, want, metric.key):
                problems.append(f"{area.key} {area.name} の {metric.key}：内訳の和 {got:,.1f} ≠ {want:,.1f}")
    return problems, compared


def _hamadori_r6() -> dict[str, float]:
    """福島県の R6 の和には、浜通り 13 市町村をまとめた 07999 が入る（市町村には割り振れない）。"""
    from area_mesh import read_r6_ptn

    table = read_r6_ptn()
    rows = table[table["SHICODE"] == HAMADORI_R6_CODE]
    return {f"pop_pred_2024_{year}": float(rows[f"PTN_{year}"].sum()) for year in PRED_YEARS}


def _undetermined_values() -> dict[tuple[str, str], float]:
    """境界未定地域（経済センサスだけ）の値。都道府県の公表値には含まれるので、内訳の和に足して比べる。"""
    out: dict[tuple[str, str], float] = {}
    for year in ECON_YEARS:
        census = read_estat(f"econ{year}")
        area_id = census.area_class_id()
        for base, tab in zip(("estab_n", "emp_n"), ECON_TABS[year]):
            by_area = census.lookup(area_id, tab=tab)
            for code in BOUNDARY_UNDETERMINED_CODES:
                if by_area.get(code) is not None:
                    key = (code[:2], f"{base}_{year}")
                    out[key] = out.get(key, 0.0) + float(by_area[code] or 0.0)
    return out


def check_projection_base(areas: list[Area], values: Values) -> list[str]:
    """推計の 2020 年（基準）＝国勢調査の 2020 年（市区町村ごとに 1 人単位・§6.12.4）。"""
    problems = []
    for area in areas:
        census = values.get((area.key, "pop_2020"))
        base = values.get((area.key, "pop_pred_2024_2020"))
        if census is not None and base is not None and abs(census - base) > EXACT_TOLERANCE:
            problems.append(f"{area.key} {area.name}：推計の 2020 年 {base:,.1f} ≠ 国勢調査 {census:,.0f}")
    return problems


def check_anchors(values: Values) -> list[str]:
    problems = []
    for (key, metric), want in ANCHORS.items():
        got = values.get((key, metric))
        if got is None or round(got) != want:
            problems.append(f"固定値 {key} {metric}：{got} ≠ {want:,}")
    return problems


# --- 出力 -------------------------------------------------------------------------------------


def catalog_payload() -> dict[str, object]:
    """区域の指標のカタログ（コミットする契約物）。"""

    def source(src: object) -> dict[str, str] | None:
        if src is None:
            return None
        return {"method": src.method, "sourceJa": src.sourceJa, "license": src.license}  # type: ignore[attr-defined]

    return {
        "version": 1,
        "generatedFrom": "pipeline/build_area_values.py（規則は pipeline/area_rules.py）",
        "kinds": [{"kind": kind, "labelJa": label} for kind, label in KIND_LABELS_JA.items()],
        "lineWidthsM": list(LINE_WIDTHS_M),
        "years": {
            "population": list(POP_YEARS),
            "populationLine": list(LINE_POP_YEARS),
            "projection": list(PRED_YEARS),
            "economy": list(ECON_YEARS),
        },
        "metrics": [
            {
                "key": m.key,
                "baseMetric": m.baseMetric,
                "category": m.category,
                "labelJa": m.labelJa,
                "unit": m.unit,
                "format": m.format,
                "year": m.year,
                "vintage": m.vintage,
                "sources": {"admin": source(m.admin), "line": source(m.line)},
            }
            for m in area_metrics()
        ],
    }


def catalog_text() -> str:
    return json.dumps(catalog_payload(), ensure_ascii=False, indent=2) + "\n"


def write_outputs(areas: list[Area], metrics: tuple[AreaMetric, ...], values: Values) -> None:
    write_csv(
        AREA_UNITS_CSV,
        ["key", "kind", "code", "name", "label", "prefecture", "parent_key", "group_key", "area_km2", "missing"],
        [
            [a.key, a.kind, a.code or "", a.name, a.label, a.prefecture or "", a.parent_key or "", a.group_key or "",
             f"{a.area_km2:.2f}", json.dumps(a.missing, ensure_ascii=False)]
            for a in areas
        ],
    )
    order = {m.key: i for i, m in enumerate(metrics)}
    rows = sorted(values.items(), key=lambda item: (item[0][0], order[item[0][1]]))
    write_csv(AREA_VALUES_CSV, ["area_key", "metric_key", "value"],
              [[key, metric, _format_value(value)] for (key, metric), value in rows])
    AREA_CATALOG_JSON.write_text(catalog_text(), encoding="utf-8")


def _format_value(value: float) -> str:
    """公表値は整数のまま、推計は小数 4 桁まで（CSV を読みやすく・DB は double precision）。"""
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="カタログ JSON が規則と一致するかだけ見る")
    args = parser.parse_args()
    if args.check:
        current = AREA_CATALOG_JSON.read_text(encoding="utf-8") if AREA_CATALOG_JSON.exists() else ""
        if current != catalog_text():
            print(f"{AREA_CATALOG_JSON.relative_to(ROOT)} が area_rules.py と一致しない（build を実行してコミットする）")
            return 1
        print(f"OK {AREA_CATALOG_JSON.relative_to(ROOT)} は規則と一致")
        return 0

    metrics = area_metrics()
    census25 = read_estat("census2025_pop")
    areas, wards_of = build_areas(census25)
    collect_area_km2(areas)
    values: Values = {}
    collect_population(areas, values)
    collect_projection(areas, wards_of, values)
    collect_economy(areas, values)

    sum_problems, compared = check_sums(areas, metrics, values)
    problems = (
        explain_missing(areas, metrics, values)
        + sum_problems
        + check_projection_base(areas, values)
        + check_anchors(values)
    )
    kinds: dict[str, int] = defaultdict(int)
    for area in areas:
        kinds[area.kind] += 1
    print(f"区域 {len(areas):,}（{dict(kinds)}）・値 {len(values):,}・内訳の和の照合 {compared:,} 組")
    if problems:
        print(f"照合が {len(problems)} 件崩れた（書き出していない）:")
        for problem in problems[:40]:
            print(f"  - {problem}")
        return 1
    write_outputs(areas, metrics, values)
    missing = sum(len(a.missing) for a in areas)
    print(f"OK {AREA_UNITS_CSV.name}・{AREA_VALUES_CSV.name}・{AREA_CATALOG_JSON.name}（理由つきの欠け {missing} 件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
