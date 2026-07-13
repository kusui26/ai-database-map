# AI チャット（LLM）機能ドキュメント

AI Database Map の **Step2＝AIネイティブ化**で実装した「AI チャット」の仕様・仕組み・使い方・今後の改善点をまとめる。実装ブロックは `plan_fable.md` の **P8a–P8d**、設計の正は `architecture.md` §4/§6/§10。

- 実装：`src/ai/`（LLM 層）＋ `src/app/api/chat/`（API）＋ `src/components/chat/`（UI）
- 既定モデル：**`gemini-flash-lite-latest`**（Google Gemini・env `GEMINI_MODEL` で差替）
- 状態：**Step2 DoD 達成**（会話がクリックと同じ描画パス／ゴールデン20問 eval 20/20／ドメイン無改変の純加算）

---

## 1. 概要 — 何を、なぜ

自然言語（日本語）で「東京駅の人口推移は？」「神奈川県で乗降客が増えた駅は？」と尋ねると、**LLM が共通API（ドメイン層）をツールとして呼び、地図とグラフで答える**。チャットは地図を隠さない**左併設パネル**（モバイルはボトムシート）で、返答と同時に地図が flyTo・ハイライトし、グラフや順位表がスレッド内に描かれる。

本アプリの中核思想は「**API こそがプロダクト**」（`.claude/CLAUDE.md` §2）。人間のクリックUIも LLM も、**同一のドメイン層／共通API**を対等に叩く。だから「クリックでできること」と「会話でできること」にズレが生じない。

---

## 2. 設計の要 — 「LLM は幻覚しない」

> **LLM が生成するのは「どのツールを呼ぶか」と「短い説明文」だけ。パネル・地図操作・数値は、ドメイン層が決定的に組み立てる。**

- ツール（`src/ai/tools.ts`）は**既存の DB クエリ＋ドメイン・プレゼンタ**をそのまま呼ぶ（HTTP を挟まない）。
- 各ツールは結果を `EffectCollector` に記録し、`assemble.ts` が **既存の Panel ビルダ**（P5/P6 とクリックUIで共用）で `MapResponse` を組み立てる。
- 組み立てた `MapResponse` は必ず **Zod（`mapResponseSchema`）を通す**。→ **数値・チャート・順位を LLM が捏造できない**。破損した応答は構造的に起こり得ない。
- パネルはチャットでもクリックUIでも**同じ `PanelRenderer` / `PanelStack`** で描画する（新規描画コードなし）。

この設計により、「LLM が適当な数字を言う」「グラフが実データとズレる」といったAIチャートの典型的失敗が原理的に発生しない。

---

## 3. アーキテクチャと仕組み

### 3.1 データフロー

```
[ユーザー] ──"東京駅の人口推移は？"──▶ useChat (@ai-sdk/react)
                                         │  POST /api/chat（UIMessage[]）
                                         ▼
        ┌──────────────── POST /api/chat（src/app/api/chat/route.ts）────────────────┐
        │ ガード：レート制限 / 入力500字 / 履歴上限 / 鍵未設定→503 / 45s abort         │
        │                                                                            │
        │  ToolLoopAgent（AI SDK v6・stepCountIs(6)）                                  │
        │    ├─ LLM がツールを選ぶ ──▶ tools.ts（domain 直呼び）                        │
        │    │      searchStations / getStationDetail / rankStations /                │
        │    │      compareGrowth / getMetricsCatalog                                 │
        │    │        └─ 結果を EffectCollector に記録＋LLM へ短い要約を返す            │
        │    └─ LLM が最終文を生成（ストリーミング）                                    │
        │                                                                            │
        │  assemble(collector, text)  ─ 既存 Panel ビルダで決定的に組立 ─▶ MapResponse │
        │        └─ mapResponseSchema.parse()（Zod・必ず通る）                         │
        │                                                                            │
        │  SSE で送出：text-delta（本文）＋ tool-*（ツール）＋ data-map（MapResponse）   │
        └────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
       [クライアント] ChatPanel（useChat）
         ├─ onData(data-map) ──▶ useApplyMapActions ──▶ 地図（flyTo/選択/ハイライト/クリア）
         └─ message.parts ─────▶ ChatMessage → InlineCard → PanelStack（既存部品で描画）
                                            └─ ⤢ 拡大 = クリックUIと同じドロワー/モーダルへ昇格
```

### 3.2 レイヤとファイル

| レイヤ | ディレクトリ | 役割 |
|---|---|---|
| **LLM 層** | `src/ai/` | ツール定義・プロバイダ抽象・プロンプト・組立・カタログ要約・レート制限・評価 |
| **API** | `src/app/api/chat/route.ts` | ツールループ＋ストリーミング＋ガード。薄い HTTP ラッパ |
| **UI** | `src/components/chat/` | `useChat` 配線・インライン描画・⤢昇格・駅名チップ・サジェスト |
| **共通（不変）** | `src/domain` `src/shared/protocol` `src/db` `src/app/api/*(chat以外)` | Step2 で**無改変**。AI は既存のドメイン/共通APIを叩くだけ |

`src/ai/` の内訳：

| ファイル | 役割 |
|---|---|
| `client.ts` | プロバイダ抽象（`@ai-sdk/google`・`chatModel()`）・定数（既定モデル・ステップ上限・タイムアウト・入力上限） |
| `tools.ts` | **5 ツール**（catalog 駆動・domain 直呼び）＋`ChatUIMessage` 型 |
| `assemble.ts` | ツール副産物 → `MapResponse`（既存 Panel ビルダ）＋LLM 向け要約 |
| `system-prompt.ts` | 役割・カタログ要約・振る舞い規約（簡潔・幻覚禁止・データ外は拒否） |
| `catalog-digest.ts` | メトリクス・カタログの要約（system-prompt と getMetricsCatalog で共有） |
| `rate-limit.ts` | 簡易 IP レート制限（固定窓・純関数） |
| `types.ts` | `ToolEffect` / `EffectCollector` |
| `eval/cases.ts` `eval/score.ts` | ゴールデン20問と純関数採点（§8） |

---

## 4. 仕様

### 4.1 モデル（プロバイダ抽象）

- 既定：**`gemini-flash-lite-latest`**（`src/ai/client.ts` `DEFAULT_CHAT_MODEL`）。高速（多段でも ~3s）・ツール選択良好・**無料枠が実用的（本プロジェクト実値で 15 RPM / 500 RPD＝§6.1）**。
- 切替：env **`GEMINI_MODEL`**（例 `gemini-flash-latest` / `gemini-3-flash-preview`）。プロバイダ抽象（`chatModel()`）の背後にあり、**1 行で差替可能**。フォールバックは Claude Haiku 4.5 / GPT-4.1-mini / Groq 等（`architecture.md` §10.2）。

**モデル・エイリアスの実体（何のモデルか）**

`gemini-flash-lite-latest` / `gemini-flash-latest` は特定バージョンではなく **`-latest` ローリング・エイリアス**。Google が新リリースで**ホットスワップ**する（変更時は **2 週間前にメール通知**）。バージョンを固定したいときは**数字付き ID** を `GEMINI_MODEL` に指定する。API メタデータ（getModel）と 429 応答で確認した **2026-07 時点の実体**：

| モデル ID | 実体（2026-07 時点） | 系統 | 種別 |
|---|---|---|---|
| **`gemini-flash-lite-latest`（既定）** | **Gemini 3.1 Flash-Lite**（現行の最新安定 Flash-Lite） | 3.1 | エイリアス（可変） |
| `gemini-flash-latest` | **Gemini 3.5 Flash**（最新安定 Flash・429 応答が `model: gemini-3.5-flash` を明示） | 3.5 | エイリアス（可変） |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview | 3 | 固定（プレビュー） |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite（stable） | 3.1 | 固定 |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite（2025-07 stable） | 2.5 | 固定 |
| `gemini-2.5-flash` | 新規 API ユーザーに提供終了（generateContent が 404） | 2.5 | 使用不可 |

> 既定の `gemini-flash-lite-latest` は**「最新の Flash-Lite」**を追う。2026-07 現在は **Gemini 3.1 Flash-Lite** を指すが、将来のリリースで別バージョンに変わりうる（2 週間前通知あり）。挙動を固定したい本番では数字付き ID（例 `gemini-3.1-flash-lite`）の指定を推奨。

- 鍵：**`GEMINI_API_KEY`（サーバ専用）**。`@ai-sdk/google` の既定 env（`GOOGLE_GENERATIVE_AI_API_KEY`）ではなく本プロジェクトの `GEMINI_API_KEY` を明示注入する。
- ライブラリ：**AI SDK v6 ライン固定**（`ai@6` ＋ `@ai-sdk/google@3` ＋ `@ai-sdk/react@3`）。

### 4.2 ツール（共通API＝ドメインの薄いアダプタ・`src/ai/tools.ts`）

| ツール | 何をする | 主な入力 | LLM への返却 | 記録する効果（→パネル/地図） |
|---|---|---|---|---|
| `searchStations` | 駅名 → 候補（grp を得る起点） | `query` | 候補[grp/名前/県/乗降] | なし |
| `getStationDetail` | 駅の詳細・推移を表示 | `grp` / `category?` / `radiusM?` | 焦点カテゴリの要約 | 駅詳細（→カード＋チャート・flyTo＋選択） |
| `rankStations` | 都道府県×指標の順位 | `metric`（カタログキー） / `prefectures?` / `order?` / `limit?` / `excludeLowN?` | 上位10の要約 | ランキング（→順位表・上位をハイライト） |
| `compareGrowth` | 2指標の増減率散布＋クラスタ | `x` / `y`（カタログキー） / `prefectures?` / `excludeLowN?` | 点数・クラスタ数 | 散布（→scatter） |
| `getMetricsCatalog` | 利用可能な指標の照会 | `category?` / `baseMetric?` | 指標ダイジェスト | なし |

- **指標キーはカタログ（単一の真実）で検証**。生カラムのパススルー禁止。不正キー・未知都道府県は**構造化エラー**を返し、LLM が `getMetricsCatalog` 等で自己修復できる（ツールループ内）。
- ツールの `execute` はエラーを catch して `{error}` を返す＝ループを壊さない。

### 4.3 GUI Chat Protocol（`src/shared/protocol.ts`）

チャット応答もクリックUIも、この `MapResponse` を produce/consume する（同一描画パス）。

```ts
MapResponse = {
  messages:  { role: 'assistant'|'user'; text }[]          // 説明文
  mapActions: ( flyTo | selectStation | highlightStations | clearOverlays )[]
  panels:    ( stationCard | trendChart | statTable | barChart | rankingTable | scatter | markdown )[]
}
```

### 4.4 ガード（`route.ts` / `rate-limit.ts` / `client.ts`）

| ガード | 値 | 実装 |
|---|---|---|
| IP レート制限 | **20 リクエスト / 60 秒**（固定窓・インメモリ） | `rate-limit.ts`。超過は 429（Retry 秒つき）。10,000 キー超で期限切れ掃除 |
| 入力（最新発話） | **500 文字** | 超過は 400 |
| 会話履歴の合計 | **4,000 文字** | 履歴詰め込みでの回避を防止・超過は 400 |
| タイムアウト | **45 秒**（アプリ側 abort） | `AbortSignal.timeout`。Vercel 関数上限 `maxDuration=60` より短く graceful abort |
| リトライ | **`maxRetries: 1`** | 無料枠 429 の長い retry-after 待ちを避ける |
| 鍵未設定 | **503**（NOT_CONFIGURED） | `isChatConfigured()` |
| エラー | 日本語の封筒メッセージ | `friendlyError()`（429/混雑は専用文言）。`toUIMessageStream({onError})` に渡す |
| ランタイム | `nodejs` | provider SDK が Node 前提 |

### 4.5 ストリーミング

- **AI SDK v6 の UI message stream**（`createUIMessageStream` → SSE）。`text-delta`（本文）と `tool-*`（ツール呼び出し）を即時ストリーム、ループ完了後に **`data-map` パート**で `MapResponse` を送出。
- クライアントは `useChat` の `onData` で `data-map` を受け、`useApplyMapActions` が地図へ即時反映。`message.parts` からパネルをインライン描画。

---

## 5. 使い方

### 5.1 エンドユーザー（画面操作）

- **開く/閉じる**：ヘッダの **✦AI ボタン**、または **⌘K / Ctrl+K**。デスクトップはアクセス時に既定オープン（地図は右に見える）、モバイルは既定クローズ（地図の初見を優先し、✦AI で開く）。
- **質問する**：日本語で入力（Enter 送信・Shift+Enter 改行・IME 変換中の Enter は送信しない）。初回は**サジェストチップ**3つ（例「東京駅の人口推移を見せて」）をタップでも送れる。
- **結果**：本文（要点のみ・数値はパネルが示す）＋インラインカード（駅カード・チャート・順位表・散布）。本文中の**駅名はクリック可能チップ**（タップで選択＋地図移動）。
- **⤢ 拡大（昇格）**：インラインカードの ⤢ で、**クリックUIと同じ場所**へ——駅詳細は右ドロワー（焦点タブつき）、ランキング/散布は同じモーダル（条件を preset）に開く。
- **地図をリセット**：ヘッダの「地図をリセット」で選択・ハイライトをクリア。
- **モバイル**：ボトムシート（半分⇔全画面の2スナップ。半分にドラッグすると地図が動くのが見える）。

### 5.2 開発者（セットアップ・実行）

```bash
# .env（サーバ専用・gitignore）
GEMINI_API_KEY=＜Google AI Studio のキー＞
# GEMINI_MODEL=gemini-flash-latest   # 任意（未指定なら gemini-flash-lite-latest）
# SUPABASE_URL / SUPABASE_ANON_KEY も必要（ツールが DB を叩くため）

pnpm dev            # ローカル起動（http://localhost:3000）
```

- **本番（Vercel）**：`GEMINI_API_KEY`（と `SUPABASE_*`）を **Vercel のダッシュボード環境変数**に設定する。ローカル `.env` は本番に反映されない（未設定だと 503 になる）。
- **ツールを増やす**：`tools.ts` にツールを足し（実体は `src/domain`/`src/db` を呼ぶ）、必要なら `assemble.ts` に効果→パネルの分岐を追加。指標は**カタログ駆動**なので、`catalog.json` に指標が増えれば UI/AI に自動追従する。

### 5.3 API（`POST /api/chat`）

- **リクエスト**（`useChat` 互換の UIMessage 配列）：
  ```json
  { "messages": [ { "role": "user", "parts": [ { "type": "text", "text": "東京駅の人口推移は？" } ] } ] }
  ```
- **レスポンス**：`text/event-stream`（SSE）。`data:` 行に `text-delta`・`tool-input-available`・**`data-map`**（`{ "type": "data-map", "data": MapResponse }`）等が流れる。エラー時は `{error:{code,message}}` の封筒（プレストリームの 400/429/503）または `error` パート。

---

## 6. 無料枠・レート制限・コスト・プライバシー

### 6.1 レート制限（1分・1日・1か月）

Gemini 無料枠の制限は **RPM（1分あたりリクエスト）／RPD（1日あたり）／TPM（1分あたりトークン）** で決まる。重要な性質：

- **月次（1か月）の上限は無い**。制限は RPD（日次）が実質の上限で、**月間は「RPD × 稼働日数」で頭打ち**になる。
- **プロジェクト単位**（API キー単位ではない＝鍵を増やしても増えない）。**RPD は毎日 太平洋時間 0 時にリセット**。
- **`-latest` エイリアスの制限は、その時点で指す実体モデルに従う**（実体が変われば制限も変わる）。
- Google 公式のレート制限ページは**モデル別の数値掲載をやめ、AI Studio で各自確認**する方式（実容量は変動しうる）。

**本プロジェクトの実値（[AI Studio レート制限画面](https://aistudio.google.com/rate-limit) の表示・2026-07-13）**。Google 公式はモデル別数値の掲載をやめ**この画面（プロジェクト単位・随時変動）が唯一の正**なので、下表はその実値：

| モデル（無料枠・本プロジェクト実値） | RPM（1分） | TPM（1分） | RPD（1日） | 1か月（≒RPD×日数） |
|---|---|---|---|---|
| `gemini-flash-latest`（＝Gemini 3.5 Flash） | 5 | 250K | 20 | ~600 |
| **`gemini-flash-lite-latest`（＝Gemini 3.1 Flash-Lite・既定）** | **15** | 250K | **500** | ~15,000 |
| `gemini-3-flash-preview`（＝Gemini 3 Flash） | 5 | 250K | 20 | ~600 |
| `gemini-2.5-flash`（固定 ID） | 5 | 250K | 20 | ~600 |
| `gemini-2.5-flash-lite`（固定 ID） | 10 | 250K | 20 | ~600 |

> **要点**：既定の **`gemini-flash-lite-latest`（＝Gemini 3.1 Flash-Lite）は 15 RPM / 500 RPD**（＝flash-latest の 20 RPD の **25 倍**）で、無料枠で唯一まともに使える。他は軒並み **RPD 20**（`gemini-flash-latest`＝3.5 Flash も同様）。API 実測（RPM=15）とも一致。
>
> **公開情報は当てにならない**：Web 上の第三者情報は日付により **15/30 RPM・250〜1,500 RPD** とばらつく（**2025-12 に無料枠 50–80% 削減**、**2026-05 の 3.1 Flash-Lite GA** 等、改定が続くため）。実際、公開値では 2.5 Flash＝250 RPD / 2.5 Flash-Lite＝1,000 RPD だが、**本プロジェクトの実値はいずれも 20 RPD** と大幅に低い。→ **必ず自分の AI Studio の値を正とする**。
>
> **1 チャット＝多段ツールで 2〜3 リクエスト消費**するため、既定モデルの体感は「1 日あたり 約 150〜250 対話・1 分あたり 5〜7 対話」まで。超えると 429（`friendlyError` が「混雑」を返す）。本格運用は有料枠/Vertex（§6.2）。

出典：**上表の値は本プロジェクトの [AI Studio レート制限画面](https://aistudio.google.com/rate-limit)（一次ソース・2026-07-13）**。制度の背景は [Rate limits（公式・AI Studio 参照方式）](https://ai.google.dev/gemini-api/docs/rate-limits)・[Models（`-latest` の定義）](https://ai.google.dev/gemini-api/docs/models)。第三者情報（[aifreeapi](https://www.aifreeapi.com/en/posts/gemini-api-free-tier-rate-limits)／[TokenMix](https://tokenmix.ai/blog/gemini-api-free-tier-limits)）は日付でばらつき参考程度。RPM=15 は API 実測でも確認済み。

### 6.2 コスト・プライバシー

- **本番は有料枠（Tier 1 以上）or Vertex AI 推奨**：無料の日次上限・低 RPM を外し、**学習非利用**にできる（無料枠は入力がモデル改善に使われうる）。収録データは公開オープンデータで懸念は小さいが、ユーザー発話を扱うため。鍵はサーバのみ。
- ランニングコスト目安：無料枠 ¥0（light 利用）／有料でも Flash 系なら月数百円規模から（従量・入出力トークン課金）。

詳細と判断根拠は `docs/p8c_eval_report.md`。

---

## 7. 評価（eval・`src/ai/eval` ＋ `tests/chat-eval.test.ts`）

- **ゴールデン20問**（駅詳細6・ランキング4・散布2・比較1・曖昧駅名2・カタログ2・データ外拒否3）を実 `/api/chat` に投げ、**期待ツール列（入力の部分一致）・パネル型・駅選択・拒否・要点文字列**を純関数で採点（`score.ts`・単体テスト済）。
- **結果：20/20 合格**（`gemini-flash-lite-latest`）。全問で正しいツール列＋`MapResponse` が Zod 通過、拒否3問はデータパネルを出さず丁寧に断る。
- 実行：`pnpm dev` → `EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts`（無料枠のため問間スロットル＋429 リトライ内蔵）。

---

## 8. 制約・既知の限界

- **無料枠のクォータ**が厳しい（上表）。連投・多段クエリで 429 になりやすい。本番は有料枠/Vertex 前提。
- **レート制限がインメモリ**：サーバレス（Vercel）では**インスタンスごと**に独立するため、厳密な全体制限ではない（コメントどおり「下限」）。→ 改善は §9。
- **ストリーム中 Gemini 429 のメッセージ**：`route.ts` は「混雑しています」を返すが、`ChatPanel` のエラー分類は `error.message` に `'429'`/`'多す'` を含むかで判定するため、**この経路の 429 は汎用文言になる**ことがある（プレストリームのレート制限 429 は「多すぎます」で拾える）。→ §9 で構造化ステータスに。
- **`data-map` は応答の末尾**に届く（`assemble` はループ完了後に動く）。地図操作の「返答中の即時反映」は、テキストが流れた後・最終段でまとまって反映される（多段ツールでも UX 上は十分だが、真の逐次反映ではない）。
- **散布の ⤢ 昇格**は、パネルとツール呼び出しの内容照合でキーを復元する。照合できない場合は昇格しない。
- **任意半径クエリ**（例「3km 以内の人口」）は未対応（事前計算6半径のみ）。
- **会話は永続化しない**（リロードで消える）。既定オープンも毎回（localStorage 保存なし）。

---

## 9. 今後の改善点

**優先度：高（本番運用）**
1. **本番モデル＝有料枠 or Vertex AI**：日次上限・学習利用を回避。`GEMINI_MODEL` を `gemini-flash-latest` 等に。プロバイダ抽象済みなので設定のみ。
2. **レート制限を Upstash Redis 等へ**：サーバレス横断で厳密に。`rate-limit.ts` の seam を差替。
3. **エラー UX の一本化**：`route` と `ChatPanel` を**構造化ステータス**（コード）で連携し、429/混雑・タイムアウト・鍵未設定を確実に出し分ける（現状の文字列マッチを廃止）。

**優先度：中（機能拡張）**
4. **MCP 公開**：共通APIを **Model Context Protocol** のツールとしても公開すれば、外部 AI クライアント（Claude 等）も同一表面を使える（`architecture.md` §10.5-5）。「API こそがプロダクト」の外部拡張。
5. **GraphAI（宣言的多段フロー）**：「A駅とB駅を人口・地価・従業者で並列比較」のような**並列 fan-out**が主戦場になったら、`fetchAgent`＝共通API のノード化で PoC（低リスク・可逆・`architecture.md` §10.4）。現状は AI SDK v6 単体で十分。
6. **任意半径クエリ**：メッシュ幾何を PostGIS に載せてオンザフライ集計、または固定6半径の補間。
7. **モデル比較の定常化**：eval を Gemini vs Claude Haiku 4.5 vs GPT-4.1-mini で回し、精度×コスト×レイテンシで採用を更新（切替は env のみ）。

**優先度：低（磨き込み）**
8. **会話の永続化**（localStorage / DB）と**共有リンク**。
9. **ストリーミング中の mapActions 逐次反映**（ツール出力を見て段階的に flyTo）。
10. **音声入力・多言語**、サジェストの文脈追従の高度化、回答の引用（どのツール結果に基づくか）表示。

---

## 10. 関連ドキュメント・ソース

| 参照 | 内容 |
|---|---|
| `docs/architecture.md` §4/§6/§10 | GUI Chat Protocol・共通API 設計・**LLM 実装方針**（プロバイダ/オーケストレーション/§10.7 確定事項） |
| `docs/plan_fable.md` P8a–P8d・§9 | 実装ブロックの詳細・進捗表・設計の最終判断 |
| `docs/p8c_eval_report.md` | eval 20/20 の詳細・**無料枠の現実**・モデル判断・GraphAI 判断 |
| `.claude/CLAUDE.md` §2 | 「API こそがプロダクト」の原則（幻覚しない設計の根拠） |
| コード | `src/ai/*`（LLM 層）・`src/app/api/chat/route.ts`（API）・`src/components/chat/*`（UI）・`src/shared/protocol.ts`（Protocol） |
