# データ品質チェック：乗降客数コロナ前後増減率（rate_covid）の異常値と除外不能問題

作成日: 2026-07-27 ／ 対象: 御厨駅（静岡）rate_covid=4777.9% が「低分母（⚠）を除外」で消えない ／ データ正: [`dataset.md`](./dataset.md)・[`passenger_aggregation.md`](./passenger_aggregation.md)

> 本書は**原因診断と処理プラン**。**方針は §7 で確定（2026-07-27 承認）**・コードは未実装。

---

## 0. エグゼクティブサマリ（結論先出し）

- **異常値の原因**：御厨#1（静岡・JR東海／2020年3月開業の新駅）は、コロナ前窓に**微小・実質開業前の分母**（`pax_2019=104`）を持ち、コロナ後 `pax_2024=5,073` と比較して **+4777.9%** になる。これは新駅特有の「開業ランプアップ」を「コロナ回復」と取り違えた**分母ノイズ**で、値自体は計算式どおり。
- **フラグは正しく立っている**：`station_dataset.csv` で御厨#1 の **`flag_covid=True`**（仕様 §7「|rate_covid|>100%」に合致）。`|rate_covid|>100%` の **85駅は全て flag_covid=True**（フラグ論理の見逃しは 0）。→ データ生成は正しい。
- **なぜ除外されないか（真の根本原因）**：`flag_covid`・`flag_yoy` の **2つだけが「駅属性（stationAttributes）」に誤分類**され、`metric_columns`／`station_values` に**登録されていない**。一方、アプリの**全消費経路**（ランキング除外RPC・散布除外・駅詳細バッジ）は信頼性フラグを **`values.get(reliabilityFlagKey)` ＝メトリクス値として解決**する設計。→ この2フラグは**どこからも参照できず**、除外もバッジ表示も無効化される。他の 73 フラグ（`pop_lowbase_*`・`lp_lown_*` 等）は値エントリなので正常。
- **影響範囲**：
  - `rate_covid` の「低分母を除外」＝**完全に無効**（御厨#1 を含む 238 の flagged 駅が消えない）。
  - `rate_yoy` も**同一バグ**（flag_yoy=True の 466 駅が除外不能。例：メディカルセンター +680%、トロッコ亀岡 +422%）。
  - 駅詳細カードの**コロナ/前年比の信頼性バッジも一度も表示されない**（同じ原因）。
- **最適な処理（汎用・安全）**：`flag_covid`・`flag_yoy` を**他のフラグと同じ「flag 種別のメトリクス値」に統一**する（＝正しい場所 `station_values` に置く）。これだけで**RPC・散布・バッジの3経路すべてが自動的に正常化**（アプリ／RPC のロジック改変は不要）。影響は **flagged 駅のみ・除外要求時のみ**で、残り約9,000駅には一切影響しない。**値のキャップ/削除は行わない**（分布を歪め「悪影響」を生むため却下）。
- **再発防止**：「エントリの `reliabilityFlagKey` は必ずエントリとして存在する」という**カタログ不変条件テスト**を追加すれば、この種の配線漏れを恒久的に検出できる。

---

## 1. 事象

- 症状：ランキングで乗降客数コロナ前後増減率（`rate_covid`）を見ると **御厨駅 = 4777.9%** が最上位。
- 「**低分母（⚠）を除外**」を ON にしても御厨は消えない。

---

## 2. 根本原因の診断（3層）

### 2.1 値の由来 ── 新駅＋コロナ前窓の微小分母（値は式どおり）

御厨は**同名2駅**が存在（`grp` は駅名を内包）：

| grp | 都道府県 | n_op | rate_covid | flag_covid | pax_2019 | pax_2024 | 備考 |
|---|---|---|---|---|---|---|---|
| 御厨#0 | 長崎県 | 1 | 4.4% | False | 314系列 | 191 | 既存の小駅・正常 |
| **御厨#1** | **静岡県** | 1 | **4777.9%** | **True** | **104** | **5,073** | **2020年開業の新駅** |

御厨#1 の年次 pax（CSV 実測）：2011–2018＝**全欠測**、2019=**104**、2020=2,574、…、2024=5,073。
`rate_covid` の定義（[`passenger_aggregation.md`](./passenger_aggregation.md) §6）は「コロナ後(2023–24)最新 ÷ コロナ前(2017–19)最新 − 1」。御厨#1 は pre=2019(104)／post=2024(5,073) → **5073/104 − 1 = +4777.9%**。
2019=104 は**実質開業前の微小値**（新駅のため 2019 は営業実態が無いに等しい）。→ 分母ノイズによる artifact だが、**計算式としては正しい**。

### 2.2 フラグは正しく立っている（データ生成は健全）

`station_dataset.csv` の御厨#1 は **`flag_covid = True`**。仕様（§7）の極端値条件「**|rate_covid| > 100%**」に合致。
全数検証：**`|rate_covid|>100%` の 85 駅は 100% が flag_covid=True**（見逃し 0）。→ **フラグ論理・データ生成は正しい**。問題は下流にある。

### 2.3 なぜ「除外」も「バッジ」も効かないか ── フラグの置き場所が違う（真因）

`flag_covid`・`flag_yoy` は、パイプラインで **`IDENTITY_COLUMNS`（＝駅属性・指標ではない）** に分類されている：

```python
# pipeline/catalog_rules.py:89-103  IDENTITY_COLUMNS（駅属性・11→12列）
{"key": "flag_yoy",   ... "role": "flag"},   # ← 値エントリにならない
{"key": "flag_covid", ... "role": "flag"},   # ← 値エントリにならない
```

一方、増減率メトリクスは `reliabilityFlagKey` でフラグを指すが、**フラグ自体は値エントリ**として別に作られる：

```python
# pipeline/catalog_rules.py:179-181  rate_covid は flag_covid を指すが…
if col == "rate_covid":
    return _make(col, ..., flag="flag_covid")     # reliabilityFlagKey='flag_covid'
# 対照：pop_gr は pop_lowbase_* を指し、その pop_lowbase_* は下で値エントリ化される（:201-206）
```

結果、カタログ（`src/shared/catalog/catalog.json`）では：
- `flag_covid`・`flag_yoy` は **`stationAttributes`**（`:86`, `:92`）＝**エントリではない**。
- `rate_covid.reliabilityFlagKey="flag_covid"`（`:381`）／`rate_yoy.reliabilityFlagKey="flag_yoy"`（`:363`）は**参照だけ存在**。
- flag 種別のエントリは 73 件あるが、それは `pop_lowbase_*`・`lp_lown_*`・`lp_gr_lown_*`・`bus_gr_lown_*`・`estab_gr_lown_*` のみ。**`flag_covid`・`flag_yoy` は含まれない**。

投入（`pipeline/load_to_supabase.py`）は **`metric_columns` を catalog.json の `entries` からのみ同期**（`:83-84,114-116`）。よって：
- `flag_covid`・`flag_yoy` は **`metric_columns`／`station_values` に入らない**。
- 代わりに **`stations` テーブルの boolean 列**として保存される（`STATION_COLUMNS :33-37`／`init_schema.sql:24-26`）。

ところが、アプリの**信頼性フラグ解決は全経路が「メトリクス値」を見る**：

| 消費経路 | フラグ解決の実装 | flag_covid/flag_yoy での挙動 |
|---|---|---|
| ランキング除外 | `rank_by_column` RPC が `metric_columns` から flag_key の id を引き `station_values` を LEFT JOIN、`fv.value is distinct from 1` で除外（`20260709120408_ranking_scatter_improve.sql:19-36`）| flag が metric_columns に**無い**→ `flag_id=NULL`→ `fv.value=NULL`→ `NULL is distinct from 1`＝**真**→ **全行が残る（除外 no-op）** |
| 駅詳細バッジ | `flagged = values.get(reliabilityFlagKey) === 1`（`src/domain/stations/presenter.ts:45-46`）| バンドルに flag が**無い**→ `undefined === 1`＝**false**→ **バッジが出ない** |
| 散布 低分母除外 | `buildGrowth` が各指標の `reliabilityFlagKey` 値で除外（`valuesForColumns` 経由）| 同上、フラグ値が取得できず**無効** |

> **結論**：アプリは「信頼性フラグ＝ `station_values` にある flag 種別のメトリクス値」という**単一の前提**で統一されているのに、`flag_covid`・`flag_yoy` の2つだけが**駅属性という別の場所**に置かれている。この**置き場所の不整合**が、除外・バッジのすべてを無効化している。御厨#1 は「flag_covid=True」なのに、**その True が誰からも見えない**。

---

## 3. 影響範囲（他の駅・他の指標）

CSV 全数スキャン（`station_dataset.csv`・9,273駅）に基づく。

### 3.1 rate_covid
- 算出あり：7,684駅。中央値 **−8.4%**（コロナ後の未回復を正しく捉える。全体分布は健全）。
- `flag_covid=True`：**238駅**（n_op=1:99, 2:118, 3:14, 他。pax_2024 中央値 1,851／42% が <1,000）。
- `|rate_covid|>100%`：**85駅**（全て flagged）。上位例：

| 順位 | 駅 | rate_covid | pax_2019→2024 | 種類 |
|---|---|---|---|---|
| 1 | 御厨#1（静岡）| 4777.9% | 104→5,073 | 新駅 |
| 2 | 公庄#0（京都）| 1000.0% | 1→11 | 微小駅ノイズ |
| 3 | 南阿蘇白川水源（熊本）| 950.0% | 2→21 | 微小駅ノイズ |
| … | メディカルセンター（長崎）| 550.0% | 600→3,900 | 新駅/急増 |

→ **配線を直せば、これら 238 駅すべてが「除外」で消える**（フラグは既に正しい）。

### 3.2 「2011–2018 欠測」は新駅ではなく S12 計上開始（rate_covid は健全）
当初「2011–2018 欠測＝新駅」と見なしたが、これは**誤り**だった。実測で二分される：

- **① 真の新駅（2020 年以降に開業＝2019 も欠測）：43 駅 → rate_covid は全て NaN**。コロナ前（2017–19）に値が無く割り算できないため**指標に現れない**（ランキングにも出ない）。「新駅は 0 から増えるので率が巨大になるはず」という直感は正しく、**だからこそパイプラインが計算を拒否**する。
- **② 2019 が初出（＝2019 に S12 計上開始）：650 駅**。この大半は**新駅ではなく既存の大駅**で、事業者（名鉄・JR 東海の一部路線等）の **S12 計上が 2019 年に始まった**だけ（[`passenger_aggregation.md`](./passenger_aggregation.md) §12「計上が多い年 2018/2019」）。2019 の分母が既に満額の実需なので rate_covid は**通常のコロナ微減**：

| grp | pax_2019 | pax_2024 | rate_covid | flag_covid |
|---|---|---|---|---|
| 名鉄名古屋 | 301,998 | 278,919 | −7.6% | False |
| 静岡 | 118,793 | 111,863 | −5.8% | False |
| 浜松 | 74,051 | 70,032 | −5.4% | False |

分母（pax_2019）別では、**2000 以上の 293 駅は rate_covid 中央値 −6.4%**（正当）。**100% 超（爆発）になるのは分母が僅少な駅だけ**で、それらは §3.1 のとおり**全て flagged**。

→ **配線修正後に残る「新駅の異常値」は存在しない**：真の新駅＝NaN（不出現）／爆発ケース＝分母僅少で flagged 済み／残りは既存駅の正当値。詳細は §5.2。

### 3.3 rate_yoy も同一バグ
- `flag_yoy=True`：**466駅**。`|rate_yoy|>30%`：458駅（全て flagged）。上位：メディカルセンター +680%、川根温泉笹間渡 +580%、トロッコ亀岡 +422% 等。
- **「低分母を除外」は rate_yoy でも完全に無効**（同じ配線不整合）。

### 3.4 3経路すべてで無効
ランキング除外・散布除外・駅詳細バッジの**いずれも** rate_covid/rate_yoy では機能していない（§2.3）。ユーザーが気づいたのはランキングだが、**バッジ非表示という UI 劣化も同時に起きている**。

---

## 4. 最適な処理（設計）

### 4.1 方針：フラグを「正しい場所」に統一する（特別扱いしない）

アプリ・RPC・散布・バッジは既に「信頼性フラグ＝`station_values` の flag 種別メトリクス値」で**完全に統一**されている。壊れているのは**データの置き場所だけ**。したがって最適解は：

> **`flag_covid`・`flag_yoy` を、他の 73 フラグと同じ「flag 種別のカタログ値エントリ」に格上げし、`metric_columns`／`station_values` に載せる。**

これにより **RPC・散布・バッジの3経路が同時に、コード改変なしで正常化**する。汎用（特別分岐を作らない）・安全（flagged 駅・除外要求時のみ影響）・単一の真実（フラグは1箇所）を同時に満たす。

### 4.2 修正手順（触るファイルと影響）※実装は後続

| # | 対象 | 変更 | 種別 |
|---|---|---|---|
| 1 | `pipeline/catalog_rules.py` | `flag_covid`・`flag_yoy` を `IDENTITY_COLUMNS` から外し、`build_entry` に **flag 種別（category='passenger', rankable=False）** のルールを追加 | パイプライン |
| 2 | カタログ再生成 | `build_catalog.py` 実行 → `catalog.json`（entries 583→**585**／stationAttributes 12→**10**）。`build_seed.py`/`validate_catalog.py` も再実行 | 生成物 |
| 3 | `script/create_dataset_for_AI_Database_Map.ipynb` | **source 修正のみ・再実行しない**：フラグ計算セル（cell#13 `flag_yoy`／cell#17 `flag_covid`）に `.astype("int8")` を付け、他フラグと同じ int8 に統一。**全国データの再処理はしない**（他列への偶発差分＝「他駅への悪影響」を回避）| パイプライン |
| 4 | `pipeline/load_to_supabase.py` | ①`STATION_COLUMNS`／stations DataFrame から2列を除去（melt 経由で `station_values` へ）。②**汎用正規化**：値列が bool 型なら 0/1 に変換（2列の特別扱いにせず将来の bool フラグにも自動対応）。再投入（冪等・単一トランザクション）| 投入 |
| 5 | `supabase/migrations/` | `stations` から `flag_covid`・`flag_yoy` 列を **DROP** する追加マイグレーション（冗長化解消。`level_complete` は駅属性として残す）| DB |
| 6 | `src/db/queries.ts` | `STATION_COLUMNS`／`StationRow`／マッピングから `flag_yoy`・`flag_covid` を除去（ドメイン未使用＝安全に削除。`:173-203`）| アプリ |

- **RPC・presenter・散布・AI ツールの改変は不要**（既存ロジックがそのまま機能する）。
- **純加算ではない**：本修正は pipeline＋DB＋catalog を触る（Step2 の「アプリ純加算」とは別種の**データ基盤の是正**）。デプロイ順は §6。
- **フラグ dtype は「折衷（source 修正＋汎用正規化）」で確定**：ノートブックの source を int8 に直す（将来の再実行・新データ追加で一貫／開発者の手本も統一）が、**重い全再実行はしない**。現CSVは bool のままでも load の**汎用 bool→int8 正規化**が吸収し、**次の正規な再実行で自然に int8 化**する。→ 素の「load 時2列キャスト」が残す将来負債（手本の分裂・隠れた特別分岐・整合性チェック不合格）を避ける。

### 4.3 なぜ安全か（他駅に悪影響を与えない根拠）
- フラグの**内容は不変**（既に CSV で正しく計算済み）。移すのは**格納場所だけ**。
- 「除外」は**ユーザーが ON にした時だけ**、**flagged 駅だけ**を落とす。unflagged の約9,000駅は**クエリ結果が一切変わらない**。
- ランキングの既定（除外 OFF）では**表示は現状と同一**（御厨も従来どおり見えるが、⚠バッジが付き、除外を押せば消える＝本来の仕様どおりになる）。
- 検証で「flagged 行のみ差分・unflagged 行は完全一致」を数値で担保できる（§6）。

### 4.4 却下する案（悪影響があるため）
- **値のキャップ/クリップ（例：±100% で頭打ち）**：分布を歪め、正当な大変化も潰す。`rate_covid` の意味（実測比率）を壊す。**却下**。
- **異常値を NaN で削除**：情報の恣意的削除。透明性（§10 の「flag するが消さない」思想）に反する。**却下**（新駅は §5.2 のとおり追加対応不要）。
- **RPC を stations 列も見るよう特別分岐**：2フラグだけの特別扱い＝非汎用・将来の負債。散布/バッジも別途対応が要る。**却下**。

---

## 5. 副次論点（設計判断）

### 5.1 既定挙動と UI（「消す」より「明示する」）
- 設計思想（[`passenger_aggregation.md`](./passenger_aggregation.md) §10）に従い **flag するが消さない**を維持。配線修正後：
  - ランキング行・駅詳細に **⚠ バッジ**が出る（現在は出ていない）。
  - 「低分母を除外」で消せる（本来の仕様）。
  - AI 応答は低信頼を**言及**できる（`flagged` が取得可能になるため）。
- 家探し「おすすめ」機能（[`plan_house_hunting.md`](./plan_house_hunting.md)）は、候補スコアリングから **flagged 駅を除外**する前提。本修正で正しく機能する。

### 5.2 新駅の rate_covid ── 追加対応は不要（現状維持＋文書化・確定）
§3.2 の実測により、当初懸念した「新駅の未フラグ異常値（約640駅）」は**実在しない**と判明した：
- **真の新駅（2020 年以降開業）**＝コロナ前が無く rate_covid は **NaN**（指標に出ない）。
- **爆発ケース（|率|>100%）**＝コロナ前の分母が僅少な駅で、**既に flagged**（§4 の配線修正で除外可能になる）。
- **「2011–2018 欠測」で 100% 未満の駅**＝その大半は**新駅ではなく S12 計上開始が 2019 年の既存大駅**（名鉄名古屋・静岡・浜松 等）で、値は**正当なコロナ微減**。
- **決定**：「新駅・コロナ前基準なし」フラグの**新設は不要**。上記の理解（**2011–2018 欠測 ≠ 新駅／真の新駅は NaN／爆発ケースは flagged 済み**）を本書に記録して恒久対応とする。

### 5.3 再発防止（不変条件テスト）
- `pipeline/validate_catalog.py` または単体テストに「**すべてのエントリの `reliabilityFlagKey` は、エントリのキー集合に存在する**」という不変条件を追加。今回の配線漏れを恒久的に検出できる。汎用・低コスト。

---

## 6. 実装フェーズと検証計画（後続・品質最優先）

1. **カタログ層**：catalog_rules.py 修正 → 再生成 → `validate_catalog.py`＋不変条件テスト green（entries 585）。
2. **パイプライン層**：ノートブック source を int8 に修正（**再実行しない**）→ `load_to_supabase.py` で2列除去＋**汎用 bool→int8 正規化** → 再投入（冪等）。DB で flag が 0/1 で載ることを検証。
3. **DB 検証（本番/ステージング・read-only 再現）**：
   - `select count(*) from metric_columns where key in ('flag_covid','flag_yoy')` = **2**（修正前は 0）。
   - `rank_by_column('rate_covid', null,'desc',5,0,true)` に **御厨#1 が出ない**（修正前は出る）。
   - `rank_by_column('rate_covid', null,'desc',5,0,false)` では従来どおり出る（既定表示は不変）。
   - unflagged 駅のランキング結果が**修正前後で完全一致**（差分は flagged 行のみ）。
4. **アプリ層**：`src/db/queries.ts` 整理 → typecheck/lint/test/build。
5. **UI 検証（ヘッドレス）**：御厨#1 の駅詳細に**コロナ⚠バッジ表示**／ランキングで「低分母を除外」ON→御厨・メディカルセンター等が消える／OFF→残る。rate_yoy でも同様。
6. **影響証跡**：`git diff --stat` と DB 差分（flagged のみ）を記録。

> ⚠ 本番 DB は調査時に接続タイムアウト（無料枠の一時停止と見られる）。診断はコード連鎖（catalog_rules→catalog.json→load→RPC→presenter）で確定済み。上記 DB 再現は実装時に必ず実施する。

---

## 7. 決定事項（2026-07-27 承認・#2 を 2026-07-28 改訂）

1. **修正方針**：§4「フラグを `station_values` に格上げ」で**確定**（RPC/アプリのロジック改変なし・pipeline＋DB＋catalog を是正）。
2. **フラグ dtype**：**折衷（source 修正＋汎用正規化）**＝ノートブックの source を int8 に修正（将来の一貫性のため・**再実行はしない**）＋ `load_to_supabase` を「値列が bool なら 0/1」の**汎用正規化**に（2列の特別扱いにしない）。重い全再実行を避けつつ将来負債も残さない。〔当初の「ノートブック全再実行で int8」から、一枚岩ノートブックの再処理 risk を踏まえ改訂〕
3. **stations 列**：`flag_covid`・`flag_yoy` 列を **DROP**（冗長解消・`src/db/queries.ts` も整理）。
4. **新駅の rate_covid**：**現状維持＋文書化**（§3.2・§5.2 に記録。新駅フラグは新設しない）。
5. **再発防止テスト**：「エントリの `reliabilityFlagKey` は必ずエントリとして存在」する不変条件チェックを**追加する**（§5.3）。

→ 次段は §6 の実装フェーズ（ブランチ→PR・マージはユーザー・品質最優先）。

---

## 8. 付録：主要な実測値・コード参照

**実測（CSV 全数）**：rate_covid 算出 7,684／flag_covid=True 238／|rate_covid|>100% 85（全て flagged）／最大 御厨#1 4777.9%（pax_2019=104→2024=5,073）。「2011–2018 欠測」693 駅の内訳＝真の新駅（2019 も欠測）**43 は rate_covid=NaN**／2019 初出 650 は**大半が既存大駅**（S12 計上 2019 開始・値は正当なコロナ微減）。rate_yoy: flag_yoy=True 466／|rate_yoy|>30% 458（全て flagged）。

**コード参照（診断根拠）**：
- 誤分類：`pipeline/catalog_rules.py:100-103`（flag_covid/flag_yoy が IDENTITY_COLUMNS）・`:179-181`（rate_covid→flag_covid 参照）
- カタログ：`src/shared/catalog/catalog.json:86,92`（stationAttributes）・`:363,381`（reliabilityFlagKey 参照）
- 投入：`pipeline/load_to_supabase.py:83-84,114-116`（metric_columns=entries のみ）・`:33-37,129-130`（stations 側へ boolean 投入）
- 除外RPC：`supabase/migrations/20260709120408_ranking_scatter_improve.sql:19-36`（flag を metric_columns 経由で解決）
- バッジ：`src/domain/stations/presenter.ts:45-46`（`values.get(reliabilityFlagKey)===1`）
- スキーマ：`supabase/migrations/20260707125114_init_schema.sql:24-26`（stations の flag 列）
- アプリ読取：`src/db/queries.ts:173-178,202-203`（StationRow の flagYoy/flagCovid＝ドメイン未使用）
- 仕様：`docs/passenger_aggregation.md` §6（rate_covid 定義）・§7（flag_covid 条件 |率|>100%）・§10（flag するが消さない）
