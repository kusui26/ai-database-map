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
- `data/derived/station_dataset.csv` が存在すること（生成は `script/` のノートブック）。
