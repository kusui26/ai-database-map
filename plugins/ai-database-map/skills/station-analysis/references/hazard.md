# 災害データの意味（要約）

本編は [hazard-reading](../../hazard-reading/SKILL.md) スキル。ここは分析中の早見表。

- `get_hazard_at_point` ＝ **「もし起きたら」**（静的な想定区域・想定最大規模）。
  `get_hazard_alerts` ＝ **「いま」**（気象庁の発表）。**混ぜない**。
- 駅の値は**代表点 1 点**の判定。駅前の反対側では異なることがある。
- レベル（none/caution/warning/danger/critical）は**順序**であって足し算できない。
  `none` は「指定区域の該当なし」であり**「安全」ではない**。
- 応答の `limitationsJa` / `coverageNotesJa` / `disclaimerJa` は**全部**利用者に伝える。
  1 行でも落とすと誤解が生まれる。
- 避難場所は「指定の一覧」であり、**いま開設されているかは分からない**。
  脱出方向は**経路案内ではない**（直線距離と方角だけ）。
