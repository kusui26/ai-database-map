---
name: recommend
description: エリアを指定して「住むのにおすすめの駅」をデータ分析で提案する。/ai-database-map:recommend 横浜市 のように使う。こだわり（予算・路線・災害許容度）は会話で確認する。
argument-hint: '<エリア（市区町村名・都道府県名）> [こだわり（任意）]'
allowed-tools: mcp__plugin_ai-database-map_station-data__search_stations, mcp__plugin_ai-database-map_station-data__list_stations, mcp__plugin_ai-database-map_station-data__build_dataset, mcp__plugin_ai-database-map_station-data__get_hazard_summary, mcp__plugin_ai-database-map_station-data__get_metrics_catalog, mcp__plugin_ai-database-map_station-data__get_hazard_at_point
---

エリア「$0」で住むのにおすすめの駅を、
[station-recommendation](../station-recommendation/SKILL.md) の方法論で分析する。
「$1」があれば要件の初期値として扱う（不足分は聞く）。

1. **まず要件を聞く**（方法論 §1。①予算/資産 ②通勤先・路線 ③災害の許容度＝足切りか減点か。
   **この段階ではツールを呼ばない**）
2. 要件が揃ったら：`list_stations`（$0 は municipality の前方一致）→
   `build_dataset`（`includeHazard: true`）→ CSV をローカルで正規化・重み付き合成
3. 重み ±20% の敏感度 → 上位 5 駅の表＋各駅の効いた要因/弱点 → 限界と出典（方法論 §8）
