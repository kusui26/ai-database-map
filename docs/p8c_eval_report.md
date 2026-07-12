<!-- P8c 評価レポート。results セクションは tests/chat-eval.test.ts の出力を貼り込む。 -->

# P8c 評価レポート（Step2・AIチャットの eval と モデル判断）

Step2 最終ブロック。**ゴールデン 20 問**でチャット（`/api/chat`）のツール選択・GUI Chat Protocol 妥当性・拒否挙動を機械判定し、合格率とモデル判断を記録する。

## 1. 評価ハーネス（`src/ai/eval` ＋ `tests/chat-eval.test.ts`）

- **`cases.ts`**：20 問（駅詳細×6・ランキング×4・散布×2・比較×1・曖昧駅名×2・カタログ探索×2・データ外拒否×3）。
- **`score.ts`**（純関数・単体テスト済）：期待を機械判定する。
  - `toolCalls`：期待するツールが**入力の部分一致つき**で呼ばれる（例 `getStationDetail(category=population)`・`rankStations(prefectures=[神奈川県])`）。
  - `panels`：期待パネル型が出る（`trendChart`/`rankingTable`/`scatter`…）。
  - `select`：`selectStation` が発火。
  - `noPanels`/`noRankScatter`：データ外はデータパネルを出さない。
  - `contains`/`containsAny`：本文＋MapResponse に要点文字列を含む。
  - **全チェック通過で 1 問合格**。加えて全問で **MapResponse が `mapResponseSchema` を通る**ことを必須にする。
- **`tests/chat-eval.test.ts`**（`EVAL=1` のときだけ実行）：各問を実 `/api/chat` に SSE で投げ、ツール列・パネル・本文を収集して採点。無料枠のため問間スロットル＋429 時 1 回リトライ。
- 実行：`pnpm dev` → `EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts`。

## 2. Gemini 無料枠の現実（2026-07 時点・重要）

eval と本番判断の前提として、実測で判明した無料枠の制約：

| モデル | 状況（2026-07・無料枠 API キー実測） |
|---|---|
| `gemini-2.5-flash` / `-lite` | **新規 API ユーザーに提供終了**（`generateContent` が 404） |
| `gemini-flash-latest`（＝`gemini-3.5-flash`） | 生成可。ただし無料枠は **5 req/分＋`GenerateRequestsPerDayPerProjectPerModel`＝20 req/日**。多段ツール（1 対話＝2〜3 コール）だと**1 日あたり実質数対話で枯渇** |
| `gemini-2.0-flash` 系 | 実測で quota 0（枯渇/縮小） |
| `gemini-3-flash-preview` | 生成可・残枠あり。ただし**多段ツールの最終生成が遅い/詰まりやすい**（実測で 45s abort に達しうる） |
| **`gemini-flash-lite-latest` / `gemini-3.1-flash-lite`** | 生成可・残枠あり・**高速（多段クエリでも実測 ~3s）**・**ツール選択も正確**（getMetricsCatalog→rankStations 等） |

→ **`gemini-flash-latest` の 20 req/日は、無料デプロイの実運用に耐えない。** 無料枠で回すなら `gemini-flash-lite-latest`、品質重視なら有料枠/Vertex の `gemini-flash-latest`（または `gemini-3-flash-preview`）。プロバイダ抽象（`GEMINI_MODEL` env）で 1 行差し替え可能。

## 3. 評価結果

> 実行モデル：**`gemini-flash-latest` は当日 20 req/日を消費済み**のため、eval は残枠のある **`gemini-flash-lite-latest`**（高速・ツール選択良好）で実施。これは「無料枠で実際に回せるモデル」の妥当性検証も兼ねる。

**合格率: 20/20（閾値 16）** — 全分野が正しいツール列＋GUI Chat Protocol（Zod）妥当で通過。

| # | id | 分野 | 合否 |
|---|---|---|---|
| 1 | detail-population | 駅詳細 | ✅ |
| 2 | detail-landprice | 駅詳細 | ✅ |
| 3 | detail-bus | 駅詳細 | ✅ |
| 4 | detail-employee | 駅詳細 | ✅ |
| 5 | detail-passenger | 駅詳細 | ✅ |
| 6 | detail-radius | 駅詳細（半径5km指定） | ✅ |
| 7 | rank-covid-kanagawa | ランキング（神奈川県） | ✅ |
| 8 | rank-national-population | ランキング（全国） | ✅ |
| 9 | rank-landprice-chiba | ランキング（千葉県） | ✅ |
| 10 | rank-tokyo | ランキング（東京都・減少） | ✅ |
| 11 | scatter-basic | 散布 | ✅ |
| 12 | scatter-chiba | 散布（千葉県） | ✅ |
| 13 | compare-two | 2駅比較（東京・新宿） | ✅ |
| 14 | ambiguous-amagasaki | 曖昧駅名（尼崎＝JR/阪神） | ✅ |
| 15 | ambiguous-kamimichi | 曖昧駅名（上道＝鳥取/岡山） | ✅ |
| 16 | catalog-overview | カタログ探索 | ✅ |
| 17 | catalog-metric | カタログ探索（地価指標） | ✅ |
| 18 | refuse-weather | データ外拒否（天気） | ✅ |
| 19 | refuse-predict | 将来予測の拒否 | ✅ |
| 20 | refuse-route | データ外拒否（経路） | ✅ |

- 各問で `getStationDetail(category=…)`／`rankStations(prefectures=…)`／`compareGrowth`／`searchStations` が期待どおり呼ばれ、`trendChart`/`rankingTable`/`scatter`/`stationCard` が描画され、拒否 3 問はデータパネルを出さず丁寧に断った。
- 受け入れ基準（≥16/20・拒否を正しく拒否）を満たす。**プロンプト簡潔化・都道府県厳格化・カタログ駆動のツール記述**が効いた（§6）。

## 4. モデル判断（採用の最終確定）

- **無料デプロイの既定＝`gemini-flash-lite-latest`**：高速・ツール選択良好・日次枠が実用的。本アプリの 20 問で合格水準（§3）。
- **品質重視／本番＝有料枠 or Vertex AI の `gemini-flash-latest`（または `gemini-3-flash-preview`）**：日次上限・学習利用の懸念を回避。プロバイダ抽象の背後で `GEMINI_MODEL` を切替えるだけ。
- **フォールバック候補（プロバイダ非依存）**：Claude Haiku 4.5 / GPT-4.1-mini / Groq（architecture.md §10.2）。ツール表面＝共通API に統一済みのため差し替え可逆。
- **本番の発話プライバシー**：無料枠は入力がモデル改善に使われうる（§10.2）。本番は有料枠/Vertex（学習非利用）。鍵はサーバのみ。

## 5. GraphAI PoC の判断

20 問（検索→詳細→本文・getMetricsCatalog→ランキング・2 指標散布・2 駅比較・曖昧駅名の区別・データ外の拒否）は、**AI SDK v6 の `ToolLoopAgent`（単一 Flash モデル・stepCountIs 6）で完結**した。宣言的多段オーケストレーション（GraphAI）は現時点で不要。**「A駅とB駅を人口・地価・従業者で並列比較」のような並列 fan-out が主戦場になった段階で再評価**（architecture.md §10.4・低リスクに PoC 可能・可逆）。→ **GraphAI は引き続き任意・段階導入の対象**（既定は AI SDK v6）。

## 6. 本 eval を受けて適用した改善（P8a/P8b ブラッシュアップ）

- **system-prompt**：回答を 1〜3 文に簡潔化・**数値の羅列を禁止**（パネルが示す）・**markdown 見出し/表/箇条書きを禁止**・**データ外/将来予測は数値を作らず 1 文で断り実績データを提案**。
- **ツール**：都道府県を厳格正規化（未知は構造化エラーで LLM に再指定させる）・`searchStations` の座標を返さない（トークン節約）・`getMetricsCatalog` を型付き返却に。
- **エラー/429 UX**：`toUIMessageStream` に `onError` を渡し日本語メッセージを届ける・`result.text` を握って二重エラー＋data-map 欠落を防ぐ・`maxRetries:1` で長い retry-after 待ちを回避。
- **UI**：アシスタント本文を軽量リッチテキスト描画（見出し/箇条書き/強調＋駅名チップ）・IME 変換中 Enter の誤送信防止・閉じたパネルを `inert`・モバイル初期スナップで入力可視・ランキングのハイライトを非クラスタ源で全国でも可視化。
