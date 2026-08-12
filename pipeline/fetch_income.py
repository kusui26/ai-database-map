"""所得データの取得（260812）— 市町村税課税状況等の調 → 年度別 CSV。

駅×半径の「1 人当たり課税対象所得（＝平均年収）」を作るための素データを取る
（設計は `docs/260811_income.md` §2・§6）。出典は総務省『市町村税課税状況等の調』第11表
（市町村別内訳）で、**年度によって取得経路が違う**：

| 年度 | 経路 | 理由 |
|---|---|---|
| 2015 / 2020 | e-Stat API（社会・人口統計体系 `0000020103`）| 過去年をまとめて取れる |
| 2025 | 総務省サイトの xlsx（`J51-25-b.xlsx`）| **SSDS は 2024 年度までで 2025 年度が無い** |

SSDS への反映は毎年 6 月頃なので、API だけに寄せると常に 1 年遅れる。
逆に xlsx は年度ごとにファイルが分かれるため、過去年は API の方が扱いやすい。
**出力の列・単位・件数は 2 経路で同一**にして、下流（ノートブック）が取得元を意識しないようにする。

⚠ SSDS の 5 桁コードには **`13100 東京都 特別区部`（23 区の集計行）**が混ざっており、
除外しないと 30.5 兆円の二重計上になる。名称に「計／区部／市部／郡部」を含む 5 桁コードは
これ 1 件しか存在しないことを全数確認済み（政令市は「市計」に値があり行政区は `-` なので、
足しても増えない＝除外しない）。

⚠ `N 年度` の課税は **N−1 年の所得**（住民税は前年所得に課税）。列名・ラベルは年度で統一する。

    python3 pipeline/fetch_income.py [--force]
    → data/市町村税課税状況/income_{2015,2020,2025}.csv
      （列: area_code, area_name, taxable_income_1000yen, taxpayers）
      ＋ 年度ごとに全国計を既知の値と照合（1 つでも崩れたら異常終了）

appId と完全なリクエスト URL は**出力しない**（`.claude/CLAUDE.md` §5）。
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sys
import time
import urllib.request
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "市町村税課税状況"
RAW_DIR = OUT_DIR / "raw"

ESTAT_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
SSDS_TABLE = "0000020103"  # 社会・人口統計体系 市区町村データ Ｃ経済基盤
INCOME_ITEM = "C120110"  # 課税対象所得（千円）
TAXPAYER_ITEM = "C120120"  # 納税義務者数（所得割）（人）

SOUMU_XLSX = "https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/xls/J51-{yy}-b.xlsx"

#: 23 区の集計行。市区町村の合計に含めると二重計上になる唯一のコード。
SPECIAL_WARDS_TOTAL = "13100"

#: 取得する年度と経路。年度を増やすときはここに 1 行足す（2026 年度以降は当面 xlsx）。
SOURCES: dict[int, str] = {2015: "estat", 2020: "estat", 2025: "xlsx"}

#: 既知の全国計（2026-08-11 実測）。団体数・課税対象所得(千円)・納税義務者(人)。
#: 出典側の改訂やコードの取り違えを検出するための不変条件。
EXPECTED: dict[int, tuple[int, int, int]] = {
    2015: (1741, 183_717_970_493, 55_877_140),
    2020: (1741, 204_211_264_557, 59_398_579),
    2025: (1741, 241_047_499_326, 62_206_393),
}

RETRIES = 3
TIMEOUT_S = 180
HEADERS = ("area_code", "area_name", "taxable_income_1000yen", "taxpayers")


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
    """5 桁の市区町村コードか（`00000` 全国・`XX000` 都道府県・特別区部の集計行を除く）。"""
    return (
        len(code) == 5
        and code.isdigit()
        and not code.endswith("000")
        and code != SPECIAL_WARDS_TOTAL
    )


def normalize_name(text: str) -> str:
    """「北海道　札幌市」→「北海道 札幌市」（全角空白と連続空白を半角 1 個に）。"""
    return re.sub(r"\s+", " ", text.replace("　", " ")).strip()


def fetch_estat(year: int) -> list[tuple[str, str, int, int]]:
    """SSDS から 1 年度分を取る。戻り値は (コード, 名称, 課税対象所得, 納税義務者)。"""
    params = {
        "appId": app_id(),
        "statsDataId": SSDS_TABLE,
        "cdCat01": f"{INCOME_ITEM},{TAXPAYER_ITEM}",
        "cdTime": f"{year}100000",
        "limit": 100_000,
        "metaGetFlg": "Y",
        "cntGetFlg": "N",
    }
    payload = request_json(params, context=f"{year}年度 SSDS {SSDS_TABLE}")
    data = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]
    names: dict[str, str] = {}
    for class_obj in data["CLASS_INF"]["CLASS_OBJ"]:
        if class_obj.get("@id") != "area":
            continue
        classes = class_obj["CLASS"]
        classes = classes if isinstance(classes, list) else [classes]
        names = {c["@code"]: normalize_name(c["@name"]) for c in classes}

    values = data["DATA_INF"]["VALUE"]
    income = {v["@area"]: v["$"] for v in values if v["@cat01"] == INCOME_ITEM}
    taxpayers = {v["@area"]: v["$"] for v in values if v["@cat01"] == TAXPAYER_ITEM}
    return sorted(
        (code, names.get(code, ""), int(float(income[code])), int(float(taxpayers[code])))
        for code in income
        if is_municipality(code) and is_number(income[code]) and is_number(taxpayers.get(code, "-"))
    )


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


def download_xlsx(year: int) -> bytes:
    """総務省の xlsx を取る（`data/市町村税課税状況/raw/` にキャッシュ）。"""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cached = RAW_DIR / f"J51-{year % 100:02d}-b.xlsx"
    if cached.exists():
        print(f"  raw/{cached.name} を再利用（{cached.stat().st_size:,} バイト）")
        return cached.read_bytes()
    url = SOUMU_XLSX.format(yy=f"{year % 100:02d}")
    last = ""
    for attempt in range(1, RETRIES + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
                raw = response.read()
            cached.write_bytes(raw)
            print(f"  raw/{cached.name} を保存（{len(raw):,} バイト）")
            return raw
        except Exception as error:  # noqa: BLE001
            last = f"{type(error).__name__}: {error}"
            if attempt < RETRIES:
                time.sleep(2 * attempt)
    raise SystemExit(f"xlsx の取得に失敗しました（{year}年度・{cached.name}）: {last}")


def fetch_xlsx(year: int) -> list[tuple[str, str, int, int]]:
    """総務省の xlsx から 1 年度分を取る（第11表 市町村別内訳）。

    団体コードは**検査数字付きの 6 桁**（札幌市 = 011002）で、pandas が数値として読むため
    先頭の 0 が落ちる。6 桁へゼロ詰めしてから上 5 桁を採る（011002 → 01100）。
    """
    frame = pd.read_excel(io.BytesIO(download_xlsx(year)), header=1)
    frame = frame[frame["年度"].astype(str).str.match(r"^\d{4}")]
    # 同じ団体が「市町村民税」「道府県民税」の 2 行で出る。課税対象所得は市町村民税の行を採る。
    frame = frame[frame["表側"] == "市町村民税"]
    rows: list[tuple[str, str, int, int]] = []
    for record in frame.itertuples(index=False):
        code = f"{int(getattr(record, '団体コード')):06d}"[:5]
        name = normalize_name(f"{getattr(record, '都道府県名')} {getattr(record, '団体名')}")
        rows.append(
            (
                code,
                name,
                int(getattr(record, "課税対象所得")),
                int(getattr(record, "所得割の納税義務者数")),
            )
        )
    return sorted(rows)


def verify(year: int, rows: list[tuple[str, str, int, int]]) -> list[str]:
    """全国計を既知の値と照合する（団体数・課税対象所得・納税義務者）。"""
    want_count, want_income, want_taxpayers = EXPECTED[year]
    got_income = sum(row[2] for row in rows)
    got_taxpayers = sum(row[3] for row in rows)
    per_capita = got_income * 1000 / got_taxpayers / 10_000
    print(
        f"  {len(rows):,} 団体 / 課税対象所得 {got_income / 1e9:,.1f} 兆円 / "
        f"納税義務者 {got_taxpayers / 1e4:,.0f} 万人 / 1 人当たり {per_capita:,.0f} 万円"
    )
    failures: list[str] = []
    if len(rows) != want_count:
        failures.append(f"団体数が {want_count} と異なる: {len(rows)}")
    if got_income != want_income:
        failures.append(f"課税対象所得の合計が {want_income:,} と異なる: {got_income:,}")
    if got_taxpayers != want_taxpayers:
        failures.append(f"納税義務者の合計が {want_taxpayers:,} と異なる: {got_taxpayers:,}")
    if len({row[0] for row in rows}) != len(rows):
        failures.append("団体コードが重複している")
    return failures


def write_csv(year: int, rows: list[tuple[str, str, int, int]]) -> Path:
    """年度別 CSV を書く（コード昇順・取得元によらず同じ形）。"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"income_{year}.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADERS)
        writer.writerows(rows)
    return path


def main(force: bool) -> int:
    failures: list[str] = []
    for year, source in SOURCES.items():
        path = OUT_DIR / f"income_{year}.csv"
        print(f"[{year}年度] 取得元: {'e-Stat API（SSDS）' if source == 'estat' else '総務省 xlsx'}")
        if path.exists() and not force:
            print(f"  {path.relative_to(ROOT)} は取得済みのため skip（--force で再取得）")
            with path.open(encoding="utf-8", newline="") as handle:
                reader = csv.reader(handle)
                next(reader)
                rows = [(r[0], r[1], int(r[2]), int(r[3])) for r in reader]
        else:
            rows = fetch_estat(year) if source == "estat" else fetch_xlsx(year)
            write_csv(year, rows)
            print(f"  {path.relative_to(ROOT)} に {len(rows):,} 行を書き出しました")
        for failure in verify(year, rows):
            failures.append(f"{year}年度: {failure}")

    if failures:
        for failure in failures:
            print(f"NG: {failure}")
        return 1
    print("\nOK: 3 年度とも全国計が既知の値と一致しました（特別区部の二重計上なし）")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="市町村税課税状況等の調（課税対象所得・納税義務者数）を取得する")
    parser.add_argument("--force", action="store_true", help="取得済みでも取り直す")
    sys.exit(main(parser.parse_args().force))
