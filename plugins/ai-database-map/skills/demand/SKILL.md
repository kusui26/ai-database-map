---
name: demand
description: 路線・会社を指定して、輸送計画・ダイヤ検討の需要側材料（乗降トレンド・コロナ回復・将来人口）を分析する。/ai-database-map:demand 東急東横線 のように使う。
argument-hint: '<路線名または会社名> [観点（回復・将来・比較など）]'
---

「$0」の駅ごとの需要分析を、[transport-planning](../transport-planning/SKILL.md) の方法論で行う。
「$1」があれば観点の初期値として扱う。

1. **まず要件を聞く**（方法論 §1：何の検討材料か・対象路線・時間軸。
   **この段階でデータツールは呼ばない**。`presentForm` が使える環境なら**フォーム 1 枚**で聞く
   ——フォームは分析ではないので先に出してよい。無ければ文章で聞く）
2. 要件が揃ったら：`list_stations`（operators / routes・まとめて 1 回）→
   `build_dataset`（pax の年系列＋rate_covid＋将来人口）→ ローカルで傾き・4 象限分類
3. 分類表＋根拠 → 限界（ダイヤ・断面・混雑は持たない／乗降≠通過需要）＋出典
4. **図を出せる環境なら**：`rank_stations` に `present: "echarts"` を付けて返った option を
   **そのまま** `presentChart` に（4 象限など自作の図は脚注を自分で添える）。
   沿線の地図は `[{"type":"highlightStations","grps":[…]}]` を `render_map` → 保存 → `presentHtml`。
   結論・表・限界・出典は `presentDocument` にも書く（図だけで終わらせない）。
