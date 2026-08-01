# ランキングに散布図と同じ絞り込み（運営会社・路線・事業者種別）を入れる（実装プラン）

作成日: 2026-08-01 ／ 対象: DB（RPC）・共通API・ランキングモーダル・AI ツール
／ 依頼: 「散布図に実装したフィルタリングの内容をランキングにも反映してほしい」

> §1–§8 が調査と設計、**§9 が確定した決定事項**（2026-08-01 ユーザー承認）、§10 が実装結果。
> 数値はすべて 2026-08-01 の実測。

---

## 0. エグゼクティブサマリ（結論先出し）

- **追加するのは 3 つ**：`operators`（運営会社）・`routes`（路線）・`routeTypes`（事業者種別）。都道府県と ⚠除外はランキングに既にある。
- **散布と決定的に違う点：ランキングは絞り込みを SQL に押し込むしかない。** 散布は全件取得してドメイン層で絞れるが、ランキングは **`total`（総件数）と `limit/offset`（もっと見る）を SQL で計算**しているため、`rank_by_column` RPC 自体に条件を足さないと**件数が嘘になる**。
- **絞り込みの意味は散布とまったく同じにできる**。`values_for_columns` に入れた述語（会社×路線を**同じ行**で判定する EXISTS）をそのまま使う。ただし**同じ 20 行の微妙な SQL を 2 か所に複製するのは避ける**（§3）。
- **UI は 1 段に入らない**。実測：ランキングの段A は内寸 **640px を使い切っており余白 0px**。追加したい 2 ボタンは **全社 68px・全路線 82px**（＋gap 16px）で **166px 不足**する。→ **絞り込みを独立した段にする**のを推奨（§4）。
- **性能は問題なし**。フィルタ付きの集計を実測して **86–294ms**（現行の全国集計 294ms と同等）。
- **ゴールデン値も確定済み**（§7）。例：`pax_2024 × 東海旅客鉄道 × 新幹線` = **17**、`× 東北新幹線` = **0**（誤ヒット検査）、`pax_2024` 全国 = **7,398**（非回帰）。

---

## 1. 現状（実装の所在）

| レイヤ | ランキング | 散布（実装済み） |
|---|---|---|
| DB | `rank_by_column(column_key, prefs, dir, lim, off, exclude_lown)` | `values_for_columns(column_keys, prefs, **ops, routes, route_types**)` |
| db | `rankByColumn()` | `valuesForColumns()` |
| API | `GET /api/ranking?metric&prefecture&order&limit&offset&excludeLowN` | `GET /api/growth?...&operators&routes&routeTypes` |
| domain | `buildRanking()` → `rankingPanel()` | `buildGrowth()` → `scatterPanel()`（タイトルに絞り込みを併記）|
| UI | `RankingDialog` → `MetricPicker`（段A/段B）| `ScatterDialog`（絞り込み行＋X/Y 行）|
| 連動 | なし | `operatorLink.ts` / `routeLink.ts`（都道府県⇄会社⇄路線）|
| AI | `rankStations`（operators なし）| `compareGrowth`（operators/routes/routeTypes あり）|
| 昇格 | `Promotion.ranking`（metricKey/prefectures/order/excludeLowN）| `Promotion.scatter`（＋operators/routes/routeTypes）|

**ランキングだけ取り残されている**のが現状で、AI から「東海旅客鉄道の新幹線駅で乗降客数ランキング」が出せない。

---

## 2. 設計の核心：ランキングは SQL に押し込むしかない

散布（`/api/growth`）は **全件を取ってドメイン層で pivot・除外**している。対してランキングは：

```sql
ranked as (
  select b.*, row_number() over (...) as rank,
         count(*) over () as total          -- ← 総件数を SQL で数えている
  from base b )
select ... from ranked order by rank limit lim offset off   -- ← ページングも SQL
```

- `total` は「もっと見る」の残件数表示（`N / M 件`）と `canLoadMore` の判定に使われる。
- したがって**絞り込みを `base` に入れない限り、total も rank も間違う**。アプリ層で後から間引くのは不可（ページ境界が壊れる）。

→ **`rank_by_column` に `ops / routes / route_types` を足す**。引数の数が変わるため **drop → create → grant** が必須（PostgREST は同名の多重定義を解決できない。`operators_filter` の migration と同じ手順）。

---

## 3. SQL の DRY：述語を 2 か所に複製しない

`values_for_columns` の絞り込みは**微妙な仕様**を含む（`docs/260730_scatter_plot_routes.md` §4.1）：

- 路線・種別が**未指定**なら、会社は従来どおり `stations.operators` を「・」分割で判定（既存挙動の保存）。
- 路線・種別が**指定**されたら、会社も `station_routes` の**同じ行**で判定する。
  東京駅は JR東海の東海道新幹線と JR東日本の東北新幹線を持つため、独立に AND すると
  **「東海旅客鉄道 × 東北新幹線」が誤ヒットする**（実測 0 件であるべき）。
- `routes` と `route_types` は **OR**。

この 20 行を `rank_by_column` にコピーすると、**片方だけ直して仕様がズレる**典型的な温床になる（CLAUDE.md §3 DRY）。

### 3.1 案の比較

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | `station_matches_filters(station_id, operators, ops, routes, route_types) returns boolean` を新設し、両 RPC から呼ぶ | **述語が 1 か所**。単純な SQL 関数なので Postgres が**インライン展開**でき、性能劣化を招きにくい。仕様変更が 1 か所で済む |
| B | `rank_by_column` に述語をコピー | 追加ファイルは要らないが、**同じ仕様が 2 か所**に。将来「会社の別名対応」等を入れるとき必ず片方を忘れる |
| C | 絞り込み後の `station_id` を返すビュー/CTE を共有 | 引数付きの共有はビューでは書けず、結局関数になる |

> 案 A では `values_for_columns` も作り直す（＝**既存の動いている関数に手を入れる**）。リスクは §7 の**非回帰ゴールデン 6 件**（散布側の既存値）で担保する。

---

## 4. UI 設計（実測に基づく）

### 4.1 実測：現状の段A は余白ゼロ

ランキングのダイアログは **672px（`max-w-2xl`）**、段A の内寸は **640px**。

| コントロール | 実測幅 |
|---|---:|
| 全国（都道府県）| 68px |
| カテゴリ | 126px |
| 変種（年・`flex-1`）| **245px** |
| 上位/下位 | 106px |
| ⚠除外 | 63px |
| **合計（gap 8px×4 込み）** | **640px ＝ 余白 0px** |

追加したいのは **全社 68px**・**全路線 82px**（散布での実測）＋gap 16px＝**166px**。
`flex-1` の変種セレクトが 245px → **79px** に潰れ、「2020年→2015年・2km圏」が読めなくなる。
→ **1 段に 7 コントロールは成立しない。**

### 4.2 案の比較（いずれも実測ベース）

| 案 | 変更 | 変種セレクト幅 | 表の可視行数 | 備考 |
|---|---|---:|---:|---|
| **A（推奨）：絞り込みを独立した段に** | 段A＝`[カテゴリ][変種][上位/下位][⚠除外]`／**新設段＝`[全国][全社][全路線]`** | 245 → **321px** | 15 → **14 行** | **散布と同じ構造**（絞り込み行と指標行を分ける）。672px 据え置き＝PR #37 の「非対称案」の判断を維持 |
| B：ダイアログを 896px に広げる | 1 段のまま 7 コントロール | 245 → **303px** | **15 行**（維持）| 表は横に伸びるだけで情報は増えない。PR #37 で「ランキングは据え置き」と決めた判断を覆す |
| C：A＋B の両方 | 広げた上で段も分ける | さらに広い | 15 行 | 今回の要件に対して過剰 |

- 可視行数は **86vh=774px**・表の可視領域 **569px**・行高 **37px** から算出（1 段＝34px＋gap 8px＝42px 増）。
- **推奨は A**。理由は 3 つ：(1) 散布と構造が揃い「どこを・どの会社を・どの路線を」が 1 行に集まる、(2) 変種セレクトが**今より広くなる**（245→321px）、(3) 幅の判断（#37）を覆さない。失うのは**可視 1 行**のみ。

### 4.3 連動（グレーアウト）も散布と同じにする

`operatorLink.ts`（都道府県⇄会社）・`routeLink.ts`（会社⇄路線）は**純関数**で、散布に依存していない。
ランキングでも同じ体験（0 件になる組合せを出さない・「この会社の都道府県を選択」ボタン）を提供するため、
**`src/components/scatter/` から `src/components/metrics/` へ移し、両ダイアログで共有する**（テスト名も追随）。
※ ESLint の依存方向ルールは `domain → UI` を禁じているだけで、`components` 内の共有は問題ない。

---

## 5. ドメイン側の共有

- **パネルタイトル**：散布は `scatterPanel` が `（全国・東海旅客鉄道・新幹線）` を併記する。ランキングも同じにする
  （例：`乗降客数（2024年）（全国・東海旅客鉄道・新幹線・上位）`）。
  現在 `scopeLabel()` は `src/domain/growth/panel.ts` の private 関数なので、
  **`src/domain/scope.ts` に切り出して両パネルで共有**する（DRY・表記ゆれ防止）。
- **API 契約**：`rankingQuerySchema` / `rankingResponseSchema` に `operators` / `routes` / `routeTypes` を追加。
  応答にも載せることで、⤢ 昇格・チャット内カード・AI の要約が「何で絞ったか」を保持できる。

---

## 6. 変更範囲

| レイヤ | ファイル | 変更 |
|---|---|---|
| DB | `supabase/migrations/<ts>_ranking_filter.sql`（新規）| `station_matches_filters()` 新設／`values_for_columns` を作り直して呼び出しに置換／`rank_by_column` に `ops・routes・route_types` を追加（drop→create→grant）|
| db | `src/db/queries.ts` | `rankByColumn(..., operators, routes, routeTypes)` |
| shared | `src/shared/api.ts` | `rankingQuerySchema` / `rankingResponseSchema` に 3 項目 |
| domain | `src/domain/scope.ts`（新規）・`growth/panel.ts`・`ranking/{presenter,panel}.ts` | `scopeLabel` を共有し、ランキングのタイトルにも併記 |
| API | `src/app/api/ranking/route.ts` | クエリ受理（`listParam` は growth と同じ書き方）|
| UI | `src/components/metrics/{operatorLink,routeLink}.ts` | `scatter/` から移設（内容は無変更）|
| UI | `src/components/ranking/MetricPicker.tsx` | 絞り込み段を新設し、会社・路線セレクタと連動を配置 |
| UI | `src/components/ranking/{RankingDialog,useRanking}.ts(x)` | 状態・SWR キー・`RankingInitial` に 3 項目 |
| AI | `src/ai/tools.ts` | `rankStations` に `operators` / `routes` / `routeTypes`（`compareGrowth` と同じ記述・0 件時の note も同じ）|
| チャット | `stores/chatStore.ts`・`chat/panelGroups.ts`・`chat/PromotionHost.tsx` | ⤢ 昇格で 3 項目を引き継ぐ |
| テスト | `tests/` | ランキング presenter/panel・URL 組立・昇格・連動（移設に追随）|

**無改変**：`src/shared/protocol.ts`・散布の UI・カタログ。

---

## 7. 検証計画（ゴールデン値は実測済み）

### 7.1 SQL ゴールデン（`/api/ranking` の `total` と突合）

| # | ケース | 期待 `total` |
|---|---|---:|
| 1 | `pax_2024`（全国）**非回帰** | **7,398** |
| 2 | `pop_gr_2020_2015_1km`（全国）**非回帰** | **9,234** |
| 3 | `pax_2024 × 東海旅客鉄道` | **411** |
| 4 | `pax_2024 × 新幹線（種別1）` | **102** |
| 5 | **`pax_2024 × 東海旅客鉄道 × 新幹線`（依頼の主眼）** | **17** |
| 6 | `pax_2024 × 路線=東海道新幹線` | **17** |
| 7 | **`pax_2024 × 東海旅客鉄道 × 東北新幹線`（誤ヒット検査）** | **0** |
| 8 | `pax_2024 × 路線=本線`（会社未指定＝10 社ぶん）| **304** |
| 9 | `rate_covid × 東海旅客鉄道 × 新幹線`（⚠除外 ON）| **17** |
| 10 | `pop_gr_2020_2015_1km × 東京地下鉄` | **144** |
| 11 | `pax_2024 × 静岡県 × 新幹線` | **6** |

※ 9 が 17（除外 0）になるのは PR #43 の修正後の正しい姿。

### 7.2 散布側の非回帰（`values_for_columns` を作り直すため）

`docs/260730_scatter_plot_routes.md` §10.3 の **14 ケース**をそのまま再実行し、全一致を確認する
（全社 7,680／JR東日本 854／東京地下鉄 143／OR 969／京成 69／札幌市 46 ほか）。

### 7.3 その他

| # | 項目 | 合格条件 |
|---|---|---|
| 12 | ページング | 絞り込み時に `N / M 件` と「もっと見る」が正しい（M＝§7.1 の total・末尾で消える）|
| 13 | UI 配置 | 絞り込み段が `[全国][全社][全路線]`・**折返しなし**（672px）／変種セレクトが 321px に広がる |
| 14 | 連動 | 東海旅客鉄道で路線候補 13 本／新幹線で会社候補 5 社（散布と同じ） |
| 15 | タイトル | `…（全国・東海旅客鉄道・新幹線・上位）` |
| 16 | AI | `EVAL=1`（23 問）維持＋追加 1 問（「東海旅客鉄道の新幹線駅で乗降客数ランキング」→ `rankStations{operators,routeTypes}`）|
| 17 | 性能 | フィルタ付きで **300ms 以内**（実測 86–294ms）|
| 18 | 品質ゲート | typecheck / lint / test / build すべて green・console error 0 |

---

## 8. 段階分割

| 案 | 内容 | 評価 |
|---|---|---|
| **1 PR（推奨）** | DB → API → UI → AI をまとめて | データ生成が無く、DB 変更は関数 3 本のみ。§7.1・§7.2 のゴールデンで一度に担保できる |
| 2 PR | ①DB＋API ②UI＋AI | 切り戻しやすいが、①だけでは UI から確認できず、路線 PR1/PR2 のときのような「UI 未変更で数値保証」の利点も小さい |

---

## 9. 決定事項（2026-08-01 ユーザー承認）

| # | 決定 |
|---|---|
| 1 | **UI レイアウトは「絞り込みを独立した段に」**（672px 据え置き・可視 15→14 行・変種セレクトは 245→321px）|
| 2 | **SQL の述語は `station_matches_filters()` に切り出して両 RPC で共有**（非回帰は §7.2 のゴールデン 14 件で担保）|
| 3 | **`rankStations` にも `operators` / `routes` / `routeTypes` を足す** |
| 4 | **パネルタイトルに絞り込みを併記**（`scopeLabel` を `domain/scope.ts` に共有）|
| 5 | **連動モジュールを `scatter/` → `metrics/` へ移設**して両ダイアログで共有 |
| 6 | **⚠除外の既定値を散布と揃えて ON にする**（推奨は「対象外」だったが、**揃える**方針を採用）|
| 7 | **1 PR** |

### 9.1 決定 6 の影響（既定値を ON に変える）

ランキングの ⚠除外は今まで既定 OFF だった。散布（PR #40 で ON）と揃えることで、
**同じデータを見ているのに 2 画面で母集団が違う**という食い違いが無くなる。

- 変えるのは **UI の初期値だけ**（`RankingDialog` の `useState`）。API の既定（`excludeLowN` 省略時＝false）と
  AI ツールの既定は**据え置く**——散布側も UI だけが ON で、API/AI は明示指定に従う設計のため。
- チャットからの ⤢ 昇格は `initial` を優先するので、**AI が実際に使った条件がそのまま反映される**（変更なし）。
- 既定の見え方が変わる指標の例：`rate_covid` は 7,684 → **7,599 件**（低分母 85 件が既定で落ちる）。
  PR #43 の修正後なので、**被覆<100% の大駅（新宿・横浜など）は落ちない**。

---

## 10. 実装結果（2026-08-01・ブランチ `feat/ranking-filter`）

### 10.1 変更内容

| レイヤ | 変更 |
|---|---|
| DB | `20260801123509_ranking_filter.sql`：**`station_matches_filters()` を新設**し、`values_for_columns` と `rank_by_column` の両方から呼ぶ（述語は 1 か所）。`rank_by_column` は引数が増えるため drop→create→grant |
| db | `rankByColumn(..., operators, routes, routeTypes)`（既定は空＝絞らない）|
| shared | `rankingQuerySchema` / `rankingResponseSchema` に 3 項目 |
| domain | **`src/domain/scope.ts`（新規）**：`scopeLabel()` を散布とランキングで共有。`buildRanking` に `RankingOptions` |
| API | `/api/ranking` が `operators` / `routes` / `routeTypes` を受理（`listParam` は growth と同じ書き方）|
| UI | **`useStationFilters`（新規）**：絞り込み 4 条件の状態と連動を 1 か所に。**`StationFilterControls`（新規）**：3 セレクタの並びを共有 |
| UI | `operatorLink.ts` / `routeLink.ts` を `scatter/` → `metrics/` へ移設（内容は無変更・テスト名も追随）|
| UI | `MetricPicker` を 3 段構成に（段A＝絞り込み／段B＝指標・並び・⚠除外／段C＝半径）。`RankingDialog` は ⚠除外の既定を **ON** に |
| AI | `rankStations` に 3 項目（0 件時の note も `compareGrowth` と同じ）。eval に 1 問追加（23 → 24 問）|
| チャット | ⤢ 昇格で 3 項目を引き継ぐ（`routeTypes` は整数のみ通す型ガード）|

**`ScatterDialog` も共有フックに載せ替えた**ため、散布側の連動コードは 40 行減った（挙動は不変・§10.3 で確認）。

### 10.2 DB 適用（本番・`supabase db push`）

適用済み。**述語の共有で意味が変わっていないこと**を、旧述語（インライン）と新述語（共有関数）の
**14 通りの組合せ全数照合**で確認した（絞りなし 9,257／会社 1,672／京成電鉄 69／札幌市 46／
新幹線 103／本線 307／会社×路線の誤ヒット 0 ほか）——**14/14 一致**。

### 10.3 検証結果

| 区分 | 結果 |
|---|---|
| §7.1 ランキングのゴールデン | **11/11 一致**（RPC 直叩き・`/api/ranking` の両方）。`pax_2024 × 東海旅客鉄道 × 新幹線` = **17**／`× 東北新幹線` = **0**／全国 **7,398**（非回帰）|
| §7.2 散布の非回帰 | ヘッドレス **18/18 PASS**（路線フィルタ一式）＋ **7/7 PASS**（PR #43 のフラグ恒久対応）|
| §7.3 UI | ヘッドレス **14/14 PASS** |
| 性能 | フィルタ付きで **171–648ms**（現行の全国集計と同等） |
| 品質ゲート | typecheck ✅ ／ lint ✅ ／ test ✅ **253 passed**（244 → +9）／ build ✅ |

UI の実測は**プランの見積りどおり**だった：

- 絞り込み段は `[全国][全社][全路線]` の順で **1 行・行高 34px・折返しなし**
- ダイアログは **672px 据え置き**
- 変種セレクトは 245 → **321px**（プランの予測値と一致）
- ⚠除外は**既定 ON**（散布と一致）
- 絞り込み時の件数表示 **17 / 17 件**・「もっと見る」は出ない → 解除で戻り **100 / 9,094 件**
- パネルタイトル：`人口増減率（2015→2020年・1km圏）（全国・東海旅客鉄道・新幹線・上位）`
- console error **0**

### 10.4 決定 6（⚠除外の既定 ON）の実測

既定の全国ランキング（`pop_gr_2020_2015_1km`）は **9,234 → 9,094 件**（低分母 140 件が既定で落ちる）。
PR #43 の恒久対応後なので、**被覆<100% の大駅（新宿・横浜など）は落ちない**。
