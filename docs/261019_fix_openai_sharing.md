# 利用者の ChatGPT プランで AI チャットを動かす — Sign in with ChatGPT（ChatGPT plan usage）の調査と、実装・ブラッシュアップ計画

作成：2026-10-19 ／ 対象：AI Database Map（Step2・アプリ内 AI チャット）／ **状態：調査と設計のみ（実装には進んでいない）**
関連：[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) §2（API こそがプロダクト）・
[`260828_research_claude_auth.md`](./260828_research_claude_auth.md)（Claude のサブスクの調査。§2.3 の「OpenAI の Sign in with ChatGPT は ID 連携のみ」は**本書で更新**）・
[`260912_gui_chat_protocol.md`](./260912_gui_chat_protocol.md)（MCP Apps の却下と GUI Chat Protocol）・
[`feat_llm.md`](./feat_llm.md)（チャットの仕組み・無料枠 §6.1）・
[`260926_chat_model_eval.md`](./260926_chat_model_eval.md)（モデルの決め方）・
[`261001_fix_user_feedback_ui.md`](./261001_fix_user_feedback_ui.md)（B1〜B5e の教訓）

> 調査は 2026-10-19 に一次情報を直接読んだ：developers.openai.com の **Markdown 原本**（`/siwc/llms-full.txt` ほか・要約ツールを通さない全文）、
> learn.chatgpt.com、OpenAI の DevKit リポジトリ（commit `0a36fef`・2026-10-07）、npm の `@ai-sdk/openai` 配布物のソース。
> **ChatGPT plan usage は 2026-09-29（DevDay）発表のプレビュー**で、3 週間で docs も手直しされている。
> 本書の事実は「2026-10-19 時点」として読み、実装前に §15 のリンクを読み直すこと。出典は（S1）のように §15 の番号で示す。

---

## 0. サマリ（結論先出し）

**問い**：Gemini の無料枠（プロジェクト全体で 15 回/分・500 回/日）では足りない。利用者の ChatGPT のサブスクで、
いまのアプリ内 AI チャットを動かし、あわせて磨きたい。助言は「ガイドのドキュメント・サンプル手順を document にして、
system prompt か user prompt に入れる、もしくは skill 化するとできる」。

**答え（4 点）**

1. **できる。ただし「本番の Web アプリで全員に」は、OpenAI の承認が先。**
   ChatGPT plan usage は、利用者が OAuth で許可すると、その人の Plus/Pro の枠で Responses API を呼べる仕組み（S1・S11）。
   いま誰でも使えるのは **オープンソースのアプリと、ローカルで動く個人のプロジェクト**まで。
   **当アプリのようにリモートでホストされたアプリは、waitlist（interest form）で承認を得てから提供する**——公式 docs と cookbook が明記している（S1・S14）。
2. **技術の壁は低い。** 当アプリのチャットは AI SDK v6 の `streamText` で動いている。v6 系の `@ai-sdk/openai@3.0.130`（npm の `ai-v6` タグ）は、
   プレビューの制約（`store:false`・`stream:true`・system ロール禁止・関数ツールの namespace 化）を**どれも設定で満たせる**ことをソースで確かめた（§3.2。
   実際に通るかは P1 の最初の 1 ターンで確かめる・§10.2）。
   **ドメイン・共通 API・ToolSpec・GUI Chat Protocol（`data-map`）は変えず、「頭脳」だけを差し替えられる**——CLAUDE.md §2 の設計がそのまま効く。
3. **推奨は 3 本立て。**
   ①**承認の要らないローカル版**で「ChatGPT プランで答えるチャット」を先に完成させる（本物の制約で検証でき、開発者の eval も GPT で回せる）。
   ②**並行して waitlist に申し込み**、承認後に本番（Vercel）へ広げる。
   ③**ChatGPT 本体から当アプリを使う道**（プラグイン＝既存のリモート MCP＋スキル）は承認なしで今日から届く——これも出す。
   **Gemini は消さない**（plan usage の対象は Plus/Pro だけ。Free/Go や ChatGPT を持たない人の入口は Gemini のまま）。
4. **ブラッシュアップの要は「ガイドの単一ソース化と、置き場所の振り分け」。** 助言を当アプリに当てはめると、
   「常に要る規範＝instructions」「その時の文脈＝developer メッセージ」「道具ごとの答え方＝道具の返り値（answerGuide）」
   「長い分析手順＝スキル（ChatGPT／Codex／Claude のプラグイン）」に分けて置くことになる。
   **最初の一歩は、いまの Gemini 向けプロンプトと 1 文字も違わない分解**（B4/B5 で「言い換えると別の問が崩れる」を何度も見たため）。

**段階（何がいつ使えるか）**

| 段 | 中身 | 誰が使えるか | 承認 | 状態 |
|---|---|---|---|---|
| **P0** | エンジン（頭脳）の抽象化・ガイドの分解（Gemini の挙動は不変） | — | 不要 | 未着手 |
| **P1** | **ローカル版**：ChatGPT プランのエンジン・ループバック OAuth・接続 UI・失敗の言い分け | 手元で動かす人（まず開発者） | 不要（OSS／ローカル） | 未着手 |
| **P2** | P1 で **GPT の eval**（62 問）→ 既定のモデルと磨き方を決める | 開発者 | 不要 | 未着手 |
| **P3** | **本番（Web）版**：登録済みクライアント・Web のリダイレクト・サーバ側の暗号化保存 | Plus/Pro の全利用者 | **要（waitlist）** | 申し込み待ち |
| **C** | ChatGPT／Codex のプラグイン（既存 MCP＋スキル） | ChatGPT・Codex の利用者 | 個人利用は不要・公開は審査 | 未着手（Codex 版は形だけ有り） |

**決めてほしいこと**は §13（推奨つき・9 項目）。**2026-10-19 に 3 つ決まった**：waitlist に申し込む（利用者が行う・やり方は §14）、LICENSE は MIT、開発者は ChatGPT Pro を持つ。

---

## 1. 背景と問い

### 1.1 いまの痛み

- 既定モデルは `gemini-3.5-flash-lite`（無料枠）。上限は**プロジェクト単位**で 15 RPM・250K TPM・500 RPD（`feat_llm.md` §6.1・2026-09-26 実値）。
  1 回の対話でモデルを 2〜3 回呼ぶので、**全利用者の合計で 1 日 150〜250 対話・1 分 5〜7 対話**が天井になる
- 混雑時は提供元の 503 や 15 秒を超える初回応答が起きる（`260926_chat_model_eval.md` §4.2）
- 無料枠の入力は、提供元のモデル改善に使われうる（`feat_llm.md` §6.2）

### 1.2 前回の結論と、何が変わったか

2026-08-28 の調査（`260828_research_claude_auth.md`）は、Claude について次の結論だった：

- Anthropic は第三者アプリがサブスクの資格情報を中継することを**明文で禁止**し、実際に遮断した
- だから向きを逆にした——**ユーザーの Claude（Claude Code／Claude.ai）が当アプリを呼ぶ**（リモート MCP＋プラグイン）
- そのとき OpenAI の Sign in with ChatGPT は「名前・メール・写真を渡す ID 連携で、推論の枠は渡らない」と書いた

**2026-09-29 の DevDay で、OpenAI はこの最後の点を変えた。** ID 連携に加えて、
**利用者の許可のもとで、その人の ChatGPT プランの枠で推論できる**能力（ChatGPT plan usage）を出した（S17）。
Anthropic とは逆の方針で、OpenCode（Anthropic の要請で Claude のサブスクログインを外したツール）も、OpenAI 側の公式連携先に並んでいる（S16）。
**Claude 側の結論（§2 の禁止と、MCP＋プラグインの向き）は変わらない。**

### 1.3 問いの分解

| | 問い | 本書の節 |
|---|---|---|
| Q1 | 何が許され、何に承認が要るか。利用者の条件は | §2 |
| Q2 | 当アプリのどこを変え、どこを変えずに済むか | §3・§5 |
| Q3 | どの道を、どの順で採るか | §4 |
| Q4 | 助言（ガイドを document／skill に）をどう取り込み、何を磨くか | §6・§7 |
| Q5 | 安全・規約・検証・段取り・決めること | §8〜§13 |

---

## 2. 調査結果：Sign in with ChatGPT と ChatGPT plan usage（一次情報）

### 2.1 何が発表されたか

| 日付 | 出来事 | 出典 |
|---|---|---|
| 2026-08 | Sign in with ChatGPT（**ID 連携**）がベータ（前回調査の時点。推論の枠は渡らなかった）。いまの ID 連携先は Airtable・GitLab・HubSpot・Notion・Supabase・Vercel など | 前回調査・S25 |
| **2026-09-29** | **DevDay**：Plus/Pro の利用者が、対応アプリで**自分の ChatGPT プランを AI リクエストに使える**ように。「Commercial sign-in is in a limited trial with selected partners. ChatGPT plan usage is available to open-source partners and selected private clients.」 | S17 |
| 同日 | 同時発表：Plugin Extensions（サイドバー・会話の横のパネル・フォーム）・MCP Events・GPT-6.1 Sol | S17 |
| 2026-10-07 | DevKit（`@siwc/local`・`@siwc/react`・見本アプリ Paste Perfect）の最新コミット | S15 |

**plan usage の連携先**（S16・2026-10-19 時点）：Amp Code・Conductor・Dactyl・Devin・Hermes Agent・Hyperagent・Kilo Code・Lovable（準備中）・
Notion・Vercel・Vorflux・Warp。**オープンソース**：OpenClaw・OpenCode・Pi・T3。**ID 連携のみ**：Airtable・Canva・GitLab・HubSpot・Supabase。

> 注：Vercel の連携は「Vercel／v0 へのサインイン」と「v0 の中での生成」に ChatGPT プランを使えるもので、
> **v0 で作ったアプリの API 呼び出しがサブスクで払われるわけではない**（Vercel の告知・S28）。Vercel にデプロイしただけで使える近道は無い。

### 2.2 2 つの能力と、誰が使えるか

Sign in with ChatGPT は **ID（サインイン）** と **plan usage（推論の枠）** を別々の許可として持つ（S11・S16）。
plan usage は会話・記憶・API キーへのアクセスを**与えない**（S1・S11・S16）。

| 使い方 | 提供の状態 | 当アプリにとって |
|---|---|---|
| Web サイトに ID サインインを付ける | 選ばれた商用パートナーの限定トライアル（waitlist） | 今は不要（アカウントの仕組みが無い） |
| ChatGPT プラグインの接続で ID サインイン | 同上 | 不要（当アプリの MCP は認証なし） |
| **OSS／ローカルのアプリで plan usage** | **全ての OSS が使える**。動的登録（`dynamic_agent_client`）でクライアントの秘密も API キーも要らない | **P1 のローカル版**はここ |
| **有料、またはリモートでホストするアプリで plan usage** | **interest form（waitlist）→「selected private clients」** | **P3 の本番版**はここ |

公式の言い回し（逐語）：

- 「These docs explain ChatGPT plan usage for open-source and locally hosted apps. **If you're interested in offering it in a paid or remotely hosted app, complete the interest form.**」（S1）
- 「At launch, ChatGPT plan usage is available to open-source projects, **personal projects that run locally**, and selected private apps.」（S14）
- 「If you're building a paid or remotely hosted app, join the waitlist to request access **before offering it to users**.」（S14）

**利用者の条件**：**Plus と Pro**（S11・S16）。Free と Go は対象外（第三者の記事に「Go も」とあるが、公式は Plus/Pro のみ）。
利用者・ワークスペース・ポリシーの都合で使えないときは `subscription_sharing_user_not_eligible`（403）が返りうる（S6）。

### 2.3 仕組み：OSS／ローカル版のフロー（S1・S2・S3・S7）

**用語**

- **クライアント**：利用者が許可する OAuth の登録。初回に OpenAI が `oaiapp_…` の `client_id` を発行し、**その利用者とワークスペースに結び付く**
- **エージェント・ホスト**：アプリが動く場所（ノート PC・自前の VM）。ホストごとに **`ext_agent_host_id`** を 1 つ作って保存し、毎回送る。
  形式は `urn:ietf:params:oauth:jwk-thumbprint:…`（推奨・RFC 9278）・`urn:uuid:…`・`did:key:…`。**メールや利用者 ID のような識別できる値は使わない**。
  公開鍵由来でも、OpenAI は今のところ秘密鍵の所持を検証しない（識別子でしかない）

**初回のサインイン（ループバック）**

```
アプリ                                  ブラウザ                         OpenAI（auth.openai.com）
 │ host ID を用意（保存済みなら再利用）
 │ 127.0.0.1 で待ち受けを開始
 │ state・nonce・PKCE（S256）を毎回新しく
 │── 認可 URL を開く ─────────────────────▶│── GET /api/accounts/authorize ─▶│
 │   client_id=dynamic_agent_client        │                                │ サインイン・ワークスペース選択
 │   agent_name_hint=<アプリ名>（初回だけ）  │                                │ 「Use your ChatGPT plan」に同意
 │   ext_agent_host_id=<host ID>            │◀── 302 ──────────────────────│
 │   redirect_uri=http://127.0.0.1:<port>/auth/callback
 │   scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct
 │   resource=https://api.openai.com/v1
 │◀── /auth/callback?code&state&client_id=oaiapp_…&scope=… ─┘
 │ state を照合 → 発行された client_id を先に保存
 │── POST /api/accounts/oauth/token（form・client_id・code・code_verifier・redirect_uri・resource。秘密なし）──▶
 │◀── access_token（1 時間）・refresh_token（30 日・使うたびに更新）・id_token・scope・earliest_refresh_at
 │ ID トークンを JWKS で検証（iss=https://auth.openai.com・aud=発行 client_id・exp・nonce）
 │ 付与された scope に chatgpt.tokens.use.direct があるか確認（無ければ推論しない）
 │ 資格情報を保存（ローカルなら 0600・原子的に書く）
```

守るべき細部（どれも docs の明文）：

- リダイレクトは **`http://127.0.0.1:<port>/auth/callback`**。**`localhost` で代用しない**。2 回目以降に変えてよいのは**ポートだけ**（パスは `/auth/callback` 固定）（S2）
- 新規登録の callback に `client_id` が無ければ登録未完了。再認証で**別の** `client_id` が返ったら拒否する（S2）
- `dynamic_agent_client` は入口であって、**保存も交換にも使わない**（S2）
- 再認証は保存した `client_id`＋同じ host ID＋`id_token_hint`（保存した ID トークン）・`login_hint`。`agent_name_hint` は付けない（S3）
- 更新（refresh）は `grant_type=refresh_token`・発行 client_id・`resource`、`scope` は省く。**同じセッションの更新は直列化**（回転するトークンを 2 つのプロセスが取り合わない）（S3）
- サインアウトは discovery の `revocation_endpoint`（2026-10-19 の実測で `https://auth.openai.com/api/accounts/oauth/revoke`）で refresh token を失効
  → ローカルのトークンを消す。client_id と host ID は残す（S3）
- 利用者が ChatGPT の設定で切断しても、**アプリには通知が来ない**。リクエストか更新の失敗で気づく（S6）

### 2.4 推論の契約：Responses API の制約（S4・S5）

- 送り先は **`POST https://api.openai.com/v1/responses`** だけ。**ChatGPT の `backend-api` は使わない**（明記）。ヘッダは `Authorization: Bearer <access_token>`
- **毎回 `store: false` と `stream: true`**。`input` は**配列**で、その回に要る履歴をすべて入れる（`previous_response_id` は使えない＝ステートレス）
- 指示は **`instructions` か developer メッセージ**。`{type:"message", role:"system"}` は**拒否される**
- **送ってはいけない項目**：`background`・`conversation`・`max_output_tokens`・`max_tool_calls`・`metadata`・`moderation`・`multi_agent`・`prompt`・
  `prompt_cache_retention`・`safety_identifier`・`temperature`・`top_logprobs`・`top_p`・`truncation`・`user`
- **道具**：関数（custom も）は **namespace にまとめるか、`additional_tools` 入力項目で渡す**。Web 検索はモデルとポリシー次第で可
- **使えない道具**：画像生成・file search・Code Interpreter・computer use・**ホスト型 MCP／コネクタ**・`tool_search`・`programmatic_tool_calling`
- 入力はテキスト・画像・ファイル（モデル次第）。音声・動画・Files API は不可
- **成功は `response.completed` を受け取ったときだけ**。`response.failed`・`response.incomplete`・途中切断は別に扱う。
  枠切れは**ストリームが始まった後に** `response.failed` で来ることがある（S4）
- **モデルの一覧**：同じトークンで `GET https://api.openai.com/v1/models` → `models[]` のうち `visibility: "list"` を表示順のまま使う。
  画面には `display_name`、リクエストには `slug`。アカウントを替えたら取り直す（S4）。docs の例は `gpt-6.1-sol`

### 2.5 失敗と回復（S6）

OpenAI は**別の課金経路へ黙って切り替えない**。HTTP 状態・本文の形・`error.code`・request ID を保つこと。

| いつ | 返り値 | 意味 | すること |
|---|---|---|---|
| ストリーム前 | 401（本文は `{"detail": …}` のことがある） | 署名済みの許可が通らない | 選んだアカウントと scope を確かめる |
| ストリーム前 | 403 | 提供地域などのポリシー | 制限を伝える |
| ストリーム前 | 503 | 直通の経路が使えない | 資格情報を保ち、上限つきの待ち直し |
| 応答 | `subscription_sharing_user_not_eligible`（403） | その利用者・ワークスペースでは使えない | 説明する。**同じリクエストや OAuth を繰り返さない** |
| 応答 | **`subscription_sharing_usage_limit_exceeded`（429）** | プランか**アプリ別の上限**に達した | 新しいリクエストを止め、**ChatGPT の設定 → Usage** へ案内。「プラン全体が空」「いつ戻る」と推測しない |
| 応答 | `subscription_sharing_usage_unavailable`（503） | 使用量を確かめられない | 資格情報を保ち、後で再試行 |
| 応答 | `subscription_sharing_unsupported_capability`（400） | 送った項目・道具・モデル等が非対応 | `error.param` を見て直す。**同じ本文で再試行しない**（＝こちらのバグ） |
| 応答 | `subscription_sharing_route_not_supported`（403） | エンドポイント違い | `POST /v1/responses` か確かめる |
| 応答 | `subscription_sharing_invalid_user`（401） | 加入者の文脈を確かめられない | request ID を残し、失効確認後に再サインイン |
| 応答 | `chatpass_v2_scope_not_authorized` ほか（403） | 許可の文脈が操作を認めない | クライアントと付与の設定を確かめる |
| 更新 | `invalid_grant`・`refresh_token_reused` など | refresh token が使えない | トークンを消し、保存した client_id で OAuth をやり直す |

同意を断られた（`error=access_denied`）・scope に `chatgpt.tokens.use.direct` が無いときは、**サインインは保ったまま plan usage を無効**にし、
「プランを使う」か「別の支払い経路」を選ばせる。設定から再び有効にするときは、保存した client_id と**全 scope**で OAuth をやり直す（S6）。

### 2.6 見せ方の決まり（UI/UX ガイドライン・S10）

| 場面 | 決まり |
|---|---|
| サインインの入口 | ラベルは **「Continue with ChatGPT」**・承認済みの OpenAI ブランドを使う・他のサインイン手段と同等の目立ち方 |
| 初回だけ | 「**You're using your ChatGPT plan**」のモーダル（ChatGPT の設定で使用量を管理できる旨）＋「**Got it**」。2 回目以降は出さない |
| 設定 | 「ChatGPT プランを使う」をオンボーディングか課金の場で出し、設定にも残す。アプリ自身の課金と区別する |
| 使用中の表示 | 入力欄かモデル選択の近くに「**Using ChatGPT plan**」＋「**Manage usage**」（`https://chatgpt.com/settings/usage`） |
| 上限に達した | **「Manage usage」を主ボタン**にする。アプリ独自のクレジットがあれば副ボタン。モーダルでも小さなカードでも、ChatGPT と分かる見た目で |
| 既存の利用者 | 別の方法でサインイン済みの人に「ChatGPT プランを使えます」のバナー |
| 有料プランがあるアプリ | どのプランで使えるかを料金表に明記（当アプリは無料なので該当しない） |

> 日本語の UI でラベルを訳してよいかは、ガイドラインにもブランド資産にも書かれていない（DevKit のボタンも英語のみ）。
> **ボタンと表示は英語の承認ラベル、説明文は日本語**、を初期案とする（要確認・§13）。

### 2.7 利用者側の枠（S3・S16・S18）

- plan usage は「**Codex／ChatGPT Work の利用枠**」から引かれる。**新しい枠が増えるわけではない**（S16）
- **Plus は 5 時間枠を全アプリで共有**（どのアプリにも別枠は無い）。**Pro は 5 時間枠なし**。週の上限もありうる（S3・S18）
- 利用者は ChatGPT の **Settings → Usage → App limits** で、アプリごとに週の上限（全体の 10〜100%）を設定できる。**上限は上限であって、取り置きではない**（S16）
- 切断は **Settings → Security and login → Sign in with ChatGPT** から（S16）
- **モデルごとの重さ**（Standard の速さ・100 万トークンあたりのクレジット・S18）：

| モデル | 入力 | キャッシュ済み入力 | 出力 | Plus の 5 時間あたりの目安（ローカルメッセージ数） |
|---|---|---|---|---|
| GPT-6 Astra | 250 | 25 | 1,250 | 5〜45 |
| GPT-6.1 Sol | 50 | 2.5 | 250 | 15〜160 |
| GPT-6 Sol | 50 | 5 | 250 | 15〜150 |
| **GPT-6 Luna** | **2.5** | **0.25** | **12.5** | **350〜3,000** |

→ 当アプリの 1 対話（モデル 2〜3 回・1 回 7〜8K トークン）は小さいが、**モデル選びで利用者の枠の減り方が 20 倍違う**。
**既定の候補は GPT-6 Luna**（一覧にあれば・§5.6）。キャッシュ済み入力は 10 分の 1 なので、**プロンプトの先頭を毎回同じにする**ことが利用者の枠を守る。
Plus の料金表には「GPT-6.1 Sol and GPT-6 Luna」とある（S18）が、**実際に使えるモデルは `/v1/models` が正**。
モデルは入れ替わる（GPT-5.5 は 2026-10-14 に ChatGPT サインインの Codex から退役・S18）——**slug を決め打ちしない**。

### 2.8 DevKit とライセンス（S15）

- 中身：`@siwc/local`（OAuth・資格情報の保存・アカウントの切り替え・モデル一覧・**テキストだけの**ストリーミング）、
  `@siwc/react`（Continue ボタン・接続カード・使用中の表示・Manage usage・回復の表示）、見本アプリ Paste Perfect（Electron＋macOS）
- `@siwc/local` は資格情報の保存に **OS の暗号化（Keychain など）を必須**にしている（平文の逃げ道なし）。DNS 名ではなく `127.0.0.1` の Host を厳密に照合し、
  callback ページは CSP・`no-referrer`・`history.replaceState` で URL のコードを消す
- **ライセンスは「Sign-in with ChatGPT DevKit Noncommercial License v1.0」**：
  非営利目的に限る（「operation of a product or service by or for a business, employer, or client in connection with its operations or commercial advantage,
  whether or not a fee is currently charged」は非営利に含まれない）、改変物を配るなら同じライセンスで、商用は OpenAI との別契約。
  パッケージは `private: true` で **npm に公開されていない**（`@siwc/local`・`@siwc/react` とも 404）
- **当アプリは DevKit を取り込まない。** 想定利用者（鉄道会社・出店・住宅購入）には業務利用が含まれ、改変物の配布条件も合わない。
  **公開仕様（S1〜S7）から独立に実装し、DevKit は読み物として参照するにとどめる**。ブランド資産（ロゴ・ボタン）は OpenAI のブランドガイドラインに従う

### 2.9 よくある落とし穴（公開の実装例から）

公開リポジトリの issue（S28：FastAPI＋PostgreSQL で plan usage を使おうとした例）・識者の分析（S28：OIDC の観点）から、実際に踏まれている穴：

| 落とし穴 | 正しい形 |
|---|---|
| Codex CLI の旧エンドポイント（`/oauth/authorize`・`/oauth/token`）を使う | discovery の `…/api/accounts/authorize`・`…/api/accounts/oauth/token` |
| 事前登録の client_id を前提にする／発行 client_id を受け取らない | `dynamic_agent_client` で始め、callback の `client_id` を保存して使う |
| `localhost:8000/…` を redirect に使う | `http://127.0.0.1:<port>/auth/callback` |
| nonce を送らない・ID トークンを検証しない | 毎回 nonce・JWKS で署名と iss/aud/exp/nonce を検証 |
| `input` を文字列で送る | 配列 |
| `profile email` を省く | identity と plan usage の scope を両方 |
| token リクエストに `ext_agent_host_id` を付ける | host ID は**認可リクエスト**に付ける |
| discovery の `scopes_supported` に plan usage の scope が無いので「対応していない」と判断する | docs が正（discovery だけでは発見できない・S28。2026-10-19 の実測でも `openid profile email offline_access` の 4 つだけ） |
| 期限切れになってから更新・更新の競合 | 期限の手前で、直列化して更新 |

### 2.10 もう 1 つの道：ChatGPT 本体から当アプリを使う（プラグイン・S23〜S25）

これは「当アプリが ChatGPT を呼ぶ」のではなく、**「利用者の ChatGPT が当アプリを呼ぶ」**向き（前回の Claude と同じ向き）。推論は ChatGPT 側で、利用者のプランから引かれる。

- **プラグイン ＝ スキル（`SKILL.md`）＋ MCP サーバ ＋（任意で）UI**。ChatGPT と Codex で**同じ 1 つのディレクトリ**を共有する（S23・S25）
- **個人で試す**：ChatGPT の Plugins → **Add custom MCP server** → URL を入れ、Authentication は **No authentication** を選べる → **Create as a plugin**。
  インストールして会話で `@` から呼ぶ（S24）。どのプランで使えるかは公式ページで確認できなかった（help.openai.com は取得不可）。
  第三者の記事は「Free は不可、Plus/Pro と Business 以上は可」としている（S28・要確認）
- **公開する**：提出ポータル（`platform.openai.com/plugins`）。個人の本人確認・プライバシーポリシーの URL・テストの質問と応答・
  ドメイン確認（`/.well-known/openai-apps-challenge`）が要る。公開後のツール更新は継続審査（S23）
- **Claude Code プラグインからの移し方**が公式にある（S23）：commands／agents はスキルに、hooks は外す、`userConfig` は使えない、
  スキル中の「Claude」は「the model」のような中立の言い方に。マーケットプレイスの承認は引き継がれない
- MCP サーバの **`instructions`**（サーバ全体の使い方）は**最初の 512 文字で完結**させる（S24）。当アプリの `/api/mcp` は今 `instructions` を持っていない
- UI は MCP Apps 標準＋OpenAI の拡張（`window.openai`）。**Plugin Extensions** で「会話の横のパネル」「サイドバー」も出せる（Free/Go の Web は準備中・S23）

### 2.11 確度と、まだ分からないこと

| 項目 | 状態 | どう確かめるか |
|---|---|---|
| interest form の設問 | **判明**（2026-10-19 にヘッドレスのブラウザで画面を読んだ。送信はしていない・§14） | — |
| 審査の基準・期間 | **不明** | 申し込み後の連絡で |
| リモート版の OAuth の形（Web のリダイレクト・秘密つきクライアント？） | **公開 docs なし**（ID 連携の Web 版はある・S12） | 承認時の案内で確定 |
| 関数ツールを namespace に入れないと拒否されるか | 文面は「namespace か `additional_tools`」 | P1 のスパイク |
| `text.verbosity`・`reasoning`・`include`・`prompt_cache_options` が通るか | 禁止の一覧に無い＝通る見込み | P1 のスパイク |
| 実際に一覧に出るモデル（Luna の有無） | アカウント次第 | P1 のスパイク |
| 日本語のラベルの可否 | 記載なし | ブランドガイドライン・承認時に確認 |
| ChatGPT のカスタム MCP が使えるプラン | 第三者情報のみ | 実機で確認 |

---

## 3. 当アプリへの当てはめ

### 3.1 いまのチャット（コードの事実）

```
画面（useChat・DefaultChatTransport '/api/chat'・body に selectedGrp / radiusM / bbox）
  ↓ POST /api/chat（src/app/api/chat/route.ts）
  ガード：IP レート制限（chat: 鍵）→ 鍵の確認（GEMINI_API_KEY）→ 入力検証（最新 500 字・履歴計 4,000 字・50 通）
  文脈：選択中の駅（mapContextPrompt）・地図の表示範囲（mapViewPrompt）を system に連結
  streamText（Gemini・tools＝createTools の 12 本・stepCountIs(6)・maxRetries 1・50 秒で打ち切り・温度は送らない）
    └ 道具＝ToolSpec（tool-specs.ts・MCP と共有の単一の真実）→ domain → Supabase
  ループ後：副産物 → assemble → data-map（GUI Chat Protocol）＋ data-promotions（⤢ の条件）
  失敗：classifyChatFailure（HTTP 状態で種類を決める）→ shared/chat-errors.ts の 1 文
```

- モデルの生成は `src/ai/client.ts` の `chatModel()` 1 か所（Gemini 専用・初回応答 15 秒の打ち切り＋1 回の再試行つき fetch）
- システムプロンプト＋道具の定義で **1 回あたり約 7K トークン**（2026-09-26 実測・その後の B5 で増えている）
- eval：`tests/chat-eval.test.ts`＋`src/ai/eval/cases.ts` の **62 問**、合格線 60、問の間 45 秒（無料枠に合わせた間引き）

**変えるのは「頭脳」だけ**——`chatModel()` が返す `LanguageModel`、`streamText` に渡す設定、資格情報。
ドメイン・共通 API・ToolSpec・protocol・assemble・パネルは**触らない**。これは CLAUDE.md §2 の図（LLM と UI が同じ共通 API を対等に叩く）が、
LLM の差し替えに対して持つ価値そのものである。

### 3.2 プレビューの制約を、AI SDK v6 で満たせるか（ソースで確認）

当リポジトリは `ai@6.0.223`。OpenAI 用は v6 系の **`@ai-sdk/openai@3.0.130`**（npm の `ai-v6` タグ。最新の 4.x は AI SDK v7 用なので**使わない**——v6 に固定している方針どおり）。
配布物のソースを読んで確かめた：

| 制約（§2.4） | `@ai-sdk/openai@3.0.130` の扱い | こちらがすること |
|---|---|---|
| `store: false` | `providerOptions.openai.store`。推論モデルで false のとき `include: ['reasoning.encrypted_content']` を**自動で**付け、手順の間で推論を受け渡す | `store: false` を渡す |
| `stream: true` | `streamText` は常にストリーム | そのまま |
| system ロールの拒否 | GPT-5 以降（GPT-6 系を含む）を推論モデルと判定し、system を **developer ロール**で送る | `systemMessageMode: 'developer'` も明示（未知の slug への保険・`forceReasoning`） |
| 禁止の項目 | `temperature`・`max_output_tokens`・`metadata`・`user`・`truncation` などは**設定したときだけ**送る | 設定しない（`CHAT_TEMPERATURE` は既に undefined）。**本文の契約テスト**で固定 |
| `previous_response_id` 禁止 | 設定したときだけ | 使わない（いまも履歴を毎回送るステートレス） |
| 関数は namespace に | **道具ごとの `providerOptions.openai.namespace: { name, description }` で namespace にまとめる**。呼び出しの `namespace` も履歴に戻す | OpenAI のときだけ付ける（Gemini 側は無視） |
| 道具ごとの設定が SDK を通るか | `ai@6.0.223` の `prepareToolsAndToolChoice` が `tool.providerOptions` をそのまま渡す（dist で確認） | — |
| ベース URL | **未指定だと環境変数 `OPENAI_BASE_URL` を読む** | **`baseURL: 'https://api.openai.com/v1'` を必ず明示**（利用者のトークンを別のホストへ送らない） |
| 枠切れの 429 | SDK の既定は 429 を再試行する | **`maxRetries: 0`**（DevKit も同じ判断）。503 だけ上限つきで待ち直す |
| `strict` | 道具に `strict` を付けなければ送らない → Responses 側が「できれば strict に正規化、無理なら非 strict」 | 既定のまま始め、§7 の #2 で strict 化を検討 |

**結論**：AI SDK を捨てて自前の Responses クライアントを書く必要は**ない**。`streamText`・`toUIMessageStream`・`data-map` の流れはそのまま使える。
残る不確実性（namespace の必須性・`response.incomplete` の扱い・Content-Type の無い SSE）は P1 のスパイクで確かめる（§10.2）。

### 3.3 当アプリならではの論点

| 論点 | 事実 | 含意 |
|---|---|---|
| 本番は Vercel（リモート） | plan usage の公開フローは 127.0.0.1 のループバック前提 | 本番は承認待ち（P3）。**承認前に Web で提供しない** |
| アカウントが無い | 今のチャットは匿名・IP 制限のみ | 本番版にはセッションと、利用者ごとの資格情報の保存が要る（P3） |
| **リポジトリは公開だが LICENSE が無い** | `gh repo view` で licenseInfo は null。一方プラグインの manifest は `"license": "MIT"` | 開発者が手元で使うだけなら「ローカルで動く個人のプロジェクト」に当たる（S14）。**第三者に配って「オープンソース」と名乗るには LICENSE が要る**。manifest とも食い違っている（§13-3） |
| ローカル版はデータが要る | サーバは `SUPABASE_URL`＋`SUPABASE_ANON_KEY`（.env.example に「ブラウザ公開可・RLS で読み取りに限定」） | 開発者は今の .env で動く。**第三者に配るなら anon キーの扱いを決める**（§13-4） |
| eval を GPT で回す | 62 問×2〜3 回 | 開発者は Pro（2026-10-19）で 5 時間枠が無い。Plus なら Luna は収まる見込みだが、Sol で全問は枠を圧迫しうる（§10.3） |
| Next.js の dev サーバは既定で全インターフェイスに bind | トークンを持つサーバが LAN から見える | ローカル版は `-H 127.0.0.1` で起動し、Host/Origin を照合（§8.2） |

---

## 4. 選択肢の比較

| | 道 | 規約・承認 | 利用者の負担 | 当アプリの負担 | 地図・パネル | 届く範囲 | 判定 |
|---|---|---|---|---|---|---|---|
| **A** | 本番 Web のチャットに plan usage | **要承認** | 「Continue with ChatGPT」1 回 | セッション・暗号化保存・OAuth（中〜大） | **今の UI そのまま** | Plus/Pro の全利用者 | **目標**（承認後） |
| **B** | ローカル版のチャットに plan usage | **今すぐ可**（OSS／ローカル） | clone・`.env`・起動 | OAuth（ループバック）・ファイル保存（中） | 今の UI そのまま | 手元で動かす人 | **先に作る**（A の部品の大半を兼ねる） |
| **C** | ChatGPT プラグイン（既存 MCP＋スキル） | 個人は不要・公開は審査 | URL 追加 1 回／ディレクトリから導入 | `instructions`・スキルの移植（小） | テキスト（UI は任意） | ChatGPT／Codex 利用者 | **並行して出す** |
| D | Codex プラグイン（既存 `.codex-plugin`） | 不要 | `codex plugin marketplace add` | 実導入の検証だけ | テキスト | Codex 利用者 | C と同時に検証 |
| E | 利用者が OpenAI の API キーを持ち込む | 可 | **従量課金・鍵の管理** | 鍵の預かり | 今の UI | 少数 | 不採用（前回も却下） |
| F | **開発者の ChatGPT プランで全員に答える** | **不可**（個人のプランの共有。5 時間枠でも破綻） | — | — | — | — | **やらない** |
| G | Codex CLI の OAuth クライアントや `backend-api` を流用 | **不可**（docs が明示的に禁止） | — | — | — | — | **やらない** |
| H | Gemini の有料枠 | 可 | なし | 月数百円規模〜（`feat_llm.md` §6.2） | 今の UI | 全員 | **保険**（承認が長引くときの容量対策） |
| I | 手元の常駐プロセス（ローカルの「頭脳」）を本番 Web から呼ぶ | **グレー**（トークンは手元だが、体験はホストされた Web） | 常駐プロセスの導入 | 大（ブラウザの Local Network Access の許可も要る） | 今の UI | 少数 | 見送り。**申し込み時に OpenAI へ聞く**候補 |

**採用：B → A（承認後）、C と D を並行。** H は記録しておき、承認が 1〜2 か月動かなければ再検討する。

- B を先にする理由は 3 つ：①**本物の制約**（system ロール拒否・禁止項目・namespace）で推論の部品を検証できるのは plan usage のトークンだけ（API キーではこの制約が出ない）、
  ②開発者の Plus/Pro で **GPT の eval を追加費用なしで**回せる、③UI（接続カード・使用中の表示・上限の案内）とエンジンの抽象は A でそのまま使う
- B の限界も明記する：**一般の利用者に届く形ではない**（clone と起動が要る）。A までの「つなぎ」であり、OSS としての配布物である
- C は承認と無関係に、**ChatGPT 本体の利用者へ今日届く**。当アプリ側の追加はほぼ文書と設定（`instructions`・スキルの移植）だけ

---

## 5. 推奨アーキテクチャ

### 5.1 全体図

```
 ┌──────────────── 当アプリの Web UI（Next.js・薄い層）────────────────┐
 │ チャット欄：エンジン［Gemini（無料）｜ChatGPT プラン］・「Using ChatGPT plan」・Manage usage │
 │ 設定：接続カード（アカウント・モデル・サインアウト）・初回のお知らせ・上限の案内                │
 └───────────┬────────────────────────────┬─────────────────────┘
             │ POST /api/chat { engine, … }  │ GET /api/chat/engines・/api/chatgpt/*
 ┌───────────▼────────────────────────────▼─────────────────────┐
 │ /api/chat（ガード → ツールループ → assemble → data-map：構造は不変）            │
 │   エンジンの解決（サーバが決める。資格情報はサーバだけが持つ）                   │
 │     ├ gemini        ：GEMINI_API_KEY（アプリ負担・既定・全員）                  │
 │     └ chatgpt-plan  ：利用者の OAuth トークン（利用者の枠・Plus/Pro）            │
 │   道具＝ToolSpec 12 本（不変。OpenAI のときだけ namespace で包む）               │
 └──────┬──────────────────────────────┬──────────────────────┘
        │ domain・共通 API（不変）        │ Responses API（store:false・stream:true）
 Supabase（PostGIS・RLS）          https://api.openai.com/v1
        資格情報の置き場：P1＝~/.config/ai-database-map（0600）／P3＝Supabase（暗号化・RLS）
        OAuth：P1＝127.0.0.1 のループバック／P3＝承認時に決まる Web のリダイレクト
```

### 5.2 エンジンの抽象（新設・P0）

いまの `client.ts`（Gemini 専用）を、**「どの頭脳で答えるか」を表す小さな型**の 1 実装にする。

```ts
// src/ai/engines/types.ts（案）
export const CHAT_ENGINE_IDS = ['gemini', 'chatgpt-plan'] as const
export type ChatEngineId = (typeof CHAT_ENGINE_IDS)[number]

/** 1 リクエスト分の頭脳（モデル・送る設定・道具の包み方・失敗の分類）。型の名前は AI SDK v6 の公開型に合わせて実装時に確定。 */
export type ChatEngine = {
  readonly id: ChatEngineId
  readonly model: LanguageModel
  readonly providerOptions: ProviderOptions        // OpenAI：store:false など
  readonly toolProviderOptions?: ProviderOptions   // OpenAI：namespace
  readonly maxRetries: number                      // OpenAI：0
  readonly modelLabel: string                      // ログと画面の名札（例「GPT-6 Luna」）
}
```

- `route.ts` は `chatModel()` の代わりに `resolveEngine(request, body)` を呼ぶだけ（**ガード・ループ・assemble は変えない**）
- `createTools(collector, origin, viewport, toolProviderOptions?)`：OpenAI のときだけ各 `tool()` に `providerOptions` を足す。
  **ToolSpec の説明・スキーマは 1 文字も変えない**（MCP・Gemini と共有のまま）
- 置き場所（案）：`src/ai/engines/{types,gemini,chatgpt-plan,resolve}.ts`、OpenAI 固有は `src/ai/chatgpt/`
  （`oauth.ts`＝認可 URL・callback 検証・トークン応答の検証、`id-token.ts`、`credentials.ts`＝保存の型とファイル実装、
  `session.ts`＝期限の手前の更新と直列化、`models.ts`、`errors.ts`＝§2.5 の表、`fetch.ts`＝URL 固定・`redirect:'error'`・初回応答の打ち切り）
- CLAUDE.md §3 に沿う：純関数は別ファイル（認可 URL の組み立て・callback の検証・エラーの分類はすべて副作用なし）、
  トークン応答は Zod で検証して `z.infer` で型、`as` を使わず型ガード、fetch は `AbortController` の期限つき、
  エラーには文脈を付けるが**トークンと URL のクエリは出さない**

### 5.3 共通 API（画面は薄く・意味はサーバ）

エンジンの一覧・状態・名前は**サーバが返し、画面は描くだけ**にする（CLAUDE.md §2。画面にラベルや状態の判断を持たせない）。

| エンドポイント | 返すもの | 備考 |
|---|---|---|
| `GET /api/chat/engines` | `[{ id, labelJa, status, models?: [{slug, displayName}], selected?, usageUrl? }]` | status＝`available`／`needs_sign_in`／`connected`／`sharing_disabled`／`reauth_required`／`limit_reached`。**本番では承認まで `gemini` だけ** |
| `POST /api/chatgpt/sign-in` | `{ authorizationUrl }` | サーバが state・nonce・PKCE を作り保持。ブラウザはそこへ移動する |
| `GET /auth/callback` | 302（アプリへ戻す） | **ループバックの仕様でパス固定**。P1 のみ |
| `POST /api/chatgpt/sign-out` | `{ revoked: boolean }` | 失効を確かめられなければ「ChatGPT の設定から切断を」と返す |
| `PUT /api/chatgpt/model` | `{ selected }` | 選んだ slug を保存 |
| `POST /api/chat` | 既存＋`engine` | 画面の希望をサーバが検証（トークンが無ければ Gemini にせず、`needs_sign_in` を返す） |

- これらは**画面とセッションの API** で、ドメインではない。MCP には出さない（AI が叩く理由が無い）
- Zod のスキーマと日本語のラベルは `src/shared/chat-engines.ts` に置き、サーバと画面で共有する（`shared/chat-errors.ts` と同じ流儀）

### 5.4 ローカル版（P1）の流れ

```
利用者（ブラウザ）              当アプリ（127.0.0.1 で起動した Next.js サーバ）              OpenAI
 [Continue with ChatGPT] ─POST /api/chatgpt/sign-in（Origin 照合）▶
                                 host ID：~/.config/ai-database-map/chatgpt-host.json（初回に urn:uuid を作る）
                                 待ち中の認可（state・nonce・verifier・戻り先）をメモリに 10 分・1 回限り
              ◀─ { authorizationUrl } ─
 ──────── 認可 URL へ移動（同じタブ）─────────────────────────────────────────▶ サインイン・同意
 ◀──────── 302 http://127.0.0.1:<port>/auth/callback?code&state&client_id&scope ─────
 ─GET /auth/callback▶  state 照合 → client_id を先に保存 → code 交換 → ID トークン検証 → scope 確認
                       → ~/.config/ai-database-map/chatgpt-credentials.json に原子的に 0600 で保存
              ◀─ 302 アプリへ（?chatgpt=connected）・初回のお知らせを出す
 [質問] ─POST /api/chat { engine:'chatgpt-plan' }▶ 期限の手前なら更新（直列化）→ Responses（store:false・stream:true）
```

- **有効にする条件**：環境変数で明示的に opt-in（例 `CHATGPT_PLAN_MODE=local`）。Vercel（`VERCEL` がある）では**常に無効**。起動は `pnpm dev -H 127.0.0.1`／`pnpm start -H 127.0.0.1`、
  開くのも `http://127.0.0.1:<port>`（戻り先と同じ名前にそろえる）
- `agent_name_hint` は「AI Database Map」で固定。ポートが変わっても登録は同じ（パスは `/auth/callback` 固定）
- callback の応答ページ：最小の HTML・厳しい CSP・`Referrer-Policy: no-referrer`・`Cache-Control: no-store`・`history.replaceState` でアドレス欄からコードを消す
- 保存の形は docs の例（S2 §5）に合わせる：`client_id`・検証済みの `sub`・`email`・`id_token`・`access_token`・`refresh_token`・`expires_at`・`scopes`・`saved_at`・`ext_agent_host_id`。
  **初期は 1 アカウント**、記録は client_id ごとに分けて複数アカウントに耐える形にしておく
- OS の鍵束（Keychain）での暗号化は後回し。docs は 0600 のファイルを認めている（S2）。DevKit の水準（OS 暗号化必須）へ上げるかは §13 で決めない（P1 の後で十分）

### 5.5 本番版（P3・承認後）との差分

承認の案内で形が確定するので、**今は差分の見取り図だけ**持つ（作り込まない）。

| | P1（ローカル） | P3（本番・想定） |
|---|---|---|
| クライアント | `dynamic_agent_client` → 発行 `oaiapp_…` | 登録済みの client（`oaiapp_…`・秘密つきの可能性） |
| 戻り先 | `http://127.0.0.1:<port>/auth/callback` | `https://ai-database-map.vercel.app/…/callback`（完全一致で登録） |
| 利用者の識別 | 1 人（ファイル） | **セッション Cookie**（`__Host-`・HttpOnly・Secure・SameSite=Lax）。サインインの取引はブラウザのセッションに結び付け、1 回限り・10 分 |
| 資格情報 | ファイル 0600 | **Supabase の表**（トークンはアプリの鍵で AES-256-GCM 暗号化・鍵は環境変数・**RLS 有効で anon の方針なし**・サービスロールはサーバだけ） |
| 更新の直列化 | プロセス内の排他 | 複数インスタンス → **行ロック**（`select … for update`）か版番号つきの更新 |
| 失効・削除 | サインアウトで失効 | 同左＋保持期間・プライバシーポリシーの更新 |
| レート制限 | 既存の IP 制限 | セッション単位も（Gemini の枠は使わないが、DB と上流は守る） |

### 5.6 推論の設定（初期値の案・P2 の eval で確定）

| 項目 | 初期値 | 理由 |
|---|---|---|
| モデル | `/v1/models` の一覧から。**既定の候補は GPT-6 Luna**（無ければ一覧の先頭）。画面で Sol 等を選べる | 利用者の枠（§2.7）。決め打ちしない（退役がある） |
| `reasoning.effort` | `low` | 短い答え・道具の選択が中心。Luna は `none` も可——eval で比べる |
| `text.verbosity` | `low` | 答えは 1〜3 文（今の規約） |
| `store` | `false` | 必須 |
| 温度・最大トークン | 送らない | 禁止 |
| 道具 | 12 本を namespace に入れる。まず 1 つ（`station_data`・短い説明）で始め、駅・指標の 8 本と災害の 4 本に分ける案と P2 で比べる | §2.4。OpenAI は「1 namespace は 10 本未満」を勧めている（遅延読み込みの文脈・S21） |
| 手順の上限 | 6（今と同じ） | eval で必要なら上げる |
| 再試行 | `maxRetries: 0`。503 だけ 1 回、待ってから | 429 は枠切れ＝待っても直らない／二重に枠を使わない |
| 打ち切り | 本番 50 秒（Vercel 60 秒の内側）。ローカルは環境変数で長くできる | 推論モデルの初回応答を P1 で実測して決める |

### 5.7 失敗の言い分け（`chat-errors` の拡張）

いまの 4 種（`rate_limited`・`unavailable`・`rejected`・`unknown`）は Gemini の言い方（「AI（Gemini）が一時的に…」「無料枠の上限の可能性」）を含む。
**エンジンごとに文を選ぶ**形にし、ChatGPT プランには種類を足す。

| 条件 | 種類（案） | 画面の 1 文（案） | 動線 |
|---|---|---|---|
| `subscription_sharing_usage_limit_exceeded` | `plan_limit` | ChatGPT プランの利用上限に達しました（プラン全体か、このアプリに設定した上限です）。 | **主：Manage usage**／副：Gemini（無料）で続ける |
| `subscription_sharing_usage_unavailable`・503 | `plan_unavailable` | ChatGPT プランの利用状況を確かめられませんでした。少し時間をおいて再度お試しください。 | 再試行 |
| `subscription_sharing_user_not_eligible` | `plan_not_eligible` | このアカウントでは ChatGPT プランを使えません（Plus／Pro が対象です）。 | Gemini で続ける |
| 401・`invalid_user`・更新の終端エラー | `plan_signin` | ChatGPT との接続が切れました。もう一度サインインしてください。 | Continue with ChatGPT |
| `unsupported_capability`・`route_not_supported` | `rejected` | 既存の「設定に問題」 | 記録（こちらのバグ） |

- **黙って Gemini に切り替えない。** OpenAI も黙って切り替えない（§2.5）。切り替えは利用者の 1 クリックで、回答には**どのエンジンが答えたか**の名札を付ける
- ログ（`[api/chat]` の 1 行）にエンジンとモデルの名札を足す。**トークン・認可 URL・発話は出さない**（既存の方針どおり）

### 5.8 画面（ガイドライン準拠・最小）

- **入力欄の上**：エンジンの切り替え（Gemini（無料）／ChatGPT プラン）。ChatGPT のときは「**Using ChatGPT plan**」と「**Manage usage**」
- **接続カード**（設定か About の中）：未接続なら「Continue with ChatGPT」、接続済みならアカウント（メール）・モデルの選択・サインアウト・Manage usage
- **初回だけ**のお知らせ（You're using your ChatGPT plan／Got it）。2 回目以降は出さない
- **上限の案内**：主ボタン Manage usage、副ボタン「Gemini（無料）で続ける」
- **本番（承認前）では一切出さない**（§13-6）。`/ai` の導入ページに「ChatGPT で使う」（C の道）を書くのは承認と無関係にできる

---

## 6. 助言の取り込み：ガイドを document にして、置き場所を振り分ける

### 6.1 助言の 2 つの読み方

> 「Guide のドキュメント、サンプル手順等々を document にして、system prompt かユーザプロンプトにいれる もしくは skill 化するとできると思います」

| 読み方 | 中身 | 本書での扱い |
|---|---|---|
| **(a) 作る側へ** | OpenAI のガイド（S1〜S10）と手順（cookbook）は新しく、モデルの知識に無い。**コーディングエージェントに document／skill として渡せば正しく実装できる** | §6.2：本書 §2 をその document にした。実装時はプロジェクトのスキルにして渡す |
| **(b) アプリの頭脳へ** | アプリ自身の「答え方のガイド・サンプル手順」を document にし、**モデルに system／user prompt か skill で渡す** | §6.3〜§6.7：置き場所の原則と、単一ソース化の設計 |

どちらも「知識をコードの外の文書にして、必要な所へ必要な形で渡す」という同じ考えで、両方やる。

### 6.2 (a) 作る側へ：実装用のスキル

- **本書 §2 は、その document として書いた**（逐語の要点・表・落とし穴）。実装のときは、`.claude/skills/` に**短いルーターの SKILL.md**
  （いつ使うか・守る不変条件・§2 と S1〜S10 の `.md` 原本への道しるべ・契約テストの一覧）を置いて渡す
- OpenAI の docs は `.md` を付ければ原本が取れる（`/siwc/llms-full.txt`・`/api/docs/llms.txt`）。**公開リポジトリに丸写ししない**（著作物）——リンクと自分の言葉の要約にする
- OpenAI は Codex 用に `openai-docs` スキルを公開しており、他のエージェントでも使える（S19）。使うなら読み物として
- §2.9 の落とし穴（Codex の旧エンドポイント・localhost・nonce 未検証…）は、**エージェントがやりがちな間違いそのもの**なので、スキルの「禁止事項」に入れる

### 6.3 (b) いま、答え方のガイドはどこに散っているか

| 置き場所 | 中身 | 誰が読む | 問題 |
|---|---|---|---|
| `src/ai/system-prompt.ts` | 役割・道具の使い分け・場所の絞り方・応答の形・おすすめの線引き・**災害の厳守規則**・地図の文脈 | アプリ内チャット（Gemini） | Gemini に合わせて 1 語ずつ調整済み（脆い）。人が読む document になっていない |
| 道具の説明（`tool-specs.ts`） | いつ使うか・引数の意味 | チャット・MCP | **全部の問いが全部の説明を見る**（B5d：説明に語を足すと無関係な問が崩れた） |
| 道具の返り値（`answerGuide`・`limitationsJa`・`disclaimerJa`） | その道具の答え方・限界 | チャット・MCP | 良い形（B4/B5 で効いた）。広げられる |
| プラグインのスキル 11 本（558 行） | 分析の型・用途別レシピ・災害の読み方・CSV 分析 | Claude Code・Codex | 災害の規範（安全と言わない・指示しない・限界を落とさない・時制）を `hazard-reading` と `system-prompt.ts` が**別々の文で二重に**持つ（片方だけ直す事故が起きうる） |
| MCP の `instructions` | **無い** | — | ChatGPT・Claude が最初に読む「サーバの使い方」が空 |

### 6.4 置き場所の原則

| 置き場所 | 向くもの | 向かないもの | 当アプリでの中身 |
|---|---|---|---|
| **instructions（system／developer・毎回同じ）** | 常に要る・人命や信頼に関わる・短い | 長い手順・その時だけの文脈 | 役割、応答の形（1〜3 文・見出しや表を使わない）、**幻覚しない**、**災害の厳守規則**、おすすめの線引き |
| **developer メッセージ（毎回変わる文脈）** | 画面の状態・選択中の駅・地図の範囲・利用者が選んだ深さ | 恒久の規則 | `mapContextPrompt`・`mapViewPrompt` の中身。OpenAI では **instructions の後ろに置き、先頭を毎回同じに保つ**（キャッシュ・§2.7）。Gemini は今の連結のまま（分解で挙動を変えない） |
| user メッセージ | **利用者の言葉だけ**（と、フォームの回答のような利用者由来の入力） | アプリの指示（権限が弱く、注入と区別できない） | 今どおり |
| **道具の返り値（answerGuide 等）** | その道具を使ったときだけ要る答え方 | 道具の選び方 | 災害の言い回し・プロフィールの答え方（既存）。**これがアプリ内の「スキル」の実体**——使ったときにだけ読まれる |
| **スキル（SKILL.md）** | 多段の分析手順・用途別レシピ・CSV の扱い | 毎回の安全規則（利用者の指示がスキルより優先されうる・S19） | プラグイン（ChatGPT／Codex／Claude）。アプリ内チャットでは読み込まない |
| サンプル手順（質問→道具→答えの例） | 評価・スキルの参考資料 | 常時のプロンプト（推論モデルでは例が逆効果になりうる・S20） | eval の 62 問が実体。スキルの `references/` に数例 |

二つの根拠を明記しておく：

- **災害の規則はスキルに逃がさない。** GPT-6 の手引きは「利用者の指示はスキルの指針より優先」という書き方を推している（S19）。
  「安全と言って」と頼まれても言わない規則は、**instructions に残す**
- **アプリ内チャットに「スキルを読む道具」は足さない（当面）。** 1 往復増える（Gemini の 15 RPM を食う・遅くなる）うえ、
  道具の返り値に答え方を載せる形（answerGuide）で「使ったときだけ読ませる」はすでに実現している

### 6.5 単一ソース化の設計

```
src/ai/guides/            ← 答え方のガイドの単一の真実（型つきの小さなモジュール）
  role.ts  output.ts  tools.ts  places.ts  hazard.ts  recommend.ts   … id・目的・対象（チャット／MCP／スキル）・本文
        │
        ├─ renderChatInstructions(engine)  → アプリ内チャット（Gemini は今の文字列と完全一致／OpenAI は上乗せの差分）
        ├─ renderMcpInstructions()         → /api/mcp の instructions（先頭 512 文字で完結）
        └─ renderSkillReference(id)        → plugins/…/skills/*/references/*.md（生成＋同期テスト）
```

進め方（**挙動を変えない順**）：

1. **分解だけ**（P0）：`buildSystemPrompt()` の出力が**今と 1 バイトも違わない**ことをスナップショットテストで固定してから、文をモジュールへ移す。
   Gemini の振る舞いは変わらない（＝eval を流す必要もない）
2. **共有**：災害の規則を `hazard-reading` スキルと MCP の `instructions` にも同じ源から出す（同期テストで二重管理を防ぐ）
3. **エンジン別の差分**（P2 の後）：OpenAI で崩れた問があるときだけ、OpenAI 用の上乗せを足す。**Gemini 側の文は触らない**。
   GPT-6 の手引きどおり、説明は短く、「いつ使うか」を狭く書く（S22）
4. Markdown のファイルにするか TS のままにするか：**TS（型と import の安全・ビルドの仕組みを足さない）を推奨**。人が読む一覧は生成した Markdown で足りる（§13-8）

### 6.6 MCP 側の「ガイド」（API こそがプロダクト）

メトリクス・カタログが「数字の意味」を API にしたように、**「このデータの話し方」も API にする**。

- `/api/mcp` に **`instructions`**（先頭 512 文字：何のサーバか・最初にどの道具・災害は「安全と言わない」・行データは CSV の URL で）
- 既存の `catalog://metrics` に並べて、ガイドを **resource**（例 `guide://hazard`）として出すのは、ChatGPT／Claude の読み方を確かめてから（任意）
- ChatGPT・Claude・Codex・アプリ内のどれから来ても、**同じ源の同じ規則**で話すことになる

### 6.7 ここでやらないこと

- 生 SQL・アプリ内でのコード実行・`build_dataset` をアプリ内チャットに出す（いずれも前回の決定のまま）
- エンジンごとに別の道具を作る（ToolSpec は 1 つ）
- Web 検索をチャットに足す（データの出所が共通 API でなくなる。やるなら出典の分離を設計してから）

---

## 7. ブラッシュアップの候補（GPT で伸ばせること）

どれも **P2 の eval の結果を見てから**、1 つずつ入れる（まとめて入れると、何が効いたか分からない）。

| # | 候補 | 中身 | 測り方 |
|---|---|---|---|
| 1 | **形の守り**を eval に足す | GPT-6 は箇条書き・表・Markdown に寄る（S19）。今の eval は形を見ていない → 「見出し・表なし」「文の数」の判定を足す | 新しい判定で全エンジンを流す |
| 2 | 道具の **strict 化**（OpenAI だけ） | 任意の引数を「必須＋null 可」に写す変換をアダプタに置き、受け取り側で null を undefined に戻す。ToolSpec は不変 | 道具の引数エラーの数（ログの `tool failure`） |
| 3 | **会話の記憶** | 今は過去のテキストだけを送る。前のターンの道具の要約（`forLlm`）を短く添え、「その中で一番は？」に道具を呼び直さずに答える | 地図文脈・追い質問の問を足す |
| 4 | **深さの切り替え** | 「速さ／じっくり」＝ `reasoning.effort` の low／medium。ガイドラインのモデル速度メニューと同じ考え | 所要時間と合格数 |
| 5 | **おすすめ（W6）をチャットから** | 既存の共通 API `/api/recommend` を道具に（画面と同じ規範で並べる。チャットが順位を作るのではない） | 拒否の問を「画面へ引き渡す／道具で答える」に分けて測る |
| 6 | **聞き取り**（フィードバック #9） | 要件を 1 回だけ聞く作法（スキルの「分析の型」①）。GPT-6 は質問しがちなので、**「合理的な既定で完走」を明記**して聞きすぎを抑える | `261001_fix_user_feedback_ui.md` §8 の D1 と合わせて |
| 7 | 入力の上限 | 最新 500 字・履歴 4,000 字は無料枠を守るための値。ChatGPT プランでは緩められる（DB と上流の保護は別に残す） | 長い問の eval |

---

## 8. セキュリティ・プライバシー・規約

### 8.1 共通

- **トークンはサーバ側だけ**。ブラウザのストレージ・URL・ログ・分析・サポートの記録に出さない（S3）。`id_token_hint` を含む認可 URL もログに出さない
- **ベース URL を固定**（`OPENAI_BASE_URL` を読ませない・§3.2）、fetch は `redirect: 'error'`、Organization／Project のヘッダは付けない
- 更新は期限の手前で・直列化して・新しい組（access・refresh・期限・scope）を**まとめて**置き換える。`refresh_token_reused` を出さない
- サインアウトは失効を試み、確かめられなければその旨を伝える（ChatGPT の設定から切断できる）
- 切断の通知は来ない → 401 と更新の失敗で気づき、資格情報を捨てて再サインインへ。**一時的な通信の失敗では捨てない**（S6）
- Bearer トークンで、送り手の束縛（DPoP 等）は無い（S28）→ 漏れたら使われる。**保存と通信の経路を最小にする**ことが唯一の防御

### 8.2 ローカル版に固有

- **127.0.0.1 にだけ bind**（LAN から見えない）。`/api/chatgpt/*`・`/api/chat`・`/auth/callback` は **Host が 127.0.0.1／localhost のポート**であることを照合（DNS リバインディング対策）
- **CSRF**：どのサイトからでもブラウザ経由で `http://127.0.0.1:<port>/api/chat` を叩けてしまう（利用者の枠を燃やされる）。
  **Origin の照合**と `Content-Type: application/json` の必須化（他所からはプリフライトが要る）で塞ぐ。サインイン開始とサインアウトも同じ
- 認可の取引は 1 回限り・10 分・state は時間一定の比較
- 資格情報のファイルは 0600・原子的な置き換え・リポジトリの外（`~/.config/ai-database-map/`）

### 8.3 本番版（P3）に固有

- RLS を有効にし anon の方針を作らない・暗号鍵は環境変数・Cookie は `__Host-`／HttpOnly／Secure／SameSite=Lax・取引はブラウザのセッションに結び付ける（CLAUDE.md §5）
- 保持する個人情報は最小に（`sub`・client_id・表示用のメール）。プライバシーポリシーに追記

### 8.4 規約・ライセンス

- OpenAI の規約とポリシーを提供前に読む（S14）。`backend-api` を使わない・Codex を装わない・**開発者のプランを他人に使わせない**（§4 の F・G）
- DevKit は非営利ライセンス → 取り込まない（§2.8）。ブランド資産はガイドラインに従う
- 「オープンソース」と名乗るなら LICENSE を置く（§13-3）

### 8.5 プライバシー

- `store: false` で OpenAI 側に応答を保存させない。発話は当アプリのサーバを通る（今の Gemini と同じ）
- plan usage は利用者の会話・記憶に触れない（S1・S16）。当アプリが利用者について受け取るのは、ID トークンの名前・メール・`sub` だけ（ほかはトークンそのもの）

---

## 9. 当アプリの「AI ネイティブ」との整合

| 原則（CLAUDE.md §2） | 本計画での守り方 |
|---|---|
| 人間 UI と AI は同じ共通 API を叩く | エンジンを替えても道具は ToolSpec 1 つ。ChatGPT 本体（プラグイン）も同じ `/api/mcp` |
| ドメインロジックを UI に埋めない | エンジンの一覧・状態・名前・失敗の文はサーバ（`/api/chat/engines`・`shared/chat-errors.ts`）が決める |
| API は自己記述的 | MCP の `instructions` とガイドの共有で、「どう話すか」まで API が持つ |
| GUI Chat Protocol の型に合わせる | `data-map`・`data-promotions` は assemble が決定的に作る——頭脳が何でも変わらない |
| アンチパターン（意味をフロントに） | エンジンごとの言い回しの分岐を画面に書かない |

---

## 10. 検証計画

### 10.1 単体（ネットワークなし・P0／P1）

- **リクエスト本文の契約**：ChatGPT エンジンで `streamText` が組む本文を偽の fetch で捕まえ、
  `store:false`・`stream:true`・禁止項目が**一つも無い**・system ロールの項目が無い・道具が namespace の中・送り先が `https://api.openai.com/v1/responses` を固定
- **認可**：初回は `dynamic_agent_client`＋`agent_name_hint`＋`ext_agent_host_id`、再認証は保存 client_id＋`id_token_hint`／`login_hint`・`agent_name_hint` なし、
  redirect が `127.0.0.1` で `/auth/callback`、scope と resource の値
- **callback**：state 不一致・複数の state・`error=access_denied`・新規なのに client_id なし・再認証で別の client_id・code の重複——すべて拒否
- **トークン応答**：scope に `chatgpt.tokens.use.direct` が無ければ plan usage 無効・`offline_access` なのに refresh が無ければ不正
- **ID トークン**：手元の鍵で署名した偽トークンで iss／aud／exp／nonce の各ずれを落とす
- **更新**：並行 2 本が 1 回の更新にまとまる・回転した refresh を保存する・終端エラーで資格情報を捨てる・一時エラーでは捨てない
- **失敗の分類**：§2.5 の表の全行（ストリーム前の `{detail}`・ストリーム中の `response.failed`）
- **エンジンの解決**：本番環境では `chatgpt-plan` を返さない・トークンが無ければ `needs_sign_in`
- **ガイドの分解**：`buildSystemPrompt()` の出力が分解前と完全一致（スナップショット）

### 10.2 スパイク（手動・開発者の Plus/Pro で 1 回・P1）

1. サインイン → 一覧のモデル（Luna の有無を記録）→ 道具 1 本の 1 ターン
2. **namespace なし**の道具を送って拒否されるか（拒否の `error.param` を記録）→ 以後 namespace で固定
3. `text.verbosity`・`reasoning.effort`・`include` が通るか
4. `response.incomplete`・途中切断・枠切れ（再現できれば）の SDK 上の見え方（finishReason・error パート）
5. 初回応答の時間（推論モデル × 打ち切り 15 秒の妥当性）
6. Settings → Usage で、この 1 ターンが何として見えるか

結果は本書に追記する（実測と日時）。

### 10.3 eval（P2）

- 62 問を **GPT-6 Luna（low）** と **GPT-6.1 Sol（low）** で全問流す。開発者は Pro（2026-10-19）で 5 時間枠が無いので、Sol も全問流せる（週の上限はありうる）
- **Plus に変えるなら、変える前に**モデルを比べる eval を済ませる。Plus は 5 時間枠を全アプリで共有し、Sol の全問は枠を圧迫しうる。
  一覧に出るモデルも変わりうる（料金表の Plus は「GPT-6.1 Sol and GPT-6 Luna」・§2.7）。変えた後は Luna の全問だけを流し直す
- 関門は今と同じ：**災害・拒否は 1 問も落とさない**、全体 60/62 以上（関門の考え方は `260926_chat_model_eval.md` §2.2、いまの閾値は `tests/chat-eval.test.ts` の 60）
- 加えて：形の判定（§7-1）・所要の p50／p95・道具の引数エラーの数・使用量の増え方
- 同じ日の同じ時間帯に Gemini も流し、問ごとの差を表にする。**崩れた問は「プロンプトかモデルか」を切り分けてから**手を入れる
- 問の間隔は短くできる（Gemini の 15 RPM が無い）が、`EVAL_THROTTLE_MS` は利用者の枠に合わせて決める

### 10.4 画面（Playwright）

- 接続カードの各状態・入力欄の「Using ChatGPT plan」・上限の案内（偽のサーバ応答で再現）・初回のお知らせが 1 回だけ
- 3 幅（広い・中・携帯）で、既存の実ブラウザ検査（FAB・図・⤢・履歴…）が全部通ること

---

## 11. 段取り（PR の切り方・案）

| PR | 中身 | 依存 | 受け入れ条件 |
|---|---|---|---|
| **PR-1** refactor | エンジンの抽象（Gemini だけ）。`route.ts` は `resolveEngine` を呼ぶだけに | — | 既存の単体・型・lint・ビルド全緑。**`/api/chat` の挙動が不変**（既存のチャットのテスト群） |
| **PR-2** refactor | ガイドの分解（`src/ai/guides/`）。出力は今と完全一致 | — | スナップショット一致。プロンプトの文字列に差分ゼロ |
| **PR-3** feat | ChatGPT エンジン：`@ai-sdk/openai@3`（v6 系）・namespace・providerOptions・URL 固定の fetch・失敗の分類。資格情報は差し込み口だけ | PR-1 | §10.1 のリクエスト本文と失敗の分類のテスト |
| **PR-4** feat | ローカル版：OAuth（ループバック・host ID・保存・更新・失効）・`/api/chat/engines`・`/api/chatgpt/*`・`/auth/callback`・接続カード・入力欄の表示・上限の案内 | PR-3 | §10.1 全部＋§10.2 のスパイク＋§10.4。**本番ビルドで ChatGPT が出ない**こと |
| **PR-5** docs/test | GPT の eval（§10.3）と結果の記録・既定モデルの決定 | PR-4 | 関門の合否と問ごとの表を本書に |
| **PR-6** feat | 磨き（§7 から eval で選んだもの。1 つずつ） | PR-5 | 該当の eval |
| **PR-7** feat | MCP の `instructions`・ガイドの共有（スキル・MCP）・ChatGPT 用プラグインの形（スキルの中立化・commands／agents のスキル化）・`/ai` に「ChatGPT で使う」・Codex の実導入の確認 | PR-2 | ChatGPT のカスタム MCP で実際に呼べる（手動）・`claude plugin validate --strict` と Codex の manifest テストが緑 |
| **PR-8** feat | 本番版（承認後）：セッション・暗号化保存・Web のリダイレクト・更新の行ロック | 承認・PR-4 | 承認時の条件で本書を更新してから |

- PR-1・PR-2・PR-7 は承認にも OpenAI のトークンにも依存しない。**最初の 1 週間で出せる**
- 1 PR に docs と実装を同居させる。別の PR の枝をベースにした PR は作らない（2026-08 の #108／#109 で、先に入った枝へマージされた）

---

## 12. リスク

| リスク | 影響 | 緩和 |
|---|---|---|
| 承認が下りない・長引く | 本番で使えない | B（ローカル）と C（プラグイン）で価値を出す。H（Gemini 有料枠）を保険に |
| プレビューの仕様が変わる（発表から 3 週間） | 動かなくなる | OpenAI 固有を `src/ai/chatgpt/` に閉じ込める・本文の契約テスト・docs の再確認日を本書に記録 |
| モデルの入れ替わり | 既定が消える・品質が変わる | 一覧から選ぶ・好みの順で既定を決める・変わったら eval（Gemini の `-latest` の教訓と同じ） |
| 利用者の枠を減らしすぎる | 「このアプリは重い」 | Luna を既定・答えは短く・先頭を固定してキャッシュ・Manage usage を常に見せる |
| GPT で答え方が崩れる | 災害の言い方・形 | 関門は今と同じ・崩れた問だけエンジン別の上乗せ・災害の規則は instructions に |
| ローカルのサーバが狙われる | 枠の盗用・トークン漏れ | 127.0.0.1・Host/Origin・JSON 必須・0600（§8.2） |
| 二つのエンジンで利用者が迷う | 体験の悪化 | 既定は Gemini のまま・名札・上限時の 1 クリック切り替え |
| ライセンス・ブランドの扱い | 公開の差し止め | DevKit を取り込まない・LICENSE を置く・ブランドガイドラインに従う |

---

## 13. 決めてほしいこと（推奨つき）

**2026-10-19 に決まったこと**

- #2 waitlist：**申し込む**（送信は利用者がブラウザで行う。設問と下書きは §14）
- #3 LICENSE：**MIT**（ファイルを置くのは本書の PR とは別に行う）
- 開発者は **ChatGPT Pro** を持つ（Plus に変える可能性あり）→ P1 のスパイクと P2 の eval は Pro で行える。Plus に変えるときの注意は §10.3

残り（#1・#4〜#9）は、P0 に着手する前に下の表の推奨どおりでよいかを確かめる。

| # | 論点 | **推奨** | 代替 |
|--:|---|---|---|
| 1 | 進め方 | **B → A（承認後）＋ C／D を並行**（§4） | A の承認だけを待つ／C だけ |
| 2 | waitlist への申し込み（**利用者の作業**） | **申し込む**（§14）。「手元の頭脳を本番 Web から呼ぶ形（§4 の I）は許されるか」も合わせて聞く。→ **決定（2026-10-19）** | 申し込まない（A を諦める） |
| 3 | LICENSE | **MIT を置く**（プラグインの manifest と一致。「オープンソース」の前提）。→ **決定（2026-10-19）** | Apache-2.0／置かない（OSS とは名乗れない） |
| 4 | ローカル版の配布範囲 | **まず開発者だけ**（今の .env で動く）。一般に配るのは、anon キーを README に載せるか決めてから | 最初から README で一般公開 |
| 5 | 既定モデル | **GPT-6 Luna（一覧にあれば）**。P2 の eval で確定 | GPT-6.1 Sol |
| 6 | 承認前の本番の画面 | **ChatGPT の選択肢を出さない**（`/ai` に「ChatGPT で使う＝プラグイン」の案内だけ） | 「準備中」と出す |
| 7 | ChatGPT プラグインの公開 | **まず個人（カスタム MCP）で検証 → 審査提出は後**（本人確認・プライバシーポリシーの準備が要る） | すぐ提出 |
| 8 | ガイドの形 | **TS モジュール**（型・import の安全・ビルドの仕組みを足さない） | Markdown＋生成 |
| 9 | ボタンの言語 | **承認ラベルは英語・説明は日本語**（ガイドラインに日本語の記載が無いため） | 日本語に訳す（要確認） |

---

## 14. 申し込み（interest form）のやり方と下書き

2026-10-19 に、フォームの画面をヘッドレスのブラウザで読んだ（**読むだけで、送信はしていない**）。
送信には Cloudflare の確認（人の操作）が要るので、**申し込みは利用者が自分のブラウザで行う**。

**手順**

1. https://openai.com/form/sign-in-with-chatgpt-interest/ をふつうのブラウザで開く（JavaScript とクッキーが要る）
2. 下の表のとおりに入れる。説明欄は下の英文をそのまま使える（LICENSE を置いてから送ると、文面の「MIT License」と食い違わない）
3. Cloudflare の確認を通して **Submit**
4. 返事を待つ間も P0〜P2 と C は進めてよい（承認が要るのは本番に出すときだけ）。**承認前に本番で ChatGPT プランを出さない**

ページの前置きは「オープンソースの開発者は developer docs へ、**商用パートナー**はこのフォームへ」。当アプリは利用者に課金しないが、
**リモートでホストする**ので docs（S1）の案内どおりこのフォームを使う。その理由は説明欄に書いておく。

**設問（8 つ・＊は必須）と入れる値**

| 設問 | 入れる値（案） |
|---|---|
| Work email ＊ | 連絡を受けたいメール。ChatGPT（Pro）のアカウントと同じものが無難。会社のドメインでなくてよい |
| First name ＊／Last name ＊ | 本名（ローマ字） |
| Company name ＊ | 個人なので `AI Database Map (independent developer)` |
| Website URL ＊ | `https://ai-database-map.vercel.app` |
| Job title | `Independent developer`（任意） |
| What capabilities would you like to implement? ＊ | **Sign in and ChatGPT plan use for AI requests**（もう一方は「Sign in only」） |
| Which of your products would use Sign in with ChatGPT? (Briefly describe each product) ＊ | 下の英文 |

フォームの裏の項目（画面には出ない）に、アプリへのリンク・段階・利用者への課金の有無・週の利用者数（WAU）・使っている API・その他がある。
後で聞かれうるので、**説明欄に先に書いておく**。

**説明欄の英文（下書き）**

```text
AI Database Map (https://ai-database-map.vercel.app, source: https://github.com/kusui26/AI-Database-Map)
is a free web app for exploring Japanese open data around train stations (ridership, population,
land prices, businesses, and flood and landslide hazards) on a map with an AI chat. It is live and
at an early stage, charges users nothing, and is open source under the MIT License.

The chat uses function calling against our own read-only API (12 tools) and answers in short
Japanese sentences with charts and map highlights. It is hosted on Vercel (Next.js) and currently
runs on the Gemini API free tier, which limits the whole site to roughly 150-250 conversations a day.

We would like eligible Plus and Pro users to run these chat requests on their own ChatGPT plan
through the Responses API (store: false, stream: true), with tokens kept server-side only and the
UI/UX guidelines followed. Because the app is remotely hosted, we are applying here. We are starting
with an open-source local version that uses the documented loopback flow.

Question: would an open-source companion that runs on the user's machine and is called by our
hosted UI count as a locally hosted app?
```

（日本語の要旨：駅周辺のオープンデータを地図と AI チャットで調べる無料・MIT の Web アプリ。チャットは自前の読み取り専用 API を
12 の道具で呼ぶ。今は Gemini の無料枠で、サイト全体で 1 日 150〜250 対話が上限。Plus/Pro の利用者が自分のプランで使えるようにしたい。
リモートでホストしているのでここから申し込む。まずはループバックのローカル版から作る。最後の段落は §4 の I についての質問で、要らなければ消してよい。）

---

## 15. 参考（一次情報・2026-10-19 閲覧）

**Sign in with ChatGPT（developers.openai.com・各ページは末尾に `.md` で原本）**

- S1 Overview（ChatGPT plan usage・client と host）— https://developers.openai.com/siwc/token-sharing-open-source
- S2 Registration and sign-in — https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- S3 Accounts and sessions — https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- S4 Models and inference — https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- S5 Preview limitations — https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- S6 Errors and recovery — https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- S7 Token reference — https://developers.openai.com/siwc/token-sharing-open-source/token-reference
- S8 Self-hosted VMs — https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- S9 Codex app-server — https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- S10 UI/UX guidelines — https://developers.openai.com/siwc/ui-ux-guidelines
- S11 Quickstart — https://developers.openai.com/siwc/quickstart
- S12 On your website（ID 連携の Web 版）— https://developers.openai.com/siwc/website
- S13 Request a client ID／interest form — https://developers.openai.com/siwc/request-client-id ／ https://openai.com/form/sign-in-with-chatgpt-interest/
- 全文の書き出し — https://developers.openai.com/siwc/llms-full.txt

**手順・実装例**

- S14 Cookbook「Integrating Sign in with ChatGPT in your Opensource App」— https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- S15 DevKit（Noncommercial License v1.0・commit `0a36fef`・2026-10-07）— https://github.com/openai/sign-in-with-chatgpt-devkit

**ChatGPT 側（learn.chatgpt.com）**

- S16 Sign in with ChatGPT（利用者向け・連携先の一覧）— https://learn.chatgpt.com/docs/sign-in-with-chatgpt
- S17 DevDay 2026（2026-09-29）— https://learn.chatgpt.com/docs/whats-new/devday-2026
- S18 Pricing（クレジット・5 時間枠の目安・プラン別のモデル）— https://learn.chatgpt.com/docs/pricing

**API・モデル・書き方**

- S19 Using GPT-6（Astra・6.1 Sol・Luna・推論の強さ・書き方の手引き）— https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra ／ `openai-docs` スキル — https://github.com/openai/codex/tree/main/codex-rs/skills/src/assets/samples/openai-docs
- S20 Function calling（namespace・strict）— https://developers.openai.com/api/docs/guides/function-calling
- S21 Tool search（`additional_tools`）— https://developers.openai.com/api/docs/guides/tools-tool-search
- S22 Rethinking skills and prompts for GPT-6 Astra — https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra

**プラグイン（ChatGPT／Codex）**

- S23 Plugins（architecture・skills・connect and test・Submit your Claude Code plugin・review requirements・Plugin Extensions）— https://developers.openai.com/plugins/llms-full.txt
- S24 Add custom MCP server — https://developers.openai.com/api/docs/guides/custom-mcp-server
- S25 Plugins（利用者向け）— https://learn.chatgpt.com/docs/plugins
- S26 Codex as a platform（app-server）— https://developers.openai.com/blog/codex-as-a-platform

**ライブラリ**

- S27 `@ai-sdk/openai@3.0.130`（npm の `ai-v6` タグ）の `responses/openai-responses-prepare-tools.ts`・`openai-responses-language-model.ts`・`openai-language-model-capabilities.ts`・`openai-provider.ts`、
  `ai@6.0.223` の `prepareToolsAndToolChoice`（当リポジトリの node_modules）

**第三者（補助・確度は一次情報より下）**

- S28 N. Sakimura「OpenAI Launches Sign in with ChatGPT (Based on OpenID Connect)」— https://www.sakimura.org/en/2026/10/11148/ ／
  実装の落とし穴の記録（issue）— https://github.com/HARA-Akihiko/x-ai-auto-post/issues/2 ／
  Vercel「Sign in with ChatGPT is now available on Vercel」— https://vercel.com/changelog/sign-in-with-chatgpt-is-now-available-on-vercel ／
  カスタム MCP のプラン別の可否（第三者のまとめ）— https://www.usecarly.com/blog/chatgpt-mcp/

---

## 付録 A：ChatGPT エンジンの骨子（擬似コード・実装時に確定）

```ts
// src/ai/engines/chatgpt-plan.ts（案）。トークンは呼び出し側（session.ts）が期限の手前で更新済みのものを渡す
import { createOpenAI } from '@ai-sdk/openai' // v3 系（ai-v6）

const OPENAI_API_BASE_URL = 'https://api.openai.com/v1' // 環境変数に任せない（§3.2）

export function chatGptPlanEngine(accessToken: string, modelSlug: string): ChatEngine {
  const openai = createOpenAI({
    apiKey: accessToken, // Bearer として送られる
    baseURL: OPENAI_API_BASE_URL,
    fetch: createPlanFetch(), // redirect:'error'・初回応答の打ち切り・期限つき
  })
  return {
    id: 'chatgpt-plan',
    model: openai.responses(modelSlug),
    providerOptions: {
      openai: { store: false, systemMessageMode: 'developer', reasoningEffort: 'low', textVerbosity: 'low' },
    },
    toolProviderOptions: { openai: { namespace: STATION_DATA_NAMESPACE } },
    maxRetries: 0,
    modelLabel: modelSlug,
  }
}
```

## 付録 B：ローカル版の認可 URL の形（値は伏せる）

```
https://auth.openai.com/api/accounts/authorize
  ?client_id=dynamic_agent_client            ← 2 回目以降は保存した oaiapp_…
  &agent_name_hint=AI%20Database%20Map       ← 初回だけ
  &ext_agent_host_id=urn%3Auuid%3A<UUIDv4>
  &response_type=code
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A<port>%2Fauth%2Fcallback
  &scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct
  &resource=https%3A%2F%2Fapi.openai.com%2Fv1
  &state=<毎回新しく>&nonce=<毎回新しく>
  &code_challenge_method=S256&code_challenge=<base64url(SHA-256(verifier))>
```

（エンドポイントは discovery `https://auth.openai.com/.well-known/openid-configuration` から読む。上は 2026-10-19 時点の値。）
