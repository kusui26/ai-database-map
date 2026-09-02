---
name: demand
description: 路線・会社を指定して、輸送計画・ダイヤ検討の需要側材料（乗降トレンド・コロナ回復・将来人口）を分析する。/ai-database-map:demand 東急東横線 のように使う。
argument-hint: '<路線名または会社名> [観点（回復・将来・比較など）]'
allowed-tools: mcp__plugin_ai-database-map_station-data__list_stations, mcp__plugin_ai-database-map_station-data__build_dataset, mcp__plugin_ai-database-map_station-data__get_metrics_catalog, mcp__plugin_ai-database-map_station-data__search_stations, mcp__plugin_ai-database-map_station-data__rank_stations
---

「$0」の駅ごとの需要分析を、[transport-planning](../transport-planning/SKILL.md) の方法論で行う。
「$1」があれば観点の初期値として扱う。

1. **まず要件を聞く**（方法論 §1：何の検討材料か・時間軸。**この段階ではツールを呼ばない**）
2. 要件が揃ったら：`list_stations`（operators / routes・まとめて 1 回）→
   `build_dataset`（pax の年系列＋rate_covid＋将来人口）→ ローカルで傾き・4 象限分類
3. 分類表＋根拠 → 限界（ダイヤ・断面・混雑は持たない／乗降≠通過需要）＋出典
