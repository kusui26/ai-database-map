"""売上データの取得（260816）— 経済センサス‑活動調査 → 年別・市区町村別の CSV。

駅×半径の「**目的地としての売上**」（小売 ＋ 飲食・宿泊 ＋ 娯楽ほか）を作るための素データを取る
（設計は `docs/260816_sales.md` §2・§4・§15）。**業種ごとに出典の表が違い、年によって母集団も違う**ので、
このスクリプトがその差を吸収して **2 年で同じ形の CSV** を出す（`fetch_income.py` と同じ役割）。

| 業種 | 2021（令和3年）| 2016（平成28年）| なぜこの表か |
|---|---|---|---|
| 小売 | `0004006342` 事業活動別 `05 小売業` | `0003218747` `4280 商業 小売業` | 大分類Ｉは約 7 割が卸売。事業活動別なら小売だけ取れる |
| 飲食・宿泊 | `0004006322` 産業大分類 `M`（経営組織 総数）| `0003218721` `15140` | 本所比 9.4% で補正が要らない |
| 娯楽ほか | `0004006324` 単独・本所・支所別 `N`（総数 − 本所）| `0003218742` `15750` | 本社が全国の売上を一括計上する（港区でＮ売上の 89%）|

**3 つの補正**（`docs/260816_sales.md` §15.6）

1. **政令市の「市計」＋東京都特別区部の 21 コードを除外**する。含めると 2021 のＩが
   **+357.1 兆円**（全国の 62%）二重計上になる。市区町村の合計＝全国計になることで担保する。
2. **娯楽は「総数 − 本所」**にする。単独＋支所を直和すると秘匿（328/719 団体）ぶん落ちて
   全国計から −3.8% ずれるが、総数 − 本所なら +0.9% に収まる。
3. **小売は 2021 にだけ個人経営分を足す**。2021 の事業活動別表は「個人、外国の会社及び
   法人でない団体を除く」で、2016 の表は個人を含む。**分母（メッシュの従業者数）は個人経営を
   含む**ので、分子も含めるのが筋（`docs/260816_sales.md` §15.4）。個人の売上は
   「卸売＋小売」の合計でしか公表されないため、**そのうち小売が占める割合を都道府県別に実測**して掛ける
   （表 `0004006320`・全国 89.1%・都道府県 73.1〜95.5%）。

    python3 pipeline/fetch_sales.py [--force]
    → data/経済センサス_売上/sales_{2016,2021}.csv
      （列: area_code, area_name, retail_million_yen ほか 13 列。単位はすべて百万円／人）
      ＋ 年ごとに全国計（市区町村の合計）を既知の値と照合し、代表 6 市区町村を個別照合する

秘匿（`X`）・該当なし（`-`）・非公表（`･･･`）は **0 に潰さず空欄**で出す。
appId と完全なリクエスト URL は**出力しない**（`.claude/CLAUDE.md` §5）。
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "経済センサス_売上"

ESTAT_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
RETRIES = 3
TIMEOUT_S = 300
API_LIMIT = 100_000

#: 政令市の「市計」20 ＋ 東京都特別区部。行政区と重複するので市区町村の合計から除く。
CITY_TOTAL_CODES = frozenset(
    {
        "01100", "04100", "11100", "12100", "14100", "15100", "22100", "23100",
        "26100", "27100", "28100", "33100", "34100", "40100", "43100",  # XX100 型 15 市
        "14130", "14150", "22130", "27140", "40130",  # 例外 5 市（川崎・相模原・浜松・堺・福岡）
        "13100",  # 東京都 特別区部（23 区の集計行）
    }
)

#: 個人経営の小売比率を測る表（産業中分類 × 経営組織・全国と都道府県まで）。2021 のみ使う。
RATIO_TABLE_2021 = "0004006320"
RATIO_PARAMS_2021 = {"cdTab": "155-2021", "cdCat01": "I,I2", "cdCat02": "1"}


@dataclass(frozen=True)
class Series:
    """1 つの数値列を、どの統計表のどの軸から取るか。"""

    table: str
    params: dict[str, str]


#: 年 → 列名 → 取得元。**2 年で同じ列名**にして、下流が取得元を意識しないようにする。
SERIES: dict[int, dict[str, Series]] = {
    2021: {
        "retail_raw": Series("0004006342", {"cdTab": "155-2021", "cdCat01": "I", "cdCat02": "05"}),
        "wholesale": Series("0004006342", {"cdTab": "155-2021", "cdCat01": "I", "cdCat02": "04"}),
        "food": Series("0004006322", {"cdTab": "155-2021", "cdCat01": "M", "cdCat02": "0"}),
        "leisure_total": Series("0004006324", {"cdTab": "155-2021", "cdCat01": "N", "cdCat02": "0"}),
        "leisure_head": Series("0004006324", {"cdTab": "155-2021", "cdCat01": "N", "cdCat02": "2"}),
        "kojin_i": Series("0004006322", {"cdTab": "155-2021", "cdCat01": "I", "cdCat02": "1"}),
        "emp_i": Series("0004006322", {"cdTab": "113-2021", "cdCat01": "I", "cdCat02": "0"}),
        "emp_m": Series("0004006322", {"cdTab": "113-2021", "cdCat01": "M", "cdCat02": "0"}),
        "emp_n": Series("0004006322", {"cdTab": "113-2021", "cdCat01": "N", "cdCat02": "0"}),
    },
    2016: {
        "retail_raw": Series("0003218747", {"cdTab": "4280", "cdCat02": "10540"}),
        "wholesale": Series("0003218747", {"cdTab": "4270", "cdCat02": "10540"}),
        "food": Series("0003218721", {"cdTab": "813", "cdCat01": "000", "cdCat02": "15140"}),
        "leisure_total": Series("0003218742", {"cdTab": "813", "cdCat01": "0000", "cdCat02": "15750"}),
        "leisure_head": Series("0003218742", {"cdTab": "813", "cdCat01": "0020", "cdCat02": "15750"}),
        "kojin_i": Series("0003218721", {"cdTab": "813", "cdCat01": "070", "cdCat02": "10540"}),
        "emp_i": Series("0003218721", {"cdTab": "812", "cdCat01": "000", "cdCat02": "10540"}),
        "emp_m": Series("0003218721", {"cdTab": "812", "cdCat01": "000", "cdCat02": "15140"}),
        "emp_n": Series("0003218721", {"cdTab": "812", "cdCat01": "000", "cdCat02": "15750"}),
    },
}

#: 市区町村の合計（21 コード除外後）の既知値（2026-08-16 実測・単位 百万円／人）。
#: 出典側の改訂や軸の取り違えを検出するための不変条件。`retail` は補正前（原表）で照合する。
EXPECTED: dict[int, dict[str, int]] = {
    2021: {
        "retail_raw": 138_862_843,
        "wholesale": 401_476_192,
        "food": 19_037_095,
        "leisure_total": 29_826_690,
        "leisure_head": 6_145_849,
        "kojin_i": 8_273_049,
        "emp_i": 11_246_013,
        "emp_m": 4_381_585,
        "emp_n": 2_050_022,
    },
    2016: {
        "retail_raw": 146_134_162,
        "wholesale": 435_324_187,
        "food": 23_882_959,
        "leisure_total": 46_075_537,
        "leisure_head": 7_223_110,
        "kojin_i": 9_927_287,
        "emp_i": 11_262_136,
        "emp_m": 4_810_856,
        "emp_n": 2_205_975,
    },
}

#: 代表市区町村の個別照合（`docs/260816_sales.md` §8 #4・リサーチ 260805 §17.3/§17.4 と一致）。
SPOT_CHECKS: dict[int, dict[str, dict[str, int]]] = {
    2021: {
        "13101": {"retail_raw": 995_096, "food": 277_185},  # 千代田区
        "13103": {"retail_raw": 1_380_511, "leisure": 371_387},  # 港区
        "22205": {"retail_raw": 27_574, "food": 35_650},  # 熱海市
    },
    2016: {},
}

HEADERS = (
    "area_code",
    "area_name",
    "retail_million_yen",  # 格納する値（2021 は個人経営分を足したあと）
    "retail_raw_million_yen",  # 原表のまま（監査用）
    "kojin_i_million_yen",  # 個人経営のＩ（卸売＋小売）売上（補正の入力・監査用）
    "kojin_retail_share",  # 掛けた比率（都道府県別・監査用）
    "wholesale_million_yen",  # 参考（指標には採らない）
    "food_million_yen",
    "leisure_million_yen",  # 格納する値（総数 − 本所）
    "leisure_total_million_yen",  # 原表のまま（監査用）
    "leisure_head_million_yen",  # 本所ぶん（監査用）
    "emp_i",
    "emp_m",
    "emp_n",
)


def app_id() -> str:
    """`.env` から e-Stat の appId を読む（値は決してログに出さない）。"""
    env = ROOT / ".env"
    if not env.exists():
        raise SystemExit(f"{env.relative_to(ROOT)} がありません（ESTAT_APP_ID が要ります）")
    for line in env.read_text(encoding="utf-8").splitlines():
        found = re.match(r'\s*(?:export\s+)?ESTAT_APP_ID\s*=\s*"?([^"\s#]+)"?', line)
        if found:
            return found.group(1)
    raise SystemExit("ESTAT_APP_ID が .env にありません")


def is_number(text: str) -> bool:
    """統計値が数値か（`-`＝該当なし、`X`＝秘匿、`･･･`＝非公表 を弾く）。"""
    return re.fullmatch(r"-?\d+(\.\d+)?", text or "") is not None


def is_municipality(code: str) -> bool:
    """基礎自治体の 5 桁コードか（全国・都道府県・政令市計・特別区部を除く）。"""
    return (
        len(code) == 5
        and code.isdigit()
        and not code.endswith("000")
        and code not in CITY_TOTAL_CODES
    )


def normalize_name(text: str) -> str:
    """「北海道　札幌市」→「北海道 札幌市」（全角空白と連続空白を半角 1 個に）。"""
    return re.sub(r"\s+", " ", text.replace("　", " ")).strip()


def request_json(params: dict[str, object], context: str) -> dict[str, object]:
    """e-Stat API を叩く（3 回リトライ・失敗時は文脈付きで落とす。URL は出さない）。"""
    last = ""
    for attempt in range(1, RETRIES + 1):
        try:
            response = requests.get(ESTAT_ENDPOINT, params=params, timeout=TIMEOUT_S)
            response.raise_for_status()
            payload = response.json()
            status = payload["GET_STATS_DATA"]["RESULT"]
            if str(status["STATUS"]) not in {"0", "1"}:
                raise RuntimeError(f"API がエラーを返した: {status.get('ERROR_MSG')}")
            return payload
        except Exception as error:  # noqa: BLE001 — 文脈を付けて上位へ渡す
            last = f"{type(error).__name__}: {error}"
            if attempt < RETRIES:
                time.sleep(2 * attempt)
    raise SystemExit(f"取得に失敗しました（{context}・{RETRIES} 回試行）: {last}")


def values_of(payload: dict[str, object], area_filter) -> dict[str, float]:
    """API 応答 → {地域コード: 値}。秘匿・非公表の行は入れない（0 に潰さない）。"""
    data = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]["DATA_INF"]["VALUE"]  # type: ignore[index]
    rows = data if isinstance(data, list) else [data]
    return {
        row["@area"]: float(row["$"])
        for row in rows
        if area_filter(row["@area"]) and is_number(row["$"])
    }


def area_names(payload: dict[str, object]) -> dict[str, str]:
    """API 応答のメタから {地域コード: 名称}（`metaGetFlg=Y` のときだけ入っている）。"""
    classes = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]["CLASS_INF"]["CLASS_OBJ"]  # type: ignore[index]
    for class_obj in classes if isinstance(classes, list) else [classes]:
        if class_obj.get("@id") != "area":
            continue
        items = class_obj["CLASS"]
        return {
            item["@code"]: normalize_name(item["@name"])
            for item in (items if isinstance(items, list) else [items])
        }
    return {}


def fetch_series(series: Series, context: str, with_meta: bool = False) -> dict[str, object]:
    """1 系列を全地域ぶん取る（市区町村は 1,966 件程度でページングは不要）。"""
    params: dict[str, object] = {
        "appId": app_id(),
        "statsDataId": series.table,
        "limit": API_LIMIT,
        "metaGetFlg": "Y" if with_meta else "N",
        "cntGetFlg": "N",
    }
    params.update(series.params)
    return request_json(params, context)


def prefecture_retail_shares(year: int) -> tuple[dict[str, float], float]:
    """都道府県ごとの「個人経営の売上に占める小売の割合」と、その全国値。

    個人経営の売上は「卸売＋小売」でしか公表されないため、産業中分類の表
    （`0004006320`・全国と都道府県まで）で内訳を測って比率にする。2021 のみ使う。
    """
    payload = fetch_series(
        Series(RATIO_TABLE_2021, RATIO_PARAMS_2021), f"{year}年 個人経営の小売比率"
    )
    data = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]["DATA_INF"]["VALUE"]  # type: ignore[index]
    rows = data if isinstance(data, list) else [data]
    whole = {r["@area"]: r["$"] for r in rows if r["@cat01"] == "I"}
    retail = {r["@area"]: r["$"] for r in rows if r["@cat01"] == "I2"}
    shares = {
        code: float(retail[code]) / float(whole[code])
        for code in whole
        if code in retail and is_number(whole[code]) and is_number(retail[code]) and float(whole[code]) > 0
    }
    national = shares.get("00000", 0.0)
    prefectures = {code: share for code, share in shares.items() if code.endswith("000") and code != "00000"}
    print(
        f"  個人経営の小売比率: 全国 {national:.1%} ／ 都道府県 {len(prefectures)} 件"
        f"（最小 {min(prefectures.values()):.1%}・最大 {max(prefectures.values()):.1%}）"
    )
    return prefectures, national


def retail_share_for(code: str, prefectures: dict[str, float], national: float) -> float:
    """市区町村コード → その都道府県の比率（無ければ全国値）。"""
    return prefectures.get(f"{code[:2]}000", national)


def fetch_columns(year: int) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    """1 年分の全系列を取る。戻り値は {列名: {市区町村コード: 値}} と {コード: 名称}。"""
    columns: dict[str, dict[str, float]] = {}
    names: dict[str, str] = {}
    for name, series in SERIES[year].items():
        payload = fetch_series(series, f"{year}年 {name}（表 {series.table}）", with_meta=not names)
        if not names:
            names = area_names(payload)
        columns[name] = values_of(payload, is_municipality)
        print(f"  {name:14s} 表 {series.table}  {len(columns[name]):,} 団体")
    return columns, names


def build_rows(year: int) -> list[list[str]]:
    """1 年分の CSV 行（コード昇順）。2021 だけ小売に個人経営分を足す（§15.5）。"""
    columns, names = fetch_columns(year)
    shares, national_share = prefecture_retail_shares(year) if year == 2021 else ({}, 0.0)
    codes = sorted({code for values in columns.values() for code in values})
    rows: list[list[str]] = []
    for code in codes:
        values = {name: column.get(code) for name, column in columns.items()}
        share = retail_share_for(code, shares, national_share) if year == 2021 else 0.0
        rows.append(build_row(code, names.get(code, ""), values, share))
    return rows


def leisure_of(values: dict[str, float | None]) -> float | None:
    """娯楽ほか＝Ｎの総数 − 本所（本所が秘匿の団体は総数のまま）。総数が無ければ欠測。"""
    total = values.get("leisure_total")
    if total is None:
        return None
    return total - (values.get("leisure_head") or 0.0)


def retail_of(values: dict[str, float | None], share: float) -> float | None:
    """小売＝原表 ＋ 個人経営のＩ売上 × 小売比率（2021 のみ。share=0 なら原表のまま）。"""
    raw = values.get("retail_raw")
    if raw is None:
        return None
    return raw + (values.get("kojin_i") or 0.0) * share


def number(value: float | None, decimals: int = 0) -> str:
    """CSV セル（欠測は空欄。0 と区別する）。"""
    if value is None:
        return ""
    return f"{value:.{decimals}f}" if decimals else f"{round(value)}"


def build_row(code: str, name: str, values: dict[str, float | None], share: float) -> list[str]:
    """1 市区町村ぶんの CSV 行（列順は HEADERS と同じ）。"""
    return [
        code,
        name,
        number(retail_of(values, share)),
        number(values.get("retail_raw")),
        number(values.get("kojin_i")),
        f"{share:.4f}" if share else "",
        number(values.get("wholesale")),
        number(values.get("food")),
        number(leisure_of(values)),
        number(values.get("leisure_total")),
        number(values.get("leisure_head")),
        number(values.get("emp_i")),
        number(values.get("emp_m")),
        number(values.get("emp_n")),
    ]


def column_total(rows: list[list[str]], column: str) -> float:
    """CSV 行から 1 列の合計（空欄は飛ばす）。"""
    at = HEADERS.index(column)
    return sum(float(row[at]) for row in rows if row[at] != "")


#: 系列名 → CSV の列名（照合で使う）。
COLUMN_OF = {
    "retail_raw": "retail_raw_million_yen",
    "wholesale": "wholesale_million_yen",
    "food": "food_million_yen",
    "leisure": "leisure_million_yen",
    "leisure_total": "leisure_total_million_yen",
    "leisure_head": "leisure_head_million_yen",
    "kojin_i": "kojin_i_million_yen",
    "emp_i": "emp_i",
    "emp_m": "emp_m",
    "emp_n": "emp_n",
}


def report(rows: list[list[str]]) -> None:
    """補正後の全国計を 1 行で見せる（原表との差＝補正の効きが分かるように）。"""
    retail = column_total(rows, "retail_million_yen")
    food = column_total(rows, "food_million_yen")
    leisure = column_total(rows, "leisure_million_yen")
    print(
        f"  小売 {retail / 1e6:,.1f} 兆円（原表 {column_total(rows, 'retail_raw_million_yen') / 1e6:,.1f}）"
        f" ／ 飲食・宿泊 {food / 1e6:,.1f} 兆円 ／ 娯楽ほか {leisure / 1e6:,.1f} 兆円"
        f" ／ 目的地計 {(retail + food + leisure) / 1e6:,.1f} 兆円"
    )


def verify_totals(year: int, rows: list[list[str]]) -> list[str]:
    """市区町村の合計（21 コード除外後）を既知の全国計と照合する。"""
    failures = []
    for name, want in EXPECTED[year].items():
        got = round(column_total(rows, COLUMN_OF[name]))
        if got != want:
            failures.append(f"{name} の市区町村計が {want:,} と異なる: {got:,}")
    if len({row[0] for row in rows}) != len(rows):
        failures.append("市区町村コードが重複している")
    return failures


def verify_spot_checks(year: int, rows: list[list[str]]) -> list[str]:
    """代表市区町村を個別に照合する（軸の取り違えは合計だけでは気づけない）。"""
    by_code = {row[0]: row for row in rows}
    failures = []
    for code, wants in SPOT_CHECKS[year].items():
        row = by_code.get(code)
        if row is None:
            failures.append(f"{code} の行がない")
            continue
        for name, want in wants.items():
            got = round(float(row[HEADERS.index(COLUMN_OF[name])] or 0))
            if got != want:
                failures.append(f"{code}（{row[1]}）の {name} が {want:,} と異なる: {got:,}")
    return failures


def write_csv(year: int, rows: list[list[str]]) -> Path:
    """年別 CSV を書く（コード昇順・2 年で同じ列）。"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"sales_{year}.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADERS)
        writer.writerows(rows)
    return path


def read_csv(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        next(reader)
        return list(reader)


def main(force: bool) -> int:
    failures: list[str] = []
    for year in sorted(SERIES):
        path = OUT_DIR / f"sales_{year}.csv"
        print(f"[{year}年調査] 売上は前年 1 年間（{year - 1} 年）の値")
        if path.exists() and not force:
            print(f"  {path.relative_to(ROOT)} は取得済みのため skip（--force で再取得）")
            rows = read_csv(path)
        else:
            rows = build_rows(year)
            write_csv(year, rows)
            print(f"  {path.relative_to(ROOT)} に {len(rows):,} 行を書き出しました")
        report(rows)
        checked = verify_totals(year, rows) + verify_spot_checks(year, rows)
        failures.extend(f"{year}年: {failure}" for failure in checked)

    if failures:
        for failure in failures:
            print(f"NG: {failure}")
        return 1
    print("\nOK: 2 年とも市区町村の合計が既知の全国計と一致しました（政令市の二重計上なし）")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="経済センサス‑活動調査の市区町村別 売上（小売・飲食宿泊・娯楽）を取得する"
    )
    parser.add_argument("--force", action="store_true", help="取得済みでも取り直す")
    sys.exit(main(parser.parse_args().force))
