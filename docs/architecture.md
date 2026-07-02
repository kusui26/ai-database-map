# アーキテクチャ（AI Database Map）

システム構成・技術スタック・データモデル・API・**リポジトリ構成（Step1/Step2 の最適設計）**をまとめる。プロジェクトの指針・原則の正は [`.claude/CLAUDE.md`](../.claude/CLAUDE.md)、データの中身は [`dataset.md`](./dataset.md)、過去プロジェクトの教訓は [`Station_Area_Database_Map.md`](./Station_Area_Database_Map.md)。

---

## 1. 概要

- **AI Database Map** ＝ オープンデータを駅×半径で集約し、**地図 ＋ AI** で誰でも使える AIネイティブ Web アプリ。
- **Step1**：データセットを刷新し、アプリを公開（AIは未搭載だが**AI-ready に設計**）。
- **Step2**：Gemini を連携し AIネイティブ化（自然言語 → 同じ共通API）。
- 設計の一貫方針：**「API こそがプロダクト」**。人間UIとLLMが**同一のドメイン層／共通API**を対等に叩く。UIに意味づけ（ラベル・単位・計算）を埋めない。

---

## 2. 技術スタック

| 領域 | 採用 | 選定理由 |
|---|---|---|
| Hosting | **Vercel**（Hobby）| Next.js 一体・プレビューデプロイ・個人開発に最適 |
| 言語 | **TypeScript** | 型付き契約（UIとLLMが同じ型を共有）|
| フレームワーク | **Next.js（App Router）＋ React** | Server Components でSSR取得、Route Handlers を共通APIに。UI/API/AI を1基盤へ統合 |
| 型・検証 | **Zod** | 共通APIの入出力・GUI Chat Protocol を単一スキーマで型化（`z.infer`）|
| 地図描画 | **MapLibre GL JS**（ベクター）| ベクター描画・サーバ側 bbox 絞り込み・大量点のクラスタリング |
| ベースマップ | **MapTiler** | ベクタータイル配信 |
| DB | **Supabase（PostgreSQL）** | マネージド Postgres・認証・RLS・マイグレーション |
| 空間拡張 | **PostGIS** | `ST_DWithin`/`ST_Distance`・geometry。駅の空間検索の土台 |
| グラフ | **Chart.js** | 年次推移・散布図（過去プロジェクトから踏襲）|
| AI / LLM | **Google Gemini 2.5 Flash** | 低レイテンシ・**function calling** で共通APIを叩く（Step2）|

---

## 3. システムアーキテクチャ

### 3.1 AIネイティブ・トポロジー（反転）
UI 中心ではなく、**ドメイン層＝共通API を中心**に据え、構造化UIとLLMが対等な2つのクライアントとして消費する。

```
      [ LLM (Gemini) ]        [ 構造化UI (Next.js / MapLibre) ]
              \                         /
               \                       /
                ────────── 共通API ──────────   (app/api : Route Handlers)
                             │
                     ドメイン層（不変条件・意味・単位・計算・メトリクスカタログ）   (src/domain)
                             │
                     Supabase / PostgreSQL + PostGIS
```

### 3.2 レイヤ責務
| レイヤ | 責務 | 持たないもの |
|---|---|---|
| **[A] Frontend**（UI/MapLibre/Chart.js）| 描画のみ。API/ドメインを呼んで表示 | ビジネスロジック・指標定義・フォーマット |
| **[B] 共通API ＋ ドメイン層** | **唯一の信頼できるロジック**：不変条件・意味・単位・計算・ランキング・クラスタリング・メトリクスカタログ | フレームワーク依存（ドメインは pure 寄り）|
| **[C] DB**（Supabase/PostGIS）| 正規化テーブル＋カタログ＋空間データの永続化 | 計算ロジック（重い事前集計は materialized view）|
| **[D] AI**（Gemini・Step2）| 自然言語 → 同じドメイン関数（function calling）→ GUI Chat Protocol 応答 | 独自のデータアクセス（UIと別経路を作らない）|

### 3.3 依存方向（構造で「単一の真実」を強制）
```
components(UI) ─┐
app/api ────────┼─→ domain ──→ db ──→ Supabase/PostGIS
ai(Gemini) ─────┘
                       ↑
                shared（型・Zod・GUI Chat Protocol・定数）＝全層が参照
```
- **`domain` は UI/api/ai に依存しない**（framework 非依存・テスト容易）。
- UI・api・ai は **必ず `domain` を経由**（UIから直接DBを叩かない・LLM専用ロジックを作らない）。
- 逆依存（domain → UI等）は禁止。これで「人間とAIが同じロジックを通る」を構造的に保証。

---

## 4. GUI Chat Protocol (Map Edition)

**構造化UI（クリック）とLLM（会話）が produce/consume する共通の応答型**。フロントは応答の種類にかかわらず**同じ描画パス**でレンダリングする（＝「クリック」と「尋ねる」を統一）。`src/shared/protocol.ts` に Zod スキーマで定義。

概念的な形（実装で確定）：
```ts
type MapResponse = {
  messages: Message[]                 // 説明テキスト（UI/LLM共通）
  mapActions: MapAction[]             // setView / drawCircle / highlightStation / addLayer …
  panels: Panel[]                     // trendChart / rankingTable / scatter / stationCard …
  data: unknown                       // パネルが描画する構造化データ
}
```
- **構造化UI**：ボタン/クリック → 共通API → この型を返す → 描画。
- **LLM**：自然言語 → Gemini が function calling で共通API（＝domain）を呼び、**同じ型**を組み立てて返す → 同じ描画パスで表示。
- → 「UIでできること」と「AIでできること」に**ズレが生じない**。

---

## 5. データモデル / スキーマ設計

過去プロジェクトの**約250列ワイド非正規テーブル**（指標追加のたびにスキーマ変更）を廃し、**正規化 ＋ メトリクス・カタログ**へ。データの実体は [`dataset.md`](./dataset.md)（現状499列）。

### 5.1 テーブル設計（方針）
| テーブル | 役割 | 主な列 |
|---|---|---|
| `stations` | 駅グループ（1行1駅）| `grp`(PK), `station_name`, `label`, `prefecture`, `lon`, `lat`, **`geom geometry(Point,4326)`**, `n_op`, フラグ |
| `station_metrics` | **正規化した指標値（ロング）** | `grp`, `metric`, `radius_m`, `year`, `year_base`(増減率用・NULL可), `value` |
| `metric_catalog` | **指標の意味づけ（単一の真実）** | `metric`, `label`, `category`, `unit`, `value_type`, `format`, `radii[]`, `years[]`, `reliability_flag` |

- **命名規約 `{接頭辞}_{年}_{半径}`（dataset.md）がそのまま `(metric, year, radius_m)` の3軸に対応** → ワイドCSVを melt するだけでロング化できる。増減率は `year`＋`year_base`、フラグは `value_type='flag'`。
- **`metric_catalog` が UI選択肢・API検証・Gemini ツール記述の共通ソース**（過去プロジェクトの重複した約200行 dataOptions マップを一掃）。
- `geom` に GiST インデックス、`station_metrics` に `(metric, radius_m, year)` 複合インデックス。重い派生は materialized view。

### 5.2 空間クエリの範囲（Step1 の正直な線引き）
- **駅レベルの空間操作は PostGIS で実クエリ**：駅名検索・**bbox 絞り込み**・最寄駅・「地点から Xkm 内の駅」（`ST_DWithin`）。過去プロジェクトの「全8,000駅を毎回返す」を廃止。
- **半径内の指標集約（人口・事業所等）は 6 半径を事前計算値で提供**：メッシュの**面積按分**はパイプライン側が最も正確に算出済み（`dataset.md`）。任意半径（例「3km以内の人口」）はメッシュ幾何をPostGISに載せてオンザフライ集計する将来拡張、または固定半径間の補間で対応（Step2+）。
- ※「本物の空間クエリ」は Step1 では駅レベルに適用。指標の任意半径集約は段階的に拡張する。

---

## 6. API 設計（共通API）

`app/api` の Route Handlers は**薄いHTTPラッパ**で、実体は `src/domain`。Server Components は domain を直接呼び（HTTP往復を省略）、Client/外部/LLM は同じ契約をHTTP or function callingで叩く。

| エンドポイント | 用途 | ドメイン |
|---|---|---|
| `GET /api/metrics` | **メトリクス・カタログ**（機械可読・自己記述）| `domain/metrics` |
| `GET /api/stations?bbox=…&q=…` | 駅検索・bbox・最寄 | `domain/stations` |
| `GET /api/stations/:grp` | 駅詳細（指標・年次推移）| `domain/stations` |
| `GET /api/ranking?metric=…&prefecture=…` | ランキング | `domain/ranking` |
| `GET /api/growth?x=…&y=…&prefecture=…` | 増減率散布＋クラスタリング | `domain/growth` |
| `POST /api/chat`（**Step2**）| 自然言語 → GUI Chat Protocol | `domain/*` via `ai/tools` |

- **原則**：①生カラム名のパススルー禁止（`metric` は catalog で列挙・検証）、②応答は**意味づけ済み**（label/unit/format 付き）、③各エンドポイントを **Gemini の function calling ツール**として設計（Step2 でそのまま tool 化）。

---

## 7. リポジトリ構成（Step1 / Step2 の最適設計）

### 7.1 設計方針
1. **単一リポジトリ**（データ生成・アプリ・DB・ドキュメントを一箇所に）。個人開発規模では turborepo 等の monorepo ツールは過剰 → **素の Next.js（`src/`）＋ 併設ディレクトリ**で十分。
2. **ドメイン中心**：`src/domain` を「プロダクト」とし、`app/api`・`components`・`ai` はその薄い presentation/adapter（§3.3）。
3. **Step2 は純加算**：Step1 の `domain`・`api`・`shared` は Step2 で**無改変**。AI は `src/ai` と `app/api/chat` と chat UI を**足すだけ**で載る（これが「Step1 で Step2 を見据える」の具体形）。
4. **境界を明確に**：`pipeline`(Python) → `data/derived`(CSV) → `supabase`(投入・スキーマ) → `src`(アプリ)。ツールチェーンが違う層を混ぜない。
5. **Vercel はリポジトリ直下の Next.js をビルド**。`pipeline/`・`data/` は `.vercelignore` で除外。

### 7.2 Step1：AI-ready な基盤 ＋ アプリ公開
```
AI-Database-Map/
├── .claude/                      # Claude Code 指針（CLAUDE.md, settings）
├── docs/                         # 設計・監査ドキュメント（本書・dataset.md ほか）
├── data/                    (gitignore) 生オープンデータ ＋ derived/（成果CSV）
│
├── pipeline/                     # ① データ生成（Python）※現 script/ を発展
│   ├── notebooks/                #   create_dataset_for_AI_Database_Map.ipynb
│   ├── src/                      #   純関数（メッシュ復元・面積按分・重複排除・監査）
│   └── load_to_supabase.py       #   derived CSV → melt/正規化 → Supabase 一括投入（冪等）
│
├── supabase/                     # ② DB（Supabase CLI 規約）
│   ├── migrations/               #   バージョン管理スキーマ（stations, station_metrics, metric_catalog, PostGIS, index）
│   ├── seed.sql                  #   metric_catalog 等の初期投入
│   └── config.toml
│
├── src/                          # ③ アプリ本体（TypeScript）
│   ├── app/                      #   Next.js App Router
│   │   ├── (map)/                #     地図UIルート（page.tsx, layout.tsx）
│   │   └── api/                  #     ★共通API（Route Handlers＝薄いHTTPラッパ）
│   │       ├── metrics/          #        カタログ（自己記述）
│   │       ├── stations/         #        検索・bbox・詳細
│   │       ├── ranking/
│   │       └── growth/
│   ├── domain/                   #   ★ドメイン層＝「プロダクト」（framework非依存・pure寄り）
│   │   ├── metrics/              #      メトリクス・カタログ（単一の真実）
│   │   ├── stations/             #      駅・半径集約・空間クエリ
│   │   ├── ranking/              #      ランキング整形
│   │   └── growth/               #      増減率・散布・クラスタリング（純関数）
│   ├── db/                       #   Supabase クライアント＋型付きクエリ
│   ├── shared/                   #   Zod スキーマ・型・定数
│   │   ├── protocol.ts           #      GUI Chat Protocol (Map Edition)
│   │   ├── metrics.ts            #      指標型・単位・半径・年
│   │   └── constants.ts          #      半径・CRS 等
│   ├── components/               #   React UI（MapLibre 地図・Chart.js・ランキング・散布図）
│   └── lib/                      #   小さなユーティリティ
│
├── public/                       # 静的アセット
├── tests/                        # ドメイン純関数の単体テスト中心（境界値重視）
├── package.json / next.config.ts / tsconfig.json / vitest.config.ts
├── .env.example / .env(gitignore) / .eslintrc / .vercelignore
└── Station_Area_Database_Map/  (参考・将来削除) ／ condminium/(探索) ／ slide/(gitignore)
```

**要点**：Step1 の勝ち筋は「派手なUI」ではなく、**意味を持つ共通API ＋ ドメイン層 ＋ メトリクス・カタログ**を作り込み、UIをその薄い consumer にすること。これが Step2 を純加算にする。

### 7.3 Step2：LLM 連携（**Step1 に純加算**）
```
src/
├── ai/                           # ★Step2：LLM 層（すべて domain を再利用）
│   ├── client.ts                 #   Gemini 2.5 Flash クライアント
│   ├── tools.ts                  #   function calling ツール ＝ domain の薄いアダプタ
│   ├── system-prompt.ts          #   ドメイン説明＋GUI Chat Protocol 指示（catalog を注入）
│   └── assemble.ts               #   ツール結果 → GUI Chat Protocol 応答に組立
├── app/api/
│   └── chat/                     #   会話エンドポイント（ストリーミング。tools → domain）
└── components/
    └── chat/                     #   チャットパネル（応答を既存の地図/グラフに描画＝§4）
```
- **無改変**：`src/domain`・`src/app/api`(chat以外)・`src/shared/protocol` は Step1 のまま。
- **AIが叩くのは Step1 の共通APIと同じ domain**（別経路を作らない）。ツール記述は `metric_catalog` から自動生成 → 指標追加が UI/AI に同時反映。
- チャットUIは GUI Chat Protocol 応答を**構造化UIと同じ描画パス**で地図/グラフに反映。

### 7.4 データフロー
```
公開オープンデータ ─(pipeline: Python)→ data/derived/station_dataset.csv(499列ワイド)
   ─(load_to_supabase: melt/正規化)→ Supabase[stations, station_metrics, metric_catalog]
   ─(src/db → src/domain)→ 共通API(app/api) ─┬─→ 構造化UI(components)
                                              └─→ Gemini(ai/tools) ─→ GUI Chat Protocol ─→ UI
```

### 7.5 現状との対応
| 目標 | 現状 |
|---|---|
| `pipeline/` | **`script/`**（notebook 2本）として存在。発展的にリネーム/整理 |
| `data/`, `docs/`, `.claude/` | 既存 |
| `src/`, `supabase/`, `public/`, `tests/` | **未作成**（Step1 で新設）|
| `Station_Area_Database_Map/`, `condminium/`, `slide/` | 既存（参考・探索・資料）|

---

## 8. デプロイ・環境・セキュリティ

- **デプロイ**：Vercel（`src/app` を直下ビルド）。`pipeline/`・`data/` は `.vercelignore`。
- **環境変数**：`.env`(gitignore)。パイプラインの `ESTAT_APP_ID`、アプリの `NEXT_PUBLIC_MAPTILER_KEY`・`SUPABASE_URL`・`SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY`（サーバのみ）・`GEMINI_API_KEY`（Step2・サーバのみ）。**鍵・完全URLは出力/ログに出さない**。
- **Supabase**：**RLS 有効化**（読み取りは公開ビュー/匿名ロールに限定）、**SSL 正常化**、CORS 制限、書込は service role をサーバ側のみ。過去プロジェクトの CORS 全開放 / `rejectUnauthorized:false` を踏襲しない。
- **DB 変更**：`supabase/migrations` の**バージョン管理**のみ（`force:true` の破壊的 DROP を使わない）。投入は**バルク＋冪等 upsert**。
- **品質ゲート**：lint / typecheck / unit test（ドメイン純関数中心）を CI で必須化。

---

## 9. 関連ドキュメント

| ドキュメント | 唯一の正とする内容 |
|---|---|
| [`docs/architecture.md`](../docs/architecture.md) | **技術スタック・システムアーキテクチャ**（AIネイティブ・トポロジー／層責務／依存方向／GUI Chat Protocol／データモデル・スキーマ／共通API）・**リポジトリ構成（Step1 / Step2 の最適設計・データフロー）**・デプロイ/環境/セキュリティ |
| [`docs/dataset.md`](../docs/dataset.md) | **データセット**（駅×半径・**全499列の一覧**・収録データと集約パラダイム・CRS・命名規約・**データ特徴量を追加する定石**・次の候補）|
| [`docs/Station_Area_Database_Map.md`](../docs/Station_Area_Database_Map.md) | **過去プロジェクト（参考のみ）**（構成・API・データモデル・機能・**継承すべき点／作り直すべき点**）|
| 各データの設計・監査 | [`population_mesh.md`](../docs/population_mesh.md)（人口・将来人口）／[`land_price.md`](../docs/land_price.md)（地価）／[`bus_point.md`](../docs/bus_point.md)（バス）／[`establishment_employee.md`](../docs/establishment_employee.md)（事業所・従業者）／[`passenger_aggregation.md`](../docs/passenger_aggregation.md)（駅集約・乗降客）／[`CRS.md`](../docs/CRS.md)（座標参照系）|
| [`docs/memo.md`](../docs/memo.md) | 背景メモ（原メモ）|

---

## 10. LLM 実装方針（Step2）— プロバイダと オーケストレーション

Step2（AIネイティブ化）の LLM 層をどう作るかの設計判断。**結論を先に**：AIネイティブ性は「どのLLM／どのフレームワークか」ではなく、**§3・§6 の共通API＋メトリクス・カタログ＝ツール表面**が担保する。ゆえにプロバイダもオーケストレータも**差し替え可能な実装詳細**として `src/ai`（§7.3）に隔離する。

### 10.1 この層の要件
- 自然言語（日本語）→ **共通APIのツール呼び出し**（function calling）→ 結果を **GUI Chat Protocol（§4）** に組み立て → 地図/グラフへ描画。
- **streaming**（対話の体感）／**構造化出力**（GUI Chat Protocol＝型付きJSON）／**マルチステップのツール呼び出し**（検索→詳細→ランキング…）／**プロバイダ非依存**／**低コスト・無料枠**（個人開発）。

### 10.2 LLM プロバイダ選定
| プロバイダ / モデル | 無料枠 | 特徴 | 位置づけ |
|---|---|---|---|
| **Gemini 2.5 Flash / Flash-Lite** | **1,500 req/日・15 RPM・1M TPM**、function calling・JSON・1M文脈 | 低遅延・低コスト・日本語良好・マルチモーダル | **主（開発・本番）** |
| Claude Haiku 4.5 | 無（従量 ~$0.8/$4 per M）| **マルチターンtool-use精度が最良**（「呼ばない」判断も強い）| 精度重視時の代替 |
| GPT-4.1-mini / 4o-mini | 実質安価（4o-mini $0.15/$0.6 per M）| 安定・堅実な tool use | 汎用の代替 |
| Groq（Llama3.3-70B / Qwen / gpt-oss）| 30 RPM・1,000 req/日・超高速(≈315TPS) | 無料・高速・function calling | 開発・コスト最適 |
| OpenRouter（gpt-oss-120b/20b 等）| 20 RPM・200 req/日 | 多数モデルをルーティング | 実験・フォールバック |

- **採用**：**Gemini 2.5 Flash を主**。無料枠で開発、本番は低コスト従量。**プロバイダ非依存の抽象**の背後に置き、tool-use 精度・遅延・レート制限に応じて Claude Haiku 4.5 / GPT-4.1-mini / Groq へ即差し替え可能にする。
- ⚠️ **無料枠の注意**：Gemini 無料枠は**入出力がモデル改善に使われうる**。収録データは公開オープンデータで懸念は小さいが、**ユーザの発話**を扱う本番は**有料枠 or Vertex AI**（学習非利用）を選ぶ。鍵はサーバのみ（§8）。
- 任意で **Vercel AI Gateway**（ルーティング・フォールバック・可観測性・コスト管理）を挟むと、無料枠横断のレート制限回避や障害時フォールバックが容易。

### 10.3 オーケストレーション層の選択肢
| 方式 | 長所 | 短所 | 適合 |
|---|---|---|---|
| **Vercel AI SDK** | Next.js/Vercel 一体・**turnkey streaming／`useChat`**・**`generateObject`(Zod)＝GUI Chat Protocol**・provider非依存・multi-step(`stepCountIs`)・巨大コミュニティ | 込み入った多段フローは手続き的に書く | ◎ 既定（最速・最小リスク・スタック最適）|
| **GraphAI** | **宣言的グラフ(YAML/JSON)＝エージェント論理がデータ**・並列/ネスト/リトライ内蔵・`fetchAgent`＝共通APIをノード化・**本アーキテクチャの源流と一致** | コミュニティ小(≈371★)・新パラダイム・Next.js streaming に一手間 | ○ 宣言的な多段フロー層に採用余地大（§10.4）|
| 素の provider SDK | 依存最小 | tool ループ／stream／provider差替を自作 | △ 車輪の再発明 |
| LangChain.js / Mastra 等 | 機能豊富 | 重い・TS慣用から外れる | △ 不要 |

### 10.4 GraphAI の評価（採用余地）
GraphAI（receptron・v2系・TypeScript・v2.0.18/2026）は **非同期データフロー実行エンジン**。エージェント（`geminiAgent`/`openAIAgent`/`anthropicAgent`/`groqAgent` ＋ **`fetchAgent`＝REST APIノード**）を **YAML/JSON の宣言的グラフ**で繋ぎ、並列・map-reduce・リトライ・streaming（`streamAgentFilter` ＋ `@receptron/graphai_express` / Web Streams で SSE）を内蔵。geminiAgent は function calling 対応。

- **本アーキテクチャと親和性が高い理由**：
  - **「AIにコードでなくDSLを書かせる」**（memo）に合致 — エージェント論理が**グラフ＝データ**。将来 LLM 自身に**グラフを生成**させる発展もありうる。
  - **「API こそがプロダクト」**の知的源流（中島聡氏の AI-native 論・MulmoCast/MulmoClaude）と**同一エコシステム**。**GUI Chat Protocol** の発想もこの系譜。`fetchAgent` で**共通APIをそのままノード化**でき思想が一貫。
  - 複雑クエリ（例「A駅とB駅を人口・地価・従業者で比較」）を **並列fan-out→合成→描画**の宣言的グラフで素直に表現できる。
- **コスト/留意**：コミュニティは Vercel AI SDK より小さく、Next.js の streaming は自前配線が要る（Route Handler・**Node runtime**でエンジンを回し Web Streams で送出。鍵はサーバのみ。`@receptron/graphai_express` は Express 向けで**必須ではない**）。Edge runtime は不可（provider SDK が Node 前提）。
- **結論**：**単純な単段フローには過剰**だが、**宣言的な多段エージェント**へ進むなら有力。**ツール表面を共通APIに分離**してあるため、**低リスクに PoC でき可逆**。

### 10.5 推奨アーキテクチャ（決定）
1. **土台（最優先）**：**共通API＋メトリクス・カタログをツール表面に固める**（§3・§6）。AIネイティブ性はここが担保し、オーケストレータは差し替え可能。
2. **プロバイダ**：**Gemini 2.5 Flash を主**、**provider非依存の抽象**の背後に。フォールバックに Claude Haiku 4.5 / GPT-4.1-mini / Groq。本番の発話は有料枠/Vertex。
3. **既定オーケストレータ**：**Vercel AI SDK**（`streamText`+tools・`generateObject`(Zod)＝GUI Chat Protocol・`useChat`）で **Step2 MVP を最短で出荷**。
4. **GraphAI**：**宣言的な多段フローが要るクエリで PoC**（`fetchAgent`＝共通API、gemini/anthropic エージェント）。有効なら orchestration を GraphAI に寄せる／複雑フローだけ GraphAI・単純対話は AI SDK という**共存**も可。
5. **将来（MCP）**：共通APIを **Model Context Protocol** のツールとしても公開すれば、外部AIクライアント（Claude 等）も同一表面を使え、「API こそがプロダクト」が外部へ拡張される。AI SDK・GraphAI とも MCP を消費可能。

> **キー洞察**：ツール＝共通API に統一してあるので、**「Gemini か／AI SDK か GraphAI か」は後から変えられる**。まず **AI SDK＋Gemini** で出荷し、**GraphAI は宣言的フロー化の判断で段階導入**する。フレームワーク選定に出荷を待たせない。

### 10.6 実装の骨子（`src/ai`・§7.3）
- `tools.ts`：**共通API（`domain`）の薄いアダプタ**をツール定義に。スキーマは **`metric_catalog` から自動生成**（指標追加が UI/AI に同時反映）。
- `assemble.ts`：ツール結果 → **GUI Chat Protocol（Zod）** に組立（AI SDK の `generateObject` / GraphAI の最終ノード、どちらでも同型を出力）。
- `client.ts`：**provider 抽象**（Gemini 主・他へ差替）。鍵はサーバのみ、`app/api/chat` から呼ぶ。
- `system-prompt.ts`：ドメイン説明＋カタログ＋GUI Chat Protocol 指示。
- streaming：`app/api/chat` が Web Streams/SSE でトークンと Protocol を送出、`components/chat` が**構造化UIと同じ描画パス**で地図/グラフに反映（§4）。

### 10.7 未決事項（PoC で確定）
- Gemini 2.5 Flash の**日本語ツール選択精度**（駅名・指標の曖昧性解決）。不足なら Claude Haiku 4.5 へ。
- GraphAI を **既定にするか AI SDK 併用か**（複雑クエリ PoC の結果次第）。
- **任意半径クエリ**（§5.2）を LLM から扱う場合の集計方式（事前計算6半径＋補間 or PostGIS 幾何）。

### 10.8 参考
- GraphAI: [receptron/graphai](https://github.com/receptron/graphai)（[LLM agents](https://github.com/receptron/graphai/blob/main/agents/llm_agents/README.md) / [Streaming](https://github.com/receptron/graphai/blob/main/docs/guide/Streaming.md) / [@receptron/graphai_express](https://www.npmjs.com/package/@receptron/graphai_express)）・[GraphAI 解説(Zenn)](https://zenn.dev/singularity/articles/graphai-index)
- Vercel AI SDK: [vercel/ai](https://github.com/vercel/ai)・[AI SDK 5](https://vercel.com/blog/ai-sdk-5)・[Gemini × AI SDK 例](https://ai.google.dev/gemini-api/docs/vercel-ai-sdk-example)
- プロバイダ: [Gemini 料金](https://ai.google.dev/gemini-api/docs/pricing) / [レート制限](https://ai.google.dev/gemini-api/docs/rate-limits)・[Groq レート制限](https://console.groq.com/docs/rate-limits)・[OpenRouter 無料モデル](https://openrouter.ai/collections/free-models)
