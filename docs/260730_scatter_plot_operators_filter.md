# 散布図に「運営会社」フィルタを追加（実装プラン）

作成日: 2026-07-30 ／ 対象: 散布モーダル（`ScatterDialog`）と `/api/growth` の系統 ／ 依頼: 「散布図を運営会社名で絞り込めるように。**全国の右隣**に置き、**低分母（⚠）を除外はその分右へ**」

> §1–§7 が調査と設計、**§8 が確定した決定事項、§9 が実装結果（2026-07-30 実装・検証済み）**。ブランチ `feat/scatter-operators-filter` → PR（マージはユーザー）。

---

## 0. エグゼクティブサマリ（結論先出し）

- **データの実態**：運営会社は **181 社**、複数社が乗り入れる駅グループは **432 件**、最小でも 2 駅・最大は東日本旅客鉄道 1,680 駅。上位 10 社で延べの **56%** を占める（`data/derived/station_dataset.csv` 実測）。
- **絞り込みは DB（RPC）で行うのが唯一現実的**：散布の点は `values_for_columns` RPC が返すが、**応答にも全駅 GeoJSON にも `operators` は含まれない**（geojson の properties は grp/name/pax のみ）。クライアント側では絞れない。
- **会社一覧は新 RPC ＋ `GET /api/operators`** で供給する（自己記述 API の原則。UI と AI が同じ表面を使う）。
- **47 件の都道府県とは UI 要件が違う**：181 件あるため、複数選択ポップオーバーに**検索ボックス**と**駅数の多い順**の並びが要る。
- **純加算ではない**：DB（migration）・`src/db`・`src/shared`・`src/domain`・共通 API・UI を縦断する機能追加。`architecture.md` §7.3 の「Step2 は純加算」は AI 層の話で、機能追加は対象外（[`plan_house_hunting.md`](./plan_house_hunting.md) §6.1 と同じ整理）。
- **AI にも同じ絞り込みを**（推奨）：`compareGrowth` ツールに `operators` を足せば、「JR東日本の駅だけで人口増減率と乗降回復を比べて」が会話からも通る。**人間 UI と AI が同じ API を叩く**という本プロジェクトの中核原則（`.claude/CLAUDE.md` §2）に沿う。

---

## 1. UI の配置（依頼どおり）

散布モーダル 1 段目の並びを変更する（X軸・Y軸の行は不変）。

```
現状：  [全国 ▾]  [☐ 低分母（⚠）を除外]
変更後：[全国 ▾]  [運営会社 ▾]  [☐ 低分母（⚠）を除外]
```

- 「運営会社 ▾」は**未選択＝「全社」**表示。1–2 件は社名を連結、3 件以上は「東日本旅客鉄道 他N件」（都道府県セレクタと同じ文法）。
- 幅 896px の 1 段目には十分な余白があり、**折返しは発生しない見込み**（現状の 1 段目は「全国」＋チェックボックスのみ）。実装後にヘッドレスで確認する。
- ランキングモーダルは**今回対象外**（将来の選択肢として §8-5）。

---

## 2. データの実態（実測・`station_dataset.csv` 9,273 駅）

| 指標 | 値 |
|---|---|
| 運営会社の異なり数 | **181 社** |
| 複数社が乗り入れる駅グループ | **432 件**（`operators` が `・` 連結） |
| `operators` が空の駅 | **0 件** |
| 駅数 ≥100 の会社 | 14 社 ／ ≥50: 30 社 ／ ≥10: 140 社 |
| 最小 | 2 駅（高尾登山電鉄・鞍馬寺 など） |
| 上位 | 東日本旅客鉄道 1,680／西日本旅客鉄道 1,186／九州旅客鉄道 572／北海道旅客鉄道 459／東海旅客鉄道 412／近畿日本鉄道 287／名古屋鉄道 276／四国旅客鉄道 262／東武鉄道 206／東京地下鉄 144 |

**含意**

1. 181 件は一覧をスクロールさせるには多い → **検索ボックス必須**、既定の並びは**駅数の多い順**（上位 10 社で 56% を占めるため、多くのユースケースは検索なしで届く）。
2. 社名は**正式名称**（「東日本旅客鉄道」であって「JR東日本」ではない）。ユーザーが「JR」で検索してもヒットしない。→ 既定の並びで JR 各社が先頭に来るため実用上は困らないが、**別名（読み・略称）対応は将来課題**として記録する。
3. 複数社の駅（432 件）は、**選択したどれか 1 社でも含めば対象**（OR）とする。

---

## 3. 「どこで絞るか」の比較

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | `values_for_columns` RPC に `ops text[]` を足し、**DB で絞る** | 転送量が減る（例：東日本旅客鉄道のみなら約 1/5）。**AI ツールからも同じ絞り込みが使える**。9,273 行のスキャンで十分速い（現状の全国集計が 0.86–1.31s） |
| B | 応答の各点に `operators` を載せ、**クライアントで絞る** | 全国 7,680 点で **+150KB 程度**（社名文字列の重複）。AI からは使えない。→ **却下** |
| C | サーバで `stations` を別途引いて突合 | 追加クエリが 1 本増え A より遅い。利点なし → **却下** |

**一致の意味**：`operators` を `・` で分割した**配列と選択配列の重なり**（`string_to_array(s.operators,'・') && ops`）＝**完全一致の OR**。部分一致（`like`）は「東京都」と「東京都交通局」のような包含関係で誤ヒットしうるため採らない。

---

## 4. 「会社一覧をどこから得るか」の比較

UI のセレクタには 181 社の一覧が要る。カタログ（`catalog.json`）は**指標**の単一の真実であり、駅属性である `operators` は含まれない。

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | 新 RPC `operator_names()`（社名＋駅数）＋ **`GET /api/operators`**（`Cache-Control` 1 日） | 自己記述 API の原則に合致（`architecture.md` §6）。DB と常に同期。**AI からも参照可能**。実装は RPC 十数行＋ルート十数行 |
| B | パイプラインで静的 JSON を生成しコミット | 追加クエリ 0 だが、**データ再生成のたびに再生成が必要**で DB と乖離しうる。カタログと違い「契約」ではなく「実データの要約」なので、コードに焼くのは筋が悪い |

---

## 5. 変更範囲（ファイル別）

| レイヤ | ファイル | 変更 |
|---|---|---|
| DB | `supabase/migrations/<ts>_operators_filter.sql`（新規） | ①`values_for_columns` を **drop → 3 引数で再作成**（`ops text[] default null`）。②`operator_names()` を新設。③両者に `grant execute`（anon/authenticated） |
| db | `src/db/queries.ts` | `valuesForColumns(keys, prefectures, operators)` に拡張／`operatorNames()` を追加（Zod 検証） |
| shared | `src/shared/api.ts` | `growthQuerySchema` に `operators`、`growthResponseSchema` に `operators`、`operatorsResponseSchema` を追加 |
| shared | `src/shared/constants.ts` | `prefectureLabel` を汎用 `selectionLabel(items, emptyLabel)` に切り出し（`prefectureLabel` は薄いラッパで後方互換）。運営会社は空＝「全社」 |
| domain | `src/domain/growth/presenter.ts` | `GrowthOptions.operators` を受け、応答に載せる（**絞り込み自体は DB 側**） |
| domain | `src/domain/growth/panel.ts` | パネルのタイトルに運営会社を反映（例「…（千葉県・東日本旅客鉄道）」）＝**何を見ているかが図に残る** |
| API | `src/app/api/growth/route.ts` | `operators` クエリを受理（`,` 区切り） |
| API | `src/app/api/operators/route.ts`（新規） | 会社一覧（駅数降順）・1 日キャッシュ |
| UI | `src/components/metrics/OperatorMultiSelect.tsx`（新規） | 検索付き複数選択ポップオーバー（`PrefectureMultiSelect` を土台に、検索と件数表示を追加） |
| UI | `src/components/scatter/ScatterDialog.tsx` | 「全国」の右隣に配置し、⚠除外を右へ。選択状態を保持 |
| UI | `src/components/scatter/useGrowth.ts` | SWR キーに `operators` を含める |
| AI（任意・推奨） | `src/ai/tools.ts` | `compareGrowth` に `operators`（会話からも絞り込める） |
| テスト | `tests/` | ラベル純関数・domain（タイトル/オプション）・API スモーク・（AI を変える場合）eval |

**URL 同期はしない**：x/y・都道府県と同じくモーダルのローカル状態に留める（現行方針を踏襲）。

---

## 6. 実装の骨子

### 6.1 migration（PostgREST のオーバーロード曖昧回避に注意）

```sql
-- 既存の 2 引数版を必ず drop（残すと PostgREST が候補を一意に決められず 300 系エラーになる）
drop function if exists public.values_for_columns(text[], text[]);

create function public.values_for_columns(
  column_keys text[], prefs text[] default null, ops text[] default null
) returns jsonb language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'grp', s.grp, 'station_name', s.station_name, 'key', mc.key, 'value', v.value)), '[]'::jsonb)
  from public.metric_columns mc
  join public.station_values v on v.column_id = mc.id
  join public.stations s on s.id = v.station_id
  where mc.key = any(column_keys)
    and (coalesce(cardinality(prefs), 0) = 0 or s.prefecture = any(prefs))
    and (coalesce(cardinality(ops), 0) = 0
         or string_to_array(coalesce(s.operators, ''), '・') && ops)
$$;

create function public.operator_names()
returns table(name text, station_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select o.name, count(*)::bigint
  from public.stations s,
       lateral unnest(string_to_array(coalesce(s.operators, ''), '・')) as o(name)
  where o.name <> ''
  group by o.name
  order by count(*) desc, o.name
$$;
```

- 動的 SQL なし・`security invoker`・`search_path=''` の既存方針を踏襲。
- 索引は当面**不要**（9,273 行）。遅ければ `create index ... using gin (string_to_array(operators,'・'))` を追加。

### 6.2 UI（`OperatorMultiSelect`）

- `PrefectureMultiSelect` と同じ骨格（ポップオーバー＋チェックボックス＋外側クリックで閉じる）に、
  **①検索入力**（社名の部分一致・前方一致優先）、**②駅数の表示**（「東日本旅客鉄道 1,680」）、**③駅数降順**を追加。
- 一覧は `GET /api/operators` を SWR で取得（1 日キャッシュ・モーダルを開いたときだけ）。
- ボタン表示：未選択「全社」／1–2 社は連結／3 社以上「東日本旅客鉄道 他2件」。

### 6.3 パネルタイトル

`scatterPanel()` のタイトルを「`x` × `y`（**都道府県・運営会社**）」に。例：
`人口増減率（2015→2020年・2km圏） × 乗降客数 コロナ前後増減率（千葉県・東日本旅客鉄道）`
→ ⤢ 昇格時もチャット内カードでも、**何で絞った図か**が残る（Protocol は無改変・title は文字列）。

---

## 7. 検証計画（受け入れ基準）

| # | 項目 | 方法 | 合格条件 |
|---|---|---|---|
| 1 | 絞り込みの正しさ | `/api/growth?...&operators=東日本旅客鉄道` の点数を CSV 実測と突合 | 該当駅（1,680 駅）のうち x/y 双方が非 NaN の件数と一致 |
| 2 | 複数選択（OR） | 2 社指定の点数 = 各社の和 − 重複（両社乗り入れ） | 数値で一致 |
| 3 | 未指定時の非回帰 | `operators` 省略時の応答 | **現行と完全一致**（点数・クラスタ・順序） |
| 4 | 会社一覧 | `GET /api/operators` | 181 件・駅数降順・先頭が東日本旅客鉄道 1,680 |
| 5 | UI 配置 | ヘッドレス | 1 段目が「全国 → 運営会社 → ⚠除外」の順・折返しなし（896px） |
| 6 | UI 動作 | ヘッドレス | 会社選択で点数が減る／タイトルに社名が出る／解除で戻る／console error 0 |
| 7 | サイズ不変 | ヘッドレス | 集計中プレースホルダと集計後の高さが一致（P6d の回帰防止） |
| 8 | 品質ゲート | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | すべて green |
| 9 | AI（実施する場合） | `EVAL=1`（22 問） | 現行水準（22/22）を維持 |
| 10 | 無改変の証跡 | `git diff --stat main -- src/shared/protocol.ts src/components/ranking pipeline` | diff 0 |

---

## 8. 決定事項（2026-07-30 ユーザー承認）

| # | 決定 |
|---|---|
| 1 | **会社一覧の供給**：§4 **案 A（新 RPC `operator_names()` ＋ `GET /api/operators`）** |
| 2 | **一致の意味**：`・` 分割の**完全一致**、複数選択は **OR**（どれか 1 社でも運営していれば対象） |
| 3 | **パネルタイトル**：運営会社で絞ったときは併記する（例「（千葉県・東日本旅客鉄道）」） |
| 4 | **AI ツール**：`compareGrowth` にも `operators` を追加する（会話からも同じ絞り込みができる） |
| 5 | **ランキング**：今回は対象外（**将来適用**） |
| 6 | **別名検索**（「JR東日本」→「東日本旅客鉄道」）：**将来課題** |

---

## 9. 実装結果（2026-07-30・ブランチ `feat/scatter-operators-filter`）

### 9.1 変更内容

| レイヤ | ファイル | 変更 |
|---|---|---|
| DB | `supabase/migrations/20260730225721_operators_filter.sql`（新規） | `values_for_columns` を **2 引数 → 3 引数（`ops text[] default null`）で再作成**（旧版は drop：残すと PostgREST がオーバーロードを解決できない）。`string_to_array(operators,'・') && ops` で**完全一致 OR**。`operator_names()` を新設（社名＋駅数・多い順）。どちらも `security invoker`・`search_path=''`・動的 SQL なし・anon に execute 付与 |
| db | `src/db/queries.ts` | `valuesForColumns(keys, prefectures, operators)` に拡張（既定 `[]`＝全社）。`operatorNames()` を追加 |
| shared | `src/shared/api.ts` | `growthQuerySchema.operators` / `growthResponseSchema.operators` / `operatorsResponseSchema` |
| shared | `src/shared/constants.ts` | `selectionLabel(items, emptyLabel)` を切り出し、`prefectureLabel`（空＝全国）・`operatorLabel`（空＝全社）をその薄いラッパに（DRY） |
| domain | `src/domain/growth/presenter.ts` | `GrowthOptions.operators` を受けて応答に載せる（**絞り込み自体は DB 側**） |
| domain | `src/domain/growth/panel.ts` | 絞り込み時のみタイトルに併記（`scopeLabel`） |
| API | `src/app/api/growth/route.ts` | `operators=`（`,` 区切り）を受理 |
| API | `src/app/api/operators/route.ts`（新規） | 会社一覧・1 日キャッシュ |
| UI | `src/components/metrics/OperatorMultiSelect.tsx`・`useOperators.ts`（新規） | 検索付き複数選択（駅数の多い順・選択済みは先頭・上限 60 件表示）／SWR で 1 時間 dedupe |
| UI | `src/components/scatter/ScatterDialog.tsx`・`useGrowth.ts` | 「全国」の右隣に配置し ⚠除外を右へ。SWR キーに `operators` |
| AI | `src/ai/tools.ts` | `compareGrowth` に `operators`（説明に「正式名称・JR東日本ではない」を明記）。返却にも `operators` |
| チャット | `src/stores/chatStore.ts`・`components/chat/panelGroups.ts`・`PromotionHost.tsx` | ⤢ 昇格時に**運営会社も引き継ぐ** |
| テスト | `tests/constants.test.ts`・`domain-growth.test.ts`・`chat-panel-groups.test.ts` | **+6**（ラベル 2・パネルタイトル 3・昇格の復元 1） |

### 9.2 品質ゲート

`pnpm typecheck` ✅ ／ `pnpm lint` ✅ ／ `pnpm test` ✅ **199 passed**（193 → +6）／ `pnpm build` ✅ ／ Prettier 準拠。

### 9.3 DB 適用と RPC の確認（クラウド）

`supabase db push` で適用し、REST から直接確認（鍵は出力しない）：

| 確認 | 結果 |
|---|---|
| `operator_names()` | **181 社**・先頭は東日本旅客鉄道 **1,680 駅**（CSV 実測と一致） |
| `values_for_columns`（`ops` あり） | 200 / 136 行 |
| `values_for_columns`（`ops` なし） | 200 / 636 行＝**後方互換**（本番の旧コードからの 2 引数呼び出しもそのまま動く） |

### 9.4 ゴールデン検証（CSV を正解に `/api/growth` と突合）

`x=pop_gr_2020_2015_2km`・`y=rate_covid` で、**8 ケースすべて完全一致**：

| ケース | CSV | API |
|---|---|---|
| 全社（後方互換） | 7,680 | **7,680** |
| 東日本旅客鉄道 | 854 | **854** |
| 東京地下鉄 | 143 | **143** |
| OR：東日本旅客鉄道＋東京地下鉄 | 969 | **969**（854+143−28 の重複を正しく処理） |
| **京成電鉄**（新京成電鉄と混同しないか） | 69 | **69** |
| 新京成電鉄 | 24 | **24** |
| **札幌市**（一般社団法人札幌市交通事業振興公社と混同しないか） | 46 | **46** |
| 東京都 × 東京地下鉄 | 136 | **136** |

→ §3 で懸念した**部分一致の誤ヒットが実際に起きないこと**を、実在する 2 組（京成／新京成・札幌市／公社）で確認した。

### 9.5 UI 検証（ヘッドレス・1440×900）— 10/10 PASS

| 検証 | 結果 |
|---|---|
| 配置 | 全国 → **運営会社** → ⚠除外 の順・**同じ行（行高 34px）に収まり折返しなし** |
| 一覧 | JR 各社が見える（駅数の多い順） |
| 検索 | 「東京地下鉄」で 1 件に絞れる |
| 絞り込み | `7680駅・4クラスタ` → **`143駅・4クラスタ`** |
| ボタン表示 | 「東京地下鉄」 |
| タイトル | 「…（**全国・東京地下鉄**）」 |
| 解除 | 件数・タイトルとも元に戻る |
| console error | **0** |

### 9.6 AI 経由の確認

「東京地下鉄の駅だけで人口増減率（2km圏）と乗降客のコロナ前後増減率を散布図で見せて」→
`compareGrowth{x:"pop_gr", y:"rate_covid", radiusM:2000, operators:["東京地下鉄"]}` を **1 発で呼び、2 ステップ・2.7s** で散布パネルを返した。**eval 22 問も 22/22 合格**（ツール入力スキーマ変更後の回帰なし）。

---

## 10. 付録：参照

- 現行 RPC：`supabase/migrations/20260709123847_values_for_columns_jsonb.sql`（単一 jsonb で max-rows 回避）
- `operators` の由来：`supabase/migrations/20260709005541_add_operators_to_stations.sql`（P5d・pax 規模降順の `・` 連結）／[`dataset.md`](./dataset.md) §2.1
- データ経路：`src/db/queries.ts`（`valuesForColumns`）→ `src/domain/growth/presenter.ts`（`buildGrowth`）→ `src/app/api/growth/route.ts` → `src/components/scatter/useGrowth.ts` → `ScatterDialog`
- UI の土台：`src/components/metrics/PrefectureMultiSelect.tsx`
- ラベル：`src/shared/constants.ts:173`（`prefectureLabel`／3 箇所で使用）
- 実測（本書 §2）：`data/derived/station_dataset.csv` の `operators` 列を全数集計（181 社・複数社 432 駅・上位 10 社で 56%）
