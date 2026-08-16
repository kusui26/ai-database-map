# P2b 投入検証レポート（自動生成）

`pipeline/validate_load.py` が CSV と Supabase を独立照合。**10/10 PASS**（✅ ALL PASS）

## 実測値

- stations: **9,273** 行
- station_values: **6,020,472** 行（フラグの 0 は格納しない規約で 866,141 行を省略）
- DB サイズ: **417 MB**（うち 3テーブル 397 MB）
- `station_values.value` の型: **real**（期待値も float4 に丸めて厳密比較）

## チェック結果

- [PASS] metric_columns 件数 = CSV 値列数 = 784
- [PASS] stations 件数 = CSV 行数 = 9273
- [PASS] (a) station_values 件数 = CSV 非NaN セル数 − フラグの 0（783列）
- [PASS] (b) 列ごとの件数一致（783列）
- [PASS] (c) 無作為 300 セルの値一致
- [PASS] (d) 全国計（sum）一致：9列
- [PASS] lp_near_use（stations）非null件数一致
- [PASS] pax_latest = 最新非NaN乗降客数（抜取23件）
- [PASS] (e) DB サイズ < 475MB（無料枠 500MB の 95%）
- [PASS] (f) フラグ列に値 0 の行が無い（行が無い＝0 の規約）

