---
name: recommend
description: エリアを指定して「住むのにおすすめの駅」をデータ分析で提案する。/ai-database-map:recommend 横浜市 のように使う。こだわり（予算・路線・災害許容度）は会話で確認する。
argument-hint: '<エリア（市区町村名・都道府県名）> [こだわり（任意）]'
---

エリア「$0」で住むのにおすすめの駅を、
[station-recommendation](../station-recommendation/SKILL.md) の方法論で分析する。
「$1」があれば要件の初期値として扱う（不足分は聞く）。

1. **まず要件を聞く**（方法論 §1。①予算/資産 ②通勤先・路線 ③災害の許容度＝足切りか減点か。
   **この段階でデータツールは呼ばない**。`presentForm` が使える環境なら、この 3 つを
   **フォーム 1 枚**で聞く——フォームは分析ではないので先に出してよい。無ければ文章で聞く）
2. 要件が揃ったら：`list_stations`（$0 は municipality の前方一致）→
   `build_dataset`（`includeHazard: true`）→ CSV をローカルで正規化・重み付き合成
3. 重み ±20% の敏感度 → 上位 5 駅の表＋各駅の効いた要因/弱点 → 限界と出典（方法論 §8）
4. **図を出せる環境なら**：合成スコアの図は**自分で option を書いて** `presentChart` に
   （単位・年次・正規化の脚注を添える）。上位駅の地図は
   `[{"type":"highlightStations","grps":[上位の grp]}]` を `render_map` → 保存 → `presentHtml`。
   結論・表・限界・出典は `presentDocument` にも書く（図だけで終わらせない）。
