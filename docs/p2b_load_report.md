# P2b 投入検証レポート（自動生成）

`pipeline/validate_load.py` が CSV と Supabase を独立照合。**9/9 PASS**（✅ ALL PASS）

## 実測値

- stations: **9,273** 行
- station_values: **5,724,484** 行
- DB サイズ: **435 MB**（うち 3テーブル 415 MB）

## チェック結果

- [PASS] metric_columns 件数 = CSV 値列数 = 658
- [PASS] stations 件数 = CSV 行数 = 9273
- [PASS] (a) station_values 件数 = CSV 非NaN セル数（657列）
- [PASS] (b) 列ごとの件数一致（657列）
- [PASS] (c) 無作為 300 セルの値一致
- [PASS] (d) 全国計（sum）一致：7列
- [PASS] lp_near_use（stations）非null件数一致
- [PASS] pax_latest = 最新非NaN乗降客数（抜取23件）
- [PASS] (e) DB サイズ < 475MB（無料枠 500MB の 95%）

