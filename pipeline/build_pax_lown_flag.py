"""乗降コロナ前後増減率の「低分母フラグ」を切り出す（260731）。

`flag_covid` は **被覆<100% ／ pre<2019 ／ |率|>100%** の OR で、意味の違う 3 条件が
1 本に混ざっている（docs/passenger_aggregation.md §7）。アプリは信頼性フラグを
`reliabilityFlagKey` の 1 本で解決するため、**「低分母を除外」と書かれた操作が、
被覆の都合で大駅（新宿・横浜・新横浜…）を消していた**（docs/260731_reliability_flag_semantics.md）。

そこで **除外に使う条件だけ**を独立した列に切り出す：

    flag_covid_lown = 1  ⇔  |rate_covid| > 100%

§7 が「大駅の rate_covid は最大 94% に収まるため、|率|>100% は正常値を誤検出せず
小駅ノイズだけを拾う」と明言している条件で、**`rate_covid` から一意に決まる**。
被覆と参照年は値そのものを損なわない（basket 内で like-for-like）ため、除外ではなく
バッジ（`noticeFlagKey` → 従来の `flag_covid`）で注意を促す。

ノートブックは再実行しない（docs/260727_data_check.md §4.2 と同じ判断）。
本スクリプトは `station_dataset.csv` の**末尾に列を足すだけ**で、既存列は書き換えない。
末尾に置くのは、カタログの列順＝`metric_columns.id` を既存分そのままに保つため
（＝DB は新しい 1 列を追加投入するだけで済み、490 万行の再投入が要らない）。

    python3 pipeline/build_pax_lown_flag.py [--check]
    → data/derived/station_dataset.csv に flag_covid_lown 列を追記（冪等）＋ 自己検証
      --check: 追記せず検証だけ行う
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_CSV = ROOT / "data" / "derived" / "station_dataset.csv"

RATE_COLUMN = "rate_covid"
COMPOSITE_FLAG_COLUMN = "flag_covid"
NEW_COLUMN = "flag_covid_lown"

#: 極端値の閾値（%）。docs/passenger_aggregation.md §7 の「|率|>100%」。
EXTREME_RATE_PCT = 100.0
#: 妥当性チェック：S12 から独立に再計算した該当群数（docs/260731_reliability_flag_semantics.md §1.2）。
EXPECTED_LOWN_GROUPS = 85


#: 真を表す CSV 上の表記。ノートブックが bool のまま出す列（flag_covid/flag_yoy）と
#: int8 で出す列（pop_lowbase_* 等）が混在するため、表記に依存せず判定する
#: （load_to_supabase.py が「bool の値列は一律 0/1」に正規化するのと同じ考え方）。
TRUE_TEXTS = frozenset({"1", "1.0", "True", "true", "TRUE"})


def is_true(text: str) -> bool:
    """CSV 上のフラグ表記を真偽に解く（空欄＝未算出は False）。"""
    return text in TRUE_TEXTS


def is_lown(rate_text: str) -> bool:
    """|rate_covid| > 100% か（空欄＝算出不可は False）。"""
    if rate_text == "":
        return False
    return abs(float(rate_text)) > EXTREME_RATE_PCT


def main(check_only: bool) -> int:
    with DATASET_CSV.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    header, body = rows[0], rows[1:]

    for required in (RATE_COLUMN, COMPOSITE_FLAG_COLUMN):
        if required not in header:
            print(f"NG: {required} 列がありません")
            return 1

    rate_at = header.index(RATE_COLUMN)
    composite_at = header.index(COMPOSITE_FLAG_COLUMN)
    existing_at = header.index(NEW_COLUMN) if NEW_COLUMN in header else None

    flags = [is_lown(row[rate_at]) for row in body]
    lown = sum(flags)
    composite = sum(1 for row in body if is_true(row[composite_at]))
    # 低分母は複合フラグの部分集合でなければならない（複合は OR なので必ず含む）。
    outside = [i for i, flag in enumerate(flags) if flag and not is_true(body[i][composite_at])]

    print(f"駅グループ {len(body)} 行 / rate_covid 算出 {sum(1 for r in body if r[rate_at] != '')} 群")
    print(f"{COMPOSITE_FLAG_COLUMN}=1: {composite} 群（被覆<100%／pre<2019／|率|>100% の OR）")
    print(f"{NEW_COLUMN}=1: {lown} 群（|率|>{EXTREME_RATE_PCT:.0f}% のみ）")
    print(f"→ 除外対象は {composite} → {lown} 群になり、{composite - lown} 群が値として残る")

    failures: list[str] = []
    if lown != EXPECTED_LOWN_GROUPS:
        failures.append(f"低分母の群数が S12 再計算（{EXPECTED_LOWN_GROUPS}）と異なる: {lown}")
    if outside:
        sample = [body[i][0] for i in outside[:5]]
        failures.append(f"複合フラグの部分集合でない群がある: {sample}")
    if failures:
        for failure in failures:
            print(f"NG: {failure}")
        return 1

    if check_only:
        print("OK: 検証のみ（追記なし）")
        return 0

    if existing_at is None:
        header.append(NEW_COLUMN)
        for row, flag in zip(body, flags, strict=True):
            row.append("1" if flag else "0")
        action = "追加"
    else:
        for row, flag in zip(body, flags, strict=True):
            row[existing_at] = "1" if flag else "0"
        action = "更新（冪等）"

    with DATASET_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(body)
    print(f"OK: {DATASET_CSV.relative_to(ROOT)} に {NEW_COLUMN} を{action}しました（列数 {len(header)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--check" in sys.argv))
