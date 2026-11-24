"""年齢の区分を整数の人数にする（2026-11-24・人口の年齢 PR-1）。

駅 × 半径の区分の値（実数）を、画面と DB に出す整数の人数にする。区分ごとに四捨五入すると、和が総数から 1〜2 人ずれる
（0〜14 ＋ 15〜64 ＋ 65 歳以上 ≠ 人口）。そこで次を同時に満たす整数にする：

1. 区分の和 ＝ 区分の実数の和の四捨五入（＝既存の総数の列。`build_station_age.py` が照合する）
2. どの区分も 0 以上
3. どの区分も、半径を広げて減らない
4. 元の実数との差は小さい（ふつうは 1 人未満・まれに 2 人）

やり方：区分を年齢の順に積んだ累積を四捨五入し、その差を区分の値にする（1 と 2 を満たし、差は 1 人以下）。
半径を広げて 1 人減った区分があれば、同じ半径で増えた区分から 1 人移す（和は変わらない・3 を満たす）。
"""

from __future__ import annotations

import numpy as np


def cumulative_round(values: np.ndarray) -> np.ndarray:
    """（区分 × …）の実数 → 整数。累積を四捨五入して差を取る（和は実数の和の四捨五入・どの区分も 0 以上）。"""
    stacked = np.rint(np.cumsum(values, axis=0))
    return np.diff(stacked, axis=0, prepend=0).astype(np.int64)


def _donor(current: np.ndarray, previous: np.ndarray, target: np.ndarray) -> int:
    """1 駅の 1 半径：前の半径より増えた区分のうち、実数より多く数えている区分（移しても減らない区分）。"""
    room = current - previous
    if room.max() <= 0:
        raise ValueError("移せる区分が無い（総数が半径を広げて減っている）")
    over = np.where(room > 0, current - target, -np.inf)
    return int(np.argmax(over))


def _repair_radius(current: np.ndarray, previous: np.ndarray, target: np.ndarray) -> int:
    """1 半径（区分 × 駅）：前の半径より減った区分へ、同じ駅の増えた区分から 1 人ずつ移す。移した人数を返す。"""
    moved = 0
    for station in np.flatnonzero((current < previous).any(axis=0)):
        column, before, wanted = current[:, station], previous[:, station], target[:, station]
        while (column < before).any():
            short = int(np.argmax(before - column))
            column[_donor(column, before, wanted)] -= 1
            column[short] += 1
            moved += 1
    return moved


def integer_bands(values: np.ndarray) -> tuple[np.ndarray, int]:
    """（区分 × 駅 × 半径）の実数 → 整数と、半径の直しで移した人数。

    実数は先に半径の方向へそろえる（浮動小数の誤差で、半径を広げて減った値を前の半径の値にする。ノートブックと同じ）。
    """
    target = np.maximum.accumulate(values, axis=2)
    out = cumulative_round(target)
    moved = sum(_repair_radius(out[:, :, radius], out[:, :, radius - 1], target[:, :, radius])
                for radius in range(1, out.shape[2]))
    return out, moved
