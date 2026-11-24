"""人口の年齢（PR-1）の部品を、作り例で確かめる（2026-11-24）。通信も DB も使わない（数秒）。

  1. 整数にする（`age_integers.py`）：和・0 以上・半径を広げて減らない・元の値との差。減った区分の直しの作り例
  2. 国勢調査の組（`age_cells.impute_census`）：秘匿したセルは合算先の構成で本来のセルへ・不詳は割り振り比で・
     セルの和 ＝ 総数・組の不詳が負なら落とす
  3. 割り振り比の借り方（`age_muni.ratio_area`）：自分 → 借りる区域（浜松市の新しい区）→ 都道府県 → 全国
  4. セルの決まり（`check_items`・`check_secrecy`）：15 歳以上 ≠ 15〜64 ＋ 65 歳以上・合算先が無い・GASSAN の食い違い
  5. 統計 GIS の zip の読み方：見出しで項目を確かめる（2015 年に 2020 年の番号を使うと落ちる）・`*` は NaN・ほかの記号は落とす
  6. R6（`age_cells._r6_year`）：`*` は合算先の構成・組の和 ＝ 合算先の年齢の列・構成の無い行は落とす
  7. 指標（`build_station_age.share`・`growth`）：小数 1 桁・分母 0 は NaN

    python3 pipeline/station_age_test.py
"""

from __future__ import annotations

import io
import sys
import zipfile
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import age_cells  # noqa: E402
from age_integers import cumulative_round, integer_bands  # noqa: E402
from age_muni import RATIO_COLUMNS, ratio_area  # noqa: E402
from age_rules import MESH_TABLES, MeshTable  # noqa: E402
from build_station_age import growth, share  # noqa: E402

SEED = 11
#: 乱数の作り例の大きさ（区分 × 駅 × 半径）。
RANDOM_SHAPE = (4, 400, 6)


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


def raises(call: Callable[[], object], kind: type[BaseException]) -> str:
    """落ちたら文を、落ちなければ空を返す。"""
    try:
        call()
    except kind as error:
        return str(error) or kind.__name__
    return ""


# --- 1. 整数にする -----------------------------------------------------------------


def integers(checks: Checks) -> None:
    rng = np.random.default_rng(SEED)
    steps = rng.uniform(0, 3, RANDOM_SHAPE) * (rng.uniform(0, 1, RANDOM_SHAPE) < 0.5)  # 半径ごとの増え方（半分は増えない）
    values = np.cumsum(steps, axis=2)
    values[:, :5] = 0.0  # 人のいない駅
    out, moved = integer_bands(values)
    target = np.maximum.accumulate(values, axis=2)
    checks.add(bool((out.sum(axis=0) == np.rint(target.sum(axis=0))).all()), "和 ＝ 実数の和の四捨五入")
    checks.add(bool((out >= 0).all()), "どの区分も 0 以上")
    checks.add(bool((np.diff(out, axis=2) >= 0).all()), "どの区分も半径を広げて減らない", f"直しで移した {moved} 人")
    worst = float(np.abs(out - target).max())
    checks.add(worst <= 2.0, "元の実数との差は 2 人以下", f"最大 {worst:.2f}")
    checks.add(int(out[:, :5].sum()) == 0, "人のいない駅は 0")
    crafted = np.array([[[10.4, 10.6]], [[10.2, 10.2]]])  # 累積の四捨五入だと 2 番目の区分が 11 → 10 に減る
    plain = cumulative_round(np.maximum.accumulate(crafted, axis=2))
    fixed, moved_one = integer_bands(crafted)
    checks.add(plain[1, 0].tolist() == [11, 10] and fixed[:, 0, 1].tolist() == [10, 11] and moved_one == 1,
               "減った区分へ、増えた区分から 1 人移す（作り例）", f"直す前 {plain[:, 0, 1].tolist()} → {fixed[:, 0, 1].tolist()}")


# --- 2〜4. 国勢調査の組・割り振り比・セルの決まり ----------------------------------------


def census_cells() -> pd.DataFrame:
    """合算先 t（秘匿したセル h1・h2 の年齢を足し上げてある）と、秘匿の無いセル p。"""
    return pd.DataFrame({
        "code": ["t", "h1", "h2", "p"], "secrecy": ["1", "2", "2", "0"], "target": ["", "t", "t", ""],
        "merged": ["h1;h2", "", "", ""],
        "total": [10.0, 5.0, 2.0, 20.0],
        "a0_14": [2.0, np.nan, np.nan, 3.0], "a15p": [13.0, np.nan, np.nan, 15.0], "a15_64": [9.0, np.nan, np.nan, 10.0],
        "a65p": [4.0, np.nan, np.nan, 5.0], "a75p": [2.0, np.nan, np.nan, 1.0],
    })


def ratios() -> pd.DataFrame:
    return pd.DataFrame([[0.1, 0.6, 0.2, 0.1], [0.25, 0.25, 0.25, 0.25]], index=["13101", "13000"], columns=list(RATIO_COLUMNS))


def imputation(checks: Checks) -> None:
    cells = census_cells()
    n03 = pd.Series(["13101", "13101", "13101", "13102"], index=cells["code"].to_numpy())
    out = age_cells.impute_census(cells, ratios(), n03).set_index("code")
    bands = out[list(age_cells.BAND_COLUMNS)]
    checks.add(bool(np.allclose(bands.sum(axis=1), out["total"])), "セルの 4 区分の和 ＝ セルの総数（秘匿したセルも）")
    group = bands.loc[["t", "h1", "h2"]].sum()
    checks.add(bool(np.allclose(group, [2.2, 10.2, 2.4, 2.2])), "組の 4 区分 ＝ 合算先の年齢 ＋ 組の不詳 2 人 × 割り振り比",
               f"{group.round(3).tolist()}")
    checks.add(bool(np.allclose(bands.loc["h1"], np.array([2.2, 10.2, 2.4, 2.2]) * 5 / 17)), "秘匿したセルは組と同じ構成で本来のセルへ")
    checks.add(bool(np.allclose(bands.loc["p"], [3.5, 10.5, 4.5, 1.5])) and out.loc["p", "ratio_area"] == "13000",
               "割り振り比の無い区（13102）は都道府県の比を借りる", f"{bands.loc['p'].tolist()}")
    checks.add(bool(np.isclose(out["unknown"].sum(), 4.0)), "補う前の不詳（組 2 人 ＋ p 2 人）を総数の割合でセルへ")
    broken = census_cells().assign(a15p=[20.0, np.nan, np.nan, 15.0], a15_64=[16.0, np.nan, np.nan, 10.0])
    message = raises(lambda: age_cells.impute_census(broken, ratios(), n03), SystemExit)
    checks.add("負" in message, "組の不詳が負（分かっている人 > 総数）なら落とす", message[:40])


def borrowing(checks: Checks) -> None:
    available = {"13101", "13000", "22130", "22137", "00000"}
    got = [ratio_area(code, available) for code in ("13101", "22138", "22140", "13102", "47201")]
    checks.add(got == ["13101", "22130", "22137", "13000", "00000"], "自分 → 借りる区域 → 都道府県 → 全国", f"{got}")


def cell_rules(checks: Checks) -> None:
    good = census_cells()
    checks.add(not age_cells.check_items(good, "作り例") and not age_cells.check_secrecy(good, "作り例"), "決まりを守る作り例は通る")
    wrong_sum = good.assign(a15_64=[9.0, np.nan, np.nan, 11.0])
    checks.add(any("15 歳以上" in p for p in age_cells.check_items(wrong_sum, "作り例")), "15 歳以上 ≠ 15〜64 ＋ 65 歳以上を見つける")
    lost = good.assign(target=["", "zz", "t", ""])
    checks.add(len(age_cells.check_secrecy(lost, "作り例")) == 2, "合算先が無い・GASSAN と食い違うを見つける")


# --- 5. 統計 GIS の zip -------------------------------------------------------------


#: 2015 年の統計 GIS（T000876）の本物の並び（1〜22 列目の見出し）。65 歳以上は 16 列目・75 歳以上は 19 列目。
LABELS_2015: tuple[str, ...] = (
    "人口総数", "人口総数　男", "人口総数　女", "０〜１４歳人口総数", "０〜１４歳人口　男", "０〜１４歳人口　女",
    "１５歳以上人口総数", "１５歳以上人口　男", "１５歳以上人口　女", "１５〜６４歳人口総数", "１５〜６４歳人口　男",
    "１５〜６４歳人口　女", "２０歳以上人口総数", "２０歳以上人口　男", "２０歳以上人口　女", "６５歳以上人口総数",
    "６５歳以上人口　男", "６５歳以上人口　女", "７５歳以上人口総数", "７５歳以上人口　男", "７５歳以上人口　女", "外国人人口総数",
)
#: 作り例のセル（秘匿したセルと合算先）の値（1〜22 列目）。
ROWS_2015: tuple[list[str], ...] = (
    ["5339000541", "2", "5339000544", "", "3", "1", "2", *["*"] * 19],
    ["5339000544", "1", "", "5339000541", "42", "20", "22", "1", "0", "1", "51", "25", "26", "28", "14", "14",
     "49", "24", "25", "23", "11", "12", "8", "3", "5", "0"],
)


def gis_zip_2015(rows: tuple[list[str], ...]) -> bytes:
    """2015 年の統計 GIS と同じ形（1 行目＝列・2 行目＝見出し・Shift_JIS）の zip を作る。"""
    columns = ["KEY_CODE", "HTKSYORI", "HTKSAKI", "GASSAN", *[f"T000876{i:03d}" for i in range(1, len(LABELS_2015) + 1)]]
    labels = ["", "", "", "", *[f"　{label}" for label in LABELS_2015]]
    text = "\n".join(",".join(line) for line in [columns, labels, *rows])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("tblT000876Q5339.txt", text.encode("cp932"))
    return buffer.getvalue()


def gis_reading(checks: Checks) -> None:
    table = MESH_TABLES[2015]
    cells = age_cells.read_gis_zip(table, gis_zip_2015(ROWS_2015), "作り例")
    checks.add(cells["a0_14"].isna().tolist() == [True, False] and cells["total"].tolist() == [3, 42]
               and cells.loc[1, "a65p"] == 23 and cells.loc[1, "a75p"] == 8, "2015 年の並びを正しく読む・秘匿の * は NaN")
    offsets_2020 = {**table.columns, "a65p": "T000876019", "a75p": "T000876022"}
    wrong = MeshTable(2015, table.stats_id, table.directory, offsets_2020, table.labels)
    message = raises(lambda: age_cells.read_gis_zip(wrong, gis_zip_2015(ROWS_2015), "作り例"), ValueError)
    checks.add("見出し" in message, "2015 年に 2020 年の項目の番号（65 歳以上＝19 列目）を使うと、見出しの確かめで落ちる", message[:70])
    at_0_14 = 4 + 3  # 4 つの鍵の列のあと、0〜14 歳は 4 列目
    odd = (ROWS_2015[0], [*ROWS_2015[1][:at_0_14], "X", *ROWS_2015[1][at_0_14 + 1 :]])
    message = raises(lambda: age_cells.read_gis_zip(table, gis_zip_2015(odd), "作り例"), ValueError)
    checks.add("T000876004 に数でない値" in message, "* でない記号（X）は黙って 0 にせず落とす", message[:50])
    checks.add(age_cells.normalize_label("　０～１４歳人口　総数") == "０〜１４歳人口総数", "見出しの空白と波ダッシュの字形をそろえる")


# --- 6. R6 -----------------------------------------------------------------------


def r6_rows(target_of_hidden: str = "5339000002") -> pd.DataFrame:
    """合算先 @（PT00 ＝ 自分 10 ＋ 秘匿 2）・秘匿 *・印の無い行（県をまたいで 2 行）。"""
    year = 2050
    return pd.DataFrame({
        "pref": ["13", "13", "13", "14"], "MESH_ID": ["5339000002", "5339000003", "5339000004", "5339000004"],
        f"HITOKU{year}": ["@", "*", "", ""], f"GASSAN{year}": ["", target_of_hidden, "", ""],
        f"PTN_{year}": [10.0, 2.0, 5.0, 1.0], f"PT00_{year}": [12.0, 0.0, 5.0, 1.0],
        f"PTA_{year}": [2.0, 0.0, 1.0, 0.2], f"PTB_{year}": [6.0, 0.0, 3.0, 0.6],
        f"PTC_{year}": [4.0, 0.0, 1.0, 0.2], f"PTD_{year}": [1.0, 0.0, 0.5, 0.1],
    })


def r6_composition(checks: Checks) -> None:
    raw = r6_rows()
    year_frame = age_cells._r6_year(raw, 2050)
    bands = year_frame[[f"{column}_2050" for column in age_cells.BAND_COLUMNS]].to_numpy()
    checks.add(bool(np.allclose(bands.sum(axis=1), raw["PTN_2050"])), "行の 4 区分の和 ＝ PTN（真の総数）")
    checks.add(bool(np.allclose(bands[0] + bands[1], [2.0, 6.0, 3.0, 1.0])), "組（@ ＋ *）の和 ＝ 合算先の年齢の列（65〜74 ＝ PTC − PTD）")
    checks.add(bool(np.allclose(bands[1], np.array([2.0, 6.0, 3.0, 1.0]) * 2 / 12)), "* の行は合算先の構成 × 自分の PTN")
    message = raises(lambda: age_cells._r6_year(r6_rows(target_of_hidden="5339009999"), 2050), SystemExit)
    checks.add("年齢構成の無い行" in message, "合算先が見つからない * の行は落とす（黙って 0 にしない）", message[:40])


# --- 7. 指標 -----------------------------------------------------------------------


def rates(checks: Checks) -> None:
    part, total = np.array([55582, 0, 1]), np.array([75418, 0, 3])
    checks.add(np.array_equal(share(part, total), [73.7, np.nan, 33.3], equal_nan=True), "割合：小数 1 桁・総数 0 は NaN")
    new, old = np.array([110, 5, 0]), np.array([100, 0, 7])
    checks.add(np.array_equal(growth(new, old), [10.0, np.nan, -100.0], equal_nan=True), "増減率：小数 1 桁・分母 0 は NaN")


def main() -> int:
    checks = Checks()
    for part in (integers, imputation, borrowing, cell_rules, gis_reading, r6_composition, rates):
        part(checks)
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
