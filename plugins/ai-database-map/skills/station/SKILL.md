---
name: station
description: 駅を 1 つ指定して、周辺の主要指標（乗降客数・人口・地価・バス・事業所・従業者）と水害リスクの要約を出す。/ai-database-map:station 東京 1000 のように使う。
argument-hint: '<駅名> [半径m]'
allowed-tools: mcp__plugin_ai-database-map_station-data__search_stations, mcp__plugin_ai-database-map_station-data__get_station_detail, mcp__plugin_ai-database-map_station-data__get_hazard_at_point
---

駅「$0」の周辺データを要約する。半径は $1（未指定なら 1000）メートル。

手順：

1. `mcp__plugin_ai-database-map_station-data__search_stations` で「$0」を解決する。
   候補が複数なら都道府県つきで一覧し、ユーザーに選んでもらう（勝手に選ばない）。
2. `mcp__plugin_ai-database-map_station-data__get_station_detail` を grp と半径で呼ぶ。
3. `mcp__plugin_ai-database-map_station-data__get_hazard_at_point` を同じ grp で呼ぶ。
4. 出力：
   - 駅名・都道府県・運営会社
   - 主要指標の表（値には**単位と年次**、見出しに**半径**を明記）
   - 水害リスクは 1〜2 行（**「もし起きたら」の前置き**・代表点 1 点の注意・
     [hazard-reading](../hazard-reading/SKILL.md) の規約に従う）
   - 出典（応答の sources をそのまま）

作法の詳細は [station-analysis](../station-analysis/SKILL.md) に従う。
