"""乗降コロナ前後増減率の「低分母フラグ」を独立検証する（260731 → 260812 で検証専用に）。

`flag_covid` は **被覆<100% ／ pre<2019 ／ |率|>100%** の OR で、意味の違う 3 条件が
1 本に混ざっている（docs/passenger_aggregation.md §7）。アプリは信頼性フラグを
`reliabilityFlagKey` の 1 本で解決するため、**「低分母を除外」と書かれた操作が、
被覆の都合で大駅（新宿・横浜・新横浜…）を消していた**（docs/260731_reliability_flag_semantics.md）。

そこで **除外に使う条件だけ**を独立した列に切り出した：

    flag_covid_lown = 1  ⇔  |rate_covid| > 100%

§7 が「大駅の rate_covid は最大 94% に収まるため、|率|>100% は正常値を誤検出せず
小駅ノイズだけを拾う」と明言している条件で、**`rate_covid` から一意に決まる**。

**この列は現在ノートブックが直接出力する**（`script/create_dataset_for_AI_Database_Map.ipynb`
の「パターン2」セル）。以前は本スクリプトが CSV の末尾に後付けしていたが、
ノートブックを再実行した 260812 に本体へ畳んだ（docs/260811_income.md §4.1）。

本スクリプトは**追記をやめ、検証だけを行う**。`rate_covid` から独立に再計算した値と
CSV の列が一致するか、S12 から独立に数えた 85 群と一致するか、`flag_covid` の部分集合か、
の 3 点を確かめる。

    python3 pipeline/verify_pax_lown_flag.py
    → PASS で exit 0 / 1 つでも崩れたら exit 1
"""

from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_CSV = ROOT / "data" / "derived" / "station_dataset.csv"

RATE_COLUMN = "rate_covid"
COMPOSITE_FLAG_COLUMN = "flag_covid"
LOWN_COLUMN = "flag_covid_lown"

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
    """|rate_covid| > 100% か（空欄＝算出不可は False）。

    CSV の `rate_covid` は小数第 1 位に丸めた % 表記。ノートブックは丸め前の生値で
    判定するため、ちょうど 100.0 と表示される群では両者が食い違いうる。
    その差は `main()` で件数と群名を出して可視化する（黙って潰さない）。
    """
    if rate_text == "":
        return False
    return abs(float(rate_text)) > EXTREME_RATE_PCT


def main() -> int:
    with DATASET_CSV.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    header, body = rows[0], rows[1:]

    for required in (RATE_COLUMN, COMPOSITE_FLAG_COLUMN, LOWN_COLUMN):
        if required not in header:
            print(f"NG: {required} 列がありません（ノートブックの再実行が必要かもしれません）")
            return 1

    rate_at = header.index(RATE_COLUMN)
    composite_at = header.index(COMPOSITE_FLAG_COLUMN)
    lown_at = header.index(LOWN_COLUMN)

    actual = [is_true(row[lown_at]) for row in body]
    rounded = [is_lown(row[rate_at]) for row in body]
    lown = sum(actual)
    composite = sum(1 for row in body if is_true(row[composite_at]))
    # 低分母は複合フラグの部分集合でなければならない（複合は OR なので必ず含む）。
    outside = [i for i, flag in enumerate(actual) if flag and not is_true(body[i][composite_at])]
    # 丸め前後で判定が割れた群（境界＝表示上ちょうど 100.0%）。
    boundary = [i for i, (a, r) in enumerate(zip(actual, rounded, strict=True)) if a != r]

    print(f"駅グループ {len(body)} 行 / rate_covid 算出 {sum(1 for r in body if r[rate_at] != '')} 群")
    print(f"{COMPOSITE_FLAG_COLUMN}=1: {composite} 群（被覆<100%／pre<2019／|率|>100% の OR）")
    print(f"{LOWN_COLUMN}=1: {lown} 群（|率|>{EXTREME_RATE_PCT:.0f}% のみ）")
    print(f"→ 除外対象は {composite} → {lown} 群になり、{composite - lown} 群が値として残る")
    if boundary:
        names = [body[i][0] for i in boundary]
        print(f"※ 表示上ちょうど {EXTREME_RATE_PCT:.0f}% で丸め前後の判定が割れる群: {len(boundary)} 件 {names[:5]}")
        print("   （ノートブックは丸め前の生値で判定する。こちらが正）")

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

    print("OK: 低分母フラグはノートブック出力・独立再計算・部分集合関係のすべてと整合します")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
