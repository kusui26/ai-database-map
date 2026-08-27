# eval レポート（2026-08-28・全 37 問）

`EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts` を通しで流した結果。
対象: `http://localhost:3000`（Gemini 無料枠・問間 45 秒のスロットル・所要 約 45 分）

**なぜ流したか**：直近 6 本の PR でシステムプロンプトを 3 回変え、ツールを 5 → 8 本に増やしたのに、
**全問を 1 度も通していなかった**。ツールが増えると選択が鈍る（＝退行しやすい）ので確かめた。

**結果**：**全分野 100%**。ツールが 8 本になっても選択は鈍っていない。

**合格率: 37/37（閾値 35）**

| 分野 | 合格 |
|---|---|
| 駅詳細 | 6/6 |
| ランキング | 5/5 |
| 散布 | 3/3 |
| 比較 | 1/1 |
| 曖昧駅名 | 2/2 |
| カタログ | 2/2 |
| **災害** | **13/13** |
| **拒否** | **3/3** |
| 地図文脈 | 2/2 |


| # | id | 分野 | 合否 | 失敗チェック |
|---|---|---|---|---|
| 1 | detail-population | 駅詳細 | ✅ | — |
| 2 | detail-landprice | 駅詳細 | ✅ | — |
| 3 | detail-bus | 駅詳細 | ✅ | — |
| 4 | detail-employee | 駅詳細 | ✅ | — |
| 5 | detail-passenger | 駅詳細 | ✅ | — |
| 6 | detail-radius | 駅詳細 | ✅ | — |
| 7 | rank-covid-kanagawa | ランキング | ✅ | — |
| 8 | rank-national-population | ランキング | ✅ | — |
| 9 | rank-landprice-chiba | ランキング | ✅ | — |
| 10 | rank-tokyo | ランキング | ✅ | — |
| 11 | rank-operator-shinkansen | ランキング | ✅ | — |
| 12 | scatter-basic | 散布 | ✅ | — |
| 13 | scatter-chiba | 散布 | ✅ | — |
| 14 | scatter-shinkansen | 散布 | ✅ | — |
| 15 | compare-two | 比較 | ✅ | — |
| 16 | ambiguous-amagasaki | 曖昧駅名 | ✅ | — |
| 17 | ambiguous-kamimichi | 曖昧駅名 | ✅ | — |
| 18 | catalog-overview | カタログ | ✅ | — |
| 19 | catalog-metric | カタログ | ✅ | — |
| 20 | hazard-station-risk | 災害 | ✅ | — |
| 21 | hazard-is-safe | 災害 | ✅ | — |
| 22 | hazard-depth | 災害 | ✅ | — |
| 23 | hazard-arrive-time | 災害 | ✅ | — |
| 24 | hazard-evacuate-where | 災害 | ✅ | — |
| 25 | hazard-evacuate-landslide | 災害 | ✅ | — |
| 26 | hazard-escape-direction | 災害 | ✅ | — |
| 27 | hazard-escape-not-route | 災害 | ✅ | — |
| 28 | hazard-evacuate-limits | 災害 | ✅ | — |
| 29 | hazard-shows-layer | 災害 | ✅ | — |
| 30 | alert-now | 災害 | ✅ | — |
| 31 | alert-not-evacuation-order | 災害 | ✅ | — |
| 32 | alert-vs-point | 災害 | ✅ | — |
| 33 | refuse-weather | 拒否 | ✅ | — |
| 34 | refuse-predict | 拒否 | ✅ | — |
| 35 | refuse-route | 拒否 | ✅ | — |
| 36 | context-followup-landprice | 地図文脈 | ✅ | — |
| 37 | context-explicit-override | 地図文脈 | ✅ | — |
