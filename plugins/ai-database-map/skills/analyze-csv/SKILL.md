---
name: analyze-csv
description: AI Database Map の build_dataset で駅×指標の CSV を作り、ローカルの pandas で分析するときの作法。多数の駅の比較・スコアリング・相関・重み付き合成に使う。Use when analyzing many stations at once via the build_dataset MCP tool and local pandas.
---

# 駅×指標データセットのローカル分析

「横浜市の全駅を比較して」「おすすめの駅を点数化して」のような**多数の駅 × 複数指標**の分析は、
`get_station_detail` を駅数ぶん繰り返さず、CSV を 1 回で作ってローカルで分析する。

## 手順

1. **対象集合**：`mcp__plugin_ai-database-map_station-data__list_stations`
   （municipality は前方一致・「横浜市」で全区。operators / routes・bbox・near でも絞れる）。
   `truncated: true` なら全件ではない——limit を上げるか条件を絞り、漏れの可能性を本文で言う。
2. **データセット生成**：`mcp__plugin_ai-database-map_station-data__build_dataset` に
   `stations`（list_stations と同じセレクタ）か `grps` と、`metrics`（ファミリ名で足りる。
   例 `["pax", "rate_covid", "pop", "pop_gr", "lp_med", "lp_gr", "bus_n", "estab_n"]`）を渡す。
   応答は**列スキーマとプレビューだけ**で、値は `url` の CSV・列の意味と出典は `meta_url` にある。
   災害を条件に使うなら `includeHazard: true` で `hazard_` 列（順序尺度）を結合するか、
   `mcp__plugin_ai-database-map_station-data__get_hazard_summary`（≤500 駅・事前計算）を使う。
3. **取得**：pandas は URL を直接読める。**meta も必ず読む**（単位・年次・半径・出典・注意）。

   ```python
   import json, urllib.request
   import pandas as pd

   df = pd.read_csv(url)  # build_dataset の url
   meta = json.load(urllib.request.urlopen(meta_url))
   print(meta["notes"], [c["key"] for c in meta["columns"]])
   ```

   再現性が要る作業では CSV・meta・スクリプトをファイルに保存して残す
   （リポジトリ利用時は `scripts/fetch_dataset.py` が同じことをする）。

4. **前処理（黙って使わない）**：
   - **欠損は空欄**（データ無し）。0 と混同しない。`df.isna().sum()` で列ごとに確認し、
     除外・補完のどちらにしても本文で件数を言う。
   - **フラグ列（`flag_*`・`*_lowbase`・`*_lown`）は 1=注意**（低分母・極端値）。
     該当行は除外するか ⚠ を付けて注記する。どの値列のフラグかは列メタの `flag` にある。
5. **合成（スコアリング）するとき**：
   - 単位の違う値をそのまま足さない。**z-score か min-max で正規化してから**重み付き合成。
   - 重みは好みなので**先にユーザーに確認**する（勝手に決めて「おすすめ」と言わない）。
   - 災害リスクは**線形スコアに足さない**（順序尺度）。足切りか段階減点かをユーザーに確認し、
     言い方は hazard-reading スキルに従う（「安全」と言わない）。
6. **頑健性**：重みを ±20% 振って**順位が入れ替わるか**を確認し、僅差は僅差と言う。
7. **出典**：meta の `sources`（source / license / 対象列）を最後に列挙する。
8. **URL の期限**：url / meta_url は**約 24 時間で失効**する（`expiresAt`）。失効・410 のときは
   build_dataset を呼び直す（保存済みの CSV があればそれを使い続けてよい）。

## してはいけないこと

- カタログに無い列名を発明する（列は必ず build_dataset の応答・meta の `columns` から）
- 欠損やフラグ行を黙って集計に混ぜる
- 単位・半径・年次の違う列を正規化なしで足す
- 災害の列や結果に「安全」と書く・限界（notes）を削る
- 失効した URL に再試行を繰り返す（build_dataset を呼び直す）
