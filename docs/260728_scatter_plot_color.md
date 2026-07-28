# 散布図マーカー配色を旧プロジェクトと同一にする（実装プラン）

作成日: 2026-07-28 ／ 対象: 散布図のマーカー色（`src/components/panels/ScatterChart.tsx`）／ 参照元: 旧プロジェクト [Station Area Database Map](https://station-area-database-map-e3cf888068c6.herokuapp.com/)（[GitHub](https://github.com/kusui26/station_area_database_map)）

> §1–§7 が実装プラン、**§8 が確定した決定事項、§9 が実装結果（2026-07-28 実装・検証済み）**。ブランチ `feat/scatter-marker-colors` → PR（マージはユーザー）。

---

## 0. エグゼクティブサマリ（結論先出し）

- **依頼**：散布図（増減率スキャッタ）のマーカー色を、旧プロジェクトと同じ配色にする。
- **旧配色（一次情報で確定）**：4 色。**GitHub ソース**と**本番 Heroku バンドル**の両方で同一配列を実測（§2）。

  `rgba(255,99,132,1)` / `rgba(54,162,235,1)` / `rgba(255,206,86,1)` / `rgba(75,192,192,1)`
  → alpha=1 なので **hex 等価**：`#ff6384` / `#36a2eb` / `#ffce56` / `#4bc0c0`

- **現状**：`ScatterChart.tsx:16-25` の**ローカル定数** `CLUSTER_COLORS`（indigo 系 8 色）。配色トークンの単一の真実である `src/shared/constants.ts` に**この 1 つだけ載っていない**（DRY 逸脱）。
- **変更**：配色を上記 4 色に差し替え、置き場所を `src/shared/constants.ts`（＝`ACCENT_COLOR` / `CATEGORY_COLORS` と同格）へ移す。**UI 層のみ**の変更。
- **影響範囲**：散布図だけ（散布モーダル＋チャット内 compact インラインカード）。ランキング・地図・駅詳細・出典表示は不変。**`domain` / `shared/protocol` / 共通API / `db` / `src/ai` は無改変**（Protocol はクラスタ**番号**のみを運び、色は表示層の責務）。
- **副次的な改善**：現行 1 色目 `#4f46e5` は `ACCENT_COLOR`（選択駅・半径サークル）と**同値**で、「選択中の駅」と「クラスタ1」が同色だった。変更後は色が分離される。
- **検証**：単体テスト（配色トークン）＋ typecheck/lint/test/build ＋ **ヘッドレスで実描画ピクセルを採取**して 4 色を確認、旧アプリとの並置スクリーンショット比較。

---

## 1. 対象範囲

| | 内容 |
|---|---|
| **対象** | 散布図マーカー（点）の色。表示経路は 2 つ＝ ①左下 FAB「散布図」→ モーダル（`ScatterDialog`・`size:'full'`）／ ②チャット回答内のインラインカード（`InlineCard`・`size:'compact'`）。どちらも同一コンポーネント `ScatterChart` を通るため**1 箇所の変更で両方に反映**される |
| **非対象**（今回は変更しない） | 点サイズ（現行 compact 1.5 / full 2.5 ・旧 3）／凡例の表示（現行は非表示・旧は「グループN」を表示）／軸・グリッド色／ツールチップ文言／ハイライト駅の赤枠（旧アプリのみの機能）／クラスタリング自体（決定的 k-means・不変） |

> 非対象項目は §7 に「旧アプリとの差分（意図的に踏襲しない）」として記録する。必要なら別依頼で扱う。

---

## 2. 旧プロジェクトの配色（一次情報・二重確認）

### 2.1 ソース（GitHub）

`frontend/src/components/GrowthRateGraphModal.vue:140-145`

```js
clusterColors: [
  "rgba(255, 99, 132, 1)",
  "rgba(54, 162, 235, 1)",
  "rgba(255, 206, 86, 1)",
  "rgba(75, 192, 192, 1)",
],
```

### 2.2 本番（Heroku バンドル・2026-07-28 実測）

`/assets/index-CS0PeK19.js` 内に**同一の 4 要素配列**が存在することを確認（デプロイ版とソースが一致）。

### 2.3 配色表（採用値）

| クラスタ | 旧アプリ（rgba） | hex（採用） | 色味 | 近似 Tailwind |
|---|---|---|---|---|
| 1 | `rgba(255, 99, 132, 1)` | **`#ff6384`** | ピンクレッド | rose-400 相当 |
| 2 | `rgba(54, 162, 235, 1)` | **`#36a2eb`** | ブルー | sky-500 相当 |
| 3 | `rgba(255, 206, 86, 1)` | **`#ffce56`** | イエロー | amber-300 相当 |
| 4 | `rgba(75, 192, 192, 1)` | **`#4bc0c0`** | ティール | teal-400 相当 |

- Chart.js の古典的な既定パレット相当。alpha=1（完全不透明）のため hex 変換で**色は完全一致**。
- 旧アプリの適用方法（`GrowthRateGraphModal.vue:501-520`）：`pointBackgroundColor` ＝クラスタ色、`pointBorderColor` ＝**同色**（幅 1）、`pointRadius` ＝3。検索ハイライト駅のみ赤枠（幅 3）＋半径 7。凡例は表示（「グループN」）。k=4（`Math.random` 初期化＝**非決定的**／新アプリは**決定的 k-means**）。

---

## 3. 現状（新アプリ）

| 観点 | 現状 | 参照 |
|---|---|---|
| 配色定数 | `CLUSTER_COLORS`＝8 色（`#4f46e5`, `#059669`, `#d97706`, `#db2777`, `#0891b2`, `#7c3aed`, `#dc2626`, `#ca8a04`）を**コンポーネント内にローカル定義** | `src/components/panels/ScatterChart.tsx:16-25` |
| 適用 | `datasets[c].backgroundColor = CLUSTER_COLORS[c % length]`（**塗りのみ**指定。枠線は Chart.js 既定 `rgba(0,0,0,0.1)` 幅 1） | 同 `:56-62` |
| 使用箇所 | **この 1 箇所のみ**（`grep` 済み。他コンポーネント・domain・AI は色に触れない） | — |
| クラスタ数 | 決定的 k-means（`DEFAULT_K = 4`）→ `clusterCount` ＝実際に出現したラベル数（**≤ 4**） | `src/domain/growth/kmeans.ts:11`, `presenter.ts:63-70` |
| 配色トークンの正 | `src/shared/constants.ts` が「配色トークンの単一の真実」を自称し `ACCENT_COLOR` / `WARNING_COLOR` / `CATEGORY_COLORS` を保持。**クラスタ配色だけが外にある** | `src/shared/constants.ts:67-88` |

**現状の問題点（今回あわせて解消される）**：1 色目 `#4f46e5` ＝ `ACCENT_COLOR`（選択駅・半径サークル・主ボタン）と同値のため、散布図で「クラスタ1 の点」と「アクセント」が同色。

---

## 4. 設計

### 4.1 採用配色（確定案）

```ts
/** 散布図クラスタの配色（旧プロジェクト Station Area Database Map と同一）。 */
export const CLUSTER_COLORS: readonly string[] = ['#ff6384', '#36a2eb', '#ffce56', '#4bc0c0']
```

- **4 色**とする：`DEFAULT_K = 4` ゆえ `clusterCount ≤ 4` で必要十分。旧アプリと同じ枚数。
- 万一 5 クラスタ以上になっても既存の `c % CLUSTER_COLORS.length` が**安全に循環**する（現行ロジックのまま）。

### 4.2 置き場所（決定ポイント A）

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | `src/shared/constants.ts` に `CLUSTER_COLORS` を追加し、`ScatterChart` は import して参照 | 同ファイルの自己記述「配色トークンの単一の真実・値の重複定義を作らない（DRY）」に整合。`ACCENT_COLOR` / `CATEGORY_COLORS` と同格に並び、将来（凡例・地図ハイライト・AI 説明）で同じ色が要るときも 1 箇所。CLAUDE.md §3「DRY・定数」に合致。差分は 3 ファイル（constants / ScatterChart / test） |
| B | `ScatterChart.tsx` の配列値だけ差し替え | 最小差分（1 ファイル）。ただし配色トークンの分散が残る |

### 4.3 マーカーの塗りと枠（決定ポイント B）

| 案 | 内容 | 見え方 |
|---|---|---|
| **A（推奨）** | `backgroundColor` のみ差し替え（＝現行の実装形のまま値だけ変更） | 色は旧アプリと**完全一致**。枠線は Chart.js 既定の薄い黒（`rgba(0,0,0,0.1)` 幅 1）が残り、**イエロー `#ffce56` が白背景に埋没しにくい** |
| B | `borderColor` にも同じクラスタ色を指定（旧アプリと同じ「塗り＝枠＝同色」） | 旧アプリのピクセル挙動に完全一致。ただしイエローの白背景コントラストは **約 1.5:1** と低く、点が見えづらくなる |

→ **推奨は A**（依頼の本質＝「色」を完全に満たしつつ、現行の視認性の利点を保つ）。旧アプリの見た目に厳密一致させたい場合は B。

### 4.4 変更しないもの（純加算・依存方向の維持）

`src/domain` / `src/shared/protocol.ts` / `src/shared/api.ts` / `src/app/api/**` / `src/db` / `src/ai` は**無改変**。GUI Chat Protocol の `scatter` パネルは `cluster`（番号）と `clusterCount` のみを運び、**色は表示層が解釈する**という現行の責務分割をそのまま維持する（architecture.md §3.2「UI は描画のみ／意味は domain」に整合。色は"意味"ではなく表現）。

---

## 5. 実装手順

1. **ブランチ作成**（ユーザー承認後）：`feat/scatter-marker-colors`
2. `src/shared/constants.ts`：`CLUSTER_COLORS` を配色トークン節に追加（JSDoc に**出典＝旧プロジェクト**と根拠を明記）
3. `src/components/panels/ScatterChart.tsx`：ローカル定数を削除し `@/shared/constants` から import（**適用ロジックは変更しない**＝ `backgroundColor` に `% length` で割り当て）
4. `tests/constants.test.ts`：配色トークンのテストを追加
   - 4 色ちょうど・全て hex 形式（既存 `HEX_COLOR` 正規表現を再利用）・重複なし
   - 旧アプリ由来の期待値と**完全一致**（`['#ff6384','#36a2eb','#ffce56','#4bc0c0']`＝リグレッション検知）
   - `ACCENT_COLOR` と衝突しない（選択駅と同色にならない不変条件）
5. **品質ゲート**：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`
6. **ヘッドレス検証**（§6）
7. **ドキュメント**：本書に実装結果（実測値・スクショ観点）を追記。`plan_fable.md` の進捗表は Step1/Step2 のブロック単位管理のため、軽微な UI 変更である本件は**本書を正**とする（必要ならユーザー判断で追記）
8. **コミット・PR**：ユーザーの明示的な指示があったときのみ（CLAUDE.md §4）

---

## 6. 検証計画（受け入れ基準）

| # | 項目 | 方法 | 合格条件 |
|---|---|---|---|
| 1 | 配色の一致 | ヘッドレス（Playwright）で散布モーダルを開き、canvas を**ピクセル採取**して出現色を集計 | `#ff6384` / `#36a2eb` / `#ffce56` / `#4bc0c0` が検出され、旧色（`#4f46e5` 等）が**検出されない** |
| 2 | 旧アプリとの目視比較 | 旧アプリ（Heroku）と新アプリの散布図を並置スクリーンショット | 色相・見た目の印象が一致 |
| 3 | compact 経路 | チャットで散布を要求 → インラインカードを描画 | モーダルと**同じ 4 色**（両経路で同一コンポーネント） |
| 4 | 機能の無回帰 | 点クリック→駅選択＋flyTo／x・y 指標変更／都道府県変更／低分母除外トグル／集計中オーバーレイ | すべて従来どおり動作・`console error 0` |
| 5 | 品質ゲート | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | すべて green（単体テストは +1 ケース群） |
| 6 | 変更範囲の証跡 | `git diff --stat` | `src/shared/constants.ts` / `src/components/panels/ScatterChart.tsx` / `tests/constants.test.ts` のみ（domain・protocol・API・db・ai に diff 0） |

---

## 7. リスク・限界・旧アプリとの差分

- **イエロー `#ffce56` のコントラスト**：白背景に対し**約 1.5:1** と低い（WCAG の非テキスト最低 3:1 を下回る）。旧アプリ準拠を優先して**受容**する。気になる場合の緩和策：§4.3 案 A のまま（既定の薄い枠線が輪郭を与える）／将来オプションで枠線を濃色にする。
- **クラスタ↔色の対応は不変ではない**：クラスタ番号は k-means の任意 index（意味を持たない）。x/y 指標や対象県を変えれば「クラスタ1＝赤」が指す集団は変わる。これは現行仕様どおり（凡例を出していない理由でもある・`ScatterChart.tsx:101`）。
- **旧アプリとの意図的な差分**（今回踏襲しない）：凡例表示／「グループN」ラベル（新アプリは「Nクラスタ」の副題）／点サイズ／検索駅の赤ハイライト枠／非決定的 k-means（新アプリは決定的＝再現性あり）。
- **【参考・本件の対象外】** `ScatterChart` は `clusterCount`（＝**出現したラベル数**）ぶんだけ dataset を作り `p.cluster === c` で振り分けるため、仮に**空クラスタ**が生じてラベルが疎（例 `{0,2,3}`）になると、最大ラベルの点が描画されない可能性がある。今回の配色変更とは独立した既存事象で、**本プランでは触らない**。別途調査・対応の要否を確認したい（§8-4）。

---

## 8. 決定事項（2026-07-28 ユーザー承認）

1. **配色**：§2.3 の 4 色（`#ff6384` / `#36a2eb` / `#ffce56` / `#4bc0c0`）で**確定**。
2. **置き場所**：§4.2 **案 A（`src/shared/constants.ts` へ移設）**で**確定**。
3. **枠線**：§4.3 **案 A（塗りのみ変更・Chart.js 既定の薄い枠線を維持）**で**確定**。
4. **潜在事象**（§7 末尾の空クラスタ）：本件と分離。**未回答**のため今回は触れていない（別途要否を判断）。

---

## 9. 実装結果（2026-07-28・ブランチ `feat/scatter-marker-colors`）

### 9.1 変更内容（差分 3 ファイル・+64 / −12 行）

| ファイル | 変更 |
|---|---|
| `src/shared/constants.ts` | 配色トークン節に **`CLUSTER_COLORS`（4 色・非空タプル型）** と **`clusterColor(clusterIndex)`（純関数）** を追加。剰余で循環し、範囲外・負値・小数でも必ず色を返す（`as` 不使用・`noUncheckedIndexedAccess` 下で型安全） |
| `src/components/panels/ScatterChart.tsx` | ローカル定数 `CLUSTER_COLORS`（旧 8 色）を削除し `clusterColor(c)` を参照。**適用ロジック・点サイズ・枠線・凡例は不変** |
| `tests/constants.test.ts` | 配色トークンと `clusterColor` の単体テストを追加（**+6 ケース**：旧アプリ配色との完全一致・hex/重複・アクセント/警告と非衝突・順序・循環・境界値） |

- **無改変を確認**：`src/domain` / `src/shared/protocol.ts` / `src/app/api/**` / `src/db` / `src/ai` に diff **0**（§4.4 の原則どおり）。

### 9.2 品質ゲート

| ゲート | 結果 |
|---|---|
| `pnpm typecheck` | ✅ green |
| `pnpm lint` | ✅ green（`any`/`as` 禁止・レイヤ境界ルール込み） |
| `pnpm test` | ✅ **142 passed**（136 → +6）／ skip 6 は実 API を使う live テスト |
| `pnpm build` | ✅ green（12 ルート生成） |
| `pnpm format:check` | 変更 4 ファイルは ✅ Prettier 準拠。**リポジトリ既存の 12 ファイル**（README・error.tsx・db/queries.ts 等）は本改修前から warn 状態のため**意図的に触れていない**（スコープ外） |

### 9.3 ヘッドレス実測（Playwright・本番ビルド `pnpm start` に対して実行）

**canvas の全ピクセルを走査して出現色を集計**する方式で、"設定値" ではなく **実際に描画された色**を検証した。

**① 新アプリ・散布モーダル（full・1440×900 / DPR2）— 11/11 PASS**

| 検証 | 結果 |
|---|---|
| モーダル表示・集計完了 | ✅ `7680駅・4クラスタ`（全国・人口増減率2km × 乗降客コロナ前後比） |
| 新パレット 4 色の描画 | ✅ `#ff6384` 781px ／ `#36a2eb` 659px ／ `#4bc0c0` 629px ／ `#ffce56` 41px |
| 旧パレット（indigo 系 8 色）の残存 | ✅ **0 px（完全に消えた）** |
| クラスタ数と検出色数の一致 | ✅ 4 クラスタ = 4 色 |
| 回帰：低分母（⚠）除外トグル | ✅ `7680駅` → `7428駅`（252 駅除外） |
| 回帰：点クリックで駅選択 | ✅ `?grp=田老#0` が URL に反映 |
| 回帰：指標ピッカ | ✅ select 4 個（カテゴリ×変種 ×2 軸）健在 |
| console error | ✅ **0** |

> `#ffce56`（イエロー）が 41px と小さいのは配色の不具合ではなく、**クラスタ 2 の所属駅が 1 駅しかない**ため（API 実測の分布：`{0:1860, 1:1414, 2:1, 3:4405}`）。この 1 点は `rate_covid` の極端値（[`260727_data_check.md`](./260727_data_check.md) の御厨#1）で、散布図上部に単独で描画されている。

**② 旧アプリ（Heroku 本番）との対照実験 — 4/4 一致**

同じ手法で旧アプリの canvas（千葉県・増減率_乗降者数 × 増減率_人口_2km）を実測：

```
#36a2eb 14893px / #ff6384 8526px / #ffce56 2466px / #4bc0c0 2300px
```

→ **新アプリで実測された 4 色と完全一致**。ソース（GitHub）・本番バンドル・**実描画ピクセル**の 3 経路で同一性を確認した。

**③ チャット内インラインカード（compact）— 一致**

実 Gemini + 実 Supabase を通し「全国で人口増減率（2km圏）と乗降客のコロナ前後増減率の散布図を見せて」を送信 → インラインカードの canvas を実測：**新パレット 4/4 検出・旧パレット 0・console error 0**。モーダルと同一コンポーネントを通ることを実証（クリックでも会話でも同じ描画パス）。

### 9.4 スクリーンショット（目視確認）

`shot_new_scatter_full.png`（新・モーダル）／`shot_new_chat_compact.png`（新・チャット内）／`shot_old_scatter.png`（旧アプリ）を取得し、色相が一致することを目視でも確認した。旧アプリのみ凡例「グループ1〜4」が表示される（§7 の意図的な差分）。

---

## 10. 付録：参照（すべて実在確認済み）

**旧プロジェクト**
- `frontend/src/components/GrowthRateGraphModal.vue:140-145`（`clusterColors` 定義）／`:399-408`（k=4 クラスタリング）／`:501-520`（点への色適用・ハイライト赤枠）
- 本番バンドル `https://station-area-database-map-e3cf888068c6.herokuapp.com/assets/index-CS0PeK19.js`（同一配列を実測・2026-07-28）

**新プロジェクト**
- `src/components/panels/ScatterChart.tsx:16-25`（現行 `CLUSTER_COLORS`）・`:56-62`（dataset 構築）・`:101-102`（凡例非表示の理由）
- `src/shared/constants.ts:67-88`（配色トークンの単一の真実）
- `src/domain/growth/kmeans.ts:11`（`DEFAULT_K = 4`）・`src/domain/growth/presenter.ts:63-70`（`clusterCount`）
- `src/shared/protocol.ts:158`（`scatter` パネル＝`cluster` / `clusterCount` のみ・色は持たない）
- `tests/constants.test.ts:13,47-52`（既存の配色トークン・テスト形式）
