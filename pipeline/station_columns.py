"""駅 × 値の表の読み方（2026-11-24・人口の年齢 PR-2）— カタログ・投入・照合が、同じ 1 つの表を読む。

値の表は 2 つの CSV からなる（どちらも `data/derived/`・gitignore）：

- `station_dataset.csv`：ノートブック（`script/create_dataset_for_AI_Database_Map.ipynb`）が作る 806 列
- `station_age.csv`：`build_station_age.py` が作る年齢の列（第 1 段 66 列・フラグ 12 列・計画書 261122 §3.3）

ノートブックは触らずに、**`station_dataset.csv` の右に `station_age.csv` を駅（grp）で連結**した 1 つの表として扱う。
カタログの id は列の並びで振るので、年齢の列は末尾に来て既存の id は動かない（`load_to_supabase.py --append`）。
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
STATION_DATASET_CSV = ROOT / "data" / "derived" / "station_dataset.csv"
STATION_AGE_CSV = ROOT / "data" / "derived" / "station_age.csv"
#: 連結の鍵（駅グループの ID）。年齢の CSV の先頭の列。
JOIN_KEY = "grp"
#: 表の出どころ（catalog.json の `generatedFrom`）。
GENERATED_FROM = "data/derived/station_dataset.csv + data/derived/station_age.csv（grp で連結）"


def _header(path: Path) -> list[str]:
    if not path.exists():
        raise SystemExit(f"{path.relative_to(ROOT)} がありません")
    with path.open(newline="", encoding="utf-8") as handle:
        return next(csv.reader(handle))


def dataset_header() -> list[str]:
    """連結した表の列（`station_dataset.csv` の列 ＋ `station_age.csv` の grp 以外の列）。標準ライブラリだけで読む。"""
    base, age = _header(STATION_DATASET_CSV), _header(STATION_AGE_CSV)
    if age[:1] != [JOIN_KEY]:
        raise SystemExit(f"{STATION_AGE_CSV.name} の先頭の列が {JOIN_KEY} でない: {age[:1]}")
    overlap = sorted(set(base) & set(age[1:]))
    if overlap:
        raise SystemExit(f"{STATION_AGE_CSV.name} の列が {STATION_DATASET_CSV.name} と重なる: {overlap[:5]}")
    return base + age[1:]


def read_dataset_frame(**read_csv_options: object) -> "pd.DataFrame":
    """連結した表（行は `station_dataset.csv` の順＝station_id の順）。駅の集合が 2 つの CSV で違えば落とす。"""
    import pandas as pd

    base = pd.read_csv(STATION_DATASET_CSV, **read_csv_options)
    age = pd.read_csv(STATION_AGE_CSV)
    if age[JOIN_KEY].duplicated().any() or set(age[JOIN_KEY]) != set(base[JOIN_KEY]):
        raise SystemExit(f"{STATION_AGE_CSV.name} の駅が {STATION_DATASET_CSV.name} と合わない（作り直してください）")
    joined = base.merge(age, on=JOIN_KEY, how="left", validate="one_to_one", sort=False)
    if list(joined.columns) != dataset_header():
        raise SystemExit("連結した表の列の並びが見出しと違う")
    return joined
