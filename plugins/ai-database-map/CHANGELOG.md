# Changelog

## 0.8.7 — 2026-10-08

- **ランキング・散布を市区町村と「起点の駅から N km 以内」で絞れるようになった**（サーバ側・
  `rank_stations` / `compare_growth` に `municipality`・`near: {station, withinM}`・`bbox`）。「横浜市で」を
  神奈川県で代用せず、「竹橋から 5km 以内で」を集計半径（`radiusM`）に入れずに答えられる。
  返却の各駅に起点からの距離（`distance`）が付く（`list_stations` も）
- **市区町村・起点の駅の名前もサーバが解決する**（「港北区」→ 横浜市港北区・「横浜」→ 横浜市・「東京都港区」）。
  決めた市区町村の都道府県を添え、読み替えを `nameNotes` に返す。同じ名前（区の「中区」・駅の「府中」「日本橋」）は
  `prefectures` で決まらなければ候補を返す（MCP には地図が無いので、地図の表示範囲では決めない）
- `list_stations` / `build_dataset` の `near` は、起点を駅（`station`）でも地点（`lon`・`lat`）でも受け、半径は `withinM`
  （以前の `radiusM` も受ける）
- 上の振る舞いに合わせて、`station-analysis` と `analyze-csv` の手順を直した

## 0.8.6 — 2026-10-08

- **路線が、利用者の呼ぶ路線（運行系統）になった**（サーバ側・`rank_stations` / `compare_growth` /
  `list_stations` / `build_dataset`）。「山手線」は環状の 30 駅（以前は法令上の 17 駅で、東京・上野・
  秋葉原が入らなかった）、「副都心線」は和光市〜渋谷の 16 駅。「京浜東北線」「湘南新宿ライン」「中央線快速」も
  そのまま 1 本の路線になり、候補で聞き返さなくなった。原典は駅データ.jp（2024-04-26 版を加工して使用）
- **区間に分かれた路線**（JR東海道本線の 4 区間と、正式名がその区間の琵琶湖線・JR京都線など）は 1 本として
  扱う。区間だけで見たいときは、候補の区間名（「JR東海道本線(東京～熱海)」）で指定する
- 同じ名前の路線（山手線・中央線・東西線・新宿線）は、これまでどおり `prefectures` で決まらなければ候補を返す
  （MCP には地図が無いので、地図の表示範囲では決めない）。候補の `routes` は、名前だけで 1 本に決まる言い方
  （「神鉄三田線」「JR宇都宮線」）になった
- 上の振る舞いに合わせて、`transport-planning` と `station-analysis` の手順を直した

## 0.8.5 — 2026-10-07

- **会社・路線をふだんの呼び方で渡せるようになった**（サーバ側・`rank_stations` / `compare_growth` /
  `list_stations` / `build_dataset`）。「東急東横線」「丸ノ内線」「都営浅草線」「JR東日本」を、
  データの正式名（東急電鉄の「東横線」・東京地下鉄の「4号線丸ノ内線」…）へ解決し、読み替えを
  `nameNotes` に返す。以前は正式名でないと 0 件になり、空の図が出ていた
- **同じ名前の別路線は推測しない**（東西線＝東京メトロ・札幌・仙台・京都など）。`prefectures` で 1 つに
  決まらなければ、図を作らずに候補（`problems` の `candidates`・駅の数と都道府県つき）を返す。
  運行系統の名前（京浜東北線など）も、正式な路線を候補として返す
- **0 件のときは図を作らない**（`noFigure`）
- 上の振る舞いに合わせて、`transport-planning` と `station-analysis` の手順を直した

## 0.8.4 — 2026-09-24

- **SessionStart フックのパスを引用符で囲んだ**。プラグインの置き場所に空白が含まれると、
  シェルが語に割ってしまい**フックが起動に失敗する**（実測：`sh: /…/space: No such file or directory`）。
  作法が 1 つも届かないまま、エラーも出ない壊れ方になる。
  - `claude plugin validate --strict` も **2.1.281 の版から警告**にしている（CI はこれで落ちた）
  - 引用符を外せば落ちるテストを `tests/claude-plugin.test.ts` に足した

## 0.8.3 — 2026-09-22

- **MulmoClaude の手順から回避策を外した**（上流が直したため）。設定は 3 つ → **2 つ**
  （MCP の登録と地図タイルの CSP）。**スキルはプラグインのまま効きます**。
  - **MulmoClaude 1.18.0 以上**を使ってください。1.18.0 で、Docker サンドボックスの中でも
    Claude Code のプラグインが解決されるようになりました
    （[#3186](https://github.com/receptron/mulmoclaude/issues/3186) →
    [#3188](https://github.com/receptron/mulmoclaude/pull/3188)：台帳のホストのパスを
    コンテナ側に読み替える）
  - **すでにリンクを張った人は消してください**——同じスキルが 2 回出ます
    （`station-analysis` と `ai-database-map:station-analysis`）。消し方は README に
- 実機で確認：**symlink 無し・サンドボックス ON** で、プラグインの MCP（13 ツール・connected）・
  スラッシュコマンド 11・SessionStart フックがエージェントに届く。台帳の読み替えを外すと 0 に戻る
  （`docs/260912_gui_chat_protocol.md` §4.6.1 ⑤）

## 0.8.2 — 2026-09-15

- **MulmoClaude が動かない理由の説明を訂正**（0.8.1 の説明は誤りだった）。
  手順と回避策は正しかったが、**因果が違った**。
  - 誤：MulmoClaude がプラグインのスキルを走査しないから
  - 正：**既定の Docker サンドボックスの中で、Claude Code がプラグインを解決できない**から。
    台帳（`known_marketplaces.json` / `installed_plugins.json`）がホストの絶対パスを持つ一方、
    コンテナのホームは `/home/node` で、そのパスが存在しない。スキルだけでなく
    スラッシュコマンド・MCP サーバ・フックも落ちる。upstream に報告済み
    （receptron/mulmoclaude#3186）
- **symlink が要る条件を限定**：サンドボックスを使うときだけ。`--disable-sandbox` で動かすなら不要。
  #3186 が直れば手順そのものが要らなくなる
- `/ai` とルート README も同じ訂正を反映

## 0.8.1 — 2026-09-15

- **母艦の導入手順を訂正**（実機で判明・`docs/260912_gui_chat_protocol.md` §4.6.1）。
  手順どおりにやっても動かない箇所が 3 つあった。
  （⚠ このうち MulmoClaude の**原因の説明は誤り**だった。手順は正しい。**0.8.2 で訂正**）
  - **MulmoClaude はプラグインを読まない**——走査するのは `~/.claude/skills/` と
    `<workspace>/.claude/skills/` だけ。「読まれない場合はコピー」ではなく**常に必須**で、
    コピーより**相対 symlink**（Docker サンドボックスでも解決し、`/plugin` 更新に追随する）
  - **MulmoClaude の MCP 登録は必須**——登録済みのサーバしか許可されないため、
    プラグイン同梱の MCP 定義は使えない
  - **MulmoTerminal は `WORKSPACE` のセルを選ぶ**——「Canvas を ON」は推奨経路には無い操作で、
    ワークスペースではスイッチ自体が表示されない
- 地図タイルの CSP は**ホスト名だけ**・**再起動不要**であることを明記
- 導入ページ `/ai` にも母艦の節を追加（リンクと CSP の 1 行コマンド）

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
