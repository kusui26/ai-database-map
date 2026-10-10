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
python3 pipeline/validate_hazard_mesh.py --points 400  # 乱点で「区間が真値を含む」ことを確かめる（本丸）
python3 pipeline/validate_hazard_mesh.py --centres 800 # 中心での照合（添字・上下反転の検査のみ）
```

| ファイル | 役割 |
|---|---|
| `mesh_grid.py` | 標準地域メッシュの格子演算（`src/shared/mesh.ts` の Python 版）。**規約の単一定義元** |
| `fetch_hazard_mesh.py` | A31b（洪水・1次メッシュ単位）／A51（内水）／G04-d（標高）を取得 |
| `build_hazard_mesh.py` | ラスタ化してタイル・索引・CSV を書き出す |
| `validate_hazard_mesh.py` | 生成物を**国勢調査 250m メッシュ全数**と公式タイルに独立照合 |
| `build_jma_areas.py` | 市区町村コード → **気象庁の発表区域**の対応表（Phase 3・アラートの区域解決） |

**格子の規約**（ここを外すと静かに壊れる）：1 次メッシュ ＝ 320 × 320、**row 0 は南端・col 0 は西端**、
行優先（`row * 320 + col`）、**1 セル 1 バイト**（**上位ニブル＝セル内の最大ランク**・**下位ニブル＝被覆率 0–15**）。
最大ランクは**国土数値情報のコード値**で 0 は該当なし。**フォーマット v2**（`index.json` の `version`）。

> **セルは点ではなく 250m の「区間」である。** 250m セルの **33% は区域と非区域の混在**なので、
> 1 セルに 1 値を持たせると点で聞かれたときに必ず嘘をつく（v1 の代表点判定は **7.7% 誤答**していた）。
> - **最大ランク** … `1×all_touched` で焼いた**上界**。真値は必ずこれ以下。発災時の判断に使う
> - **被覆率** … `8×サブセル`（64 点・1 点 ≒ 31.25m）の中心で測った面積の割合。
>   **厳密なのは両端だけ**——`0` は「一切かからない」、`15` は「全域」。`1–14` は「一部」としか言えない
>
> 点で確定させたいときは**浸水ナビ API か公式タイルの画素に降りる**（優先順位は
> `docs/260824_flood.md` §6.3）。どの経路に降りても、答えは必ず `(0, 最大ランク]` に入る。

### 気象庁の発表区域の対応表（Phase 3）

```bash
python3 pipeline/build_jma_areas.py          # 生成 → src/shared/hazard/jma-areas.json
python3 pipeline/build_jma_areas.py --check  # 生成せず、対応の網羅率だけ出す
```

警報は**気象庁の区域単位**で出るが、地点から分かるのは**市区町村コード**。その橋渡し。
**正は `warning/map.json` が実際に使っている区域コード**で、区域定義（`area.json` の class20）とはズレる
——`area.json` は横浜市を「北部／南部」に分けているのに、警報は「横浜市」で出る。
政令市の区（大阪市北区など）はどの区域にも前方一致しないので、`muni.js` の
「大阪市　北区」という表記から**市へ畳んでから**引く。詳しくは `docs/260824_flood.md` §8.4。

**原典は A31b（1 次メッシュ単位）を使う。** プランは A31a（河川単位）を挙げていたが、A31b は
A31a をオーバレイして 1 次メッシュで切ったもので中身は同じ。出力の単位とファイルの単位が一致するので、
200MB 級のファイルでもメモリに載せずに済み、メッシュどうしを並列に処理できる。

**並列度は CPU 数ではなく実メモリから決まる**（`--workers` で上書きできる）。1 次メッシュ 1 枚の処理は
ピークで約 1.2GB 使うので、8.6GB のマシンでは 3 並列になる。**ここを CPU 数（8）にすると
スワップに落ちて数倍遅くなる**——実測で、6 並列は 40 分経っても 115 枚中 10 枚すら終わらなかった
（`docs/260824_flood.md` §5.9）。全国 1 回の生成は 3 並列で **約 60 分**。

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

## 路線（運行系統）— 駅データ.jp（L1・261008）

アプリの「路線」を、国土数値情報 S12 の**法令上の路線**（`station_routes`）ではなく、利用者が呼ぶ路線
（**運行系統**）で持つ。S12 の「山手線」は 17 駅（品川〜新宿〜田端）だが、利用者の言う山手線は環状の 30 駅
（`docs/261001_fix_user_feedback_ui.md` §6.8）。原典は**駅データ.jp の有料版（2024-04-26）の統合前の 4 つの CSV**
（`data/駅データjp/`・gitignore）。**取り直さない**（費用のため・計画書 §12-19）ので、版は固定。

```bash
python3 pipeline/build_lines.py              # 駅レコード → アプリの駅（grp）・直しの表 → data/derived/lines*.csv
python3 pipeline/validate_lines.py           # 独立の検証（全 PASS で exit 0）
python3 pipeline/validate_lines.py --osm     # ＋ OpenStreetMap の主な 12 系統と突き合わせ（ネットワーク・キャッシュあり）
python3 pipeline/load_lines.py               # lines / line_stations へ投入（単一トランザクション・投入後の確認つき）
python3 pipeline/golden_lines_test.py        # 投入後：共通の条件 line_cds（L2）を本物の DB で確かめる（REST 経由も）
```

| ファイル | 役割 |
|---|---|
| `line_rules.py` | **手で編集するのはここだけ**：名前の直し（16）・駅の追加（2）・事業者名の読み替え（6・社名変更）・表示名が S12 と違ってよい通称（26）・結べなくてよい駅・駅データ.jp に無い S12 の路線（ケーブルカーなど）・人が確かめた事業者 → 会社名・固定の確認・OSM の系統 |
| `line_common.py` | 原典とアプリの駅の読み込み、駅名の鍵（B1 の `nameKey` に括弧書き・末尾の「駅」を足したもの）、距離 |
| `build_lines.py` | 駅レコード（路線 × 駅）を、駅名の鍵が同じで 1.5km 以内の駅へ結ぶ。候補が複数なら**会社名 → 駅名の完全一致 → 近さ**。事業者 → S12 の会社名は数で決める |
| `validate_lines.py` | build の照合を使わずに確かめる：網羅・形・取り違えの兆候 2 つ・事業者の対応・事業者名（古い社名が残っていない・表示名が S12 と違うのは確かめた通称だけ）・固定の確認・どの路線にも属さない駅 |
| `load_lines.py` | `copy_lines()`。`load_to_supabase.py` の全量投入からも呼ぶ（`line_stations` は `stations` の truncate cascade で消える） |
| `golden_lines_test.py` | L2 の共通の条件 `line_cds` を本物の DB で確かめる：路線ごとの駅の集合が `line_stations` と完全一致（抜き取り 44 路線）・路線どうし OR／会社・都道府県と AND・ランキングと散布の件数・`line_names()`・以前の呼び方の互換・REST（anon） |

**生成物**（`data/derived/`・gitignore）：`lines.csv`（601 路線）・`line_stations.csv`（10,618 行）が DB に入るもの。
`line_links.csv`（駅レコードごとの結びつけ・方法・距離）と `line_unassigned.csv`（どの路線にも属さない駅）は監査用。
`lines_loaded_grps.txt` は**投入が成功したときだけ** `load_lines.py` が書く（次の build で「前回の投入から増えた駅」を見つける）。

**S12 を更新したら**：`build_lines.py` → `validate_lines.py`。「どの路線にも属さない駅」に**要対応**が出たら
（新駅・改称。乗降がまだ無い新駅も「前回の投入から増えた駅」として出る）、`line_rules.py` の直しの表に足してから
`load_lines.py`。路線名・事業者名の変更は自動では入らないので、見つけたら名前の直しで読み替える。
社名が変わると（S12 は新しい社名・2024-04 版は古い事業者名）、検証の「表示名が S12 の会社名と違うのは確かめた通称だけ」が落ちる。
社名変更なら `COMPANY_NAME_FIXES`、通称なら `COMPANY_DISPLAY_NAMES` に足す（画面と AI は会社を事業者名で出すので、古い社名を黙って出さない）。

## 場所の条件 — 市区町村・範囲・起点から N m（B2・261008）

データの投入は無い（migration `20261008210000_area_filters.sql` だけ）。駅の絞り込みの述語 `station_matches_filters` に
市区町村・範囲・近傍を寄せ、ランキング・散布・一覧の 3 つの RPC が同じ述語を使う。近傍のときは起点からの距離（`dist_m`）も返す。

```bash
python3 pipeline/golden_area_test.py --trial   # 当てる前：migration をトランザクションの中で当てて確かめ、ロールバック
python3 pipeline/golden_area_test.py           # 当てたあと：本物の DB と REST（anon）で確かめる（全 PASS で exit 0）
```

| ファイル | 役割 |
|---|---|
| `golden_area_test.py` | 駅の集合を RPC を通さずに `stations` から直接数えて突き合わせる：市区町村の前方一致（横浜市＝全区）・JIS コード・都道府県と AND・「%」を特別扱いしない・範囲・近傍（竹橋から 5km＝129 駅・最寄地価 1 位は新宿三丁目 4,882m）・ランキングと散布と一覧で同じ件数・路線と会社とも AND・以前の呼び方の互換・述語が展開されること（実行計画）・`station_catalog()`（全 9,273 駅）・REST（anon） |

## エリアの区域の値 — 行政区域の公表値・沿線のメッシュ按分（B5a・261010）

「横浜市全体の人口は？」「東横線の沿線の人口は 2050 年までにどうなる？」に、**区域全体の値**で答えるためのデータ
（駅の値を足すと、重なった円を二重に数える）。行政区域（全国・都道府県・政令市・東京 23 区・市区町村・区）は**公表値**、
沿線（路線の駅から 500m・1km・2km の円を重ねた範囲）は**メッシュの面積按分**（駅の値と同じ方法）。
設計は `docs/261001_fix_user_feedback_ui.md` §6.12、データの説明は `docs/area_values.md`。

```bash
python3 pipeline/fetch_area_stats.py           # e-Stat の 8 表と社人研の結果表（照合用）→ data/area_raw/（取得済みは skip・--force）
python3 pipeline/build_area_values.py          # 行政区域 → area_units.csv・area_values.csv・area-catalog.json（照合が崩れたら書かない）
python3 pipeline/build_line_corridors.py       # 沿線 601 路線 × 3 幅 → line_corridors.csv・line_corridor_values.csv（約 2 分）
python3 pipeline/validate_area_values.py       # 独立の検証（--mesh でメッシュの按分と公表値のずれも・約 5 分）
python3 pipeline/load_area_values.py           # area_metrics / areas / area_values へ投入（単一トランザクション・投入後の確認つき）
python3 pipeline/golden_area_values_test.py    # 投入後：本物の DB と REST（anon）で確かめる（当てる前は --trial）
python3 pipeline/golden_area_summary_test.py   # 要約と色分けの関数（261010 B5b）：本物の DB と REST（anon）で（当てる前は --trial）
python3 pipeline/build_area_values.py --check  # カタログ JSON が規則と一致するか
```

| ファイル | 役割 |
|---|---|
| `area_rules.py` | **手で編集するのはここだけ**：年・幅・e-Stat の表・単位の特例（境界未定地域・所属未定地・北方領土・浜松・浜通り）・無い値の理由・県の和の例外（山口村・上九一色村）・照合の固定値・区域の指標（カタログの元） |
| `area_common.py` | 置き場所・エリアの鍵（`jp`／`pref:14`／`muni:14100`／`line:26001@1000`）・e-Stat の生データの読み方・行政区域（N03）の単位 |
| `area_mesh.py` | メッシュの読み方（国勢調査 250m・経済センサス 500m・将来推計人口 R6）と正積図法の矩形。駅の値を作ったノートブックと同じ規約 |
| `fetch_area_stats.py` | 公表値を取る。取得の直後に全国の値を公表値と照合し、崩れた表は保存しない。**appId と URL を出さない**（失敗の理由は型と HTTP の状態だけ） |
| `build_area_values.py` | 区・市区町村は市区町村データ、都道府県・全国は公表の行、推計は R6 を `SHICODE` で足す。無い値には理由が要る。内訳の和（区＝市・23 区＝特別区部・市区町村＝県・県＝全国）と推計の 2020 年＝国勢調査を照合 |
| `build_line_corridors.py` | 沿線の面を作り、250m（人口・推計）と 500m（事業所・従業者）のセルを重なりの割合で按分する |
| `validate_area_values.py` | build の照合を使わずに確かめる：推計＝社人研（13,601 組）・固定値・沿線 ≥ 最大の駅の円・≤ 駅の円の和・円が重ならない沿線は駅の値の和と一致・形 |
| `load_area_values.py` | `copy_area_values()`。areas は stations を参照しないので全量投入では消えない（路線・駅を作り直したら沿線から作り直す） |
| `golden_area_values_test.py` | 本物の DB で：件数・固定値・カタログの写し・内訳の和・沿線の単調性と**DB の駅の値**との比べ・無い値の理由・権限（anon は SELECT だけ）・大きさ・速さ・REST（anon） |
| `golden_area_summary_test.py` | 要約と色分けの関数（B5b）を本物の DB で：区域の行と内訳の子・駅の数（政令市・東京 23 区・全国）・分布を numpy と照合（7 通りの絞り込み）・値の無い駅・権限と設定（`search_path`・`extra_float_digits`）・速さ・REST と直接の一致（大きな値も 1 桁まで） |

**生成物**（`data/derived/`・gitignore）：`area_units.csv`（行政区域 1,961）・`area_values.csv`（46,737 値）・`line_corridors.csv`（1,803 沿線）・
`line_corridor_values.csv`（34,257 値）。カタログ `src/shared/catalog/area-catalog.json`（24 指標）はコミットする契約物。

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
