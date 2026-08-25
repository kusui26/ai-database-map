# pipeline — データ生成・カタログ生成（Python）

CSV（`data/derived/`・gitignore）からアプリの契約物を生成する Python スクリプト群。
将来は Supabase 投入（P2b）もここに置く。

## メトリクス・カタログ（P1）

`data/derived/station_dataset.csv`（499列）→ `src/shared/catalog/catalog.json`
（488 値列エントリ ＋ 11 駅属性）を生成する。**カタログはコード（契約）としてコミットする**
（`docs/plan_fable.md` §2.2-③「コードが正・DB はミラー」）。UI 選択肢・API 検証・AI ツール記述は
すべてこの 1 ファイルから派生する。

```bash
python3 pipeline/build_catalog.py      # catalog.json + docs/catalog_labels.md を生成
python3 pipeline/validate_catalog.py   # CSV・dataset.md §2 と全数照合（全 PASS で exit 0）
```

| ファイル | 役割 |
|---|---|
| `catalog_rules.py` | 列名（`docs/dataset.md` §2 命名規約）→ `CatalogEntry` の変換ルール（ラベル・単位・出典の単一定義元） |
| `build_catalog.py` | CSV ヘッダを読み、カタログ JSON と日本語ラベル一覧を出力 |
| `validate_catalog.py` | 生成物を CSV ヘッダ・`dataset.md` §2 のカテゴリ別件数に**独立照合**（生成ロジックのバグも検出） |

データ更新やデータセット拡張（`dataset.md` §3 の定石）でCSV列が増減したら、`build` → `validate`
を再実行してカタログを更新する。列名から機械生成するため **指標追加＝列追加**でUI/API/AIが自動追従する。

## ハザード・レイヤカタログ（260825・水害 Phase 0）

水害レイヤの**意味**（ラベル・階級・色・何 m か・どうすべきか・網羅性の注記・出典）を
`src/shared/hazard/hazard-catalog.json` に生成する。メトリクス・カタログと違って**CSV を読まない**
——原典が「タイル配信＋公表資料」なので、`hazard_rules.py` が知識そのものの単一定義元になる。
凡例 UI と Gemini はこの 1 ファイルを読む（フロントに凡例を直書きしない・`docs/260824_flood.md` §5.4）。

```bash
python3 pipeline/build_hazard_catalog.py           # hazard-catalog.json + docs/hazard_layers.md を生成
python3 pipeline/build_hazard_catalog.py --check   # 生成物が rules と一致するか検査（差分があれば exit 1）
```

| ファイル | 役割 |
|---|---|
| `hazard_rules.py` | レイヤ定義（15 レイヤ・55 階級）と配色の根拠。**手で編集するのはここだけ** |
| `build_hazard_catalog.py` | JSON と日本語一覧を出力。`--check` は「JSON を手で書き換えた」事故を落とすゲート |

**配色は `colorSource` で確からしさを型に残す**：`official`＝国交省『洪水浸水想定区域図作成マニュアル
（第 4 版）』表-7.2／表-7.4 の RGB（配信タイルの画素実測とも一致を確認済み）、`measured`＝公式仕様を
確認できず実測で得た色（土砂災害の 3 レイヤ）、`null`＝未確定。凡例 UI は `measured` に注記を出す。

年度更新（A31a は毎年 5 月）でタイルの中身が変わったら、`hazard_rules.py` の `vintage` を上げて
`build` を実行し、`tests/hazard-catalog.test.ts` を通す。

## ハザードの 250m メッシュ化（260825・水害 Phase 1b）

洪水・内水の想定区域を **1 次メッシュごとの 320 × 320 の 250m 格子**へ落とし、
`public/hazard/**` に配布アーティファクトとして置く。ここだけが「原典 → メッシュ」の唯一の経路で、
アプリ側（`src/shared/hazard-mesh.ts`）が同じ規約で読む。

```bash
python3 pipeline/fetch_hazard_mesh.py          # 原典を data/hazard_raw/ へ（約 4.9GB・再実行で続きから）
python3 pipeline/fetch_hazard_mesh.py --list   # 落とさずに対象と総量だけ見る
python3 pipeline/build_hazard_mesh.py          # メッシュ化 → public/hazard/** と data/derived/hazard_mesh.csv
python3 pipeline/validate_hazard_mesh.py       # §4 の実測の再現・索引の整合（全 PASS で exit 0）
python3 pipeline/validate_hazard_mesh.py --tiles 800   # 公式タイルとの画素照合も行う
```

| ファイル | 役割 |
|---|---|
| `mesh_grid.py` | 標準地域メッシュの格子演算（`src/shared/mesh.ts` の Python 版）。**規約の単一定義元** |
| `fetch_hazard_mesh.py` | A31b（洪水・1次メッシュ単位）／A51（内水）／G04-d（標高）を取得 |
| `build_hazard_mesh.py` | ラスタ化してタイル・索引・CSV を書き出す |
| `validate_hazard_mesh.py` | 生成物を**国勢調査 250m メッシュ全数**と公式タイルに独立照合 |

**格子の規約**（ここを外すと静かに壊れる）：1 次メッシュ ＝ 320 × 320、**row 0 は南端・col 0 は西端**、
行優先（`row * 320 + col`）、1 セル 4 ビット（バイトの上位ニブルが偶数番目）、値は**国土数値情報のコード値**、
0 は該当なし。該当判定は「**250m セルに少しでも重なれば該当**」＝ セル内の最大ランク（安全側）。

**原典は A31b（1 次メッシュ単位）を使う。** プランは A31a（河川単位）を挙げていたが、A31b は
A31a をオーバレイして 1 次メッシュで切ったもので中身は同じ。出力の単位とファイルの単位が一致するので、
200MB 級のファイルでもメモリに載せずに済み、メッシュどうしを並列に処理できる。

## 所得データの取得（260812）

駅×半径の「1 人当たり課税対象所得（＝平均年収）」を作るための素データを取る
（設計は `docs/260811_income.md`）。**どちらも `data/` に落とすだけで、コミットされるのはコードのみ。**

```bash
python3 pipeline/fetch_income.py              # 課税対象所得・納税義務者数（2015/2020/2025 年度）
python3 pipeline/fetch_working_age_mesh.py    # 15〜64 歳人口の 250m メッシュ（2015/2020・按分の重み）
```

| スクリプト | 取得先 | 出力 | 検証 |
|---|---|---|---|
| `fetch_income.py` | 2015/2020＝e-Stat API（社会・人口統計体系）／**2025＝総務省 xlsx** | `data/市町村税課税状況/income_{年度}.csv`（1,741 団体）| 全国計を既知の値と照合 |
| `fetch_working_age_mesh.py` | e-Stat API（国勢調査 250m メッシュ・`cdCat01=0100`）| `data/国勢調査_人口及び世帯_{年}_mesh250/age1564_<区画>.csv`（151 区画）| 全国計を公式値と照合 |

**なぜ 2025 年度だけ取得元が違うか**：SSDS は 2024 年度までで、令和7年度（2025 年度）は
総務省サイトにしか無い。SSDS への反映は毎年 6 月頃なので、API だけに寄せると常に 1 年遅れる。
`fetch_income.py` が**出力の列・単位・件数を 2 経路で揃える**ので、下流は取得元を意識しない。

**罠**（どちらも検証で担保している）

- SSDS の 5 桁コードには **`13100 東京都 特別区部`（23 区の集計行）**が混ざる。除外しないと
  課税対象所得が 30.5 兆円ぶん二重計上になる（政令市は「市計」に値があり行政区は `-` なので除外しない）。
- 15〜64 歳メッシュの保存名は **`age1564_*.csv`**。`mesh` で始めるとノートブックの人口ローダ
  （`mesh*.csv` を glob）に混ざる。

## 売上データの取得（260816）

駅×半径の「**目的地としての売上**」（小売 ＋ 飲食・宿泊 ＋ 娯楽ほか）を作るための素データを取る
（設計は `docs/260816_sales.md`）。**どちらも `data/` に落とすだけで、コミットされるのはコードのみ。**

```bash
python3 pipeline/fetch_sales.py           # 市区町村の業種別売上（2016/2021 年調査）
python3 pipeline/fetch_industry_mesh.py   # 2016 の 500m メッシュ 産業別従業者数（149 区画）
```

| スクリプト | 取得先 | 出力 | 検証 |
|---|---|---|---|
| `fetch_sales.py` | e-Stat API（経済センサス‑活動調査。**業種ごとに別の表**）| `data/経済センサス_売上/sales_{2016,2021}.csv`（1,896／1,897 団体・14 列）| 市区町村の合計を既知の全国計と照合＋代表 6 市区町村を個別照合 |
| `fetch_industry_mesh.py` | e-Stat API（経済センサス 500m メッシュ・`cdCat01=0290/0330/0340`）| `data/経済センサス_活動調査_事業所数及び従業者数/2016_industry/eco2016ind_<区画>.csv`（149 区画）| 総数（`0200`）も同時に取り、**区画ごとに既存 `2016/eco2016_*.csv` と 1 人単位で照合**＋全国計 56,872,826 人 |

**なぜ業種ごとに表が違うか**（`docs/260816_sales.md` §2.1）

| 業種 | 2021 | 2016 | 理由 |
|---|---|---|---|
| 小売 | `0004006342` 事業活動別 `05` | `0003218747` `4280` | 大分類Ｉは約 7 割が卸売。事業活動別なら小売だけ取れる |
| 飲食・宿泊 | `0004006322` `M`・経営組織 総数 | `0003218721` `15140` | 本所比 9.4% で補正が要らない |
| 娯楽ほか | `0004006324` `N` の総数 − 本所 | `0003218742` `15750` | 本社が全国の売上を一括計上する（港区でＮ売上の 89%）|

**3 つの補正**（`fetch_sales.py` が吸収するので、下流は取得元を意識しない）

1. **政令市の「市計」＋特別区部の 21 コードを除外**（含めると 2021 のＩが +357 兆円の二重計上）
2. **娯楽は「総数 − 本所」**（単独＋支所の直和は秘匿ぶん落ちて全国計から −3.8% ずれる）
3. **小売は 2021 にだけ個人経営分を足す**（2021 の表は個人を除き、2016 は含む。分母のメッシュ従業者は
   個人を含むので分子も含める。比率は**都道府県別に実測**＝全国 89.1%・県別 73.1〜95.5%）

**罠**

- 2016 のメッシュは **`2016_industry/` に分けて保存**する。`2016/eco2016_*.csv` と同じフォルダに
  似た名前で置くと、ノートブックの既存ローダ（glob）に混ざる。
- 秘匿（`X`）・該当なし（`-`）・非公表（`･･･`）は **0 に潰さず空欄**。売上が秘匿の市区町村では
  個人経営分も足さない（`retail_million_yen` が空欄のまま）。

## 独立検証（260812）

`data/derived/` の生成は**すべてノートブック 1 回で完結する**（`script/create_dataset_for_AI_Database_Map.ipynb`）。
以前は「ノートブックを再実行しない」前提で CSV を後から加工するスクリプトが 2 本あったが、
所得データ追加のためにノートブックを再実行したタイミングで本体へ畳んだ（`docs/260811_income.md` §4）。

残した 2 本は**書き込みをやめ、独立した方法で検証するだけ**にしてある。生成経路と検証経路が
別なので、両者が一致することが双方の正しさの裏付けになる。

```bash
python3 pipeline/verify_pax_lown_flag.py    # flag_covid_lown を rate_covid から再計算して照合（85 群）
python3 pipeline/verify_station_routes.py   # 路線表を最近傍マッチングで再構成して照合（10,424 行）
```

| スクリプト | 何を検証するか |
|---|---|
| `verify_pax_lown_flag.py` | `flag_covid_lown = \|rate_covid\| > 100%` が成り立つか／S12 から独立に数えた **85 群**と一致するか／`flag_covid` の部分集合か |
| `verify_station_routes.py` | S12 を読み直し、**駅名が同じグループのうち最も近いもの**へ距離で貼り直した結果が、ノートブック出力と完全一致するか（新幹線 103 駅・東海道新幹線 17 駅も確認）|

## 前提

- Python 3.12 系（`python3 --version`）。カタログ生成は標準ライブラリのみ（pandas 不要）。
- 取得スクリプトは `requests` / `pandas` / `openpyxl` と `.env` の `ESTAT_APP_ID` を使う。
- `data/derived/station_dataset.csv` が存在すること（生成は `script/` のノートブック）。
