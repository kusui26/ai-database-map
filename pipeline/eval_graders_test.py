"""受け入れテストの**決定的グレーダ**そのものを検査する（PR-14）。

グレーダが誤判定すると、スキルは正しいのに実走が落ちる（実際に 3 回ぶん落とした）。
判定の境目——**ハザードを「描いた」のか、注記で「触れた」だけなのか**——を固定する。

    python3 pipeline/eval_graders_test.py   # 全 PASS で exit 0
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_recommend import HAZARD_PLOTTED, plotted_text  # noqa: E402


def chart(option: dict) -> dict:
    return {"name": "mcp__canvas__presentChart", "input": {"document": {"charts": [{"option": option}]}}}


def plots_hazard(option: dict) -> bool:
    return HAZARD_PLOTTED.search(plotted_text(chart(option))) is not None


# 足切りの事実は**書かなければならない**（方法論 §5）。タイトル・副題・注記は見ない。
ALLOWED = {
    "注記が副題にある": {
        "title": {"text": "合成スコア", "subtext": "洪水 hazard_flood_level が danger 以上の 3 駅は除外"},
        "xAxis": {"type": "category", "data": ["鶴見", "戸塚"]},
        "series": [{"type": "bar", "name": "合成スコア", "data": [0.82, 0.77]}],
    },
    "注記が軸名ではなく図タイトルにある": {
        "title": {"text": "洪水の危険度 danger 以上を除いた 15 駅"},
        "xAxis": {"type": "category", "data": ["鶴見"]},
        "yAxis": {"name": "スコア（0-1・min-max 正規化）"},
        "series": [{"type": "bar", "data": [0.8]}],
    },
}

# 描いたら落ちる：系列名・軸カテゴリ・凡例のどこに出ても同じ。
FORBIDDEN = {
    "系列名がハザード列": {"series": [{"type": "bar", "name": "洪水 hazard_flood_level", "data": [3, 2]}]},
    "軸カテゴリがレベル語": {
        "xAxis": {"type": "category", "data": ["none", "warning", "danger"]},
        "series": [{"type": "bar", "data": [5, 3, 1]}],
    },
    "凡例に危険度": {"legend": {"data": ["危険度"]}, "series": [{"type": "bar", "data": [1]}]},
}


def main() -> int:
    failures = [name for name, option in ALLOWED.items() if plots_hazard(option)]
    failures += [f"(見逃し) {name}" for name, option in FORBIDDEN.items() if not plots_hazard(option)]
    for name in ALLOWED:
        print(f"  OK 許す: {name}" if name not in failures else f"  NG 許すはずが落ちた: {name}")
    for name in FORBIDDEN:
        print(f"  OK 落とす: {name}" if f"(見逃し) {name}" not in failures else f"  NG 見逃した: {name}")
    print(f"\n{'PASS' if not failures else 'FAIL: ' + ', '.join(failures)}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
