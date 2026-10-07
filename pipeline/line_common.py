"""路線（運行系統）の build / validate / load で共有する読み込みと照合の道具（L1・2026-10-08）。

規則（直しの表・確認）は `line_rules.py`。ここは**読み方**だけを持つ：原典（駅データ.jp）とアプリの駅
（`data/derived/station_dataset.csv`）の読み込み、駅名の鍵、距離。
"""

from __future__ import annotations

import csv
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import line_rules as rules

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "駅データjp"
DERIVED = ROOT / "data" / "derived"

#: アプリの駅（駅グループ）と、その周りの値。grp・駅名・座標・会社名（「・」区切り）を使う。
APP_STATIONS_CSV = DERIVED / "station_dataset.csv"
#: S12 の法令上の路線（grp × 会社 × 路線）。どの路線にも属さない駅の分類に使う。
LEGAL_ROUTES_CSV = DERIVED / "station_routes.csv"
#: 会社ごとの年別の乗降の有無（present_YYYY）。「乗降がある駅」の判定に使う。
OPERATOR_DETAIL_CSV = DERIVED / "station_operator_detail.csv"

#: 出力（DB に入れるもの）。
LINES_CSV = DERIVED / "lines.csv"
LINE_STATIONS_CSV = DERIVED / "line_stations.csv"
#: 出力（監査用）。駅レコードごとの結びつけと、どの路線にも属さない駅。
LINE_LINKS_CSV = DERIVED / "line_links.csv"
LINE_UNASSIGNED_CSV = DERIVED / "line_unassigned.csv"
#: 前回 DB に入れたときのアプリの駅（load_lines.py が成功したときだけ書く）。新駅の検出に使う。
LOADED_GRPS_TXT = DERIVED / "lines_loaded_grps.txt"

LINE_COLUMNS = [
    "line_cd", "name", "formal_name", "company_cd", "company_name", "company_short", "operator",
    "color", "color_name", "line_type", "is_loop", "station_count", "source",
]
LINE_STATION_COLUMNS = ["line_cd", "grp", "seq", "source_station_cd", "source_name"]

ACTIVE = "0"  # 駅データ.jp の e_status：0 営業中・1 開業前・2 廃止


def read_csv(path: Path) -> list[dict[str, str]]:
    """UTF-8（BOM があっても可）の CSV を辞書の列で読む。"""
    if not path.exists():
        raise SystemExit(f"{path} がありません")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, columns: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def same_name(a: str, b: str) -> bool:
    """駅名が文字として同じか（全角・半角の違いだけを同一視する）。"""
    return unicodedata.normalize("NFKC", a) == unicodedata.normalize("NFKC", b)


def name_key(name: str) -> str:
    """駅名の照合の鍵。全角・括弧書き・空白・中黒・「の／ノ」「ヶ／ケ」・末尾の「駅」の違いを吸収する。

    B1 の `src/ai/routes/names.ts` の nameKey と同じ吸収に、括弧書き（「空港第２ビル（第２旅客ターミナル）」）と
    末尾の「駅」（S12 の「富山駅」は路面電車の停留場）を足したもの。末尾の「駅」で別の駅と重なりうるので、
    候補が複数あるときは会社名と `same_name` の完全一致で選ぶ（build_lines.Matcher.choose）。
    """
    text = unicodedata.normalize("NFKC", name)
    text = re.sub(r"[（(〈<［\[].*?[）)〉>］\]]", "", text)
    text = re.sub(r"[\s・･.]", "", text)
    text = text.replace("の", "ノ").replace("ヶ", "ケ").replace("ヵ", "カ")
    return text.removesuffix("駅").lower()


def distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """2 点間の距離（m・測地線ベースの haversine。verify_station_routes.py と同じ式）。"""
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class AppStation:
    """アプリの駅（駅グループ）。operators は S12 の会社名。"""

    grp: str
    name: str
    lon: float
    lat: float
    operators: frozenset[str]

    @property
    def key(self) -> str:
        return name_key(self.name)


def load_app_stations() -> list[AppStation]:
    stations = []
    for row in read_csv(APP_STATIONS_CSV):
        operators = frozenset(op for op in (row["operators"] or "").split("・") if op)
        stations.append(AppStation(row["grp"], row["station_name"], float(row["lon"]), float(row["lat"]), operators))
    return stations


@dataclass(frozen=True)
class Source:
    """駅データ.jp（営業中の路線と駅だけ）。"""

    stations: list[dict[str, str]]  # 駅レコード（路線 × 駅）
    lines: dict[str, dict[str, str]]  # line_cd → 路線
    companies: dict[str, dict[str, str]]  # company_cd → 事業者
    joins: list[dict[str, str]]  # 隣の駅の組

    def company_of(self, station: dict[str, str]) -> dict[str, str]:
        return self.companies[self.lines[station["line_cd"]]["company_cd"]]

    def line_name(self, station: dict[str, str]) -> str:
        return self.lines[station["line_cd"]]["line_name"]


def load_source() -> Source:
    lines = {r["line_cd"]: r for r in read_csv(SOURCE_DIR / rules.LINE_FILE) if r["e_status"] == ACTIVE}
    stations = [
        r for r in read_csv(SOURCE_DIR / rules.STATION_FILE)
        if r["e_status"] == ACTIVE and r["line_cd"] in lines
    ]
    companies = {r["company_cd"]: r for r in read_csv(SOURCE_DIR / rules.COMPANY_FILE)}
    joins = [r for r in read_csv(SOURCE_DIR / rules.JOIN_FILE) if r["line_cd"] in lines]
    return Source(stations, lines, companies, joins)


def latest_presence() -> tuple[int, set[str]]:
    """最新年と、その年に乗降がある駅（grp）。会社ごとの行のどれか 1 つでも乗降があれば「ある」。"""
    rows = read_csv(OPERATOR_DETAIL_CSV)
    years = sorted(int(col.removeprefix("present_")) for col in rows[0] if col.startswith("present_"))
    latest = years[-1]
    present = {row["grp"] for row in rows if row[f"present_{latest}"] == "True"}
    return latest, present


def legal_routes() -> dict[str, set[tuple[str, str]]]:
    """grp → {(S12 の会社名, 法令上の路線名)}。"""
    routes: dict[str, set[tuple[str, str]]] = {}
    for row in read_csv(LEGAL_ROUTES_CSV):
        routes.setdefault(row["grp"], set()).add((row["operator"], row["route"]))
    return routes
