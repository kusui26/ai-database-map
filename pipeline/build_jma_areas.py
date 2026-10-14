"""市区町村コード → 気象庁の二次細分区域（class20）の対応表を作る（Phase 3・§8.4）。

警報・注意報は**気象庁の区域単位**で発表される（`warning/map.json`）。一方、地点から分かるのは
**5 桁の市区町村コード**（国土地理院の逆ジオコーダ）である。この 2 つを繋ぐ表がここで作られる。

## どこを正にするか

**アプリが読む `r8/map.json` が実際に使っている区域コードを正とする**（`src/lib/hazard/jma.ts` と同じ URL）。
区域定義（`area.json` の class20）や旧 `warning/data/warning/map.json` とはズレることがある。

- 2026-08-27：旧 `map.json` は横浜市・相模原市・富山市など 8 市を 1 区域（`1410000` 横浜市…）で出していて、
  区域定義（「横浜市北部／南部」）と食い違っていた。この表は旧 `map.json` から作った
- 2026-10-15：アプリは r8 に移っていたが、この表は旧のまま残っていた。r8 は 8 市を区域定義どおり分けて出す
  （`1410011` 横浜市北部・`1410012` 横浜市南部…）ので、**表の `1410000` は 1 件も当たらず、警報が出ていても
  「発表なし」と答えていた**。r8 から作り直すと、引ける発表区域は 1,805 件（分かれる市町村 74）

表とアプリが読む `map.json` が食い違わないよう、URL はアプリと同じものにする。それでも気象庁が区域を
変えれば表は古くなるので、アプリは**表の区域が発表に見当たらなければ「発表なし」と言わない**
（`src/lib/hazard/alert-source.ts`）。

## なぜ生成するのか（手書きしないのか）

区域コードの多くは「5桁 + 00」で素直に対応するが、残りが 2 つの理由で崩れる。

1. **1 つの市が複数の区域に分かれる**（横浜市北部／南部、富山市平地／山間部…）
2. **政令市の区は区域に対応しない**。大阪市北区（27127）で前方一致を試みても**何も当たらない**——
   気象庁は「大阪市」単位でしか発表しないので、まず市コードへ畳む必要がある

②の畳み込みは、国土地理院の `muni.js` が**「大阪市　北区」のように市名と区名を全角スペースで
繋いだ表記**を持っているので、そこから導ける。**推測で埋めず、公開データから機械的に決める。**

    python3 pipeline/build_jma_areas.py          # 生成して src/shared/hazard/jma-areas.json へ
    python3 pipeline/build_jma_areas.py --check  # 生成せず、対応の網羅率だけ出す
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "shared" / "hazard" / "jma-areas.json"

MUNI_URL = "https://maps.gsi.go.jp/js/muni.js"
AREA_URL = "https://www.jma.go.jp/bosai/common/const/area.json"
#: 警報・注意報が**実際にどの区域コードで発表されるか**の正。区域定義（area.json）とはズレる。
#: **アプリが読むのと同じ `r8`**（`src/lib/hazard/jma.ts`）。旧 `warning/data/warning/map.json` は 2026-05 から
#: 更新が止まっていて、しかも区域の分け方が r8 と違う（旧は「横浜市」1 区域、r8 は「横浜市北部・南部」）。
#: 旧から作った表では 8 市の発表が 1 件も引けず、警報が出ていても「発表なし」と答えていた（2026-10-15 に発見）。
WARNING_MAP_URL = "https://www.jma.go.jp/bosai/warning/data/r8/map.json"
USER_AGENT = "Mozilla/5.0 (AI Database Map / jma area table)"
TIMEOUT_S = 60

#: `muni.js` の 1 行：GSI.MUNI_ARRAY["1101"] = '1,北海道,1101,札幌市　中央区';
_MUNI_LINE = re.compile(r'MUNI_ARRAY\["(\d+)"\]\s*=\s*\'([^\']*)\'')
#: 政令市の区は市名と区名を**全角スペース**で繋ぐ（「横浜市　鶴見区」）。
WARD_SEPARATOR = "　"
#: 北方領土の 6 村。**気象庁は警報を出さない**ので二次細分区域が存在しないのが正しい。
NORTHERN_TERRITORIES = frozenset({"01695", "01696", "01697", "01698", "01699", "01700"})


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return response.read().decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001 — 原因を残して落とす
        raise RuntimeError(f"取得できません: {url}") from error


def read_municipalities() -> dict[str, tuple[str, str]]:
    """`muni.js` → {5 桁コード: (都道府県名, 市区町村名)}。**5 桁へゼロ埋めする**。

    北海道は `1101` のように 4 桁で入っているが、逆ジオコーダは `01101` を返す。
    ここで揃えておかないと、北海道だけ静かに対応が取れなくなる。
    """
    table: dict[str, tuple[str, str]] = {}
    for code, body in _MUNI_LINE.findall(fetch(MUNI_URL)):
        parts = body.split(",")
        if len(parts) < 4:
            continue
        table[code.zfill(5)] = (parts[1], parts[3])
    return table


def read_class20_names() -> dict[str, str]:
    """`area.json` → {区域コード（7 桁）: 名前}。名前の出どころとしてだけ使う。"""
    area = json.loads(fetch(AREA_URL))
    return {code: entry["name"] for code, entry in area.get("class20s", {}).items()}


def read_warning_areas() -> set[str]:
    """`r8/map.json` → 警報・注意報が**実際に発表される**区域コード（7 桁）。ここが正。

    r8 は気象台ごとに `warning.class20Items[].areaCode` を持つ（発表の無い区域も「発表警報・注意報はなし」で並ぶ）。
    """
    offices = json.loads(fetch(WARNING_MAP_URL))
    codes = {
        item["areaCode"]
        for office in offices
        for item in (office.get("warning") or {}).get("class20Items", [])
    }
    return {code for code in codes if len(code) == 7}


def city_code_of_ward(
    code: str, name: str, prefecture: str, municipalities: dict[str, tuple[str, str]]
) -> str | None:
    """政令市の区（「横浜市　鶴見区」）→ 市のコード。区でなければ None。"""
    if WARD_SEPARATOR not in name:
        return None
    city = name.split(WARD_SEPARATOR)[0]
    return next(
        (
            other
            for other, (other_pref, other_name) in municipalities.items()
            if other_pref == prefecture and other_name == city and other != code
        ),
        None,
    )


def areas_for(prefix: str, warning_areas: set[str]) -> list[str]:
    """5 桁コードに前方一致する区域（分割されている市は複数返る）。"""
    return sorted(code for code in warning_areas if code.startswith(prefix))


def ward_codes_of_city(
    code: str, name: str, prefecture: str, municipalities: dict[str, tuple[str, str]]
) -> list[str]:
    """政令市（「神戸市」）→ その区のコード。区を持たない市町村なら空。

    神戸市・広島市は**区ごとに**二次細分区域がある（`2810100` 神戸市東灘区…）ので、
    市コードそのものには区域が無い。市で聞かれたら**区の全部**を束ねて答える。
    """
    if WARD_SEPARATOR in name:
        return []
    prefix = f"{name}{WARD_SEPARATOR}"
    return [
        other
        for other, (other_pref, other_name) in municipalities.items()
        if other_pref == prefecture and other_name.startswith(prefix) and other != code
    ]


def resolve(
    code: str, municipalities: dict[str, tuple[str, str]], warning_areas: set[str]
) -> list[str]:
    """市区町村コード → 発表区域コード（0 件なら対応が取れなかった）。"""
    direct = areas_for(code, warning_areas)
    if direct:
        return direct
    prefecture, name = municipalities[code]
    city = city_code_of_ward(code, name, prefecture, municipalities)
    if city is not None:
        return areas_for(city, warning_areas)
    wards = ward_codes_of_city(code, name, prefecture, municipalities)
    return sorted({area for ward in wards for area in areas_for(ward, warning_areas)})


def explain_unresolved(
    code: str, municipalities: dict[str, tuple[str, str]]
) -> str | None:
    """対応が取れないことを**説明できる**か（できなければ None＝異常）。

    件数の上限で通すと、いつのまにか増えても気づけない（`tests/api.smoke.sh` の
    「metrics 488」と同じ失敗）。**理由が言えるものだけ**を通す。
    """
    if code in NORTHERN_TERRITORIES:
        return "北方領土（気象庁は警報を発表しない）"
    prefecture, name = municipalities[code]
    duplicate = next(
        (
            other
            for other, (other_pref, other_name) in municipalities.items()
            if other != code and other_pref == prefecture and other_name == name
        ),
        None,
    )
    return None if duplicate is None else f"muni.js の旧コード（現行は {duplicate}）"


def area_name(
    area: str, names: dict[str, str], municipalities: dict[str, tuple[str, str]]
) -> str:
    """発表区域の名前。区域定義に無いものは、上 5 桁が指す市区町村名で代える。"""
    known = names.get(area)
    if known is not None:
        return known
    fallback = municipalities.get(area[:5])
    return area if fallback is None else fallback[1].replace(WARD_SEPARATOR, " ")


def build() -> tuple[dict[str, object], list[str]]:
    municipalities = read_municipalities()
    warning_areas = read_warning_areas()
    names = read_class20_names()
    entries: dict[str, object] = {}
    unresolved: list[str] = []
    for code in sorted(municipalities):
        prefecture, name = municipalities[code]
        areas = resolve(code, municipalities, warning_areas)
        if not areas:
            reason = explain_unresolved(code, municipalities) or "★理由が説明できない"
            unresolved.append(f"{code} {prefecture} {name}：{reason}")
            continue
        entries[code] = {
            "nameJa": name.replace(WARD_SEPARATOR, " "),
            "prefectureJa": prefecture,
            # 名前は区域定義から。定義に無い 8 件（横浜市など）は、
            # **その区域コードの上 5 桁が指す市区町村**の名前で代える
            # （区から畳んだときに「横浜市　鶴見区」と出さないため）。
            "areas": [
                {"code": area, "nameJa": area_name(area, names, municipalities)}
                for area in areas
            ],
        }
    table = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "generatedFrom": "pipeline/build_jma_areas.py",
        "sourceJa": "気象庁 気象警報・注意報（r8/map.json の発表区域）／区域定義（area.json の名称）／国土地理院 市区町村コード（muni.js）",
        "municipalityCount": len(entries),
        "municipalities": entries,
    }
    return table, unresolved


def report(table: dict[str, object], unresolved: list[str]) -> None:
    entries = table["municipalities"]
    assert isinstance(entries, dict)
    split = sum(1 for entry in entries.values() if len(entry["areas"]) > 1)
    total = len(entries) + len(unresolved)
    print(f"  市区町村 {total:,} 件中 {len(entries):,} 件が対応（{100 * len(entries) / total:.1f}%）")
    covered = {area["code"] for entry in entries.values() for area in entry["areas"]}
    print(f"  引ける発表区域: {len(covered):,} 件")
    print(f"  うち複数区域に分かれる市町村: {split} 件（最も重い警報を採る）")
    for line in unresolved:
        print(f"  ・対応なし: {line}")


def main(argv: list[str]) -> int:
    print("気象庁の二次細分区域 × 市区町村コードの対応表を作ります")
    table, unresolved = build()
    report(table, unresolved)
    unexplained = [line for line in unresolved if "★" in line]
    if unexplained:
        print(f"✗ 理由を説明できない未対応が {len(unexplained)} 件あります")
        return 1
    if "--check" in argv:
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(table, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"✓ {OUT.relative_to(ROOT)} — {OUT.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
