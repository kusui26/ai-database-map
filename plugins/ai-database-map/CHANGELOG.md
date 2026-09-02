# Changelog

## 0.6.1 — 2026-09-03

- リファクタ：意思決定支援の共通骨格を **station-analysis の「分析の型（8 段）」** に抽出し、
  用途別スキル（住宅・輸送計画・出店）を「型のダイジェスト＋用途の差し込み（質問・プリセット・
  固有の限界・禁じ手）」の薄いレシピカードに痩身。挙動同等は golden eval 全通し
  （housing 5/5・transport 3/3・market 3/3）で確認

## 0.6.0 — 2026-09-03

- 方法論スキルを 3 ユースケースへ拡張（CLAUDE.md §1 の想定ユーザー全対応）：
  - `transport-planning`：輸送計画・ダイヤ検討の需要側材料（乗降トレンド 2011–2024・
    コロナ回復×将来人口の 4 象限。ダイヤ・断面・混雑は「持っていない」と明言する規範）
  - `market-analysis`：出店の商圏分析（業種別の按分売上・従業者=昼間 proxy・
    競合=同業集積 proxy・2020 年=コロナ影響年の注記を必須化）
- コマンド `/ai-database-map:demand`・`/ai-database-map:market` を追加
- evals に transport / market の golden ケースを追加（ローカルランナーは --scenario 対応）

## 0.5.0 — 2026-09-03

- 方法論スキル `station-recommendation` を追加：「〇〇市で住むのにおすすめの駅は？」の作法
  （要件を先に聞く→対象集合→CSV→正規化・重み合成→±20% 敏感度→上位 5 駅＋限界・出典。
  災害は線形加点しない・「安全」と言わない）
- コマンド `/ai-database-map:recommend <エリア>` を追加
- golden シナリオ受け入れテスト（`evals/`・`claude plugin eval` で採点）を同梱
- 修正：MCP ツール結果の `structuredContent` に `result`（LLM 向け要約）を同梱。
  structuredContent を優先するクライアント（Claude Code）で、パネルなしツールの結果が
  空に見えていた問題を解消（実走 eval で発見）

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
