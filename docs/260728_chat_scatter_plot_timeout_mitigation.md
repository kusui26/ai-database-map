# チャットの散布図要求がタイムアウト（abort）する事象の恒久対応プラン

作成日: 2026-07-28 ／ 対象: `src/ai/*`・`src/app/api/chat/route.ts`（＋クライアント `src/components/chat/*`）／ 発見経緯: [`260728_fix_scatter_chart_sparse_cluster_labels.md`](./260728_fix_scatter_chart_sparse_cluster_labels.md) §9.5（PR #34 の検証中に観測・対象外として記録）

> §1–§7 が計測に基づく診断と恒久対応プラン、**§8 が確定した決定事項、§9 がフェーズ 1（fail-soft）、§10 がフェーズ 2＋3（往復削減・タイムアウト設計）の実装結果**（いずれも 2026-07-29 実装・検証済み）。

---

## 0. エグゼクティブサマリ（結論先出し）

- **症状**：チャットで散布図（`compareGrowth`）を求めると、**何も表示されずに終わる**ことがある。ユーザーから見ると「タイムアウト」だが、実測すると**症状が同じ 3 つの失敗モード**がある。

  | 失敗モード | 中身 | 実測 |
  |---|---|---|
  | ① **45s abort** | LLM の 1 回の応答が数十秒停滞し、`CHAT_TIMEOUT_MS`（45s）に達して中断 | 45.2s / 45.3s / 45.5s / 45.8s で複数回 |
  | ② **ステップ枯渇** | `stepCountIs(6)` を `getMetricsCatalog` の往復で使い切り、`compareGrowth` に到達しない（または誤キーで失敗） | 5 試行中 1 件・6 試行中 1 件 |
  | ③ **429/エラー** | 無料枠のレート制限に当たり、ツール実行前後で打ち切り | 連投 6 試行中 3 件 |

- **本当のボトルネックは「データ処理」ではなく「LLM の往復回数」**：ツール実行は速い（散布の集計＝`/api/growth` 相当で **千葉県 0.59s / 全国 0.86–1.31s**）。一方 LLM は**1 ステップ ≈ 0.9–1.1s（正常時）だが、テールで 7–30s 停滞**する。
- **往復が多い根本原因＝指標キーの解決**：散布 1 回につき **`getMetricsCatalog` が 4–6 回**呼ばれている（5 試行の中央値 5 回）。1 回の返却は最大 **7–15KB の JSON**（`pop_gr` は 54 変種 ≈7.4KB、`pop_pred` は 114 変種）で、以後の全ステップの入力に積み上がる。
- → **対策の優先順位**：
  1. **失敗しても必ず何かを返す（fail-soft）**：ツールが成功した時点で**パネルを逐次送出**し、本文が空でも**フォールバック文**を返す。3 つの失敗モードすべてで「何も出ない」を解消する（最小の変更で最大の効果）。
  2. **往復そのものを減らす**：ツールが**意味パラメータ**（baseMetric＋半径＋年）を受け取り、**キー解決をサーバ側の純関数**で行う。カタログ照会 4–6 回 → **0〜1 回**、LLM 呼び出し 7–8 回 → **2–3 回**が狙い。
  3. **テール遅延を切る**：プロバイダに **TTFT（初回応答）タイムアウト付き fetch** を注入し、停滞は即座に 1 回だけ再試行。全体は 45s → 50–55s（Vercel Hobby の 60s 内）。
  4. **運用レバー**：`GEMINI_MODEL` による有料枠/Vertex 切替、フォールバック・プロバイダ、失敗理由のログ。
- **純加算**：`src/domain`・`src/shared/protocol`・既存 API・`src/db` は**無改変**。変更は `src/ai` と `app/api/chat`、必要なら `components/chat` に限る。
- **回帰の担保**：`EVAL=1` のゴールデン **22 問**を再実行し、現行水準（合格閾値 16）を維持することを受け入れ基準に含める。

---

## 1. 事象

- ユーザー操作：チャットで「千葉県で人口増減率（2km圏）と乗降客のコロナ前後増減率の散布図を見せて」等。
- 症状：**回答本文もパネルも出ない**まま終わる。`/api/chat` は HTTP 200 で SSE を返しており、`data-map` パートは届くが `panels: []` `messages: []`。
- 補足：PR #34 の検証中、修正前の `main` ビルドでも**同一プロンプトが 1 回目 8.1s 成功・2 回目 45.3s abort** となり、**コード変更とは独立の既存事象**であることを確認済み。

---

## 2. 計測

### 2.1 手法

`/api/chat` の SSE を受け、**イベントごとの経過時刻**を記録するトレーサを作成（`start-step` / `tool-input-available(toolName)` / `tool-output-available` / `text-*` / `abort` / `error` / `data-map`）。無料枠のレート制限を避けるため **45s 間隔**（eval ハーネスの既定 `EVAL_THROTTLE_MS` と同値）で 5 試行。プロンプトは上記の千葉県・散布。

### 2.2 結果（間隔をあけた 5 試行＝公平条件）

| 試行 | 所要 | ステップ数 | `getMetricsCatalog` 回数 | 1 イベント間の最大無応答 | 結果 |
|---|---|---|---|---|---|
| 1 | **42.9s** | 6（上限） | **6** | **29.9s** | scatter 表示（45s まで残り 2 秒） |
| 2 | 6.1s | 6（上限） | 5 | 1.1s | **パネル 0・本文 0**（ステップ枯渇） |
| 3 | 6.3s | 6（上限） | **6** | 1.0s | scatter 表示 |
| 4 | 13.9s | 5 | 5 | 7.1s | scatter 表示 |
| 5 | 34.0s | 5 | 4 | 10.8s | scatter 表示 |

- **すべての試行で `getMetricsCatalog` が 4–6 回**。`compareGrowth` は 1 回だけ（本来これだけで済む）。
- 正常時の 1 ステップは **0.9–1.1s**。**テールで 7.1s / 10.8s / 29.9s** と大きく振れる。
- ステップ上限 6 に**毎回張り付いている**（試行 1–3）。

### 2.3 連投時（無料枠のレート制限が効く条件・6 試行）

所要 9.8s / 5.0s / 5.6s / 4.1s / 3.1s / 2.3s、**パネル 0 が 3 件**（うち 2 件は `error` イベント＝429 系、1 件はステップ枯渇）。
→ eval ハーネスが既定で 45s のスロットルを掛けているのは、この制約への対処（`tests/chat-eval.test.ts:22`）。

### 2.4 決定的な処理（自前コード）は速い

| 処理 | 実測 |
|---|---|
| `/api/growth`（＝`compareGrowth` と同じ集計）千葉県 | **0.59s** / 21.5KB |
| 同 全国（7,680 駅） | **0.86–1.31s** / 543KB |
| ツール実行イベント間（SSE 実測） | `compareGrowth` **0.55s**、`getMetricsCatalog` **0.00–0.01s** |

→ **45s のうち自前処理は 1s 前後。残りはすべて LLM 待ち。**

### 2.5 なぜカタログ照会が増えるのか

- system prompt が渡すのは「カテゴリ → baseMetric → **例キー 1 つ** ＋ 対応半径」（`catalog-digest.ts:164`）。**特定の年ペア × 半径の正確なキーは含まれない**。
- そのため LLM は `getMetricsCatalog(baseMetric)` を呼ぶが、返却は**全変種**（`pop_gr` 54 / `lp_med` 100 / `pop_pred` 114 変種）で、`pop_gr` だけで **7,354 bytes ≈ 2,400 トークン**。x/y の 2 指標ぶん、さらに探索的に複数回呼ぶ。
- **近いが無効なキー**を作りやすく、その都度エラー → 再照会の往復が増える（実測）：

  | LLM が作りがちなキー | 判定 |
  |---|---|
  | `pop_gr_2020_2015_2km` | ✅ 有効 |
  | `pop_gr_2015_2020_2km`（年の順が逆） | ❌ 無効 |
  | `pop_gr_2km`（年ペアなし） | ❌ 無効 |
  | `bus_gr_2000m`（半径表記ゆれ） | ❌ 無効 |
  | `emp_gr_2016_2021_2km`（年の順が逆） | ❌ 無効 |
  | `rate_covid_2km`（半径非依存指標に半径） | ❌ 無効 |

---

## 3. 根本原因（4 層）

| # | 原因 | 効き方 |
|---|---|---|
| ① | **キー解決が LLM の往復に依存**（意味パラメータでは呼べず、正確なキー文字列が必須） | 1 ターンあたり **+4〜6 回の LLM 呼び出し**。所要時間・停滞確率・トークン/クォータ消費が比例して増える |
| ② | **ステップ上限 6 が①で食い潰される** | `compareGrowth` に到達せず終了＝**パネル 0**（失敗モード②） |
| ③ | **LLM のテール遅延**（無料枠 `gemini-flash-lite-latest`：正常 ~1s／テール 7–30s） | 呼び出し回数が多いほど「1 回でも停滞する」確率が上がり、45s 到達（失敗モード①） |
| ④ | **無料枠のレート制限**（連投で 429） | 失敗モード③。eval が 45s スロットルを掛けている前提と同じ制約 |

> **重要**：①②が**主因**で、③④は**それを増幅する外部要因**。したがって「タイムアウトを伸ばす」だけでは（体感は多少改善しても）失敗モード②③は残る。**往復を減らす**ことと**失敗しても部分成果を返す**ことが恒久対応の本体になる。

---

## 4. 対策候補の比較

| # | 案 | 効果 | コスト/リスク | 採否 |
|---|---|---|---|---|
| **F1** | **ツール成功時点でパネルを逐次送出**（`data-map` を段階的に write） | 失敗モード①②③**すべて**で「何も出ない」を解消。ツールが 1 つでも通れば図は出る | `src/ai/types.ts` に通知フック＋`route.ts` で write。クライアントは**最後の data-map を採用**する実装（`ChatMessage.tsx:25-29`）なので互換 | **採用（最優先）** |
| **F2** | **本文が空のときのフォールバック文** | 「無言で終わる」を根絶。ユーザーに次の行動を示せる | `route.ts` で `assemble` の結果に応じて 1 文を足すだけ（`assemble` は純関数のまま） | **採用** |
| **R1** | **ツールに意味パラメータを追加**（`baseMetric`＋`radiusM`＋`year`/`yearBase`/`vintage`。`metric` も従来どおり可） | カタログ照会 **0 回**で到達可能に | 入力スキーマ拡張＝LLM の挙動が変わりうる → eval で担保 | **採用** |
| **R2** | **キー解決器（純関数）**：完全一致 → 表記ゆれ正規化（半径 `2000`/`2000m`/`2km`・年ペアの順序）→ baseMetric＋半径で一意なら採用 → 不能なら現行のエラー＋`didYouMean` | 近似キーの往復を吸収。**カタログが単一の真実**という原則は不変 | 純関数＋単体テスト。曖昧なときは**推測で確定しない**（誤指標の表示を防ぐ） | **採用** |
| **R3** | **system prompt にキー命名規則＋代表キー**（カタログ駆動で生成） | LLM が 1 回でキーを組み立てられる | プロンプト肥大（数百バイト）。eval で確認 | **採用** |
| **R4** | **`getMetricsCatalog` の返却をスリム化**（変種を「年ペア一覧 × 半径一覧」に畳む・上限件数） | 1 回あたり 7–15KB → 数百バイト。以後の全ステップが軽くなる | 表現を変えるため eval のカタログ 2 問に影響しうる | **採用（R1–R3 の後に効果測定して調整）** |
| **T1** | **TTFT（初回応答）タイムアウト付き fetch をプロバイダに注入**（例 20s）＋`maxRetries: 1` | 30s 停滞を「20s で打ち切って再試行」に置換。テールを構造的に切る | `createGoogleGenerativeAI({ fetch })` で実装可（型で確認済み）。**ストリーム本文は切らない**設計が必須 | **採用** |
| **T2** | **全体タイムアウト 45s → 50–55s** | 余裕が 5–10s 増える | `maxDuration = 60`（Hobby 上限）の内側。単体では②③に無効 | **採用（補助）** |
| **T3** | **ステップ上限 6 → 8** | 枯渇を緩和 | 往復が増えれば遅延・クォータも増える。R1–R3 で消費が減れば不要 | **保留**（R 実施後に再測定して判断） |
| **O1** | `GEMINI_MODEL` で有料枠 / Vertex / 上位モデルへ | テール遅延・429 の根本緩和 | 費用。既存の env 機構だけで可能（コード変更なし） | **採用（運用レバー・実装不要）** |
| **O2** | プロバイダ・フォールバック（Groq/OpenRouter/Claude Haiku を 2 番手に） | 429・停滞時に自動退避 | `client.ts` の抽象を拡張。鍵の追加管理 | **将来（別ブロック）** |
| **O3** | 失敗理由の 1 行ログ（ステップ数・所要・abort/error 種別） | 本番での再発検知 | `console.error` 1 箇所 | **採用（小）** |
| ✗ | 散布ツールの返却をさらに削る | 既に要約のみ（`pointCount`/`clusterCount` 等）＝**すでに最適** | — | **不要** |
| ✗ | 集計結果のサーバキャッシュ | 自前処理は 1s 前後で**ボトルネックではない** | 複雑さだけ増える | **却下** |
| ✗ | タイムアウト撤廃 | Vercel 関数上限 60s で強制切断＝ UX 悪化 | — | **却下** |

---

## 5. 推奨実装プラン（フェーズ分割・各フェーズで検証可能）

### フェーズ 1：fail-soft（最優先・体感の 9 割を回収）

1. **`EffectCollector` に通知フックを追加**（`src/ai/types.ts`）
   ```ts
   export function createCollector(onPush?: (effects: readonly ToolEffect[]) => void): EffectCollector
   ```
   `push` のたびに現在の全効果を通知する（純データのまま・domain 非依存）。
2. **`route.ts` で逐次 `data-map` を送出**
   ```ts
   const collector = createCollector((effects) => {
     writer.write({ type: 'data-map', id: MAP_PART_ID, data: assemble(effects, '') })
   })
   ```
   `id` を固定して**同じパートを更新**（`DataUIPart` は `id?` を持つ）。クライアントは最後の `data-map` を採用するため、最終書き込みが常に権威になる。
3. **フォールバック文（`route.ts`）**：ループ終了後、`text` が空のときだけ 1 文を補う。
   - パネルあり：「地図とグラフを表示しました（説明の生成は間に合いませんでした）。」
   - パネルなし・abort：「時間内に取得できませんでした。もう一度お試しください。」
   - パネルなし・エラー：既存の `friendlyError`（429 は「混雑しています」）を本文にも反映。
4. （任意）**クライアント**：`status === 'error'` 時に「もう一度試す」チップを出す（`ChatPanel`・既存のエラー UI に追加）。

**このフェーズだけで**、失敗モード①②③のいずれでも「ツールが 1 つでも成功していれば図が出る／必ず一言返る」状態になる。

### フェーズ 2：往復削減（根治）

5. **キー解決器**（新規・純関数 `src/ai/metric-resolver.ts`）
   ```ts
   export type MetricSpec = { metric?: string; baseMetric?: string; radiusM?: number; year?: number; yearBase?: number; vintage?: number }
   export type MetricResolution =
     | { ok: true; key: string; note: string | null }   // note: 補正した場合の説明
     | { ok: false; error: string; hint: string; didYouMean: string[] }
   export function resolveMetricKey(spec: MetricSpec): MetricResolution
   ```
   - 完全一致 → そのまま。
   - 表記ゆれ（半径 `2000`/`2000m`/`2km`、年ペアの順序）を正規化して再照合。
   - `baseMetric`＋（`radiusM`/`year`/`yearBase`/`vintage`）で**候補が一意**なら採用。**複数残る場合は確定せず** `didYouMean` を返す（誤った指標を黙って出さない）。
   - 解決は**カタログのみ**を参照（単一の真実は不変・`rankable` 検証も従来どおり）。
6. **`rankStations` / `compareGrowth` の入力拡張**：`metric`（従来）に加え `baseMetric` / `radiusM` / `year` / `yearBase` / `vintage` を任意で受ける。実行時は `resolveMetricKey` を通し、補正したら返却に `resolvedMetric` と `note` を含める（LLB が本文で言及できる）。
7. **system prompt の強化**（`system-prompt.ts`・カタログ駆動）：
   - 「キーは `{接頭辞}_{年}_{半径}`／増減率は `{接頭辞}_gr_{新年}_{旧年}_{半径}`」という**規則**を明示。
   - **代表キー 8 個程度**（人口増減率・地価増減率・バス増減率・事業所/従業者増減率・乗降 `rate_yoy`/`rate_covid` 等）を列挙。
   - 「`baseMetric` と `radiusM` を渡せばキーは不要」と明記（＝カタログ照会を促さない）。
8. **`getMetricsCatalog` のスリム化**（`catalog-digest.ts`）：変種の全列挙をやめ、「年ペア一覧 × 半径一覧 ＋ 代表キー」に畳む。返却上限を設ける。

### フェーズ 3：テール遅延とタイムアウト設計

9. **TTFT タイムアウト付き fetch**（`client.ts`）：`createGoogleGenerativeAI({ apiKey, fetch })` に、**最初の応答が返るまで**の期限（例 20s）を持つ fetch を渡す。到達したら abort し、`maxRetries: 1` に再試行させる。**ストリーム開始後は解除**（長い応答を切らない）。
10. **全体タイムアウト 45s → 50–55s**（`CHAT_TIMEOUT_MS`）。`maxDuration = 60` の内側に余裕を残す。
11. **失敗理由の 1 行ログ**（`route.ts`）：`steps` / 所要 ms / 終了理由（finish・abort・error）/ 効果件数。本番で再発を検知できるようにする。

### フェーズ 4：運用レバー（コード変更なし・記録のみ）

12. `GEMINI_MODEL` で有料枠 or Vertex の `gemini-flash-latest` / `gemini-3-flash-preview` に切替（[`p8c_eval_report.md`](./p8c_eval_report.md) §2 の判断を踏襲）。無料枠を使い続ける場合は、**連投時の 429 は仕様の範囲**として UI 文言で説明する。

---

## 6. 影響範囲と純加算性

| レイヤ | 変更 |
|---|---|
| `src/ai/types.ts` | `createCollector` に通知フック（後方互換・引数省略可） |
| `src/ai/metric-resolver.ts`（新規） | キー解決器（純関数・カタログのみ参照） |
| `src/ai/tools.ts` | 2 ツールの入力拡張＋解決器の適用（返却に `resolvedMetric`/`note`） |
| `src/ai/system-prompt.ts` / `catalog-digest.ts` | 規則・代表キーの明示／ダイジェストのスリム化 |
| `src/ai/client.ts` | TTFT タイムアウト付き fetch・`CHAT_TIMEOUT_MS` 調整 |
| `src/app/api/chat/route.ts` | 逐次 `data-map`・フォールバック文・1 行ログ |
| `src/components/chat/*`（任意） | 「もう一度試す」チップ |
| **無改変** | **`src/domain`・`src/shared/protocol`・`src/shared/api`・既存 API（chat 以外）・`src/db`・`pipeline`・`supabase`** |

→ Step2 の原則（**AI 層は純加算**・architecture.md §7.3）を維持する。

---

## 7. 検証計画（受け入れ基準）

| # | 項目 | 方法 | 合格条件 |
|---|---|---|---|
| 1 | **往復の削減** | 本調査の SSE トレーサで散布プロンプトを 5 試行（45s 間隔） | `getMetricsCatalog` **≤1 回/ターン**（現状 4–6）、ステップ数 **≤3**（現状 5–6） |
| 2 | **所要時間** | 同上 | p50 **< 6s**、p95 **< 20s**（現状 p50 13.9s・最悪 42.9s） |
| 3 | **空応答ゼロ** | 同上＋連投 6 試行（429 を意図的に誘発） | **すべての試行で「パネルまたは本文」が必ず出る**（現状：11 試行中 4 件が無言） |
| 4 | **部分成果の即時性** | SSE のイベント順 | `compareGrowth` の `tool-output-available` 直後に `data-map`（パネルあり）が届く＝最終テキストを待たない |
| 5 | **abort 時の挙動** | `CHAT_TIMEOUT_MS` を一時的に小さくして強制 abort | パネルは表示され、フォールバック文が出る |
| 6 | **キー解決器** | 単体テスト（純関数） | 完全一致／年順の逆／半径表記ゆれ（2000・2000m・2km）／年ペア省略／半径非依存指標に半径指定／曖昧＝エラー＋`didYouMean`、を網羅 |
| 7 | **eval 回帰** | `EVAL=1 pnpm exec vitest run tests/chat-eval.test.ts`（22 問・45s スロットル） | **合格数が現行水準以上**（閾値 16／直近 20+/22）。特に `scatter-*`・`rank-*`・`catalog-*` の 8 問 |
| 8 | 品質ゲート | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | すべて green |
| 9 | ヘッドレス | Playwright でチャット散布 → インラインカード描画 | パネルが出る・`console error 0`・⤢ 昇格が従来どおり |
| 10 | 純加算 | `git diff --stat main -- src/domain src/shared/protocol.ts src/shared/api.ts src/db src/app/api（chat 以外）` | **diff 0** |

---

## 8. 決定事項（2026-07-29 ユーザー承認）

| # | 決定 | 内容 |
|---|---|---|
| 1 | **PR の分け方** | **フェーズ 1（fail-soft）を先行 PR**（小さく即効・LLM の挙動に触れないため回帰リスク最小）→ **フェーズ 2＋3 を次の PR**（eval を厚く回す） |
| 2 | **キー解決の厳しさ** | **曖昧な指定は既定値で確定し、`note` で明示**する。既定＝①年ペアは「終点＝最新年・スパン 5 年（無ければ最も近いスパン）」＝`pop_gr` 2015→2020／`estab_gr`・`emp_gr` 2016→2021／`lp_gr` 2021→2026／`pop_gr_pred` 2020→2025、②半径は未指定なら 1km、③非対応半径は最も近い対応半径へ丸めて `note`（UI の自動フォールドと同じ挙動）。**ファミリ不明・`rankable` 外・実在しない年の明示・半径非依存指標への半径指定**は確定させずエラー＋`didYouMean` |
| 3 | **全体タイムアウト** | **50s**（`maxDuration = 60` に対し 10 秒のマージンを残す）。TTFT タイムアウトは **15s**（実測：正常 ~1s／停滞 7.1・10.8・29.9s） |
| 4 | **`getMetricsCatalog` のスリム化** | **フェーズ 2 に含める**。ただし「変種の全列挙 → **年ペア一覧 × 半径一覧 ＋ 代表キー**」への畳み込みに留め、上限値は効果測定後に調整。ツール自体は残す（自己記述カタログの原則）。eval のカタログ 2 問は本文キーワードのみを見るため影響は小さい（`cases.ts` で確認済み） |
| 5 | **運用** | **無料枠のまま**（`gemini-flash-lite-latest`）。有料枠/Vertex への切替は将来判断（本書 §4-O1・[`p8c_eval_report.md`](./p8c_eval_report.md) §5 に記録） |

---

## 9. 実装結果 — フェーズ 1（fail-soft・2026-07-29・ブランチ `feat/chat-fail-soft`）

> フェーズ 2（往復削減）・3（TTFT タイムアウト＋全体 50s）は**次の PR**。本 PR では `CHAT_TIMEOUT_MS` は **45s のまま**。

### 9.1 変更内容（4 ファイル・+186 / −16 行）

| ファイル | 変更 |
|---|---|
| `src/ai/types.ts` | `createCollector(onPush?)`：ツールが成果を記録するたびに**その時点の全副産物のスナップショット**を通知（引数省略で従来どおり＝後方互換） |
| `src/ai/assemble.ts` | `ChatOutcome`（`ok`/`aborted`/`failed`）と **`textOrFallback()`**（純関数）を追加。本文が空のとき、パネルの有無 × 終わり方で文言を出し分ける。`assemble()` 自体は無改変 |
| `src/app/api/chat/route.ts` | ①ツール成功のたびに **`data-map` を先出し**（固定 id `map` で上書き・最後の完全版が権威）／②終了時に `textOrFallback` で**必ず本文を付ける**／③終わり方の判定を **`AbortSignal.aborted` と `onError` の捕捉数**から決定 |
| `tests/ai-assemble.test.ts` | **+10 ケース**（`textOrFallback` の全分岐・空白のみ・既定引数・Zod 通過／`createCollector` の通知内容・スナップショット性・部分成果からのパネル組立・後方互換） |

- **無改変**：`src/domain`・`src/shared/*`・既存 API（chat 以外）・`src/db`・`src/components`・`pipeline`・`supabase`。
- クライアントは変更なしで動作（`ChatMessage` が**最後の data-map を採用**する既存実装のため）。

### 9.2 品質ゲート

`pnpm typecheck` ✅ ／ `pnpm lint` ✅ ／ `pnpm test` ✅ **162 passed**（152 → **+10**）／ `pnpm build` ✅ ／ 変更ファイルは Prettier 準拠。

### 9.3 fail-soft の実測（本番ビルド・4 パターン）

`CHAT_TIMEOUT_MS` を一時的に縮めて **強制 abort** を、`GEMINI_API_KEY` を無効値にして **エラー**を再現（いずれも検証後に元へ戻し済み。差分ゼロを `git diff` で確認）。

| 状況 | 修正前 | 修正後（実測） |
|---|---|---|
| 正常終了 | 本文＋パネル | 変わらず（本文＋パネル 3・4.4s） |
| **abort・ツール成功済み** | `panels=0 messages=0`（**無言**） | **`panels=3 messages=1`**／本文「地図とグラフを表示しました（説明の生成は時間内に終わりませんでした）。」 |
| **abort・ツール未到達** | `panels=0 messages=0` | `panels=0 messages=1`／本文「時間内に取得できませんでした。もう一度お試しください。」 |
| **エラー（429・鍵不正 等）** | `panels=0 messages=0`＋エラー表示のみ | `panels=0 messages=1`／本文「うまく取得できませんでした。時間をおいて再度お試しください。」（従来のエラー表示も維持） |
| ステップ枯渇（`ok` で本文なし） | `panels=0 messages=0` | 本文「うまく取得できませんでした。指標や地域を変えて、もう一度お試しください。」（単体テストで担保） |

### 9.4 部分成果の到達タイミング（SSE 実測）

散布の要求で、**パネルはツール完了と同時**に届き、最終版（本文つき）はその **1.0 秒後**だった：

```
t=10.37s  data-map [panels=1 messages=0 id=map]   ← 部分成果（compareGrowth 完了と同時）
t=10.37s  tool-output-available → pointCount=296 …
t=11.35s  text-start … text-end
t=11.39s  data-map [panels=1 messages=1 id=map]   ← 最終版（本文つき）
```

強制 abort 版でも同じ順序を確認：

```
t= 4.02s  data-map [panels=3 messages=0 id=map]   ← 部分成果（getStationDetail 完了と同時）
t= 4.09s  abort                                    ← タイムアウト
t= 4.09s  data-map [panels=3 messages=1 id=map]   ← 補足文つきの最終版
```

→ **本文生成が中断・失敗しても、成功済みのツールぶんの図は必ず残る。**

### 9.5 ヘッドレス（Playwright・実 Gemini）

「東京駅の人口推移を見せて」→ **インラインカード 1 個・チャット内 canvas 1 個・console error 0**。data-map を 2 回送っても**カードは重複しない**（`ChatMessage` が最後の data-map を採用するため）。スクリーンショットで表示崩れなしを目視確認。

### 9.6 検証中に判明した設計上の注意（本 PR で反映済み）

**abort 時に `result.text` は reject せず空文字で解決する**ことが実測で判明した（当初の実装は reject を前提に終わり方を判定していたため、タイムアウトなのに「指標や地域を変えて…」という誤った文言が出ていた）。→ **`AbortSignal.aborted` を直接見る**方式に変更し、エラーは `toUIMessageStream({ onError })` の捕捉数で判定するようにした。実測で 3 分岐すべての文言を確認済み（§9.3）。

---

## 10. 実装結果 — フェーズ 2＋3（往復削減・タイムアウト設計・2026-07-29・ブランチ `feat/chat-metric-resolver`）

### 10.1 変更内容（8 ファイル）

| ファイル | 変更 |
|---|---|
| `src/ai/metric-resolver.ts`（新規） | **キー解決器**（純関数・カタログのみ参照）。①完全一致キーはそのまま、②ファミリ名・表記ゆれ（半径 `2000m`/`2km`/`2`・年ペアの順序違い）・年ペア省略を正規化、③既定（半径 1km／終点最新年・スパン 5 年／最新の推計時点）で確定し **`note` で必ず可視化**、④ファミリ不明・ランキング不可・存在しない年の明示・絞り切れない場合は**確定させずエラー＋候補**。`suggestMetricKeys` もここへ移設（依存の向きを一方向に） |
| `src/ai/tools.ts` | `rankStations` に `radiusM` / `year` / `yearBase`、`compareGrowth` に `radiusM` を追加。`metric`・`x`・`y` は**キーでもファミリ名でも可**。返却に `resolvedMetric(s)` と `note` を追加（LLM が本文で条件を説明できる） |
| `src/ai/catalog-digest.ts` | `getMetricsCatalog` の baseMetric 応答を**畳み込み**（変種の全列挙 → 半径一覧 × 年一覧 ＋ 既定キー ＋ 使い方）。system prompt の例キーも**解決器の既定キー**に統一 |
| `src/ai/system-prompt.ts` | 「指標はファミリ名＋半径でよい」「キーを組み立てない」「getMetricsCatalog は原則不要」「note を返したら条件を一言添える」を明示 |
| `src/ai/client.ts` | **初回チャンク期限つき fetch**（15s）をプロバイダに注入＋**1 回だけ即再試行**（ボディが文字列のときのみ）。遅い初回応答（≥8s）を 1 行ログ。`CHAT_TIMEOUT_MS` 45s → **50s** |
| `src/app/api/chat/route.ts` | ターンの 1 行サマリログ（終わり方・所要 ms・効果数・パネル数・本文有無。発話内容は出さない） |
| `tests/ai-metric-resolver.test.ts`（新規） | **+28 ケース**（完全一致・ファミリ既定・各ファミリの既定キー実在・表記ゆれ 6 種・半径の丸め・半径非依存・エラー 4 種・不変条件・決定性） |
| `tests/ai-support.test.ts` | ダイジェスト畳み込みに合わせて更新（+3：返却サイズ < 1KB・vintage・半径非依存） |
| `tests/eslint-boundary.test.ts` | ESLint 起動が重いテストにタイムアウト 30s を明示（テスト増でスイート並列時に既定 5s を超えて落ちるようになったため。**プロダクトコードの問題ではない**） |

`src/domain`・`src/shared/*`・既存 API（chat 以外）・`src/db`・`src/components`・`pipeline`・`supabase` は**無改変**。

### 10.2 品質ゲート

`pnpm typecheck` ✅ ／ `pnpm lint` ✅ ／ `pnpm test` ✅ **193 passed**（162 → **+31**）／ `pnpm build` ✅ ／ Prettier 準拠。

### 10.3 効果（同一プロンプト・45s 間隔の 5 試行・本番ビルド）

プロンプト：「千葉県で人口増減率（2km圏）と乗降客のコロナ前後増減率の散布図を見せて」

| 指標 | フェーズ 1 まで（§2.2） | **フェーズ 2＋3** | 目標（§7） |
|---|---|---|---|
| 所要（5 試行） | 42.9 / 6.1 / 6.3 / 13.9 / 34.0s | **3.7 / 2.7 / 2.2 / 2.6 / 2.5s** | p50 < 6s・p95 < 20s |
| p50 / 最大 | 13.9s / 42.9s | **2.6s / 3.7s** | ✅ |
| ステップ数 | 6, 6, 6, 5, 5（上限 6 に張り付き） | **2, 2, 2, 2, 2** | ≤3 ✅ |
| `getMetricsCatalog` 回数 | 6, 5, 6, 5, 4 | **0, 0, 0, 0, 0** | ≤1 ✅ |
| 1 イベント間の最大無応答 | 29.9 / 1.1 / 1.0 / 7.1 / 10.8s | **1.4 / 1.1 / 1.0 / 0.9 / 1.0s** | — |
| パネル 0 で終了 | 1 件 | **0 件** | 0 ✅ |

LLM 呼び出しは実質 **7〜8 回 → 2 回**に減った。ツール入力も 1 発で決まっている：

```
tool-input-available(compareGrowth) {"x":"pop_gr","y":"rate_covid","radiusM":2000,"prefectures":["千葉県"]}
tool-output-available → resolvedMetrics {"x":"pop_gr_2020_2015_2km","y":"rate_covid"} / note "2015→2020年（既定）"
```

### 10.4 プロンプト別の確認（回帰なし）

| プロンプト | ツール列 | 結果 |
|---|---|---|
| 千葉県で地価が上がった駅トップ10 | `rankStations{metric:"lp_gr", radiusM:1000, prefectures:["千葉県"]}` | 2 ステップ・rankingTable。本文が **note を受けて「2021年から2026年にかけて」**と条件を明示 |
| 東京駅の人口推移を見せて | `searchStations` → `getStationDetail` | 3 ステップ・stationCard/trendChart/statTable（従来どおり） |
| 2010年から2020年で人口が増えた駅ランキング | `rankStations{metric:"pop_gr", radiusM:1000, year:2020, yearBase:2010}` | 2 ステップ・年ペア指定が端から端まで機能 |

### 10.5 eval（ゴールデン 22 問・`EVAL=1`）

**22/22 合格**（閾値 16・失敗 0）。本番ビルドに対し 45s スロットルで実行（所要 ~17 分）。

| 分野 | 問数 | 結果 |
|---|---|---|
| 駅詳細 | 6 | ✅ 6/6 |
| ランキング | 4 | ✅ 4/4 |
| 散布 | 2 | ✅ 2/2 |
| 2 駅比較 | 1 | ✅ 1/1 |
| 曖昧駅名 | 2 | ✅ 2/2 |
| カタログ照会 | 2 | ✅ 2/2 |
| データ外の拒否 | 3 | ✅ 3/3 |
| 地図文脈（P8e） | 2 | ✅ 2/2 |

ツール入力スキーマとシステムプロンプトを変えたにもかかわらず**回帰ゼロ**。カタログ照会 2 問も、ダイジェストを畳み込んだ状態で合格している。

### 10.6 フェーズ 3（初回チャンク期限つき fetch）の動作確認

`TIME_TO_FIRST_CHUNK_MS` を一時的に 200ms にして強制的に打ち切らせ、実挙動を確認した（検証後に 15s へ復帰・差分ゼロ）。

```
[ai] 初回応答が 200ms を超えたため 1 回だけ再試行します     ← 打ち切り＋再試行が 1 回だけ発火
[api/chat] failed 749ms effects=0 panels=0 text=false      ← 1 行サマリ（フェーズ3 の可観測性）
```

再試行も失敗したターンは**フェーズ 1 の fail-soft** で「うまく取得できませんでした…」を返し、ハングしない。通常運用（15s）では 5 試行すべてで打ち切りは発生していない（最大無応答 1.4s）。

### 10.7 設計判断の補足（§8-2 からの一点の変更）

決定事項では「**半径非依存の指標に半径を指定**」もエラーにする方針だったが、実装で**無視＋`note`** に変更した。理由は、`compareGrowth` の `radiusM` を **x/y 共通の 1 パラメータ**にしたため（LLM の入力を最小にする設計）、「人口増減率(2km) × 乗降客コロナ前後比」という**最も多い質問**で y（`rate_covid`＝半径非依存）が必ずエラーになってしまうこと。決定の趣旨である「**誤った指標を黙って出さない**」は保たれる（`rate_covid` は一意で、半径を無視しても別の指標にはならない）。他のエラー条件（ファミリ不明・ランキング不可・存在しない年の明示・絞り切れない）は決定どおり維持している。

---

## 11. 付録：コード参照と実測ログ

**コード参照**
- タイムアウト・ループ：`src/app/api/chat/route.ts:166-198`（`createUIMessageStream`／`stepCountIs(MAX_TOOL_STEPS)`／`AbortSignal.timeout(CHAT_TIMEOUT_MS)`／abort 時も `assemble` を送出）
- 定数：`src/ai/client.ts:24`（`MAX_TOOL_STEPS = 6`）・`:31`（`CHAT_TIMEOUT_MS = 45_000`）・`:21`（既定モデル `gemini-flash-lite-latest`）
- ツール：`src/ai/tools.ts:206-247`（`compareGrowth`＝LLM へは要約のみ返す＝設計は良好）・`:249-261`（`getMetricsCatalog`）
- 収集と組立：`src/ai/types.ts:44-52`（`createCollector`）・`src/ai/assemble.ts:110-120`（`assemble`＝**text が空なら messages も空**）
- プロンプト：`src/ai/system-prompt.ts:18-47`／ダイジェスト：`src/ai/catalog-digest.ts:125-152`・`:164-173`
- クライアント：`src/components/chat/ChatPanel.tsx:66-74`（`onData` で mapActions 適用）・`ChatMessage.tsx:25-29`（**最後の data-map を採用**）・`panelGroups.ts`（昇格パラメータはツール入力から復元）
- プロバイダ拡張点：`@ai-sdk/google` の `GoogleGenerativeAIProviderSettings.fetch`（カスタム fetch 可＝TTFT タイムアウトを実装できる）
- eval：`tests/chat-eval.test.ts:6-7`（実行方法）・`:22`（既定スロットル 45s）・`src/ai/eval/cases.ts`（22 問。期待値は**ツール名と部分入力**なので、入力スキーマ拡張と両立する）

**実測ログ（2026-07-28・本番ビルド `pnpm start` に対して計測。調査スクリプトはスクラッチパッドに置き、リポジトリには残していない）**
- 間隔 45s の 5 試行：42.9s / 6.1s / 6.3s / 13.9s / 34.0s、`getMetricsCatalog` 6/5/6/5/4 回、最大無応答 29.9s / 1.1s / 1.0s / 7.1s / 10.8s、**パネル 0 が 1 件**
- 連投 6 試行：9.8s / 5.0s / 5.6s / 4.1s / 3.1s / 2.3s、**パネル 0 が 3 件**（429 系 2・ステップ枯渇 1）
- abort 実測：45.2s / 45.3s / 45.5s / 45.8s（`main` ビルドでも発生＝既存事象）
- 自前処理：`/api/growth` 千葉県 0.59s（21.5KB）・全国 0.86–1.31s（543KB）、`compareGrowth` のツール実行 0.55s、`getMetricsCatalog` 0.00–0.01s
- カタログ返却量：`pop_gr` 54 変種 **7,354 bytes**（≈2,400 トークン）・`pop_pred` 114 変種・`lp_med` 100 変種
- 無効になりやすいキー：`pop_gr_2015_2020_2km`（年順逆）／`pop_gr_2km`（年なし）／`bus_gr_2000m`（半径表記）／`emp_gr_2016_2021_2km`／`rate_covid_2km`
