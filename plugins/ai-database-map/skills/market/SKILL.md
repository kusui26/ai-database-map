---
name: market
description: 業種と候補駅（またはエリア）を指定して出店の商圏分析をする。/ai-database-map:market カフェ 横浜・武蔵小杉 のように使う。
argument-hint: '<業種> <候補駅やエリア（複数可）>'
allowed-tools: mcp__plugin_ai-database-map_station-data__search_stations, mcp__plugin_ai-database-map_station-data__list_stations, mcp__plugin_ai-database-map_station-data__build_dataset, mcp__plugin_ai-database-map_station-data__get_metrics_catalog
---

業種「$0」・候補「$1」の商圏分析を、[market-analysis](../market-analysis/SKILL.md) の方法論で行う。

1. **まず要件を聞く**（方法論 §1：業種の対応区分・商圏半径・重視軸。
   **この段階ではツールを呼ばない**）
2. 要件が揃ったら：候補駅は `search_stations` で grp 解決（エリアなら `list_stations`）→
   `build_dataset`（業種別プリセット・radiusM=商圏）→ ローカルで需要×競合の比較
3. 比較表＋強み/弱み → 限界（按分推計・2020 年はコロナ影響・従業者＝昼間 proxy・
   地価は賃料ではない）＋出典
