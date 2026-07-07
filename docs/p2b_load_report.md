# P2b 投入検証レポート（自動生成）

`pipeline/validate_load.py` が CSV と Supabase を独立照合。**9/9 PASS**（✅ ALL PASS）

## 実測値

- stations: **9,273** 行
- station_values: **4,390,790** 行
- DB サイズ: **348 MB**（うち 3テーブル 330 MB）

## チェック結果

- [PASS] metric_columns 件数 = 488
- [PASS] stations 件数 = CSV 行数 = 9273
- [PASS] (a) station_values 件数 = CSV 非NaN セル数（487列）
- [PASS] (b) 列ごとの件数一致（487列）
- [PASS] (c) 無作為 300 セルの値一致
- [PASS] (d) 全国計（sum）一致：7列
- [PASS] lp_near_use（stations）非null件数一致
- [PASS] pax_latest = 最新非NaN乗降客数（抜取23件）
- [PASS] (e) DB サイズ < 400MB

