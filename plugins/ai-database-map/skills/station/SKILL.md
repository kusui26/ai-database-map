---
name: station
description: 駅を 1 つ指定して、周辺の主要指標（人口と増減・将来・所得・地価・従業者・売上・乗降客数・バス）と県内／市内での位置、エリアの性格の目安、水害リスクの要約を出す。/ai-database-map:station 東京 1000 のように使う。
argument-hint: '<駅名> [半径m]'
allowed-tools: mcp__plugin_ai-database-map_station-data__search_stations, mcp__plugin_ai-database-map_station-data__get_station_profile, mcp__plugin_ai-database-map_station-data__get_hazard_at_point, mcp__station-data__search_stations, mcp__station-data__get_station_profile, mcp__station-data__get_hazard_at_point
---

駅「$0」の周辺データを要約する。半径は $1（未指定なら 1000）メートル。

手順：

1. `search_stations` で「$0」を解決する。
   候補が複数なら都道府県つきで一覧し、ユーザーに選んでもらう（勝手に選ばない）。
2. `get_station_profile` を grp と半径で 1 回呼ぶ（要点・県内／市内での位置・性格の目安・
   災害の要約・見ていないことが返る）。
3. 河川ごとの浸水深や到達時間まで聞かれたときだけ、`get_hazard_at_point` を同じ grp で呼ぶ。
4. 出力：
   - 駅名・都道府県・運営会社
   - 性格の目安（`character`・根拠の数ごと。**自分で判定し直さない**）
   - 主要指標の表（値には**単位と年次**、見出しに**半径**、列に**県内／市内での位置**
     ＝応答の `positions` をそのまま。「上位」は値が大きい側で、良し悪しではない）
   - 水害リスクは 1〜2 行（**「もし起きたら」の前置き**・代表点 1 点の注意・
     [hazard-reading](../hazard-reading/SKILL.md) の規約に従う）
   - **見ていないこと**（応答の `notCovered`：治安・学校・生活施設・家賃・通勤・騒音）
   - 出典（応答の sources をそのまま）

作法の詳細は [station-analysis](../station-analysis/SKILL.md) に従う。
