---
name: station-analysis
description: AI Database Map の駅×半径オープンデータ（乗降客数・人口・地価・バス・事業所・従業者）を分析するときの作法。駅名・半径・指標・ランキング・比較の質問で使う。Use when analyzing Japanese station-area metrics via the station-data MCP tools.
---

# 駅×半径データ分析の作法

AI Database Map の MCP ツール（`station-data` サーバ）で駅周辺の統計を扱うときは、必ずこの作法に従う。

## 手順

1. **駅の特定**：駅名は `mcp__plugin_ai-database-map_station-data__search_stations` で解決し、
   返った `grp` を以後のツールに渡す。同名駅（例：三田・府中）は候補の都道府県で確認する。
   「横浜市の駅」のような**地域から対象集合を作る**ときは
   `mcp__plugin_ai-database-map_station-data__list_stations`（municipality は前方一致・
   「横浜市」で全区を束ねる）。
2. **指標キーはカタログが唯一の真実**：指標名を推測で書かない。
   `mcp__plugin_ai-database-map_station-data__get_metrics_catalog` で正確なキー・ラベル・単位・
   利用可能な半径と年次を引いてから `rank_stations` / `compare_growth` に渡す。
   キーの形は `{接頭辞}_{年}_{半径}`（例 `pop_gr_2020_2015_1km`）。ファミリ名
   （例 `pop_gr`, `lp_gr`, `lp_med`, `bus_n`, `rate_covid`）でも渡せるが、半径・年の既定
   （1km・直近）が使われることを本文で明示する。
3. **半径は 6 段**：500 / 1000 / 2000 / 5000 / 10000 / 20000 m。未指定は 1km。
   **どの半径の値かを必ず書く**（半径が違う値を比べない）。
4. **数値には単位・年次を添える**：カタログの `unit` と対象年をそのまま使う。
   増減率は「どの年→どの年」かを書く。
5. **信頼性フラグ（⚠）を黙って使わない**：`flagged` の行（母数が小さい・極端値）は
   除外するか、⚠ を付けて注記する。除外したときは件数を書く。
6. **出典を落とさない**：応答の `sources` / 出典情報を最後に列挙する（詳細は
   [references/sources.md](references/sources.md)）。
7. **水害・災害に触れるときは** [hazard-reading](../hazard-reading/SKILL.md) の作法に従う
   （「安全」と言わない・時制を明示・limitations を全部伝える）。

## してはいけないこと

- カタログに無いキー・ラベル・単位を発明する
- 単位や半径の違う値を並べて優劣を言う
- 0 件・エラーのとき「データが無い」と断定する（応答の `hint` / `note` に従って言い直す）
- レート制限（`Rate limited`）を受けたのに即再試行する（案内された秒数を待つ）

## 参照（必要なときだけ読む）

- [references/metrics.md](references/metrics.md) — 指標キーの規約・半径・年次・信頼性フラグ
- [references/hazard.md](references/hazard.md) — 災害データの意味と言い方
- [references/sources.md](references/sources.md) — 出典・ライセンスの扱い
