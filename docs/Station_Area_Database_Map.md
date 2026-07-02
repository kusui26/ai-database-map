# Station Area Database Map（過去プロジェクト）— 参考資料

本書は、個人開発された既存 Web アプリ **Station Area Database Map**（リポジトリ内 `Station_Area_Database_Map/`）の構成・機能・設計を精読して記録したもの。**AI Database Map（Next.js + Supabase/PostGIS + MapLibre + Gemini による AIネイティブ再構築）を設計するための「参考資料」**であり、そのまま踏襲する対象ではない。実装方針の正は [`.claude/CLAUDE.md`](../.claude/CLAUDE.md)。

> 位置づけ：**優れたデータ資産・機能仕様・命名規約は継承し（§6）、薄いCRUD API・UI埋没ロジック・固定半径・Heroku依存は作り直す（§7）**。

---

## 1. 概要

- 公共交通オープンデータチャレンジ2024 等で発表した**稼働 MVP**。
- 目的：**駅を選ぶと周辺（半径 1/2/5/10km）の人口・乗降客・地価・バス・事業所などを一括で見られる**地図アプリ。想定ユースケースは個人の住宅購入検討、企業の出店検討。
- 構成：`backend`（Express + Sequelize + PostgreSQL）＋ `frontend`（Vue 3 + Vite + Leaflet + Chart.js）のモノレポ。ルート `package.json` から **Heroku** デプロイ（`Procfile: web: node backend/app.js`、`heroku-postbuild` でフロントをビルド）。
- データ規模：`backend/data/station_are_dataset_utf-8.csv` ＝ **8,035 駅 × 約250列**の巨大ワイドテーブル。

---

## 2. 技術スタック（新スタックとの対比）

| 領域 | 過去（Station Area DB Map）| 新（AI Database Map）|
|---|---|---|
| バックエンド | Express + Sequelize（ORM）| Next.js Route Handlers（**共通API**）|
| DB | PostgreSQL（**PostGIS 空間クエリ未使用**）| Supabase + **PostGIS 本格活用** |
| フロント | Vue 3 + Vite | Next.js App Router + React |
| 地図 | **Leaflet** + markercluster + OSM ラスタ | **MapLibre GL**（ベクター）+ MapTiler |
| グラフ | Chart.js | （踏襲候補）|
| AI | なし | Gemini 2.5 Flash（function calling）|
| ホスティング | **Heroku** | Vercel |

- ⚠️ **重要**：コード全体を精査した結果、**Gemini / MapLibre / Supabase / PostGIS 空間関数（`ST_DWithin` 等）は一切未使用**。`geometry GEOMETRY('POINT')` 列は定義のみでクエリ未使用。**半径集計は全て CSV に事前計算済みの値**を格納しているだけ。

---

## 3. バックエンド

### 3.1 起動フロー（`backend/app.js`）
- `express()` → `cors()`（**設定なしの全開放**）→ `express.json()` → `/api/stations` に `routes/stations` をマウント → `frontend/dist` を静的配信 → `app.get('*')` で SPA フォールバック。
- `PORT = process.env.PORT || 3000` で**先に `app.listen()`**、**その後**に `sequelize.sync()`（DB同期完了前に受付開始・同期失敗は `console.error` のみ）。
- 接続分岐（`config/db.js`）：`DATABASE_URL` があれば Heroku 本番（`ssl: { rejectUnauthorized:false }`）、なければローカル（`DB_HOST/USER/PASSWORD/NAME/PORT`）。

### 3.2 API エンドポイント（全て GET・`/api/stations` 配下）
`routes/stations.js` ＋ `controllers/stationsController.js`。

| メソッド・パス | 入力 | 返す内容 |
|---|---|---|
| `GET /search` | `stationName`（部分一致）| `jan_station` を `LIKE %name%` 検索 → `station_id, jan_station, lat, lng, pref_name` の配列 |
| `GET /growth-rate-data` | `prefecture, xDataColumn, yDataColumn` | 都道府県内で x,y 両方非NULLの駅（散布図用）|
| `GET /prefectures` | なし | `DISTINCT pref_name`（フロントは47県ハードコードで**実質未使用**）|
| `GET /ranking` | `prefecture, dataColumn` | 都道府県内で `dataColumn` 降順（ランキング用）|
| `GET /` | なし | **全8,000駅**の `station_id, jan_station, lat, lng`（地図マーカー用・ページングなし）|
| `GET /:station_id` | path | その駅の**全約250列**フル行 |

- ⚠️ `ranking` / `growth-rate-data` は**クエリのカラム名を直接 `col(dataColumn)` に渡す** → ①任意カラム読取・SQLインジェクション懸念、②**どのカラムが存在するかの知識がサーバに無く、フロントが全て持つ**構造。

### 3.3 データモデル（`models/stationModel.js` → テーブル `stations`）
単一モデル・**約250列のワイド非正規テーブル**（`timestamps:false`, PK `station_id`）。

| カテゴリ | 例 |
|---|---|
| 乗降者数 | `passengers_2000` … `passengers_2023`（24年分）|
| 駅属性 | `jan_station, latitude, longitude, connect_line_name/number, connect_company_name/number, pref_name` |
| 空間 | `geometry GEOMETRY('POINT')`（**定義のみ・未使用**）|
| 人口 | `population_within_{1,2,5,10}km_{2015,2020}` |
| 地価 | `average_land_price_within_{r}km_{2015..2024}` |
| バス停 | `bus_stops_within_{r}km_{2010,2022}` |
| 事業所/就業者 | `establishments_within_ / employees_within_ {r}km_{2016,2021}` |
| 将来推計人口 | `estimated_population_within_{r}km_{2020..2050}`（5年刻み）＋ `error_population_*_2020` |
| 事前計算増減率 | `rate_{metric}_{r}km` |
| 半径差分 | `{metric}_rate_{r1}km_to_{r2}km_{year}` |

- **規則的命名規約** `{metric}_within_{radius}km_{year}` / `rate_{metric}_{radius}km` が **DB列・API・UI選択肢を1:1で貫通**（＝事実上のメトリクス・スキーマ）。

### 3.4 データ投入
- `createTables.js`：`sequelize.sync({ force:true })` で**テーブルを DROP & 再作成**（破壊的・マイグレーション無し）。
- `importData.js`：単一CSV を `csv-parser` で読み、**1行ごとに `pause()`→`Station.create()`→`resume()`**（1行1INSERT・bulk/upsert無し・低速）。`geometry` は lng/lat から GeoJSON Point を組立。

---

## 4. フロントエンド（Vue 3 + Vite + Leaflet + Chart.js）

- `App.vue`（**中央オーケストレータ・状態集約**）：`selectedStationData`・各モーダル表示フラグ・`selectedRadius`（既定2km）を保持。駅クリック → `GET /:id` → グラフモーダル＋`drawCircle()`。子コンポーネントを **`$refs` 経由で命令的に直接呼ぶ**（密結合）。
- `MapView.vue`：Leaflet 初期化（東京中心・OSMタイル）。`GET /` で**全駅マーカーを markerClusterGroup に投入**。検索は `/search`。
- `Header.vue`：タイトル＋4ボタン（このアプリ/データについて/ランキング/増減率グラフ）＋半径セレクト（1/2/5/10km）。
- `StationGraphModal.vue` + `StationGraph.vue`：Chart.js の折れ線6種（乗降者数・人口(実測+予測)・地価・バス停・事業所・就業者）。`population_within_${radiusKey}_${year}` のように**キーを動的合成**して抽出。
- `RankingModal.vue`：**47県ハードコード**＋日本語ラベル→カラム名の**約200行の巨大マップ**（computed）→ `/ranking` → 上位/下位20。`formatValue` で %/カンマ/四捨五入を**フロントで判定**。
- `GrowthRateGraphModal.vue`：2軸の rate 系を選び `/growth-rate-data` → 散布図。**k-means(k=4) を手書きでクライアント実装**。`dataOptions` は RankingModal と**ほぼ丸ごと重複**。
- `StationSelectionModal.vue`（同名駅選択）、`AboutModal.vue`/`DataModal.vue`（静的説明・出典 odpt / MLIT / e-Stat）。

---

## 5. 提供機能（ユーザー体験）

1. **駅クリック → 周辺データ一括表示**：選択半径（1/2/5/10km）における乗降者数・人口（実測＋2050までの将来推計）・地価・バス停数・事業所数・就業者数の**年次推移グラフ**、運行事業者・路線名。地図に半径円を描画。
2. **ランキング**：都道府県 × 指標で**上位/下位20駅**を表形式（増減率%・実数を切替）。
3. **増減率の散布図**：都道府県内で任意の2つの増減率指標を XY 軸に取り、**4グループにクラスタリング**した散布図。駅検索でハイライト。
- 補助：駅名の部分一致検索、半径トグル。

---

## 6. 継承すべき点（AI Database Map へ）

- **データ資産そのもの**：8,000駅 × 多指標 × 多年次 × 半径、将来推計2050含む。出典明確（odpt / MLIT / e-Stat）。**本アプリの中核価値**。
- **3つのコア機能**（駅別トレンド／都道府県ランキング／増減率散布図＋クラスタリング）を**製品仕様として継承**。
- **規則的メトリクス命名規約** `{metric}/{radius}/{year}` を**概念スキーマ**として継承（ただし格納は列でなく行/カタログに）。
- **層分離**（routes/controllers/models）→ Next の Route Handlers ＋ service 層へ写像可。
- **PostGIS geometry(POINT) の素地**（緯度経度保持）＝本物の空間クエリへ拡張する土台。
- **事前計算による軽い読み取り**の思想（→ materialized view / 事前集計テーブルとして、ただし**クエリ可能な形**で）。
- Chart.js 可視化、`/api` dev プロキシ、SPA配信の考え方。

---

## 7. 作り直すべき点（AIネイティブ再構築）

- **約250列のワイド非正規テーブル → 正規化 or JSONB ＋ メトリクス・カタログ表**（`station_metrics(station_id, metric, radius_m, year, value)` 等）。指標・半径・年の追加を**マイグレーション無しのスキーマ変更に頼らず**行う。
- **CSV焼き込みの固定半径（geometry未使用）→ 本物の空間クエリ**（`ST_DWithin`/`ST_Distance`/ポリゴン）。任意地点・任意半径・任意ポリゴンに対応（自然言語ジオクエリの基盤）。
- **生カラムパススルーのCRUD → 意味を持つ共通API ＋ メトリクス・レジストリ**：列挙・検証済みの型付きパラメータでインジェクションを排除し、**API を自己記述的に**（利用可能な指標・半径・年・単位・ラベルを機械可読で返すカタログ・エンドポイント）。→ Gemini の **function calling ツール**として設計。
- **UI埋没ロジックをサーバへ引き下ろす**：k-means クラスタリング・値フォーマット（%/カンマ/四捨五入）・指標選択肢マップ・半径→キー変換・都道府県リストは、すべて**共通API/ドメイン層**へ。→ 人間UIと Gemini が**同一エンドポイント・同一意味の応答**を消費できるようにする（**AIネイティブの核心**）。
- **地図を MapLibre GL（ベクター）へ**：駅は GeoJSON/ベクタータイル ＋ **サーバ側 bbox 絞り込み/クラスタリング**（`GET /` で毎回8,000行返す方式を廃止）。
- **Supabase 化**：RLS・**バージョン管理マイグレーション**・コネクションプーリング・SSL正常化・CORS制限・シークレットは環境変数。
- **インポート刷新**：バルクロード/COPY・**冪等 upsert**、`force:true` の破壊的DROPをやめ seed + migration へ。
- **バリデーション（Zod等）・エラーハンドリング・テスト・ページング**を追加（過去はいずれも不在）。
- **重複排除**：単一のメトリクス・カタログを UI/API で共有（約200行マップと47県配列の複製を解消）。
- **密結合の解消**：`App → MapView` の `$refs` 命令呼び出し等をやめ、疎結合な状態管理へ。

---

## 8. 移行方針の結論

> **「データ・機能仕様・命名規約は継承。意味を持たない薄いCRUD API と UI埋没ロジックは、AI と人間が対等に叩く共通API層へ再設計」**。

過去プロジェクトは human-UI 専用の薄いAPIであり、**「人間UIとAIが同じ意味づけされた共通APIを通る」という AIネイティブ要件を満たしていない**点が最大の作り直しポイント。データ資産と製品仕様（3コア機能）という強みを土台に、**意味を持つ共通API・本物の空間クエリ・正規化スキーマ・MapLibre/Supabase/Vercel** で作り直す。

---

*関連：[`.claude/CLAUDE.md`](../.claude/CLAUDE.md)（AI Database Map 開発指針・正）, [`architecture.md`](./architecture.md), [`memo.md`](./memo.md)*
