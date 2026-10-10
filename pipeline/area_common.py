"""エリアの区域の値（B5a）の共通部品：置き場所・エリアの鍵・e-Stat の生データの読み方・行政区域の単位。

規則（年・指標・出典・値が無い理由）は `area_rules.py`、メッシュの読み方は `area_mesh.py`。
"""

from __future__ import annotations

import csv
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

from area_rules import N03_UNASSIGNED_SUFFIX, NORTHERN_TERRITORIES_CODES

ROOT = Path(__file__).resolve().parents[1]

# --- 置き場所（data/ は gitignore。コミットするのはカタログ JSON とコードだけ） -------------------
RAW_DIR = ROOT / "data" / "area_raw"
ESTAT_DIR = RAW_DIR / "estat"
IPSS_XLSX = RAW_DIR / "ipss_suikei_kekka.xlsx"
DERIVED_DIR = ROOT / "data" / "derived"
AREA_UNITS_CSV = DERIVED_DIR / "area_units.csv"
AREA_VALUES_CSV = DERIVED_DIR / "area_values.csv"
LINE_CORRIDORS_CSV = DERIVED_DIR / "line_corridors.csv"
LINE_CORRIDOR_VALUES_CSV = DERIVED_DIR / "line_corridor_values.csv"
AREA_CATALOG_JSON = ROOT / "src" / "shared" / "catalog" / "area-catalog.json"

#: エリアの種類（DB の `areas.kind` と同じ）。並びは DB の id の並び。
KINDS: tuple[str, ...] = ("country", "prefecture", "city", "special_wards", "municipality", "ward", "line")
#: 行政区域の種類（公表値で持つもの）。
ADMIN_KINDS: frozenset[str] = frozenset(KINDS) - {"line"}

#: 値が無いことを表す e-Stat の記号（「-」該当なし・「･･･」調査なし・「x」秘匿 など）。
NON_NUMERIC = frozenset({"-", "･･･", "…", "x", "X", "***", ""})


def area_key(kind: str, code: str | None = None, line_cd: int | None = None, width_m: int | None = None) -> str:
    """エリアの鍵（§6.12.3 の文字列）。共通 API・URL・地図の操作で同じ形を使う。"""
    if kind == "country":
        return "jp"
    if kind == "prefecture":
        if code is None or len(code) != 2:
            raise ValueError(f"都道府県のコードは 2 桁（受領: {code}）")
        return f"pref:{code}"
    if kind == "line":
        if line_cd is None or width_m is None:
            raise ValueError("沿線は路線コードと幅が要る")
        return f"line:{line_cd}@{width_m}"
    if code is None or len(code) != 5:
        raise ValueError(f"市区町村のコードは 5 桁（受領: {kind} {code}）")
    return f"muni:{code}"


def numeric(text: object) -> float | None:
    """e-Stat の値（文字列）→ 数。記号（該当なし・秘匿など）は None。"""
    if text is None:
        return None
    value = str(text).strip()
    if value in NON_NUMERIC:
        return None
    try:
        return float(value.replace(",", ""))
    except ValueError as error:
        raise ValueError(f"e-Stat の値を数にできない: {value!r}") from error


# --- e-Stat の生データ（fetch_area_stats.py が保存した JSON） -------------------------------


@dataclass(frozen=True)
class EstatClass:
    code: str
    name: str
    level: str | None
    parent: str | None


@dataclass(frozen=True)
class EstatData:
    """1 つの表の値とメタ情報。値は {分類の id: コード, ..., "$": 値} の辞書の並び。"""

    name: str
    stats_data_id: str
    classes: dict[str, tuple[EstatClass, ...]]
    values: tuple[dict[str, str], ...]

    def class_of(self, class_id: str) -> dict[str, EstatClass]:
        return {c.code: c for c in self.classes[class_id]}

    def area_class_id(self) -> str:
        """地域の分類の id（たいていは `area`。平成 24 年の経済センサスは `cat02`）。"""
        if "area" in self.classes:
            return "area"
        for class_id, classes in self.classes.items():
            if any(c.code == "00000" for c in classes) and any(c.code == "13101" for c in classes):
                return class_id
        raise ValueError(f"{self.name}: 地域の分類が見つからない")

    def lookup(self, area_id_key: str, **where: str) -> dict[str, float | None]:
        """地域コード → 値（`where` の分類に合う行だけ）。同じ地域が 2 度出てきたら落とす。"""
        out: dict[str, float | None] = {}
        for row in self.values:
            if any(row.get(f"@{key}") != value for key, value in where.items()):
                continue
            code = row[f"@{area_id_key}"]
            if code in out:
                raise ValueError(f"{self.name}: 地域 {code} が 2 度ある（{where}）")
            out[code] = numeric(row.get("$"))
        return out


def read_estat(name: str) -> EstatData:
    path = ESTAT_DIR / f"{name}.json"
    if not path.exists():
        raise SystemExit(f"{path.relative_to(ROOT)} がありません。先に pipeline/fetch_area_stats.py を実行してください")
    payload = json.loads(path.read_text(encoding="utf-8"))
    classes: dict[str, tuple[EstatClass, ...]] = {}
    for obj in payload["classes"]:
        items = obj["CLASS"] if isinstance(obj["CLASS"], list) else [obj["CLASS"]]
        classes[obj["@id"]] = tuple(
            EstatClass(str(c["@code"]), str(c["@name"]), c.get("@level"), c.get("@parentCode")) for c in items
        )
    return EstatData(name, payload["statsDataId"], classes, tuple(payload["values"]))


# --- 行政区域（N03 2026）の単位 ------------------------------------------------------------


@dataclass(frozen=True)
class N03Unit:
    """行政区域の 1 単位（市区町村・政令市の区・東京 23 区の区）。"""

    code: str
    prefecture: str
    name: str  # stations.municipality と同じ言い方（政令市は「横浜市港北区」）
    is_ward: bool  # 政令市の区


def read_n03_units() -> tuple[N03Unit, ...]:
    """N03（行政区域・2026-01-01）の単位を、駅の市区町村（build_municipality.py）と同じ名前の付け方で並べる。"""
    # 重い依存（geopandas 一式）は、行政区域を読むときだけ読み込む（公表値の取得だけなら要らない）
    import pyogrio

    from build_municipality import municipality_name
    from fetch_admin_boundaries import DEST as N03_ZIP

    if not N03_ZIP.exists():
        raise SystemExit(f"{N03_ZIP} がありません。先に fetch_admin_boundaries.py を実行してください")
    with zipfile.ZipFile(N03_ZIP) as zf:
        shp = [n for n in zf.namelist() if n.endswith(".shp") and "_prefecture" not in n]
    if len(shp) != 1:
        raise SystemExit(f"zip 内の市区町村 .shp を特定できない: {shp}")
    frame = pyogrio.read_dataframe(
        f"zip://{N03_ZIP}!{shp[0]}",
        columns=["N03_001", "N03_003", "N03_004", "N03_005", "N03_007"],
        read_geometry=False,
    )
    frame = frame[frame["N03_007"].notna()].drop_duplicates("N03_007")
    units = []
    for _, row in frame.iterrows():
        code = str(row["N03_007"]).zfill(5)
        if code.endswith(N03_UNASSIGNED_SUFFIX) or code in NORTHERN_TERRITORIES_CODES:
            continue  # 所属未定地・北方領土（統計の対象外）
        ward = row["N03_005"]
        units.append(
            N03Unit(
                code=code,
                prefecture=str(row["N03_001"]),
                name=municipality_name(row),
                is_ward=isinstance(ward, str) and ward != "",
            )
        )
    return tuple(sorted(units, key=lambda unit: unit.code))


# --- CSV ------------------------------------------------------------------------------------


def write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"{path.relative_to(ROOT)} がありません（先に build を実行してください）")
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
