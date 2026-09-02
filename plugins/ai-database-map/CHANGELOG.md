# Changelog

## 0.4.0 — 2026-09-03

- `get_hazard_summary` を追加：全 9,273 駅の水害・土砂災害サマリ（事前計算・順序尺度）を
  最大 500 駅まで一括で返す。none≠安全（uncovered の印つき）・「いま」の警報は含まない
- `build_dataset` に `includeHazard`：hazard_ 接頭辞の列（レベル・nearby/uncovered フラグ・
  標高）を CSV に結合できる

## 0.3.0 — 2026-09-03

- `build_dataset` を追加：駅×指標の CSV（短命の署名 URL・meta.json つき）を 1 回で生成し、
  ローカル pandas で分析する入口。`analyze-csv` スキルを新設
- `list_stations` のセレクタを拡張：operators / routes / routeTypes・bbox・near

## 0.2.0 — 2026-09-02

- `list_stations` を追加：都道府県・市区町村（前方一致。「横浜市」で全区）から
  駅の対象集合を作る。`station-analysis` スキルと `data-analyst` を対応

## 0.1.0 — 2026-09-02

初版。

- リモート MCP サーバ（`station-data`）：9 ツール（駅検索・駅詳細・ランキング・散布・
  災害リスク・警報・避難場所・脱出方向・メトリクスカタログ）＋ `catalog://metrics` リソース
- スキル：`station-analysis`（分析の作法）・`hazard-reading`（災害の言い方）・
  `/ai-database-map:station`・`/ai-database-map:rank`
- サブエージェント：`data-analyst`
- SessionStart フック（1 文の文脈）
