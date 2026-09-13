# Changelog

## 0.8.0 — 2026-09-14

- **母艦（Canvas）対応**：`presentChart` / `presentForm` / `presentHtml` / `presentDocument` を
  持つホスト（MulmoTerminal・MulmoClaude）で、表と文章に加えて**図**を出す作法を追加。
  - チャートは**自分で書かない**——`get_station_detail` / `rank_stations` / `compare_growth` に
    `present: "echarts"` を足すと `presentChart` の document がそのまま返る（単位・年次・⚠ 込み）
  - 地図は `render_map` → URL を保存 → `presentHtml`（ランキングの上位駅もそのまま地図になる）
  - 要件の聞き取りは `presentForm` 1 枚（無ければ従来どおり文章で聞く）
  - 引数の形は**実機の定義**に合わせた——`presentDocument` は `title` 必須＋`filenamePrefix`
    （無いと保存名が `document` に落ちる）、`presentHtml` は `path`（本文を貼り直さない）
  - 詳細は `skills/station-analysis/references/canvas.md`。**図が無い環境でも答えは変わらない**
- **ツール名の可搬性**：スキルは短い名前（`build_dataset` など）で書き、接頭辞は環境ごとに
  末尾一致で解決する。`data-analyst` と `/station`・`/rank` は 2 通りの綴りを両方許可
- `/recommend`・`/demand`・`/market` から `allowed-tools` を外した——ローカル解析（Bash）と
  母艦のプレゼンタ（名前が環境依存）を使うため、セッションの許可に委ねる
- `data-analyst` は CSV をローカルで解析する道具（`Bash` / `Read` / `Write` / `Glob` / `Grep`）を
  持つようにし、**図は親のセッションに返す**（Canvas は親のもの・プレゼンタ名は列挙できない）。
  報告の**限界・出典・正規化の脚注は要約しない**（親がそのまま使うため）
- 災害は**チャートにしない**（順序尺度・免責と時制が落ちる）を `hazard-reading` に明文化
- 成果物の置き場所を規約化：母艦は `artifacts/`、Claude Code 単体は `./data/`
- SessionStart の 1 文を書き直した——**スキルが 1 つもロードされない回がある**（実走で確認）ので、
  守られないと答えが間違う作法だけをここに置く：対象集合は 1 回・正規化してから合成し方法と重みを
  1 行・最後に限界と出典（要約でも削らない）・要件は先に聞く・Canvas の 3 手
- golden に Canvas 版（`golden-yokohama-canvas`）を追加。ローカルランナーは
  `--scenario canvas` で**プレゼンタのスタブ**を差し込んで実走できる。
  受け入れは実走 **14/14**（住宅 5/5・輸送計画 3/3・出店 3/3・Canvas 3/3）

## 0.7.0 — 2026-09-03

- **Codex 対応**：`.codex-plugin/plugin.json`（同じ skills/ と本番 MCP を参照）＋
  リポジトリ直下 `.agents/plugins/marketplace.json`。
  `codex plugin marketplace add kusui26/AI-Database-Map` → `/plugins` で導入
- 導入ページ `https://ai-database-map.vercel.app/ai`（コマンド・コネクタ導入リンク・
  プラン別/枠の注意）を公開

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
