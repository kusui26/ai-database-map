---
name: rank
description: 指標を指定して駅ランキングを出す。/ai-database-map:rank pop_gr 1000 20 のように使う（指標・半径 m・件数）。都道府県や路線の絞り込みは会話で指定する。
argument-hint: '<指標キーまたはファミリ> [半径m] [件数]'
allowed-tools: mcp__plugin_ai-database-map_station-data__get_metrics_catalog, mcp__plugin_ai-database-map_station-data__rank_stations
---

指標「$0」で駅ランキングを出す。半径は $1（未指定なら 1000）メートル、件数は $2（未指定なら 20）。

手順：

1. 「$0」がカタログキーの形（`_年_半径` を含む）でなければ、まず
   `mcp__plugin_ai-database-map_station-data__get_metrics_catalog` でファミリを引き、
   **どのキーに解決したか**を本文に書く。
2. `mcp__plugin_ai-database-map_station-data__rank_stations` を呼ぶ
   （会話で都道府県・会社・路線の指定があれば渡す）。
3. 出力：
   - 見出しに指標ラベル・**単位・年次・半径**・絞り込み条件
   - 順位表（⚠ `flagged` の行には ⚠ を付け、意味を 1 行注記）
   - `note`（既定の補完・0 件の理由）があればそのまま伝える
   - 出典

作法の詳細は [station-analysis](../station-analysis/SKILL.md) に従う。
