# 家探し向け「おすすめ駅」プラン（UI/UX ブラッシュアップ）

作成日: 2026-07-22 ／ 起点メモ: [`memo_house_hunting.md`](./memo_house_hunting.md) ／ データ正: [`dataset.md`](./dataset.md)・[`catalog_labels.md`](./catalog_labels.md) ／ 設計正: [`architecture.md`](./architecture.md)・[`.claude/CLAUDE.md`](../.claude/CLAUDE.md)

---

## 0. エグゼクティブサマリ（結論先出し）

- **やること**：エリア（当面は**都道府県**）を指定すると、その中で「住む場所としておすすめの駅周辺」を**複合スコア**で並べて地図＋パネル＋AIで提示する新機能を足す。メモの「おすすめ＝乗降・人口・地価が、他の駅周辺と**相対比較**して伸びている／高い」を、**エリア内パーセンタイルの重み付き合成**として定式化する。
- **増減率か実数か（メモの問い）への回答**：**どちらも使う**。ただし単位が違う生値を足すのは誤り。各指標を**エリア内パーセンタイル（0–100）**に変換してから合成する。増減率＝「伸びている」、実数（水準）＝「高い」を別軸として両取りする。
- **設計の核心判断**：「おすすめ」は指標定義・単位・方向・重み・順位付けという**意味を持つロジック**。CLAUDE.md §2「AIと人間で別APIを作らない／意味づけをUIに埋めない」に従い、**`src/domain/recommend`（純関数）＋ `/api/recommend` ＋ AIツール `recommendStations` ＋ 構造化UI** が**同一ドメインを叩く**形にする（AI専用にしない・UIに計算を埋めない）。
- **好都合な事実（低コストで作れる）**：多駅×多指標のマトリクスを返す **`valuesForColumns(keys[], prefs[])`（RPC は jsonb・行数上限なし）が既にある**（`src/db/queries.ts:139`）。都道府県版の複合スコアは **DB マイグレーション無改変**で実装できる。増減率散布の `buildGrowth`（grp でピボット）がスコア合成の雛形（`src/domain/growth/presenter.ts:36-61`）。
- **正面から扱う3つの制約**：
  1. **市区町村カラムが無い**（`stations` の地理属性は `prefecture` のみ）。→ 例「横浜市で」の粒度は現データに無い。当面は**都道府県＋地図表示範囲(bbox)**をエリア単位にし、**市区町村は将来のデータ拡張**（pipeline・並行トラック）で対応する。
  2. **`higherIsBetter` がカタログ全583件で `null` かつコード未参照**（Explore 検証済み）。→ 各指標の「良い方向」は **recommend ドメインが自前で定義**する（カタログ汚染を避ける／将来カタログに昇格可）。
  3. **地価増減率は 1km–10km のみ**（500m・20km 無し）、**地価中央値は 500m–10km**（20km 無し）、**乗降は半径非依存**。→ 全指標が最も綺麗に整合するのは **1km**。住環境（徒歩生活圏）としても妥当なので**既定半径＝1km**。
- **フェーズ**：R1 ドメイン（純関数スコア＋テスト）→ R2 データ取得（既存 `valuesForColumns` 再利用）→ R3 `/api/recommend` → R4 AIツール＋eval → R5 UI（おすすめモーダル・地図・内訳パネル）→ R6 検証。**MVP は protocol／map 無改変**（既存パネルで表現）、**Phase2 で専用パネル＋スコア地図**へ拡張。

---

## 1. ニーズの定義：ファミリーの家探しペルソナ

「個人の家探し」を、意思決定の時間軸が長い**ファミリーの持ち家購入**として具体化する。ここを外すと指標選定と方向がぶれる。

- **時間軸**：20–30年住む前提。→ **将来の持続性**（人口が維持されるか、資産価値が下支えされるか）が短期の賑わいより重い。
- **買い手の立場**：地価が「高い」ことは魅力ではなく**コスト**。一方で地価が「緩やかに上昇」は**資産保全**として歓迎。→ 地価は**水準と増減率で意味が逆**になる二面性を持つ。ここを雑に「高いほど良い」とするとターミナル駅ばかり推薦する誤りに陥る。
- **利便性の非線形**：乗降客数が最大（東京・新宿）＝過密・高コストで、**"住む"には最適ではない**。→ 乗降は「一定以上あれば十分（利便性フロア）＋伸びている（新興住宅地の勢い）」を評価し、**最大値を過大評価しない**。
- **現データで測れないが本来重要な軸（正直に明示）**：学区・治安・災害リスク・生活利便施設（医療・買い物）・実際の物件。→ 本機能は**データで測れる相対シグナル**に限定し、これらは免責＋[`dataset.md`](./dataset.md) §4 の将来データ（災害 A31/A33、生活利便 P04/P29、昼間人口）で埋める布石とする。

> **家探し版「おすすめ」の定義**：*エリア内で、①将来にわたり人が住み続ける見込みが高く（人口・将来推計）、②資産価値が保全され（地価トレンド）、③そこそこ便利で活力がある（乗降の水準・回復）駅周辺*。「高い」だけでも「伸びている」だけでもなく、**持続性を主軸に両者を合成**する。

---

## 2. 現状データの棚卸しと「おすすめ」への含意

[`dataset.md`](./dataset.md)・[`catalog_labels.md`](./catalog_labels.md) と実コード（Explore 検証）から、家探しに使える資産と制約を確定する。

### 2.1 使える指標（カテゴリ別・家探し観点の評価）

| カテゴリ | 収録 | 家探しでの意味 | 「高い」＝水準 | 「伸びている」＝増減率 |
|---|---|---|---|---|
| 人口 実績（1995–2020・6半径）| `pop_{Y}_{R}` / `pop_gr_{新}_{旧}_{R}` | **住環境の現況と勢い**（最重要級）| 密度（中庸が良い）| ◎ 直近トレンド |
| 将来推計人口（R6: 2020–2070）| `pop_pred_2024_{Y}_{R}` / `pop_gr_pred_2024_{Y}_{R}` | **持続性＝家探しの決定軸** | 将来水準 | ◎◎ 2020→2040 等 |
| 地価公示（2007–2026・500m–10km）| `lp_med_{年}_{R}` / `lp_gr_2026_{旧}_{R}` | **資産性とコストの二面** | △（コスト）| ○ 資産保全 |
| 乗降客数（2011–2024・駅単位）| `pax_{Y}` / `rate_covid` / `rate_yoy` | **利便性・活力**（非線形）| ○（フロア）| ○ 回復・直近 |
| バス（現行・6半径）| `bus_n_{R}` / `bus_gr_{R}` | 二次的な生活交通 | 補助 | 補助 |
| 事業所・従業者（2012–2021）| `estab_n_*` / `emp_n_*` / `*_gr_*` | 就業・商業集積（間接）| 補助 | 補助 |

→ **主軸は人口（実績＋将来推計）・地価・乗降の3系統**（メモ準拠）。バス・事業所・従業者は**将来の重み拡張余地**として設計に含めるが MVP の既定スコアには入れない。

### 2.2 「おすすめ」に効く3つの制約（正面から扱う）

1. **市区町村が無い**：`stations` の地理属性は `prefecture` のみ（`init_schema.sql`・Explore 検証で `city/市区町村` は src・migrations に不在）。エリアの内蔵単位は**都道府県**だけ。bbox（`stations_in_bbox`）・最寄（`nearest_stations`）はあるが**いずれも駅サマリのみで指標値を返さない**。
2. **方向情報が未整備**：カタログの `higherIsBetter` は**全 583 件 null・コード未読**。→ 方向は本機能が定義（§4.3）。
3. **半径の非対称**：地価増減率＝1/2/5/10km、地価中央値＝0.5/1/2/5/10km、乗降＝半径なし、人口・将来人口・事業所＝全6半径。→ **1km で全指標が揃う**（既定）。他半径では地価増減率の 500m→1km 代替などフォールバックが必要。

### 2.3 信頼性フラグ（推薦の確度に直結）

低分母・異常値は「おすすめ」を歪めるため必ず考慮する。カタログの `reliabilityFlagKey` を参照：
- 人口：`pop_lowbase_{Y}_{R}`（基準人口<50）
- 地価：`lp_lown_{R}`（地点数僅少）／`lp_gr_lown_2026_{旧}_{R}`
- 乗降：`flag_yoy`・`flag_covid`
- 事業所/従業者：`estab_gr_lown_{R}`

→ **当該指標が低信頼の駅は、その指標をスコアから除外して残り重みで再正規化**（§4.5）。全指標が薄い駅は候補から外す。

---

## 3. データ・指標の選定（家探し既定セット）

メモの問い「どのデータを具体的に使うか／増減率か実数か」への具体回答。**既定半径 1km**、キーはすべて実在確認済み（catalog.json 照合）。

### 3.1 既定スコア指標（ファミリー・持続性重視プリセット）

| # | 役割 | 指標キー(1km) | ラベル | 種別 | 方向 | 既定重み |
|---|---|---|---|---|---|---|
| 1 | 将来持続性 | `pop_gr_pred_2024_2040_1km` | 将来人口増減率 2020→2040 | growth | 高い◎ | **0.30** |
| 2 | 現在の勢い | `pop_gr_2020_2015_1km` | 人口増減率 2015→2020 | growth | 高い◎ | **0.20** |
| 3 | 資産保全 | `lp_gr_2026_2016_1km` | 地価中央値 増減率 2016→2026 | growth | 高い○ | **0.20** |
| 4 | 駅の活力 | `rate_covid` | 乗降 コロナ前後回復率 | growth | 高い○ | **0.15** |
| 5 | 利便性水準 | `pax_2024` | 乗降客数 2024（対数パーセンタイル）| level | 中〜高 | **0.15** |
| — | 参考（既定は非加点）| `lp_med_2026_1km` | 地価中央値 2026（水準）| level | コスト/資産 | 0.00 |
| — | 参考 | `pop_2020_1km` | 人口 2020（密度）| level | 中庸 | 0.00 |

- **合計重み＝1.00**。将来＋実績人口で **0.50**（持続性を主軸）、地価トレンド 0.20、乗降 0.30。
- **「伸びている」×「高い」の両取り**：#1–4 が増減率（伸び）、#5 が水準（高さ）。地価水準・人口密度は**情報表示**として出すが既定では加点しない（家探しでは「高い地価＝コスト」のため）。
- **地価トレンドの期間**：10年（`_2016_`）を既定。短期の振れを避け、資産性の基調としてより安定。5年（`lp_gr_2026_2021_1km`）はプリセットで選択可。
- **将来人口の到達年**：2040（子育て〜住宅ローン完済の現実的地平）。より長期を見るなら 2050（`pop_gr_pred_2024_2050_1km`）も選択肢。

### 3.2 ペルソナ・プリセット（重みの切替）

同じエンジンで、重みだけ替えて3プリセットを提供（上級者は個別調整可）。

| プリセット | 将来人口 | 実績人口 | 地価トレンド | 地価水準 | 乗降回復 | 乗降水準 | 狙い |
|---|---|---|---|---|---|---|---|
| **ファミリー（既定）** | 0.30 | 0.20 | 0.20 | 0.00 | 0.15 | 0.15 | 持続性・住環境 |
| **資産性重視** | 0.20 | 0.10 | 0.25 | 0.20 | 0.10 | 0.15 | 値下がりしにくさ・立地 |
| **利便性重視** | 0.20 | 0.15 | 0.15 | 0.00 | 0.20 | 0.30 | アクセス・賑わい |

- 「資産性重視」では**地価水準を加点**（＝立地の良さ）に転じる。「割安重視」派には別途 `direction='lower'`（安いほど加点）のトグルを用意可能（§4.3）。
- 重みは**初期値であり、R6 の実データ検証で調整**（例：神奈川で上位に成長住宅地が妥当に並ぶか）。

### 3.3 半径とフォールバック

- 既定 **1km**。ユーザーが 2/5km を選んだ場合、地価増減率は同半径が存在（1–10km）。**500m 選択時のみ**地価増減率が無いため **1km で代替**（ドメインで明示フォールバック＋パネルに注記）。乗降は常に半径非依存。

---

## 4. スコアリングモデル（相対比較の定式化）

メモ「他の駅周辺と相対比較して」を、**エリア内パーセンタイルの重み付き合成**として実装する。純関数・決定的（`buildGrowth`/`kmeans` と同じ流儀）。

### 4.1 相対比較＝エリア内パーセンタイル

- 候補集合 = 選択エリア（都道府県）内の駅群。各指標について、候補集合における**その駅のパーセンタイル順位 p∈[0,100]** を求める（同値は平均順位）。
- **なぜパーセンタイルか**：地価・人口・乗降は分布が対数正規〜裾が重い。生値の z-score は外れ値（都心ターミナル）に引っ張られる。**順位ベースは頑健**で「他と比べて上位何%」という説明にも直結する。
- **絶対 vs 相対**：メモは「エリア内相対」。既定は**選択エリア内での相対**。参考として**全国パーセンタイル**を副次表示（「県内 上位8% / 全国上位25%」）して文脈を補う。

### 4.2 対数前処理（水準指標のみ）

乗降水準 `pax_2024`・地価水準など**裾の重い水準指標**はパーセンタイル化前に `log1p` を通す（順位自体は単調で不変だが、将来 z-score 系に切替可能な設計余地として前処理層を分離）。増減率（%）はそのまま。

### 4.3 方向補正（higherIsBetter が無いため自前定義）

各採用指標に `direction: 'higher' | 'lower' | 'info'` を **recommend ドメインが定義**する（カタログの null を補完）。

```ts
// 例：向きを適用（p はパーセンタイル 0..100）
const orient = (p: number, direction: Direction): number =>
  direction === 'lower' ? 100 - p : p   // 'info' は加点しない（表示のみ）
```

- 家探し既定：増減率系＝`higher`、`pax_2024`＝`higher`（対数で緩和）、`lp_med`＝`info`（既定非加点）。
- 「割安重視」トグル：`lp_med` を `lower`（安いほど加点）に切替。

### 4.4 複合スコア（重み付き平均）

```ts
// 駅ごと：採用指標のうち「値あり×信頼できる」ものだけで加重平均
const composite = (per: readonly { oriented: number; weight: number }[]): number => {
  const wsum = per.reduce((s, m) => s + m.weight, 0)
  if (wsum === 0) return NaN
  return per.reduce((s, m) => s + m.oriented * m.weight, 0) / wsum
}
```

- 結果 **0–100 の複合スコア**。0.5 刻み等に丸めず内部は連続値、表示は整数。

### 4.5 欠損・信頼性の扱い（推薦の誠実さ）

- **欠損（NaN）**：その指標を当該駅の合成から除外し、**残り重みで再正規化**（`wsum` が縮む）。
- **低信頼フラグ**：`reliabilityFlagKey` が 1 の指標は**除外**（欠損と同様）＋パネルに注記。
- **候補フィルタ**：採用指標の**有効カバレッジが一定未満**（例：重みの 60% 未満しか値が無い）の駅は「データ不足」で**候補から除外**（ランキングに出さず、別枠で件数だけ提示）。→ 「データが薄い駅を高順位にしない」。
- **極小駅の抑制**：`pop_lowbase` の駅は将来人口・人口トレンドが不安定 → 上記フィルタで自然に落ちる。

### 4.6 出力（説明可能性を担保する構造）

駅ごとに：`{ grp, name, prefecture, score, rank, subScores: [{key,label,percentile,oriented,weight,value,formatted,flagged}], coverage }`。
- **サブスコア内訳を必ず持たせる**（なぜおすすめかを説明するため）。ブラックボックスにしない。
- エリア集計：`{ prefecture(s), radiusM, preset, weights, candidateCount, excludedCount, rows }`。

### 4.7 将来の発展（設計に含めるが MVP 非実装）

- **クラスタでエリアの性格をラベル**：`kmeans`（既存・決定的）でサブスコア空間を分け「成長住宅地／成熟都心／郊外静穏」等のタグ付け。
- **重み学習**：ユーザーの選好（クリック・比較）から重みを個人化。

---

## 5. UX / 見せ方

「クリックでも会話でも同じ場所に同じ部品」（architecture §4）を踏襲し、**2つのエントリが同一の `/api/recommend`＝同一ドメイン**を叩く。

### 5.1 2つのエントリ経路

1. **AIチャット（会話）**：「神奈川県でおすすめの駅は？」「もっと便利さ重視で」「5km圏で」 → `recommendStations` ツール。自然言語で**エリア・ペルソナ・半径・除外条件**を解釈。
2. **構造化UI（クリック）**：`ランキング`/`散布` と並ぶ **「おすすめ」ボタン**（FAB）→ **おすすめモーダル**。都道府県セレクト＋ペルソナ（3プリセット）＋半径＋「低信頼を除外」。既存 `RankingDialog` が雛形（`src/components/ranking/RankingDialog.tsx`）。

### 5.2 結果の提示（3レイヤ）

- **地図**：上位 N 駅を**スコアで段階表示**（色＝スコア、任意でサイズ）＋**順位ピン(1..N)**。エリアに `fitBounds`。
  - *MVP*：既存 `highlightStations`（二値ハイライト・`grps` のみ）＋順位はパネルで。
  - *Phase2*：ハイライトソースに `score` を持たせデータ駆動 paint（`stations-circle` が既に `pax` で `interpolate` している＝実現可能・`MapView.tsx:102-124`）。新アクション `rankStationsOnMap`（または `highlightStations` に `scores?` を追加）。
- **おすすめランキング表**：複合スコア＋主要サブ指標列（将来人口・地価トレンド・乗降）。行クリック→**駅詳細ドロワー**（既存 6 タブ）で深掘り。
- **おすすめカード（上位数駅）**：大きくスコア＋**内訳（レーダー／横棒）**＋実数（将来人口・地価・乗降）＋**一言理由**（AIが言語化）。
  - *MVP*：`rankingTable`（value＝複合スコア）＋ `statTable`/`markdown` で内訳（**protocol 無改変**）。
  - *Phase2*：専用 `recommendation` パネル（スコア＋サブスコア可視化）。

### 5.3 説明可能性・信頼（"おすすめ"の必須要件）

- **なぜ？を必ず見せる**：各駅のサブスコア（県内 上位%）と実数を併記。「将来人口が県内上位10%・地価も緩やかに上昇・乗降は中程度だが回復傾向」。
- **重みの透明化**：使用プリセットと重みを表示。ユーザーが替えれば順位が変わることを体感できる（AIネイティブな対話的探索）。
- **免責**：データに基づく相対評価であり、**学区・治安・災害・実際の物件は含まない**旨を明記し、実地確認・専門家相談を促す。→ 将来データ（§7）への自然な導線。

### 5.4 AIネイティブな探索ループ

`おすすめ → 理由説明 → 条件変更（重み/半径/エリア）→ 個別駅を深掘り → 上位2駅を比較` を全て同一ドメインで往復。既存 `compareGrowth`／駅詳細と地続き。

### 5.5 モバイル

カード縦積み＋地図（既存 vaul ボトムシート）。地図は順位ピン中心、詳細はカードで。

---

## 6. 実装計画（アーキテクチャ適合・純加算中心）

architecture §3/§6/§7 に厳密適合：**ロジックは domain、`app/api` は薄いラッパ、`ai` と UI は同じ domain を消費**。既存の依存境界（ESLint：domain は UI/api/ai を import しない）を守る。

### 6.1 純加算の範囲と「拡張」の明示

- **新規追加（無改変原則を侵さない）**：`src/domain/recommend/**`、`src/app/api/recommend/route.ts`、`src/ai/tools.ts` への1ツール追加、`src/components/recommend/**`、eval/テスト。
- **既存 union への追加（additive・契約は壊さない）**：Phase2 で `src/shared/protocol.ts` に Panel 変種 `recommendation` と（必要なら）MapAction を1つ追加。**既存変種は不変**。MVP はこの追加を回避（既存パネルで表現）。
- **DB**：**都道府県版は無改変**（`valuesForColumns` 再利用）。bbox/市区町村版に進む時のみ新 RPC を追加（§6.3・§7）。
- → **記録**：P8a–P8e は「Step1 完全凍結の上に AI 層を純加算」だった。本機能は**新しい商品能力**であり、architecture §3/§6 の原則どおり **domain＋共通API を additive に拡張**する（既存契約は壊さない）。この線引きをユーザーと合意する（§9）。

### 6.2 フェーズ分解（各ブロック＝ブランチ→PR・マージはユーザー）

| ブロック | 内容 | 主なファイル（新規◎/既存編集△）| protocol/DB |
|---|---|---|---|
| **R1 ドメイン** | 純関数スコアリング＋プリセット＋パネル整形＋単体テスト | ◎`src/domain/recommend/{score,presenter,presets,panel,index}.ts`、◎`tests/recommend-*.test.ts` | 不変 |
| **R2 データ取得** | 候補×指標マトリクス取得（**既存 `valuesForColumns` 再利用**）＋ドメイン結線 | △`src/db/queries.ts`（必要なら薄い集約ヘルパのみ）、◎`src/domain/recommend/index.ts` | 不変 |
| **R3 共通API** | `/api/recommend`（Zod in/out・薄いHTTPラッパ）＋ `src/shared/api.ts` に型 | ◎`src/app/api/recommend/route.ts`、△`src/shared/api.ts`（型追加）| 不変 |
| **R4 AI 統合** | ツール `recommendStations`＋effect＋assemble マッピング＋system-prompt＋eval | △`src/ai/{tools,assemble,types,system-prompt,catalog-digest}.ts`、△`src/ai/eval/cases.ts` | 不変 |
| **R5 UI（MVP）** | おすすめモーダル＋FABボタン＋結果表示（既存パネル）＋promotion配線 | ◎`src/components/recommend/**`、△`src/components/Fab.tsx`、△`src/stores/chatStore.ts`、△`PromotionHost.tsx`/`panelGroups.ts` | 不変 |
| **R5' UX（Phase2）** | 専用 `recommendation` パネル＋地図スコア表示 | △`src/shared/protocol.ts`（union追加）、△`src/components/map/MapView.tsx`、△`useApplyMapActions.ts` | **追加** |
| **R6 検証** | 品質ゲート・eval・ヘッドレス・実データ妥当性（重み調整）| tests・pw | — |

### 6.3 再利用点（コードで確認済み）

- **マトリクス取得**：`valuesForColumns(keys: string[], prefectures: string[]): ValueRow[]`（`src/db/queries.ts:139`）＋RPC `values_for_columns`（jsonb・**LIMIT 無し**・`supabase/migrations/...values_for_columns_jsonb.sql`）。N 個の指標キーを渡せば全駅×N指標が返る → **複合スコアの入力そのもの**。
- **ピボット雛形**：`buildGrowth` の grp ピボット＋両欠損除外（`src/domain/growth/presenter.ts:36-61`）を N 指標に一般化。
- **カタログ引き**：`requireEntry(key)`/`getEntry(key)`（label・unit・format・reliabilityFlagKey・radiusM）で意味づけ（`src/shared/catalog.ts`）。半径→キー解決は `rankableVariantGroups`（`src/domain/metrics/index.ts:109`）。
- **パネル整形**：`rankingPanel`（`src/domain/ranking/panel.ts`）に倣い `recommendPanel` を追加。フォーマットは既存 `format`（`src/shared/format`）。
- **モーダル雛形**：`RankingDialog`＋`useRanking`（SWR）＋`chatStore.Promotion`＋`PromotionHost`＋`panelGroups` マッチャ＋`Fab` の一式（Explore §8）。
- **エリア/都道府県**：`PREFECTURES`（47・`src/shared/constants.ts:101-149`）、`normalizePrefectures`（`src/ai/tools.ts:46`）、`prefectureLabel`。

### 6.4 ドメイン API（想定シグネチャ・純関数）

```ts
// src/domain/recommend/index.ts（純関数・I/Oはしない）
type RecommendInput = {
  prefectures: readonly string[]      // 空＝全国（重いので UI では必須化）
  radiusM: RadiusM                    // 既定 1000
  preset: RecommendPreset             // 'family' | 'asset' | 'access'
  weights?: Partial<Record<MetricRole, number>>  // 上級者の上書き
  excludeLowReliability?: boolean     // 既定 true
  limit?: number                      // 表示件数（既定 20）
}
// 指標セットは preset × radiusM から決定的に解決（キー・方向・重み）
buildRecommendation(input: RecommendInput, rows: readonly ValueRow[]): RecommendResponse
recommendPanel(res: RecommendResponse, size?: 'compact' | 'full'): Panel
```

- `buildRecommendation` は**値の取得を受け取らない純関数**（テスト容易）。取得は `db` 層、結線は API/ツール側。
- 指標セット解決（preset＋radius→ `{key,role,direction,weight}[]`）も純関数で、`requireEntry` によりキーの実在を保証。

### 6.5 AI ツール（`recommendStations`）

```ts
// 入力（Zod）
{ prefectures?: string[], preset?: 'family'|'asset'|'access',
  radiusM?: number, excludeLowReliability?: boolean, limit?: number }
```

- ドメイン：`valuesForColumns(resolveKeys(preset,radius), prefs)` → `buildRecommendation`。
- effect：`{ kind: 'recommend', response }` を collector に push（`src/ai/types.ts` の `ToolEffect` union に追加）。
- `assemble.ts`：
  - `panelsFor`：MVP＝`[inline(recommendPanel(res,'compact'))]`（＝rankingTable ベース）。Phase2＝専用パネル。
  - `mapActionsForEffect`：`res.rows` の grp で `highlightStations`（MVP）／Phase2 は score 付きアクション＋`fitBounds`。
- `system-prompt.ts`：ツール説明1段落＋「エリア・ペルソナ・半径の聞き取り」「一般ランキング（単一指標）との使い分け」を追記。
- **既定の解釈規約**：エリア未指定なら聞き返す（全国は重い）。地図で駅選択中（P8e の文脈）なら**その都道府県**を初期エリア候補に。

### 6.6 品質・境界値テスト（CLAUDE.md §3）

- パーセンタイル（同値・単一要素・全欠損）、方向補正、重み再正規化、カバレッジ閾値、フォールバック半径、信頼性除外、決定性（同入力→同出力）。
- API：Zod 検証・未知都道府県・未知プリセット・limit 上限。
- eval：`recommend-*` ケース（「神奈川でおすすめ」→ recommend ツール＋panel＋highlight／「一般の人口ランキング」→ 従来 rankStations に振り分く／エリア未指定→聞き返し）。

---

## 7. パネル／プロトコル設計の選択肢（意思決定ポイント）

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| **MVP：既存パネル再利用** | `rankingTable`（value＝複合スコア）＋`statTable`/`markdown` で内訳。地図は二値ハイライト | **protocol/map 無改変**・最速・低リスク | スコア内訳の可視化が弱い・地図で順位が伝わりにくい |
| **Phase2：専用パネル＋スコア地図** | Panel union に `recommendation`（スコア＋サブスコア レーダー/横棒）を追加、地図をスコアで段階表示 | 家探し体験が主役級に・説明力が高い | protocol/map を additive に拡張（`MapView` 編集） |

→ **推奨：MVP を先に出荷**（既存パネルで概念実証＋重み調整）、体験の中核として磨く段で **Phase2** に投資。両者は同一ドメイン出力なので**段階移行が可逆**。

---

## 8. リスク・限界・将来拡張

- **エリア粒度（最大の限界）**：市区町村が無く、当面は都道府県。「横浜市で」に応えるには**市区町村カラムの追加が本命**（[`dataset.md`](./dataset.md) §3 の定石：`lon/lat` を N03 行政界に空間結合＝リバースジオコード → `city` 列）。**並行データトラック**として起票する。つなぎとして**地図表示範囲(bbox)×都道府県フィルタ**で「この範囲でおすすめ」を提供可（`stations_in_bbox` で grp 集合→所属県で `valuesForColumns`→bbox 内に絞る、DB 無改変）。
- **重みの主観性**：既定重みは仮説。R6 で実データ妥当性を検証（例：神奈川で成長住宅地が上位に妥当に並ぶか）し調整。プリセット＋透明化＋ユーザー調整で緩和。
- **測れない重要軸**：学区・治安・災害・生活利便・物件。→ [`dataset.md`](./dataset.md) §4（災害リスク A31/A33/A40/A49、生活利便 P04/P29/P14/P33、昼間人口）を将来重みに追加できる設計にしておく（指標セットを preset で差し替え可能に）。
- **`higherIsBetter` の未整備**：当面はドメイン定義。将来 pipeline でカタログに方向を昇格させれば、UI/AI/推薦が単一の真実を共有（architecture §5 の思想に合致）。
- **任意半径**：既定6半径のみ（architecture §5.2 の将来拡張）。当面は 1km 既定＋選択式で十分。
- **パフォーマンス**：都道府県×5–6指標のマトリクスは数千行程度（`values_for_columns` は jsonb 一括）。ドメイン計算は O(駅数×指標数)。問題なし。全国は重いので UI ではエリア必須化。

---

## 9. ユーザー確認事項（実装前に合意したい点）

1. **スコープ**：本機能は architecture §3/§6 に沿って **domain＋共通API を additive 拡張**する（P8a–P8e の「Step1 完全凍結」からは一歩広げる）。この方針で良いか。
2. **エリア粒度**：当面**都道府県**でよいか（＋bbox「この範囲」）／それとも**市区町村データ追加**（pipeline・時間かかる）を先に行うか。
3. **既定ペルソナ／重み**：§3 の「ファミリー既定重み」を初期値として進め、R6 で調整する方針でよいか。
4. **パネル**：MVP＝既存パネル再利用 → 後で専用パネル、の段階方針でよいか（§7）。
5. **地価水準の扱い**：既定は「情報表示・非加点」（家探し＝コスト観点）でよいか。「割安重視」トグルの要否。

---

## 10. 想定スケジュール（ブランチ→PR・マージはユーザー・品質最優先）

R1（ドメイン＋テスト）→ R2（データ結線）→ R3（API）→ R4（AI＋eval）→ R5（UI・MVP）→ R6（検証・重み調整）→〔合意の上で〕R5'（Phase2 パネル＋スコア地図）。各ブロックで typecheck/lint/test/build＋ヘッドレス検証、eval 合格、`git diff --stat main` で影響範囲（純加算／additive 拡張）を証跡化。

---

### 付録A：主要参照（コード実在確認済み）

- 多駅×多指標取得：`src/db/queries.ts:139`（`valuesForColumns`）／RPC `values_for_columns`（jsonb・LIMIT無し）
- スコア合成の雛形：`src/domain/growth/presenter.ts:36-61`（grp ピボット）
- カタログ：`src/shared/catalog.ts`（`CatalogEntry`・`requireEntry`）／`src/domain/metrics/index.ts:109`（半径→キー）
- パネル/プロトコル：`src/shared/protocol.ts:96-168`（Panel 7変種）・`:20-31`（MapAction）・`:188-193`（MapResponse）
- AI 結線：`src/ai/tools.ts:88-263`（5ツール）・`src/ai/assemble.ts:76-104`（effect→panels/mapActions）・`src/app/api/chat/route.ts:163-191`
- モーダル雛形：`src/components/ranking/RankingDialog.tsx`・`useRanking.ts`・`src/stores/chatStore.ts:13-27`・`PromotionHost.tsx`・`panelGroups.ts`・`Fab.tsx`
- 地図ハイライト：`src/components/map/MapView.tsx:128-140`（二値）・`:102-124`（`pax` で段階表示＝スコア地図の実現可能性）・`src/stores/mapStore.ts:27-29`
- 定数：`src/shared/constants.ts`（`RADII_M`・`PREFECTURES:101-149`・`prefectureLabel`）

### 付録B：家探し既定スコアの指標キー（1km・実在確認済み）

`pop_gr_pred_2024_2040_1km`（将来人口 2020→2040）／`pop_gr_2020_2015_1km`（実績人口 2015→2020）／`lp_gr_2026_2016_1km`（地価 2016→2026）／`rate_covid`（乗降回復）／`pax_2024`（乗降水準）。参考（非加点）：`lp_med_2026_1km`・`pop_2020_1km`。
