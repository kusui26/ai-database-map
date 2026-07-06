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

## 前提

- Python 3.12 系（`python3 --version`）。カタログ生成は標準ライブラリのみ（pandas 不要）。
- `data/derived/station_dataset.csv` が存在すること（生成は `script/` のノートブック）。
