# 散布図：都道府県フィルタと運営会社フィルタを連動させる（実装プラン）

作成日: 2026-07-30 ／ 対象: 散布モーダル（`ScatterDialog`・`PrefectureMultiSelect`・`OperatorMultiSelect`）と `GET /api/operators` ／ 依頼: 「都道府県と運営会社のフィルタを連動させたい。例：**東海旅客鉄道を選んだら該当する都道府県がチェックされている**イメージ」

> §1–§6 が調査と設計、**§7 が確定した決定事項、§8 が実装結果（2026-07-31 実装・検証済み）**。ブランチ `feat/scatter-filter-link` → PR（マージはユーザー）。

---

## 0. エグゼクティブサマリ（結論先出し）

実データを測ったところ、**依頼どおりの「自動チェック」だけでは狙った効果が出ない**ことが分かりました。

- **① 自動チェックは検索結果を 1 点も変えない**（実測で確認）。2 つのフィルタは AND なので、会社の該当県をすべてチェックしても結果は会社単独と同一：
  - 東海旅客鉄道のみ → **411 点** ／ 東海旅客鉄道 ＋ 該当 13 県を自動チェック → **411 点（完全一致）**
  - つまり自動チェックの価値は「結果を変えること」ではなく、**カバー範囲の可視化**と**そこから絞り込む起点**です。
- **② むしろ絞り込みは面倒になる**：「東海旅客鉄道の静岡県だけ見たい」は、自動チェックがなければ**静岡県を 1 クリック**（→75 点）。自動チェックがあると**12 県を外す**必要があります。
- **③ 本当の使いにくさは「空の組合せ」**：（会社 × 都道府県）は 8,507 通りありますが、**実在するのは 289 通りだけ＝96.6% は 0 件**になります（例：東海旅客鉄道 ＋ 北海道 → 0 点）。**選べてしまうこと自体が罠**です。
- → **推奨は「選択肢の連動（候補を絞る）」を主軸に、「会社の県を入れる」はワンクリックのボタンで提供**する形です。依頼どおりの自動チェックも実装可能で、§7 の決定ポイントで選べるようにしています。

---

## 1. 実データ（`station_dataset.csv` 全数集計）

| 指標 | 値 |
|---|---|
| 会社がまたぐ都道府県数 | **中央値 1**／最大 18（西日本旅客鉄道）／**137 社（76%）は 1 県のみ** |
| 東海旅客鉄道 | 412 駅・**13 県**（三重・京都・和歌山・大阪・富山・山梨・岐阜・愛知・東京・滋賀・神奈川・長野・静岡） |
| 東日本旅客鉄道 | 1,680 駅・17 県 ／ 西日本旅客鉄道 1,186 駅・18 県 ／ 東京地下鉄 144 駅・3 県 |
| 都道府県あたりの会社数 | 中央値 **5**／最大 20（東京都）／千葉県 17・静岡県 10・鳥取県 3 |
| （会社 × 県）の組合せ | 全 8,507 通りのうち**実在は 289 通り（3.4%）** |

**含意**

1. 会社の 76% は 1 県のみ＝**自動チェックしても 1 県だけ**。効果が大きいのは JR 各社など少数です。
2. 逆に県から見ると会社は中央値 5 社・最大 20 社。**181 社の一覧を 5〜20 社に絞れる**なら、会社選択の手間は大きく減ります。
3. 96.6% の組合せが 0 件なので、**候補を絞る（連動）ことの価値が最も大きい**。

---

## 2. 連動の 4 つの設計案

| 案 | 内容 | 効果 | 副作用・コスト |
|---|---|---|---|
| **A：自動チェック**（依頼どおり） | 会社を選ぶと該当県を自動でチェック | カバー範囲が見える／「1 県だけ外す」が簡単 | **結果は変わらない**（§0-①）／「1 県に絞る」が 12 クリックに増える／自動と手動の**状態管理**が必要 |
| **B：候補の連動**（推奨・双方向） | 会社選択中は県一覧を該当県のみに、県選択中は会社一覧をその県の会社のみに絞る（非該当はグレーアウト or 非表示） | **0 件の組合せを構造的に防ぐ**（96.6% を排除）／181 社 → 5〜20 社で選びやすい | 選択状態は書き換えないので副作用なし／「非表示 vs グレーアウト」の選択が必要 |
| **C：明示ボタン** | 会社選択時に「**この会社の都道府県を選択（13県）**」ボタンを出し、押したときだけチェック | 依頼の体験を**ユーザーの意思で**得られる／勝手に変わらない | ボタン 1 つ分の UI 追加 |
| D：逆方向の自動チェック | 県を選ぶと会社を自動チェック | — | 東京都で 20 社が一気に入る＝ノイズが大きい → **非推奨** |

### 推奨：**B ＋ C**（＋ A を選ぶ場合は §3 の状態モデルで）

- **B** が使いやすさの本体（空振りを防ぐ・181 社を絞る）。
- **C** で依頼どおりの「会社の県をチェックした状態」もワンクリックで作れる。
- **A（自動を既定）** にすると「1 県に絞る」操作が重くなるため、**既定にはしない**ことを推奨します。ただし体験の好みなので §7-1 で選べるようにします。

---

## 3. A / C を採る場合の状態モデル（勝手に消さないための規則）

自動で入れたチェックと、ユーザーが自分で入れたチェックを**区別**しないと、会社を外した瞬間にユーザーの選択まで消えます。純関数で表現します。

```ts
type LinkState = {
  readonly prefectures: readonly string[]  // 実際の選択（API に渡る）
  readonly auto: readonly string[]         // そのうち「会社連動で入った」もの
}

/** 会社の選択が変わったとき、自動分だけを差し替える（手動分は温存）。 */
function applyOperatorLink(
  state: LinkState,
  operators: readonly string[],
  prefecturesOf: (operator: string) => readonly string[],
): LinkState
```

規則：

1. 会社を選ぶ → その会社の県のうち**まだ入っていないもの**を追加し、`auto` に記録。
2. 会社を外す → `auto` に入っている県のうち、**残った会社のどれにも属さないもの**だけ外す。
3. ユーザーが県を手動でトグルした → その県は `auto` から外し**手動所有**にする（以後の自動操作の対象外）。
4. 「全国（すべて解除）」 → `prefectures` も `auto` も空に。

この 4 規則があれば「会社を切り替えても手動選択が壊れない」「会社を外せば自動分だけ消える」が成立します（単体テストで固定）。

---

## 4. データの供給（会社 → 都道府県の対応表）

現状 `GET /api/operators` は `{ name, stationCount }` のみ。連動には**会社ごとの都道府県**が要ります。

- **推奨**：`operator_names()` RPC を **`prefectures text[]` つき**で作り直し、`/api/operators` の各要素に `prefectures` を足す。
  - 実測サイズ：**12,279 bytes**（181 社・1 日キャッシュ済み）。追加リクエストは不要。
  - 逆方向（県 → 会社）は**この 1 本からクライアント側で逆引き**できる（追加 API 不要）。
- 代替：県ごとの会社を返す別 RPC → **不要**（同じ情報の重複）。

```sql
drop function if exists public.operator_names();

create function public.operator_names()
returns table(name text, station_count bigint, prefectures text[])
language sql stable security invoker set search_path = ''
as $$
  select o.name,
         count(*)::bigint as station_count,
         array_agg(distinct s.prefecture order by s.prefecture) as prefectures
  from public.stations s
  cross join lateral unnest(string_to_array(coalesce(s.operators, ''), '・')) as o(name)
  where o.name <> ''
  group by o.name
  order by count(*) desc, o.name
$$;

grant execute on function public.operator_names() to anon, authenticated;
```

※ 既存 `operator_names()` は戻り値の型が変わるため **drop → create**（PostgREST のキャッシュ都合でも drop が必要）。`/api/operators` は 1 日キャッシュなので、デプロイ直後は最大 1 日ぶん古い応答が残りうる（`prefectures` が無い応答は Zod で optional 扱いにして安全に無視する）。

---

## 5. 変更範囲（ファイル別）

| レイヤ | ファイル | 変更 |
|---|---|---|
| DB | `supabase/migrations/<ts>_operator_prefectures.sql`（新規） | `operator_names()` を `prefectures text[]` つきで再作成 |
| db | `src/db/queries.ts` | `operatorNames()` の戻り値に `prefectures` |
| shared | `src/shared/api.ts` | `operatorSchema.prefectures`（**optional＋既定 `[]`** ＝旧キャッシュ応答でも壊れない） |
| UI（純関数） | `src/components/scatter/operatorLink.ts`（新規） | §3 の `applyOperatorLink` ほか（`prefecturesFor` / `operatorsFor` の逆引き）。**単体テスト対象** |
| UI | `src/components/metrics/PrefectureMultiSelect.tsx` | `allowed?: readonly string[]`（未指定なら全 47）を受け、非該当を**グレーアウト or 非表示**。件数バッジは付けない（散布の点数とは別物のため） |
| UI | `src/components/metrics/OperatorMultiSelect.tsx` | `allowedPrefectures?: readonly string[]` を受け、該当会社のみ表示（＋「この会社の都道府県を選択」ボタン＝案 C） |
| UI | `src/components/scatter/ScatterDialog.tsx` | 2 つの選択状態と `auto` を保持し、`applyOperatorLink` を通す |
| テスト | `tests/scatter-operator-link.test.ts`（新規） | §3 の 4 規則・境界（空・全解除・会社切替・手動優先） |

- **AI ツールは無改変**：`compareGrowth` は都道府県・運営会社を両方受けており、連動は**UI の操作補助**にすぎない（サーバ側の意味は変わらない）。
- `src/domain`・`src/shared/protocol`・`/api/growth`・ランキングは**無改変**。

---

## 6. 検証計画（受け入れ基準）

| # | 項目 | 方法 | 合格条件 |
|---|---|---|---|
| 1 | 連動の純関数 | 単体テスト | §3 の 4 規則（追加・自動分のみ削除・手動優先・全解除）＋境界 |
| 2 | 会社 → 県の候補 | ヘッドレス | 東海旅客鉄道を選ぶと県一覧が **13 県**に絞られる（or 非該当がグレーアウト） |
| 3 | 県 → 会社の候補 | ヘッドレス | 静岡県を選ぶと会社一覧が **10 社**に絞られる |
| 4 | 0 件の組合せが選べない | ヘッドレス | 東海旅客鉄道選択中に北海道が選べない（or 明示的に 0 件と分かる） |
| 5 | 結果の不変性 | API | 「会社のみ」と「会社＋該当県すべて」の点数が一致（現状 411 = 411） |
| 6 | 絞り込みは効く | ヘッドレス | 東海旅客鉄道＋静岡県 → 75 点 |
| 7 | 手動選択が壊れない | ヘッドレス | 手動で東京都 → 会社を選ぶ/外す → 東京都のチェックが残る |
| 8 | 旧キャッシュ耐性 | 単体 | `prefectures` の無い `/api/operators` 応答でも例外なく動く（連動が無効化されるだけ） |
| 9 | 品質ゲート | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | すべて green |
| 10 | 無改変の証跡 | `git diff --stat main -- src/domain src/shared/protocol.ts src/ai src/app/api/growth` | diff 0 |

---

## 7. 決定事項（2026-07-31 ユーザー承認）

| # | 決定 |
|---|---|
| 1 | **自動チェックは既定にしない**。代わりに**案 C のボタン**（「この会社の都道府県を選択（N県）」）でワンクリックで同じ状態を作る |
| 2 | **候補の連動（案 B）は双方向**（会社 → 県／県 → 会社） |
| 3 | 非該当は**グレーアウト**（非表示にはしない。「JR東海は北海道を走らない」という情報自体が有用なため） |
| 4 | 会社を外したときは**自動で入った県だけ外す**（手動で入れた県は残す・§3 規則 2） |
| 5 | **ランキングへの展開は対象外**（ランキングには会社フィルタ自体がまだ無いため） |

---

## 8. 実装結果（2026-07-31・ブランチ `feat/scatter-filter-link`）

### 8.1 変更内容（8 ファイル）

| レイヤ | ファイル | 変更 |
|---|---|---|
| DB | `supabase/migrations/20260731000542_operator_prefectures.sql`（新規） | `operator_names()` を **`prefectures text[]` つきで再作成**（`array_agg(distinct s.prefecture order by s.prefecture)`）。戻り値の型が変わるため drop → create |
| db | `src/db/queries.ts` | `operatorNames()` の戻り値に `prefectures`（null は `[]` に正規化） |
| shared | `src/shared/api.ts` | `operatorSchema.prefectures`（**既定 `[]`**＝1 日キャッシュの古い応答でも壊れず、連動が無効になるだけ） |
| UI（純関数） | `src/components/scatter/operatorLink.ts`（新規） | `prefectureIndex` / `prefecturesOfOperators` / `operatorsInPrefectures` / `selectOperatorPrefectures`（規則 1）/ `pruneAutoPrefectures`（規則 2）/ `applyManualPrefectures`（規則 3・4）。**すべて純関数** |
| UI | `src/components/metrics/PrefectureMultiSelect.tsx` | `allowed` を受けて非該当を**グレーアウト**（選択済みは解除できるよう活かす＝行き止まりを作らない）＋ヒント文 |
| UI | `src/components/metrics/OperatorMultiSelect.tsx` | `allowed` でグレーアウト＋並びを「選択済み → 選べる → グレー」に。**「この会社の都道府県を選択（N県）」ボタン**（案 C）。会社一覧は親から受け取る形に変更（取得元を 1 箇所に） |
| UI | `src/components/scatter/ScatterDialog.tsx` | `LinkState`（`prefectures` と `auto`）を保持し、双方向の候補と 3 つのハンドラ（手動トグル・会社変更・ボタン）を配線 |
| テスト | `tests/scatter-operator-link.test.ts`（新規） | **+15 ケース**（4 規則・和集合/逆引き・同一参照での no-op・`auto ⊆ prefectures` の不変条件） |

`src/domain`・`src/shared/protocol.ts`・`/api/growth`・`src/ai`・ランキングは**無改変**（連動は UI の操作補助であり、サーバ側の意味は変わらない）。

### 8.2 品質ゲート

`pnpm typecheck` ✅ ／ `pnpm lint` ✅ ／ `pnpm test` ✅ **214 passed**（199 → **+15**）／ `pnpm build` ✅ ／ Prettier 準拠。
DB は `supabase db push` で適用し、REST で **181 社・東海旅客鉄道 13 県・1 県のみの会社 137 社**（CSV と一致）を確認。

### 8.3 ヘッドレス検証（1440×900）— **12/12 PASS**

| 検証 | 結果 |
|---|---|
| 案 C のボタン | 「この会社の都道府県を選択（**13県**）」 |
| 会社 → 県の候補 | ヒント「選択中の会社が走る **13 県**のみ選べます」・**北海道はグレーアウト**・静岡県は選択可 |
| ボタン適用 | 都道府県が「三重県 他12件」に。**点数は 411 → 411 で不変**（AND のため・§0-① を実挙動で再確認） |
| 会社を外す | 自動で入った 13 県が消えて「全国」に戻り、点数も 7,680 に復帰 |
| 県 → 会社の候補（逆方向） | 静岡県を選ぶと「選択中の都道府県を走る **10 社**のみ選べます」・**札幌市はグレーアウト** |
| 手動選択の保護 | 手で入れた静岡県は、会社の選択・解除をしても**残る** |
| console error | **0** |

### 8.4 補足：この設計が効く理由

- 「東海旅客鉄道 ＋ 北海道」のような **0 件になる組合せ（全体の 96.6%）が選べなくなった**のが最大の効果です。
- 依頼の「会社を選んだら県がチェックされる」状態も、**ボタン 1 回**で作れます（自動にしないので、「静岡県だけ見る」は従来どおり 1 クリックのまま）。

---

## 9. 付録：実測ログ

- 自動チェックの無効性：`/api/growth?x=pop_gr_2020_2015_2km&y=rate_covid&operators=東海旅客鉄道` → **411 点**、`&prefecture=<該当13県>` を足しても **411 点**（完全一致）。`&prefecture=静岡県` → **75 点**、`&prefecture=北海道` → **0 点**。
- 組合せの疎性：（会社 × 県）8,507 通り中、実在 **289 通り（3.4%）**。
- 会社の県数：中央値 1・最大 18・1 県のみが 137 社。
- `/api/operators` に `prefectures` を足したときの JSON サイズ：**12,279 bytes**。
- 参照コード：`src/components/metrics/OperatorMultiSelect.tsx`・`PrefectureMultiSelect.tsx`・`src/components/scatter/ScatterDialog.tsx`・`src/app/api/operators/route.ts`・`supabase/migrations/20260730225721_operators_filter.sql`（`operator_names()`）
