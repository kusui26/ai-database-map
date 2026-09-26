# AI チャット（LLM）機能ドキュメント

AI Database Map の **Step2＝AIネイティブ化**で実装した「AI チャット」の仕様・仕組み・使い方・今後の改善点をまとめる。実装ブロックは `plan_fable.md` の **P8a–P8d**、設計の正は `architecture.md` §4/§6/§10。

- 実装：`src/ai/`（LLM 層）＋ `src/app/api/chat/`（API）＋ `src/components/chat/`（UI）
- 既定モデル：**`gemini-3.5-flash-lite`**（Google Gemini・番号つきの版に固定・env `GEMINI_MODEL` で差替）
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
| `chat-errors.ts` | 失敗の**種類**を HTTP 状態で決める（`classifyChatFailure`）＋記録の 1 行（発話を伏せる・§4.6） |
| `types.ts` | `ToolEffect` / `EffectCollector` |
| `eval/cases.ts` `eval/score.ts` | ゴールデン20問と純関数採点（§8） |

---

## 4. 仕様

### 4.1 モデル（プロバイダ抽象）

- 既定：**`gemini-3.5-flash-lite`**（`src/ai/client.ts` `DEFAULT_CHAT_MODEL`・**番号つきの版に固定**）。golden eval 38/38（2026-09-26）・1 ターンの中央値 4〜5 秒・**無料枠で実用になる 3.x の Flash-Lite**（§6.1）。
- 温度：**送らない**（＝モデルの既定 1.0・`CHAT_TEMPERATURE`）。Google は Gemini 3 系で既定のままを強く推奨している。以前の 0.2 と eval で差が無かったので推奨に従う。
- 切替：env **`GEMINI_MODEL`**（**番号つきの ID** を指定する）。プロバイダ抽象（`chatModel()`）の背後にあり、**1 行で差替可能**。フォールバックは Claude Haiku 4.5 / GPT-4.1-mini / Groq 等（`architecture.md` §10.2）。
- **版を上げるとき**：Google は新しい版を 2 週間前にメールで告知する。**golden eval を流してから**上げる（手順・判断の記録は `docs/260926_chat_model_eval.md`）。

**なぜ別名（`-latest`）を既定にしないか**

`gemini-flash-lite-latest` / `gemini-flash-latest` は特定バージョンではなく **`-latest` ローリング・エイリアス**で、Google が新リリースで**ホットスワップ**する。2026-09 には `gemini-flash-lite-latest` の中身が **3.1 → 3.5 Flash-Lite に替わっていたが、エラーは出ず、こちらは気づかなかった**（本番の設定が一度も eval を通っていない状態になった）。

- 番号つきの版なら中身は替わらない。退役すれば 404 になり、`model failure … status=404` の 1 行（§4.6）ですぐ分かる
- `@ai-sdk/google` は ID が `gemini-3` で始まるときだけ Gemini 3 として扱う。そのため並列のツール呼び出しの 2 つ目以降（署名が付かないのが仕様）に検証を飛ばす目印を補い、ログに `AI SDK Warning … without a thoughtSignature` を出す——**無害**（`docs/260926_chat_model_eval.md` §4.4）
- プレビュー版（`-preview`）も既定にしない（数か月で退役する）。`tests/ai-client-model.test.ts` が見張る

**モデル ID の実体**（getModel・generateContent の `modelVersion`・[退役表](https://ai.google.dev/gemini-api/docs/deprecations)。2026-09-26 時点）：

| モデル ID | 実体 | 系統 | 種別 |
|---|---|---|---|
| **`gemini-3.5-flash-lite`（既定）** | **Gemini 3.5 Flash-Lite**（`3.5-flash-lite-07-2026`・2026-07-21 公開・退役予定なし） | 3.5 | 固定 |
| `gemini-flash-lite-latest` | いまは 3.5 Flash-Lite（2026-07 は 3.1 Flash-Lite） | — | 別名（可変） |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite（`3.1-flash-lite-05-2026`・**早ければ 2027-05-07 に退役**・後継は 3.5） | 3.1 | 固定 |
| `gemini-flash-latest` | Gemini 3.5 Flash（2026-07 時点・429 応答が `model: gemini-3.5-flash` を明示） | 3.5 | 別名（可変） |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview | 3 | 固定（プレビュー） |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash-Lite（2025-07 stable） | 2.5 | 固定 |
| `gemini-2.5-flash` | 新規 API ユーザーに提供終了（generateContent が 404） | 2.5 | 使用不可 |

> 思考：3.1 も 3.5 も getModel では `thinking: true` で、既定の思考は**最小（`minimal`）**。eval の拒否の問では思考トークンは 0 だった。「3.5 は思考型だから遅い」わけではない（`docs/260926_chat_model_eval.md` §1・§4.3）。

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
| タイムアウト | **50 秒**（アプリ側 abort・`CHAT_TIMEOUT_MS`） | `AbortSignal.timeout`。Vercel 関数上限 `maxDuration=60` より短く graceful abort |
| リトライ | **`maxRetries: 1`** | 無料枠 429 の長い retry-after 待ちを避ける |
| 鍵未設定 | **503**（NOT_CONFIGURED） | `isChatConfigured()` |
| エラー | **種類ごとの日本語 1 文**（§4.6） | `classifyChatFailure()` が HTTP 状態で種類を決め、文は `shared/chat-errors.ts`。`toUIMessageStream({onError})` に渡す。**元のエラーは 1 行で記録**する（ツールの失敗は別の行で、ターンの失敗に数えない） |
| ランタイム | `nodejs` | provider SDK が Node 前提 |

### 4.5 ストリーミング

- **AI SDK v6 の UI message stream**（`createUIMessageStream` → SSE）。`text-delta`（本文）と `tool-*`（ツール呼び出し）を即時ストリーム、ループ完了後に **`data-map` パート**で `MapResponse` を送出。
- クライアントは `useChat` の `onData` で `data-map` を受け、`useApplyMapActions` が地図へ即時反映。`message.parts` からパネルをインライン描画。
- 本文が無いまま終わったターン（打ち切り・本文なしの終了）は、`data-map` の `messages` の一文を吹き出しに出す（`messageParts.displayTextOf`）。**2026-09-25 まで画面はこれを描いておらず、打ち切りは無言だった**。
- `data-map` と一緒に **`data-promotions`**（⤢ の条件・パネルと同じ並び・`shared/promotion.ts`）を送る。条件は図を生んだ副産物からサーバが作り（`assemble.ts` の `promotionsFor`）、図より先に届く。画面の ⤢ とキャンバスの自動表示は、これをそのまま使う（§8）。

### 4.6 失敗の言い分けと記録（2026-09-25）

**きっかけ**：Gemini が一時的に応答しなくなり、本番は 31 秒待って失敗した（同じ時間帯、API に直接投げた最小の生成にも 14.3 秒）。
10 分ほどで自然に回復したが、3 つの弱点が見えた——①画面が 429 以外をすべて「応答の取得に失敗しました」で上書きしていた
②サーバも提供元の 500 を「生成に失敗」と言っていた（待てば直るのに）③**ログに元のエラーが残っておらず、429 か 5xx かを
後から確かめられなかった**。

**種類は HTTP 状態で決める**（`src/ai/chat-errors.ts`・文言の正規表現はやめた）。基準は**待てば直るか**。

| 種類 | 提供元の応答 | 画面の 1 文（`shared/chat-errors.ts`） |
|---|---|---|
| `rate_limited` | 429 | ただいま混雑しています（無料枠の上限の可能性があります）。少し時間をおいて… |
| `unavailable` | 5xx・408・接続の失敗 | AI（Gemini）が一時的に応答できない状態です。少し時間をおいて… |
| `rejected` | その他の 4xx（鍵・モデル名・リクエストの形） | チャットの設定に問題があり…**時間をおいても直らない可能性**があります |
| `unknown` | それ以外 | 応答の生成に失敗しました。時間をおいて… |

**画面は言い換えない**。サーバの 1 文をそのまま出し、自分で選ぶのはサーバの答えが届かなかったときだけ——
アプリの HTTP エラー（封筒の日本語）・**WAF の遮断**（「一時的に制限しています」＝`shared/platform-error.ts`。
Vercel の本文はアプリの封筒と同じ形なので、見分けないと英語の `Forbidden` が出る）・通信断（端末がオフラインと
言っているときだけ「オフライン」）。

**記録は失敗 1 件につき 1 行**（Vercel の Runtime Logs で `model failure` を検索）：

```
[api/chat] model failure kind=rejected status=400 provider=INVALID_ARGUMENT attempts=1
  model=gemini-flash-lite-latest elapsed=341ms name=AI_APICallError detail="API key not valid. Please pass a valid API key."
```

- **発話は出さない**。提供元の説明に紛れていても伏せる（4 文字以上の発話を `[発話]` に置換）。説明は 160 字で切る
- SDK の既定は失敗のたびに生のエラー（説明・応答本文）を `console.error` に出すので、`streamText` の `onError` で止めた
  （`ToolLoopAgent` はこれを型の上で渡せないため、`streamText` を直接呼ぶ形にした。引数と停止条件は同じ）
- 重ねて記録しないもの：同じエラーの再送・こちらの打ち切りの残骸（`TimeoutError`）・派生の
  `NoOutputGeneratedError`（他に原因があるとき）。打ち切りは結果の 1 行（`[api/chat] aborted …`）が記録する

**ツールの失敗はモデルの失敗ではない**（2026-09-26）。モデルが形の合わない引数を渡したり（例 `routeTypes: ["1"]`）、
無いツールを呼んだりすると、SDK はそのエラーを**ツールの結果としてモデルに差し戻し、手順を続ける**——モデルは
同じターンで直して答えられる。だからターンの成否（`ok` / `failed`）には数えず、別の 1 行で残す
（Runtime Logs で `tool failure` を検索）：

```
[api/chat] tool failure tool=compareGrowth name=AI_InvalidToolInputError
  model=gemini-3.5-flash-lite detail="routeTypes.0: Invalid input: expected number, received string"
```

- 載せるのは**どの引数が、なぜ合わないか**だけ。引数の値は載せない（利用者の言葉や地点が入りうる）
- 以前は、画面向けのストリームの `onError`（ツールの失敗でも呼ばれる）で失敗を拾っていたため、1 回の失敗が
  `model failure kind=unknown` の 2 行（エラーと、SDK がそれを文字列にしたもの）になり、ターンが `failed` と
  数えられていた。いまはモデルの失敗を `streamText` の `onError`（error パートでだけ呼ばれる）と `result.text` から、
  ツールの失敗を手順の記録（`onStepFinish` の `content`）から取る
- ツールのパーツに添える文も、モデルの失敗の文ではなく「ツールの呼び出しに失敗しました。」にした（画面は描かない）
- 頻度は、モデルとツールの説明の相性の目安になる（2026-09-26 の eval では 38 問中 1 回）

**検証**：`tests/api-chat-errors.test.ts`（提供元の失敗を `MockLanguageModelV3` で投げ、画面に届く SSE とログの両方を見る）・
`tests/chat-error-message.test.ts`・`tests/chat-errors.test.ts`・`tests/ui.chat-errors.smoke.py`（実ブラウザ 9 場面。
**旧コードの本番に当てると 9 場面すべて落ちる**）。偽の API キー・存在しないモデル名で本物の Gemini にも当て、
400 / 404 がそれぞれ `rejected` として 1 行で残ることを確かめた。

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
# GEMINI_MODEL=…   # 任意（未指定なら gemini-3.5-flash-lite。替えるなら番号つきの ID で・§4.1）
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
- **レスポンス**：`text/event-stream`（SSE）。`data:` 行に `text-delta`・`tool-input-available`・**`data-map`**（`{ "type": "data-map", "data": MapResponse }`）・**`data-promotions`**（`{ "type": "data-promotions", "data": (PanelPromotion | null)[] }`＝パネルと同じ並びの ⤢ の条件）等が流れる。エラー時は `{error:{code,message}}` の封筒（プレストリームの 400/429/503）または `error` パート。

---

## 6. 無料枠・レート制限・コスト・プライバシー

### 6.1 レート制限（1分・1日・1か月）

Gemini 無料枠の制限は **RPM（1分あたりリクエスト）／RPD（1日あたり）／TPM（1分あたりトークン）** で決まる。重要な性質：

- **月次（1か月）の上限は無い**。制限は RPD（日次）が実質の上限で、**月間は「RPD × 稼働日数」で頭打ち**になる。
- **プロジェクト単位**（API キー単位ではない＝鍵を増やしても増えない）。**RPD は毎日 太平洋時間 0 時にリセット**。
- **`-latest` エイリアスの制限は、その時点で指す実体モデルに従う**（実体が変われば制限も変わる）。
- Google 公式のレート制限ページは**モデル別の数値掲載をやめ、AI Studio で各自確認**する方式（実容量は変動しうる）。

**本プロジェクトの実値（[AI Studio レート制限画面](https://aistudio.google.com/rate-limit) の表示・2026-07-13。既定の 3.5 Flash-Lite の行だけ 2026-09-26）**。Google 公式はモデル別数値の掲載をやめ**この画面（プロジェクト単位・随時変動）が唯一の正**なので、下表はその実値：

| モデル（無料枠・本プロジェクト実値） | RPM（1分） | TPM（1分） | RPD（1日） | 1か月（≒RPD×日数） |
|---|---|---|---|---|
| **`gemini-3.5-flash-lite`（＝Gemini 3.5 Flash-Lite・既定）** | **15** | 250K | **500** | ~15,000 |
| `gemini-flash-latest`（＝Gemini 3.5 Flash） | 5 | 250K | 20 | ~600 |
| `gemini-flash-lite-latest`（＝当時の実体 Gemini 3.1 Flash-Lite・当時の既定） | 15 | 250K | 500 | ~15,000 |
| `gemini-3-flash-preview`（＝Gemini 3 Flash） | 5 | 250K | 20 | ~600 |
| `gemini-2.5-flash`（固定 ID） | 5 | 250K | 20 | ~600 |
| `gemini-2.5-flash-lite`（固定 ID） | 10 | 250K | 20 | ~600 |

> **要点**：無料枠でまともに使えるのは **3.x の Flash-Lite（15 RPM / 500 RPD）**だけ（＝flash-latest の 20 RPD の **25 倍**）。既定の `gemini-3.5-flash-lite`（2026-09-26〜）も、7 月の既定（3.1 Flash-Lite）と同じ値である。他は軒並み **RPD 20**（`gemini-flash-latest`＝3.5 Flash も同様）。API 実測（RPM=15）とも一致。
>
> **別名で呼んだ分も、その時点の実体の枠に数えられる**：モデル検証の日（2026-09-26）の使用量の表示は RPD 282/500 で、その日に別名（`gemini-flash-lite-latest`）と番号つきの ID で 3.5 Flash-Lite を呼んだ数の合計（約 270 回）とほぼ一致した。
>
> **1 回の呼び出しは約 7〜8K トークン**（システムプロンプトとツール定義だけで約 7K・2026-09-26 実測）で、1 チャット（3 回）で約 2.2 万。15 RPM まで使っても TPM は約 11 万で、250K の半分に届かない——**先に効くのは RPM**。
>
> **公開情報は当てにならない**：Web 上の第三者情報は日付により **15/30 RPM・250〜1,500 RPD** とばらつく（**2025-12 に無料枠 50–80% 削減**、**2026-05 の 3.1 Flash-Lite GA** 等、改定が続くため）。実際、公開値では 2.5 Flash＝250 RPD / 2.5 Flash-Lite＝1,000 RPD だが、**本プロジェクトの実値はいずれも 20 RPD** と大幅に低い。→ **必ず自分の AI Studio の値を正とする**。
>
> **1 チャット＝多段ツールで 2〜3 リクエスト消費**するため、15 RPM / 500 RPD なら体感は「1 日あたり 約 150〜250 対話・1 分あたり 5〜7 対話」まで。超えると 429（画面に「ただいま混雑しています」が出る・§4.6）。本格運用は有料枠/Vertex（§6.2）。

出典：**上表の値は本プロジェクトの [AI Studio レート制限画面](https://aistudio.google.com/rate-limit)（一次ソース・2026-07-13。3.5 Flash-Lite の行は 2026-09-26）**。制度の背景は [Rate limits（公式・AI Studio 参照方式）](https://ai.google.dev/gemini-api/docs/rate-limits)・[Models（`-latest` の定義）](https://ai.google.dev/gemini-api/docs/models)。第三者情報（[aifreeapi](https://www.aifreeapi.com/en/posts/gemini-api-free-tier-rate-limits)／[TokenMix](https://tokenmix.ai/blog/gemini-api-free-tier-limits)）は日付でばらつき参考程度。RPM=15 は API 実測でも確認済み。

### 6.2 コスト・プライバシー

- **本番は有料枠（Tier 1 以上）or Vertex AI 推奨**：無料の日次上限・低 RPM を外し、**学習非利用**にできる（無料枠は入力がモデル改善に使われうる）。収録データは公開オープンデータで懸念は小さいが、ユーザー発話を扱うため。鍵はサーバのみ。
- ランニングコスト目安：無料枠 ¥0（light 利用）／有料でも Flash 系なら月数百円規模から（従量・入出力トークン課金）。

詳細と判断根拠は `docs/p8c_eval_report.md`。

---

## 7. 評価（eval・`src/ai/eval` ＋ `tests/chat-eval.test.ts`）

- **ゴールデン 38 問**（駅詳細 6・ランキング 5・散布 3・比較 1・曖昧駅名 2・カタログ 2・**災害 13**・**データ外拒否 4**・地図文脈 2）を実 `/api/chat` に投げ、**期待ツール列（入力の部分一致）・パネル型・駅選択・拒否・要点文字列・言ってはいけない語**を純関数で採点（`score.ts`・単体テスト済）。
- **合格の線**：全体 36/38 以上、かつ**災害・拒否は 1 問も落とさない**（17/17。人命に関わる言い方の不変条件）。
- **記録するもの**：合否に加えて、**所要時間（p50・p95・最大）と再試行に頼った問の数**（集計は `src/ai/eval/report.ts`）。runner は失敗した問を 65 秒待って 1 度だけ流し直すので、合格数だけではモデルの不安定さが隠れる。
- **最新の結果（2026-09-26）**：`gemini-3.5-flash-lite` × 既定温度で **38/38**（災害・拒否 17/17・再試行 0）。20 問の時代は 20/20（2026-07・P8c）、37 問で 37/37（2026-08-28・`docs/260828_eval_report.md`）。
- 実行：サーバを起動 → `EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts`（無料枠のため問間スロットル＋429 リトライ内蔵）。**モデルや温度を比べるとき**は `EVAL_REPORT`（レポートの書き出し先）と `EVAL_LABEL`（名札）を付け、サーバのログ（初回応答の打ち切り・`model failure`）も数える——手順は `docs/260926_chat_model_eval.md` §3。

---

## 8. 制約・既知の限界

- **無料枠のクォータ**が厳しい（上表）。連投・多段クエリで 429 になりやすい。本番は有料枠/Vertex 前提。
- **レート制限がインメモリ**：サーバレス（Vercel）では**インスタンスごと**に独立するため、厳密な全体制限ではない（コメントどおり「下限」）。→ 改善は §9。
- ~~**ストリーム中 Gemini 429 のメッセージ**：`ChatPanel` が `'429'`/`'多す'` の文字列で判定するため汎用文言になる~~——**解消（2026-09-25・§4.6）**。画面はサーバの 1 文をそのまま出す。
- **`data-map` は応答の末尾**に届く（`assemble` はループ完了後に動く）。地図操作の「返答中の即時反映」は、テキストが流れた後・最終段でまとまって反映される（多段ツールでも UX 上は十分だが、真の逐次反映ではない）。
- ~~**⤢ 昇格の条件は、画面がパネルとツール呼び出しの照合で推し量る**~~——**やめた（2026-09-26）**。推し量ると、
  失敗した呼び出し（「千葉市」で失敗→「千葉県」で呼び直し）や、同じ指標の 2 つ目の呼び出し（「新幹線」を事業者名に渡して 0 件の図→
  絞り込みを外して呼び直した図）で、⤢ もキャンバスも**別の図の条件**で開き、「データがありません」になっていた。いまは**サーバが
  図を生んだ副産物から条件を作り**（`promotionsFor`）、`data-promotions` としてパネルと同じ並びで送る。画面はそれを使うだけ
  （`panelGroups.ts`・条件の数がパネルと合わない・種類が食い違うときは ⤢ を出さない）。検証：`tests/api-chat-promotions.test.ts`
  （本物のツールと SDK）・`tests/ui.chat-promotion.smoke.py`（実ブラウザ 5 場面。修正前の本番では「同じ指標の図が 2 つ」の 2 場面が落ちる）
- **任意半径クエリ**（例「3km 以内の人口」）は未対応（事前計算6半径のみ）。
- **会話は永続化しない**（リロードで消える）。既定オープンも毎回（localStorage 保存なし）。

---

## 9. 今後の改善点

**優先度：高（本番運用）**
1. **本番モデル＝有料枠 or Vertex AI**：日次上限・学習利用を回避。`GEMINI_MODEL` を Flash 系の番号つきの版（例 `gemini-3.5-flash`）に——eval を流してから（§4.1）。プロバイダ抽象済みなので設定のみ。
2. **レート制限を Upstash Redis 等へ**：サーバレス横断で厳密に。`rate-limit.ts` の seam を差替。
3. ~~**エラー UX の一本化**~~——**実施（2026-09-25・§4.6）**。続く**モデルの検証**も**実施（2026-09-26・§4.1）**：既定を `gemini-3.5-flash-lite` に固定し、温度は送らない（`docs/260926_chat_model_eval.md`）。そこで見つけた宿題のうち、ツールへの不正な引数が「モデルの失敗」と記録される件は**修正済み**（§4.6）。残りは同 §6。

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
