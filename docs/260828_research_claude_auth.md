# ユーザー自身の Claude サブスクリプションで、当アプリのデータ分析を支援させる（調査）

作成日：2026-08-28（2026-09-01 に §5「高度なデータ分析支援」を追記） ／ 対象：AI Database Map（Step2 の次・「AI ネイティブ」の外部展開）
**状態：§9 の決定 1〜10 は 2026-09-01 に推奨どおり合意済み。実装（§10 の段取り）に入ってよい。**
関連：[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) §2（API こそがプロダクト）・
[`architecture.md`](./architecture.md) §4（GUI Chat Protocol）§5（スキーマ）§6（共通API）§10（LLM 方針）・
[`plan_house_hunting.md`](./plan_house_hunting.md)（おすすめ駅・§9 の 5 決定）・
[`260824_flood.md`](./260824_flood.md) §7.5（言ってはいけないこと）

> 調査は 2026-08-28 に一次情報（Anthropic の docs / help / legal、MCP 仕様、Vercel・Supabase の docs、
> 各社リポジトリ）を直接確認した。**規約・課金・上限はこの 1 年で 4 回変わっている**ので、
> 本文書の事実は「2026-08-28 時点」として読み、実装前に §13 のリンクを再確認すること。

---

## 0. サマリ（結論先出し）

**問い**：BYOK（ユーザーが API キーを持ち込む）は課金の敷居とセキュリティ不安で避けたい。
ユーザー個人の Claude サブスクリプション（Pro/Max）を「頭脳」にして、当アプリのデータベースと機能に対して
Claude Code のようなデータ分析支援を、プラグイン導入程度の手間で使えるようにしたい。

**答え：できる。ただし「向き」が逆になる。**

| | 当初の想定 | **実現できる形（採用）** |
|---|---|---|
| 誰が誰を呼ぶか | **当アプリ**（自前ハーネス）が、ユーザーのサブスクで **Claude を呼ぶ** | **ユーザーの Claude**（Claude Code／Claude.ai／Cowork）が、**当アプリを呼ぶ** |
| 頭脳 | ユーザーのサブスク | ユーザーのサブスク（同じ） |
| 当アプリが提供するもの | ハーネス（ループ・権限・セッション）＋ツール | **リモート MCP サーバ**（共通API の薄いラッパ）＋**プラグイン**（スキル・コマンド・サブエージェント） |
| 規約 | **明示的に禁止**（§2） | **公式に推奨されているルート**（§2.3） |
| モデルの鍵 | 当アプリが触る | **一切触らない**（サインインは Anthropic 自身のフローで完結） |

根拠は 3 つ。

1. **Anthropic は「第三者アプリが Claude.ai ログインを提供する／サブスクの資格情報を中継する」ことを明文で禁止**しており、
   2026-01 と 04 に予告なしの遮断・BAN を実施済み。OpenCode は法務要請でサブスクログインを削除、Roo Code はプロバイダごと削除した（§2.2）。
   「Sign in with Claude」のような第三者向けプログラムは存在しない（OpenAI の同名機能も ID 連携のみで推論枠は渡らない）。
2. 逆に **「ユーザー本人が、無改変の Claude Code／Claude.ai に自分でサインインし、そこに第三者の MCP サーバ・プラグイン・スキルを読み込む」**
   ことは、公式ドキュメントが正面から支援している（カスタムコネクタは **Free でも 1 個**、プラグインは有料プラン全て、
   MCP Apps は全プラン）。
3. 当アプリは既に **「意味を持つ共通API」＋「Gemini 用の function calling ツール 9 本」＋「GUI Chat Protocol のパネル 17 型」** を
   持っている（CLAUDE.md §2 の設計）。MCP サーバは共通API の薄いラッパで済み、パネルは MCP Apps の UI にそのまま写せる。
   **1 本の MCP サーバが Claude Code／Claude.ai／Cowork／Chrome／ChatGPT／Codex／Cursor に同時に届く。**

**採用案（§4）**：
リモート MCP サーバ（`/api/mcp`・認証なしの読み取り専用から開始）＋ Claude Code プラグイン（当リポジトリをマーケットプレイスに）＋
Claude.ai／Cowork 向けカスタムコネクタ（同じ URL）→ 次段で MCP Apps（地図・チャート）→ 個人化が要る段になったら Supabase OAuth 2.1 で lazy auth。
**自前ハーネスは作らない。BYOK も要らない。既存の Gemini チャットは非エンジニア・無料利用者向けに残す。**

**追記（2026-09-01・§5）**：狙いは「既存 UI（ランキング・散布図）を会話で言い換えること」ではなく、
**「横浜市で中古マンションを買う。おすすめの駅は？」に、エージェントが自分でデータを集め・加工し・重みを聞き・根拠つきで答える**こと。
そのために §4 の器に **分析グレードのツール 3 本**（`list_stations`・`build_dataset`・`get_hazard_summary`）と
**方法論スキル**（`station-recommendation`）を足す。役割分担は
「**データと意味＝サーバ／方法論と禁じ手＝スキル／判断と対話＝エージェント（ユーザーの Claude）**」。
サブスクの枠を守る鍵は **「行データはツール結果に流さず、URL で渡してローカル Python（pandas）で分析させる」**である。

---

## 1. 前提の整理

### 1.1 何を叶えたいか

- **ユーザー**：鉄道会社の輸送計画、店舗出店の商圏分析、住宅購入者（CLAUDE.md §1）。データ分析を対話で深掘りしたい人
- **やりたいこと**：当アプリの共通API（駅×半径の指標・ランキング・散布・水害リスク・避難先）を、ユーザーが普段使う Claude から叩き、
  Python で加工し、表・図・地図で返す。**「Claude Code を実行して分析支援」**。
  例：「横浜市で中古マンションを購入したい。おすすめの駅は？」→ 乗降客数・人口・地価・ハザード等を**分析して**提案（§5）
- **制約**：①当アプリはモデルの鍵を持たない・払わない、②ユーザーの導入は「プラグインを入れる」程度、③規約に触れない
- **避けたいもの**：BYOK（API 従量課金の敷居・鍵の預かり）、Claude Code／OpenCode の丸ごと再実装

### 1.2 当アプリが既に持っているもの（追加投資が小さい理由）

| 資産 | 現状 | MCP 化での使い道 |
|---|---|---|
| 共通API（15 本） | `/api/stations` `/api/stations/:grp` `/api/metrics` `/api/ranking` `/api/growth` `/api/hazard/*`（point / alerts / evacuation / escape / catalog）… 認証なし・読み取り専用・IP レート制限のみ | MCP ツールの実体。**ドメイン層をそのまま呼ぶ**（HTTP 往復も不要） |
| AI ツール（9 本・`src/ai/tools.ts`） | `searchStations` `getStationDetail` `rankStations` `compareGrowth` `getHazardAtPoint` `getHazardAlerts` `findEvacuationSites` `findEscapeDirection` `getMetricsCatalog`（Zod 入力・日本語説明） | **同じ Zod スキーマを MCP に渡せる**（AI SDK v6・zod 4・MCP SDK v2 が揃う） |
| GUI Chat Protocol（パネル 17 型） | `trendChart` `rankingTable` `scatter` `stationCard` `hazardCard` `evacuationList` `escapeDirection` … | MCP の `structuredContent` の型に。MCP Apps の `ui://` ビューの入力に |
| ドメインの言い回し・注意書き | 水害の「安全と言わない」「時制」「出典」（`260824_flood.md` §7.5・`260828_fix_flood.md`） | **スキル（SKILL.md）の中身**。ロジックは API、作法はスキル |
| メトリクス・カタログ | `/api/metrics`・自己記述（label / unit / radii / years / reliability_flag） | MCP の resource／ツール。「正確なキーを引いてから呼ぶ」作法の土台。**§5 では CSV の列の意味を運ぶ台帳** |
| 正規化スキーマ（`station_metrics` ロング形式） | `(grp, metric, radius_m, year, value)`＋カタログ（architecture §5.1） | **§5 の `build_dataset`（横持ち生成）が 1 本の SQL で書ける**理由 |

---

## 2. 規約と認証：どこまで許されるか

### 2.1 条文（一次情報・要点の引用）

**Claude Code「Legal and compliance」**（https://code.claude.com/docs/en/legal-and-compliance）

> "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."

> "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."

> "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code…"

> "The Claude Code binary must not be modified… Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential…"（自社製品に Claude Code を同梱する場合の条件・Commercial Terms が前提）

> "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

**Agent SDK**（https://code.claude.com/docs/en/agent-sdk/overview）

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

**`claude setup-token`**（https://code.claude.com/docs/en/authentication）：CI 等でブラウザログインできない**本人の環境**向け。
"It can only make model requests, so it can't … fetch claude.ai connectors."
→ 第三者製品がこのトークンや `~/.claude` の資格情報を読み出して API を叩くのは、上の "collect, store, or intermediate" に該当する。

**Consumer Terms**（2025-10-08 効力）："You may not share your Account login information, Anthropic API key, or Account credentials with anyone else." ／
"…to access the Services through automated or non-human means… or resell the Services."（API キー経由・明示的許可がある場合を除く）

**課金面の現状**（https://support.claude.com/en/articles/15036540）："Update June 15: We're pausing the changes… For now, nothing has changed:
Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits."
→ **サブスク枠から引く挙動は当面残っているが、方針変更は予告済み**。これを前提に製品を組んではいけない。

### 2.2 執行の年表（2026 年）

| 日付 | 出来事 |
|---|---|
| 01-09 | サーバ側チェック開始。Claude Code 以外からのサブスク OAuth を "This credential is only authorized for use with Claude Code" で遮断。OpenCode / Cline / Roo Code が停止、誤 BAN も発生 |
| 02-18〜20 | Legal ページ改訂。"Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product… is not permitted"。Anthropic："Third-party harnesses using Claude subscriptions… are prohibited by our Terms of Service" |
| 02-20／03-19 | **OpenCode** が法務要請でサブスクログイン（`opencode-anthropic-auth`・Claude Code 偽装ヘッダ・専用プロンプト）を削除。現行 docs："Anthropic explicitly prohibits this." **Roo Code** は Anthropic 準拠でプロバイダ削除（後にリポジトリごとアーカイブ）。Kilo・JetBrains も同旨 |
| 04-04 | "Claude subscriptions will no longer cover usage on third-party tools like OpenClaw"（Boris Cherny）。理由はキャッシュ効率と容量 |
| 05-13 | Agent SDK 経由の第三者アプリ向け「月額クレジット」を発表（6/15 施行予定） |
| **06-15** | **施行当日に一時停止**。"nothing has changed… still draw from your subscription's usage limits"。再改定は予告済み |

**含意**：「自前ハーネス＋ユーザーの OAuth」は禁止かつ実際に遮断される。「Agent SDK 経由」は "previously approved" が前提で、課金ルールが年 4 回変わった。
**安定して許されているのは 1 つだけ——無改変の Claude Code／Claude.ai にユーザー本人がサインインし、そこに第三者のツールを足す形。**

### 2.3 公式ルートは「純正クライアントに、第三者のツールを差し込む」

Anthropic の拡張は「第三者アプリへログインを渡す」ではなく、**「Claude 側が第三者のツール（MCP／プラグイン／スキル）を取り込む」**方向で進んでいる。

| Anthropic の面 | 第三者が差し込めるもの | プラン | 出典 |
|---|---|---|---|
| **Claude.ai（web / Desktop / mobile）** | カスタムコネクタ（リモート MCP）・MCP Apps（対話 UI）・スキル・プラグイン（スキル部分） | **Free は 1 個まで**、Pro/Max は制限記載なし。Team/Enterprise は Owner が追加 | support 11175166・claude.com/docs/connectors |
| **Claude Code（CLI / Desktop / VS Code / JetBrains / web）** | リモート MCP・プラグイン（スキル・コマンド・サブエージェント・hooks・`.mcp.json`）・マーケットプレイス | Pro/Max/Team/Enterprise（または API キー） | code.claude.com/docs/en/plugins・mcp |
| **Claude Cowork**（Claude Code と同じアーキテクチャの非ターミナル版・2026-04 GA） | コネクタ・スキル・プラグイン（hooks／サブエージェント含む）・MCP Apps | 有料全プラン（web/mobile は順次） | claude.com/docs/cowork |
| **Claude in Chrome／Claude for Excel** | "Your skills, plugins, and connectors work here" | 有料プラン | support 12012173 |
| **ディレクトリ**（Connectors / Plugins） | 掲載は任意。掲載すると全プランのユーザーが「Connect」1 回で導入 | 提出は **Team/Enterprise 組織**（プラグインのコミュニティ枠は個人も Console から可） | claude.com/docs/connectors/building/submission・plugins/submit |

**「Sign in with Claude」相当は無い。** OpenAI の "Sign in with ChatGPT"（2026-08-02 β）は名前・メール・写真を渡す**ID 連携**で、
ユーザーの ChatGPT プランの推論枠を第三者アプリに持ち込む仕組みではない。Codex CLI の ChatGPT ログインも自社ハーネス限定である。

### 2.4 サブスクの上限と、MCP を多用するときの注意（ユーザー側の体験に効く）

- Pro/Max は **5 時間枠＋週次枠**、Claude／Claude Code／Cowork で**共有**。超過は extra usage（API 単価）。2026-05 に 5 時間枠が 2 倍化
- "Claude Code sends your full conversation with every request, and each time Claude uses tools it sends another request carrying that batch of tool results."
  → **MCP の結果が大きいほど、ユーザーの枠を直撃する**。キャッシュ寿命はサブスクで 1 時間
- `/usage` に MCP サーバ別の寄与率が出る。ツール定義は既定で遅延ロード（Tool Search）
- "Advertised usage limits… assume ordinary, individual usage" → バッチ的な大量分析は "ordinary" から外れうる
- **設計への要求**：既定の応答は簡潔（上位 N 件＋要約）、行データは URL で渡す（§4.7・§5.3）、ツールごとにサイズ上限を宣言。
  **§5 の分析グレード設計は、この制約から直接導かれる**（「150 駅 × 20 指標を 1 ツール呼び出し＝URL 1 本」にする）

---

## 3. 選択肢の全体像

| | 規約 | ユーザーの負担 | 当アプリの負担 | 対話 UI | 届く面 | 工数 |
|---|---|---|---|---|---|---|
| **A. 自前ハーネス＋ユーザーの Claude OAuth**（OpenCode 型） | **✗ 明示的に禁止・遮断実績** | — | — | — | — | — |
| **B. 自前ハーネス＋BYOK** | ○ | **✗ API 従量課金・鍵の管理**（本件の出発点で却下） | ハーネス保守 | 自前 | 自前のみ | 大 |
| **C. Agent SDK を当アプリのサーバで** | ○（API キー） | 無し | **✗ モデル費を当アプリが払う**。サブスクは使えない | 自前 | 自前のみ | 中 |
| **D. 無改変の Claude Code を同梱（devcontainer 等）＋各ユーザーが自分でログイン** | ○ 条件付き（Commercial Terms・無改変・名称制限） | 環境構築 | 配布物の保守 | Claude Code | Claude Code | 中 |
| **E. Claude Code プラグイン（MCP＋スキル）** | **◎ 公式ルート** | `/plugin marketplace add` 1 回 | **MCP サーバ＋スキルの保守だけ** | Claude Code（テキスト） | Claude Code 全面・Cowork | 小〜中 |
| **F. Claude.ai カスタムコネクタ（リモート MCP）＋MCP Apps** | **◎ 公式ルート** | URL 追加 1 回（事前入力リンク可） | E と同じサーバ | **MCP Apps で地図・表** | Claude.ai web/Desktop/mobile・Cowork・Chrome・（ChatGPT・VS Code 等も同じサーバ） | 小（Apps は中） |
| **G. ディレクトリ掲載** | ○ | 「Connect」1 回 | 審査対応・Team/Enterprise 組織 | F と同じ | 全プラン | 中（組織が要る） |
| **H. Claude Desktop 拡張（.mcpb）** | ○ | ダブルクリック | stdio プロキシの同梱 | Desktop | Desktop のみ | 小 |
| **I. 既存の Gemini チャット（当アプリ負担）** | ○ | 無し | 無料枠〜低額 | 自前（既存） | 当アプリ内 | 済 |

**採るのは E＋F（同じ MCP サーバを 2 つの入口で）**。G は組織要件が満たせる時点で追加、H は補助。
**A は不採用（規約）。B は不採用（本件の前提）。C は「サブスクを頭脳に」の趣旨に反する。D は E で足りるので不要。I は残す。**

> **D の位置づけ**：Legal ページは「プラットフォームが無改変の Claude Code をホストし、各ユーザーが自分の資格情報でサインインする」形を明示的に許している。
> ただし製品名に "Claude Code" は使えず（"Powered by Claude" 等のみ）、ユーザーは結局 Claude Code を触る。
> E（プラグイン）で同じ体験が「ユーザーが既に持っている Claude Code」の上で得られるので、D を選ぶ理由は今は無い。

---

## 4. 採用案：「共通API を MCP で公開し、ユーザーの Claude に届ける」

### 4.1 全体像

```
   ユーザーのサブスクで動く（Anthropic 純正・当アプリは鍵に触れない）
   ┌───────────────┬───────────────┬───────────────┐
   │ Claude Code    │ Claude.ai     │ Claude Cowork  │ ← ChatGPT / Codex / Cursor / VS Code も同じサーバを消費可
   │ (CLI/Desktop/  │ (web/Desktop/ │ (Desktop/web/  │
   │  VS Code/web)  │  mobile)      │  mobile/Chrome)│
   └──┬─────────┬───┴───────┬───────┴───────┬───────┘
      │プラグイン │  MCP     │ カスタム      │ プラグイン（git URL）＋コネクタ
      │(skills/  │ (HTTP)   │ コネクタ(URL) │
      │ commands/│          │ ＋MCP Apps    │
      │ agents/  │          │               │
      │ .mcp.json)│         │               │
   ┌──▼─────────▼──────────▼───────────────▼───────┐
   │  当アプリ（Vercel）                                │
   │  /api/mcp  ← mcp-handler 2 + @modelcontextprotocol/server 2 │
   │     ツール = ToolSpec（AI SDK の tool() と同じ Zod）   │
   │     resources = メトリクス・カタログ / ハザード・カタログ │
   │     ui://    = GUI Chat Protocol のパネル（MCP Apps）  │
   │  /api/*    ← 既存の共通API（UI・Gemini チャットが使用）  │
   │  domain/*  ← 意味づけ（単一の真実）                     │
   │  Supabase (PostGIS・RLS 読み取り) ／ 気象庁・国土地理院   │
   └─────────────────────────────────────────────────┘
```

**CLAUDE.md §2 の図の「LLM (Gemini)」の隣に「ユーザーの Claude」が並ぶだけ**で、構造は変わらない。
UI・Gemini・Claude の三者が**同じドメイン関数**を通る。

### 4.2 リモート MCP サーバ（`app/api/mcp/route.ts`）

**技術選定（2026-08 時点で確認）**

- **`mcp-handler@2.1`＋`@modelcontextprotocol/server@2`＋zod 4**。MCP 仕様 **2026-07-28**（ステートレス・`Mcp-Session-Id` 廃止）をネイティブに、
  2025 世代の Streamable HTTP クライアント（現行の Claude.ai／Claude Code）を互換層で受ける。**Redis 不要**。ルートは `app/api/mcp/route.ts` 1 本
- Node 20+・Fluid compute 既定・`maxDuration` は 60s 程度（Hobby 上限 300s）
- ⚠ Vercel の docs「Deploy MCP servers」は 2026-03 の 1.x 形式のまま古い。**README と changelog（2026-07-30 / 08-13）の 2.x を正とする**
- ⚠ MCP TypeScript SDK v2 は **zod ≥4.2 必須**（当リポジトリは 4.4）。AI SDK v6 の `tool()` と `@ai-sdk/mcp` も zod 4 対応 → **同じ `z.object()` を両方に渡せる**

**ツール設計（既存 9 本を写す＝Layer 1。分析グレードの追加は §5.3）**

| MCP ツール | 元 | 注記 |
|---|---|---|
| `search_stations` | `searchStations` | 駅名 → 候補（grp）。最初の一歩 |
| `get_station_detail` | `getStationDetail` | `grp` × `radius_m` × `category`。`structuredContent`＝`stationCard`／`trendChart` 型 |
| `rank_stations` | `rankStations` | `metric`（ファミリ可）・上位 N・都道府県／事業者／路線。**既定 N を小さく** |
| `compare_growth` | `compareGrowth` | 散布＋クラスタ。行データは `resource_link`（§4.7） |
| `get_hazard_at_point` | `getHazardAtPoint` | `hazardCard` 型。**言い回しは応答の文字列をそのまま**（安全と言わない） |
| `get_hazard_alerts` | `getHazardAlerts` | 上流（気象庁・逆ジオ）を叩く → **厳しめのレート制限**（§4.4） |
| `find_evacuation_sites` / `find_escape_direction` | 同名 | `for`（災害種別）必須。限界（`limitationsJa`）を落とさない |
| `get_metrics_catalog` | `getMetricsCatalog` | **resource（`catalog://metrics`）としても公開**。「正確なキーを引いてから呼ぶ」作法 |

- 名前は ASCII の snake_case（`^[a-zA-Z0-9_-]{1,64}$`・日本語不可）、説明は日英併記
- 全ツールに `title`＋`annotations.readOnlyHint: true`（ディレクトリ審査基準でもあり、Claude が確認なしで実行する条件）
- `_meta["anthropic/maxResultSizeChars"]` をツール単位で宣言。Claude Code は 25,000 トークン超で退避、Claude.ai は約 150,000 文字超で退避（MCP App が hydrate しない）
- `structuredContent`＝GUI Chat Protocol の型、`content[0].text`＝要約 JSON（後方互換のため両方）
- **単一の真実**：`src/ai/tools.ts` は EffectCollector に結合しているので、`ToolSpec { name, title, description, inputSchema, readOnly, run }` を切り出し、
  AI SDK 側（`tool({ execute })`）と MCP 側（`registerTool`）の 2 つの薄い変換で消費する。**定義を二重に持たない**（CLAUDE.md §3 DRY）

```ts
// app/api/mcp/route.ts（骨格・mcp-handler 2.1 系）
import { createMcpHandler } from 'mcp-handler'
export const maxDuration = 60

const handler = createMcpHandler(
  (server) => {
    for (const spec of TOOL_SPECS) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema, // AI SDK と同じ Zod
          annotations: { readOnlyHint: true },
          _meta: { 'anthropic/maxResultSizeChars': spec.maxChars },
        },
        async (input) => {
          const result = await spec.run(input) // domain/* をそのまま呼ぶ
          return {
            content: [{ type: 'text', text: JSON.stringify(spec.summarize(result)) }],
            structuredContent: result, // GUI Chat Protocol の型
          }
        },
      )
    }
  },
  { serverInfo: { name: 'ai-database-map', version: '1.0.0' } },
)
export { handler as GET, handler as POST }
```

### 4.3 認証：段階的に

Claude が受け付ける方式（claude.com/docs/connectors/building/authentication）：`oauth_dcr`・`oauth_cimd`・`oauth_anthropic_creds`（要連絡）・
`static_headers`（β・組織管理者のみ）・**`none`（公式サポート）**。個人ユーザー向けに静的トークンは使えない（Claude.ai 側）。

| 段 | 方式 | 何が要るか | いつ |
|---|---|---|---|
| **Phase 1（採用）** | **`none`**：認証なし・読み取り専用 | 既存の共通API と同じ公開レベル（オープンデータ・ユーザーデータなし）。Claude.ai の "Add custom connector" で Authentication=None、Claude Code は `claude mcp add --transport http` | 最初から |
| Phase 2 | **lazy auth**：公開ツールは無認証のまま、**保護ツール（保存した条件・お気に入り駅・自分の分析履歴等）だけ** 401＋`WWW-Authenticate: Bearer resource_metadata=…` で Connect を促す | 認可サーバ。**Supabase Auth の OAuth 2.1 サーバ（β・全プラン無料）**：`allow_dynamic_registration` ON、署名鍵を ES256 へ、同意画面を Next.js で実装、redirect URI は完全一致。mcp-handler の `withMcpAuth`＋`protectedResourceHandler` で JWKS 検証 | 個人化の機能を足すとき |
| 代替 | WorkOS AuthKit（無料 1M MAU・DCR/CIMD 対応）／Auth0／Clerk／Better Auth の MCP プラグイン | Supabase が CIMD 未対応なら | — |

- ⚠ MCP 2026-07-28 は DCR を非推奨化し CIMD へ移行中。Claude は両対応で、CIMD メタデータが無ければ DCR にフォールバックする。Supabase は CIMD 未対応（Discussion #41695・未回答）→ Phase 2 時点で再確認
- ⚠ Claude Code の OAuth コールバックは loopback の可変ポート。Supabase の完全一致検証との相性は未検証（`oauth.callbackPort` 固定で回避可）
- 当アプリは **モデルの鍵にも Claude の資格情報にも一切触れない**。触れるのは Phase 2 の「当アプリ自身のユーザー」のトークンだけ

### 4.4 濫用対策・上流保護（認証なしで公開する以上、ここが要）

- **Vercel WAF のレート制限**を `/api/mcp` に（全プランで使える。Hobby は 1 ルール・月 100 万許可リクエスト込み）。Anthropic の egress `160.79.104.0/21` は許可
- **ツール別の制限**：2026-07-28 仕様は POST に `Mcp-Name`（ツール名）ヘッダを必須化 → `get_hazard_alerts`（気象庁・逆ジオ）と `find_evacuation_sites`（国土地理院タイル）は厳しめに。
  実装は既存 `src/ai/rate-limit.ts` の seam を **`@upstash/ratelimit`** に差し替え（インスタンス毎メモリの限界は同モジュールが自認している）
- **キャッシュ**：カタログ・駅詳細は `ttlMs`／CDN キャッシュ。警報は既存の SWR 間隔と同じ考え方
- **サイズ**：上位 N 件＋ハンドル（`nextCursor` 相当をツール引数で）、"Do not return a full database dump"（審査基準）。
  **例外は §5.3 の `build_dataset`**——ただし返すのは URL であって行データではない
- **Spend Management**（Vercel）で上限を切る。上流の 429/403 は「取得できなかった」として正直に返す（§7.5 の流儀）

### 4.5 Claude Code プラグイン

**配布**：当リポジトリ直下に `.claude-plugin/marketplace.json`、プラグイン本体は `plugins/ai-database-map/`。
ユーザーは `/plugin marketplace add kusui26/AI-Database-Map` → `/plugin install ai-database-map@ai-database-map`。
（PostHog 方式：**1 リポジトリから Claude Code／Cowork／Codex／Cursor 向けマニフェストを同時に出す**。Codex は `.codex-plugin/plugin.json`＋`.mcp.json`）

```text
plugins/ai-database-map/
├── .claude-plugin/plugin.json      # name / version（更新はここを上げる）/ description / userConfig
├── .mcp.json                       # { "station-data": { "type": "http", "url": "https://ai-database-map.vercel.app/api/mcp" } }
├── skills/
│   ├── station-analysis/SKILL.md   # 知識型（user-invocable: false）：カタログの引き方・半径・年次・出典の作法
│   │   └── references/{metrics.md, hazard.md, sources.md}
│   ├── hazard-reading/SKILL.md     # 知識型：時制（いま／もし起きたら）・「安全と言わない」・限界を落とさない
│   ├── station-recommendation/SKILL.md  # 方法論（§5.4）：要件の聞き取り→データ→正規化→重み→敏感度→提案
│   ├── station/SKILL.md            # コマンド型 /ai-database-map:station <駅名> [半径]
│   ├── rank/SKILL.md               # コマンド型 /ai-database-map:rank <指標> [半径] [N]
│   ├── recommend/SKILL.md          # コマンド型 /ai-database-map:recommend <地域> （§5 の入口）
│   └── analyze-csv/SKILL.md        # export → scripts/fetch_dataset.py → pandas（§4.7）
├── agents/data-analyst.md          # tools を MCP＋Read/Bash に限定、知識スキルを preload
├── hooks/hooks.json                # PreToolUse で半径・年の妥当性、SessionStart で短い文脈
└── README.md / CHANGELOG.md
```

- **ロジックは API、作法はスキル**（Anthropic 公式 `knowledge-work-plugins/data` と同じ分離）。スキルに数式や閾値を書かない
  （例外：§5.4 の**方法論**はスキルに書く——それは「判断の作法」であって、データの意味づけではない）
- SKILL.md は Claude Code 専用フィールド（`argument-hint` 等）を含むと **claude.ai／Cowork のアップロードでハードエラー**になる。知識型スキルは標準 6 フィールドだけで書き、コマンド型だけ拡張を使う
- ツール名はプラグイン同梱だと `mcp__plugin_ai-database-map_station-data__<tool>`。スキル本文では**完全修飾名**で指す
- 常時読み込まれる `description` は短く（プラグイン詳細画面に Context cost が出る）。`claude plugin validate --strict` を CI に
- `userConfig` に任意の `api_token`（Phase 2 で `headers` に渡す）を最初から用意しておくと、後で構成を変えずに済む
- 第三者マーケットプレイスは**自動更新が既定 OFF**。README で `/plugin` › Marketplaces の更新手順を案内

### 4.6 Claude.ai／Cowork 向けコネクタと MCP Apps

- **導入リンク**を配る：`https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=AI%20Database%20Map&connectorUrl=<encoded URL>`
  （名前と URL が事前入力される。確認は省略されない）。**Free でも 1 個まで追加可**
- Cowork はプラグインも「Add from a repository（GitHub/git URL）」で入る。hooks／サブエージェントは Cowork でだけ動く（チャットではスキルのみ）
- **MCP Apps**（仕様 2026-01-26・SDK `@modelcontextprotocol/ext-apps` 1.7・Claude は全プランで描画）：
  - GUI Chat Protocol の **パネル種別 → `ui://` リソース**に対応づけ、ツールの `structuredContent` にパネル JSON を載せる。**ドメインロジックを UI に持ち込まない**（既存の描画部品を単一 HTML に別ビルド）
  - `trendChart`／`rankingTable`／`scatter`／`statTable` は inline カード、`hazardCard`＋地図は fullscreen 前提
  - **CSP は既定で外部接続ゼロ**。MapLibre のタイル・スタイル・glyph・sprite のホストを `_meta.ui.csp.connectDomains`／`resourceDomains` に列挙。
    公式例は CesiumJS（WebGL）が動いているので WebGL 自体は可。**blob: Web Worker（MapLibre）が通るかは未検証 → 最初にスパイク**。不可なら PNG（`image` コンテンツ）にフォールバック
  - Claude Code CLI は MCP Apps を描画しない → ツールは**必ずテキスト／構造化のフォールバック**を返す
  - ext-apps の peer は SDK v1。mcp-handler 2（SDK v2）では `registerTool` に `_meta.ui.resourceUri`、`registerResource` に `text/html;profile=mcp-app` を**直接指定**する（薄いラッパを介さない）
- 同じサーバが ChatGPT（Apps SDK は MCP 上）・VS Code・Cursor・Codex でも動く（MCP は 2025-12 に Linux Foundation の AAIF へ寄贈・OpenAI も共同）

### 4.7 重い分析は「URL で渡してローカル Python」

MCP の結果をインライン展開すると、Claude Code は 25,000 トークンで退避し、ユーザーの枠も削る。
公式ガイドは無いが、制約から導ける経路は次のとおり（Anthropic の `data` プラグインも "upload CSV/Excel files for analysis" を前提にしている）。

1. `build_dataset`（§5.3）は **行数・スキーマ・短命の署名 URL（Vercel Blob 等）**だけを返す（`resource_link`・`text/csv`）
2. スキル同梱の `scripts/fetch_dataset.py`（標準ライブラリのみ）が `./data/<name>.csv` へ保存し、`shape` と `head` を印字。
   `allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/*)` で確認なしに実行、キャッシュは `${CLAUDE_PLUGIN_DATA}`
3. 本文で pandas の分析と、HTML を生成してブラウザで開く可視化の手順を指示
4. `compatibility: Requires Python 3 and network access`（claude.ai／API のスキルはネットワーク不可なので Claude Code／Cowork 専用と分かる）

### 4.8 既存の Gemini チャットはどうするか

**残す。** 非エンジニア・無料利用者・「アプリを開いてすぐ聞く」場面は当アプリ内チャットが担う（費用は当アプリ、無料枠〜低額）。
Claude 経由は「自分の環境で深掘りしたい人」向け。**ツールの定義（ToolSpec）は 1 つ**なので、二重保守にはならない。
§5 の分析グレードのツールも Gemini から呼べるが、役割分担は §5.6 に整理した。

---

## 5. 高度なデータ分析支援 —「決められた UI を返す」から「分析する」へ（2026-09-01 追記）

### 5.1 目標の言い直し

これまでの Gemini チャットは、**手動 UI と同じ操作を言葉で呼び出す**ものだった——「ランキングを見せて」→ `rankingTable`、
「散布図で」→ `scatter`。答えの形は**事前に決めた UI パネル**である。これは「UI でできること＝AI でできること」を保証する設計（§4 の思想）
としては正しいが、次の問いには答えの形が無い。

> 「横浜市で中古マンションを購入したい。おすすめの駅は？」

この問いに必要なのは、パネルの選択ではなく**分析**である：
①目的と好み（予算・通勤先・災害への許容度…）を**聞き**、②対象の駅集合と関連指標のデータを**集め**、
③正規化・重み付け・合成・敏感度確認を**自分で計算し**、④根拠と限界つきで**提案する**。
③④はまさにコーディングエージェント（Claude Code）が得意な仕事で、**当アプリが提供すべきは「分析の材料と作法」**である。

**役割分担（ここが設計の要）**

| 層 | 担うもの | 置き場所 |
|---|---|---|
| **データと意味** | 値・単位・定義・年次・半径・信頼性フラグ・出典・ハザードの言い回し | **サーバ**（共通API／MCP・カタログ）——従来どおり単一の真実 |
| **方法論と禁じ手** | 分析の手順・正規化の仕方・ハザードの扱い方・言ってはいけないこと | **スキル**（配布物・§5.4） |
| **判断と対話** | 重み・トレードオフ・ユーザーへの質問・提案文 | **エージェント**（ユーザーの Claude）＋ユーザー |
| 事前 UI パネル | クイックな確認（ランキング・散布・駅カード） | 従来どおり（Layer 1・§4.2） |

サーバは**好みを推測しない**（重み付きの「おすすめスコア API」を作らない）。エージェントは**意味を発明しない**（カタログ外のキー・単位・言い回しを作らない）。
この分担なら CLAUDE.md §2（意味はサーバ）を守ったまま、分析の自由度をエージェントに渡せる。

> 当アプリ自身の「おすすめ駅」機能（[`plan_house_hunting.md`](./plan_house_hunting.md)・未実装）は、この方法論の**固定レシピ版**にあたる。
> エージェント版を先に出すと、重み・ペルソナ（同 §9 の 5 決定）を実データで試す実験場になり、固まったレシピを後からアプリ機能に昇格できる。
> 逆にアプリ機能で決めた語彙・注意書きは、そのままスキルに写す——**二重に発明しない**。

### 5.2 いまのツール面が「分析」に足りない理由（ギャップ）

横浜市の例を既存ツール（Layer 1）だけでやると、こうなる。

| 工程 | 既存ツールでのやり方 | 問題 |
|---|---|---|
| 対象駅の列挙（横浜市） | `/api/stations` は駅名 `q`・`bbox`・都道府県。**市区町村では絞れない**（`stations` に市区町村列が無い・architecture §5.1） | **G1**：bbox の手作業か神奈川県全駅からの目視絞り込み |
| 駅×指標の横持ち | `rank_stations` は 1 指標、`get_station_detail` は 1 駅 → 150 駅 × 15 指標を揃えるには**ツール呼び出しを百回単位で**繰り返す | **G2**：Claude Code は毎回全会話を再送する（§2.4）。数十万トークン規模の浪費で、5 時間枠が持たない。会話も肥大してコンパクションを誘発 |
| ハザードの一括評価 | `get_hazard_at_point` は 1 地点ずつ。実装は公式タイル・メッシュ・浸水ナビを**その場で読む** | **G3**：150 回叩けば上流（国土地理院・気象庁）への負荷と遅延が非常識になる。§4.4 の自衛レート制限とも矛盾 |
| 「中古マンション価格」 | 無い。地価公示（L01）が近い代理 | **G4**：正直に「地価は土地の公示価格でありマンション価格そのものではない」と言うしかない（将来データセット候補：不動産取引価格情報） |
| 分析の作法 | どこにも書いていない | **G5**：正規化せず単位の違う値を足す・ハザードを線形スコアに混ぜる・「安全」と言う——事故の温床 |

**結論：足りないのはモデルの賢さではなく、「集合を 1 回で渡す」ツールと「作法」である。**

### 5.3 追加するツール（Layer 2＝分析グレード・3 本）

#### ① `list_stations` — 対象集合を作る

```
入力: { prefectures?, municipalities?, operators?, routes?, bbox?, near?: {lon, lat, radius_m}, limit? }
出力: { count, stations: [{ grp, name, prefecture, municipality, lon, lat, n_op }], truncated? }
```

- 既存の PostGIS クエリ（駅名・bbox・最寄・`ST_DWithin`）の薄い一般化。**G1 の解消には `stations.municipality` 列の追加が要る**
  （パイプラインで行政区域ポリゴン（国土数値情報 N03）と空間結合して埋める。列が無い間は `bbox`／`near` で代替）
- 返すのは**識別子と位置だけ**（値は返さない）。150 駅でも数 KB

#### ② `build_dataset` — 駅×指標の横持ちテーブルを 1 回で作り、URL で渡す

```
入力: { stations: {…list_stations と同じ selector} | grps[],
        metrics: カタログキー[] | ファミリ[]（radius_m / years で確定）,
        radius_m?: 1000, years?: 'latest' | number[] , shape?: 'wide' | 'long',
        include_hazard?: boolean, format?: 'csv' }
出力: { rows, station_count, columns: [{ key, label, unit, value_type, year, radius_m, reliability_flag }],
        url（短命の署名 URL・text/csv）, meta_url（columns＋出典＋生成条件の JSON）,
        preview（先頭 5 行）, notes: [欠損・lowbase/lown の件数 …] }
```

- **実装は 1 本の SQL**：`station_metrics` はロング形式 `(grp, metric, radius_m, year, value)` なので、
  カタログで検証したキー集合に対する melt→pivot で済む（architecture §5.1 の正規化がここで効く）。**生 SQL をエージェントに書かせない**（§5.5）
- 列名は既存の命名規約 **`{接頭辞}_{年}_{半径}`**（dataset.md）をそのまま使う——アプリ・ドキュメント・CSV で語彙が一致する
- **意味を CSV まで運ぶ**：`columns` と `meta_url`（label／unit／出典／ライセンス／生成条件）を必ず添える。
  出典の担当は今週の §11 案 C（`SourceRef`）と同じ思想——**データを渡すときに権利表記を落とさない**
- **返すのは URL**（`resource_link`）。ツール結果はスキーマとプレビューだけ → Claude Code の 25k トークン退避にも、ユーザーの枠にも優しい
- 上限：駅 2,000 × 列 60 程度（Vercel 60 秒・CSV 数 MB を目安に実測で確定）。超えたら `truncated` と絞り方の提案を返す
- `include_hazard: true` で ③ の駅別ハザード列を結合できる（列名は `hazard_` 接頭辞で指標と混ざらないように）

**枠への効き目（概算）**：横浜市 150 駅 × 15 指標を Layer 1 でやると、ツール呼び出し 100 回超 ×（会話全文＋結果）の再送で
**数十万〜百万トークン規模**になり Pro の 5 時間枠を使い切りかねない。`build_dataset` なら **ツール呼び出し 3 回**
（list → build → hazard）＋ローカル pandas で、モデルに入るのは要約だけ——**このツールが「サブスクで高度分析」を成立させる**。

#### ③ `get_hazard_summary` — 駅別ハザードの一括取得（**事前計算から読む**）

```
入力: { grps: string[]（≤500）}
出力: { computed_at, version, stations: [{ grp,
          worst: { group, level, valueJa },
          flood: { level, depth_rank, duration_rank }, inland_flood: {…}, storm_surge: {…},
          tsunami: {…}, landslide: {…} }],
        limitationsJa: [「駅の代表点 1 点の値」「white≠安全」…], sources }
```

- **ライブ計算しない**。パイプラインで既存の地点ドメイン関数（`pointHazard`——サーバ・ブラウザ・オフラインで同じもの）を
  **全 9,273 駅にオフライン実行**し、駅別サマリをテーブル化して配信する（G3 の解消）。
  上流タイルを叩くのは**パイプライン実行時の 1 回だけ**。`computed_at`／`version` を持ち、データ更新時に再計算
- レベルは**順序尺度**であって足し算できない。`limitationsJa` と「安全と言わない」語彙は応答に**同梱**し、スキル（§5.4）でも禁じ手として重ねる
- **「いま」（警報・キキクル）はバッチにしない**。リアルタイム情報の一括取得は上流負荷と鮮度の両面で不適切。
  住まい探しの文脈では静的な想定区域が主で、「いま」は個別駅の確認（Layer 1 の `get_hazard_alerts`）に限る
- 既存の「災害は指標ではない」区分（`260828_fix_flood.md` §4.1・`DetailTab` の分離）を守る：
  ハザードサマリは `metric_catalog` に**入れない**。別テーブル・別カタログ（`hazard`）のまま、`build_dataset` が結合だけする

#### 見送るもの（Layer 2 に入れない）

- **生 SQL ツール（`run_sql`）**：Supabase／Neon の MCP には前例がある（read-only フラグ）が、当アプリでは見送る。
  ①CLAUDE.md §2 が「生カラムの CRUD 化」を明示的にアンチパターンとしている、②単位・欠損・信頼性フラグ・出典という**意味**が SQL 結果から落ちる、
  ③`build_dataset`＋pandas で分析の自由度は同等以上（結合・集計はローカルで無限にできる）、④公開・認証なしサーバに置くには攻撃面が広い。
  将来もし要るなら「カタログ由来の公開ビュー限定・SELECT のみ」を別途設計する
- **サーバ側の統計ツール**（percentile・回帰など）：pandas で足りる。作らない（YAGNI）
- **サーバ側の「おすすめスコア」API**：重みは好みであり、サーバが決めるとエージェントとユーザーの対話を奪う。
  固定レシピはアプリ機能（plan_house_hunting）側で別途

### 5.4 方法論スキル `station-recommendation`（G5 の解消）

「作法」はスキルに書く。骨子（SKILL.md 本文の設計・実装時に references へ展開）：

1. **要件を先に聞く（決め打ちしない）**。最低限：①予算感と「資産価値 vs 買いやすさ」のどちら寄りか、②通勤先・使う路線、
   ③災害リスクの許容度（回避したい種別）、④暮らしの好み（にぎわい vs 静けさ＝事業所・従業者の扱い）。
   plan_house_hunting §9 の 5 決定（重み・ペルソナ）を**対話に写した形**。ペルソナ（ファミリー／資産重視／防災重視）は**初期重みの例**として提示し、必ず確認を取る
2. **対象集合**：`list_stations`（例：municipality=横浜市。無ければ bbox）。件数と漏れの可能性を明示
3. **データ**：`build_dataset`。推奨初期セット（半径 1km・最新年＋増減率）：
   乗降客数（水準・コロナ前後比）／人口（水準・増減・将来推計増減）／地価（水準・増減）／バス停・事業所・従業者。
   `include_hazard: true`
4. **前処理**：欠損と `reliability_flag`（lowbase／lown）の行を**黙って使わない**——除外か注記かをユーザーに見せる
5. **合成**：単位が違う値は **z-score か min-max で正規化してから**重み付き合成。
   **ハザードは線形スコアに足さない**——順序尺度なので「段階の減点」か「足切り」（どちらにするかはユーザーに確認）。
   `none` を加点しない（「指定なし＝安全」ではない・§7.5-1）
6. **頑健性**：重みを ±（例 ±20%）振って**順位が入れ替わるか**を必ず確認し、「僅差」をそう言う。
   地価×乗降のようなトレードオフは散布で見せる（安い×便利は両立しにくい——正直に）
7. **提案の形**：上位 5 駅前後。各駅に「効いた要因 1〜2 行」「弱点 1 行」。末尾に**限界**を必ず：
   半径は駅の代表点基準／年次はデータごとに違う／地価はマンション価格の代理（G4）／ハザードは想定であり「いま」ではない（時制・§7.5）。
   **出典**は `meta_url` の内容から列挙
8. **成果物**：Claude Code なら比較表（Markdown）＋任意で matplotlib の図・HTML レポート。使った CSV と手順（スクリプト）を残して**再現可能**に
9. **禁じ手**（明文化）：カタログ外キーの発明／単位無視の足し算／ハザードの線形加点／「安全です」／古い年次の混在を無断で／
   `notes`・`limitationsJa` の削除

Cowork でも同じスキルが動く（成果物が Excel になる）。claude.ai チャットではコード実行の形が違うため、
このスキルは **Claude Code／Cowork 専用**と `compatibility` に明記し、claude.ai では Layer 1（パネル）で答える。

### 5.5 なぜ「生 SQL」でなく「カタログ経由の横持ち生成」か（設計判断の記録）

エージェントに最大の自由を渡す最短路は read-only SQL だが、当アプリの価値は**意味づけ**にある（CLAUDE.md §2）。
`build_dataset` は「自由度はローカル pandas で・意味はサーバで」という折衷で、
①エージェントが触るのは**カタログで検証された語彙だけ**、②CSV には label／unit／出典が随伴、③サーバの攻撃面は増えない、
④それでいて分析の自由度（結合・派生列・任意の統計）は SQL と同等になる（データが手元にあるから）。
**「API こそがプロダクト」の分析版**として、この形を正とする。

### 5.6 アプリ内（Gemini）との関係

- **アプリ内チャット**：即答＋パネル（従来どおり）。`build_dataset` を呼ばせることは可能だが、アプリ内には
  コード実行環境が無いので「CSV を返されても分析できない」。当面はアプリ内を Layer 1 に限定し、
  深掘りは「Claude Code／Cowork で続きをやる」導線（コマンド例のコピー）を出す
- **将来のおすすめ駅機能**（plan_house_hunting）：§5.4 の方法論が実データで安定したら、固定レシピとして
  アプリ機能に昇格（重みプリセット＝ペルソナ、UI はランキング＋理由カード）。**building blocks（list／build_dataset／hazard_summary）は共通**

---

## 6. ユーザー体験（導入と、横浜の例の一気通貫）

**導入（再掲）**

- Claude Code（Pro/Max）：`/plugin marketplace add kusui26/AI-Database-Map` → `/plugin install ai-database-map@ai-database-map`
- Claude.ai（Free でも 1 個）：導入リンク → 追加 → チャットで質問（Layer 1・パネルは MCP Apps）
- Cowork（有料）：Customize › Connectors に同じ URL、Plugins に同じリポジトリ
- ChatGPT／Codex／Cursor：同じ MCP URL（Codex は `.codex-plugin`）

**横浜市の例（Claude Code・§5 の流れ）**

```
ユーザー: 横浜市で中古マンションを買おうと思う。おすすめの駅は？
Claude : （station-recommendation スキルが発火）3 点だけ教えてください——
         ①予算重視か資産価値重視か ②通勤先（使う路線）③水害・土砂のリスクはどこまで許容？
ユーザー: 予算重視・東京駅まで45分以内・洪水の危険が高い駅は外して
Claude : [list_stations: 横浜市 → 約150駅] [build_dataset: 150駅×14列 → CSV 210KB の URL]
         [get_hazard_summary: 150駅 → 事前計算から一括]
         [Bash: fetch_dataset.py → pandas で正規化・重み付き合成・敏感度チェック]
         おすすめ 5 駅はこちらです（表）。◯◯駅は地価水準が市内下位 25% なのに乗降・人口が増勢で…
         ただし：地価公示は土地の価格でマンション価格そのものではありません。ハザードは想定最大規模の
         「もし起きたら」で、△△駅は洪水想定区域内のため除外しました（駅の代表点 1 点の判定です）。
         重みを ±20% 振っても上位 3 駅は不動、4・5 位は入れ替わります。出典：…
```

ツール呼び出しは 3 回・モデルに入るのは要約だけ。**枠を守りながら、パネルの語彙に縛られない分析**ができる。

---

## 7. コストとリスク

**当アプリ側の費用**：モデル費 **0**（推論はユーザーのサブスク）。増えるのは Vercel の関数実行と Supabase の読み取り（既存 API と同じ性質）、
`build_dataset` の CSV 生成と Blob 配信（数 MB 級・短命）、上流 API（気象庁・国土地理院）への負荷 → §4.4（ハザードは §5.3 の事前計算で激減）。

**ユーザー側**：サブスク枠の消費（§2.4）。Pro は 5 時間枠が小さく、MCP の長い JSON は枠を削る → **既定を簡潔に**・行データは URL、README に明記。

**規約・方針の変動**（最大のリスク）：

| リスク | 影響 | 緩和 |
|---|---|---|
| Anthropic がプラグイン／マーケットプレイスの規則や上限を変える（年 4 回の実績） | 導入手順・体験が変わる | **MCP は可搬**：同じサーバを Claude.ai コネクタ・ChatGPT・Codex・Cursor・VS Code に。Claude Code 専用機能（hooks 等）に依存しすぎない |
| Pro から Claude Code が外れる（2026-04 に 2% テスト後撤回） | Pro ユーザーが CLI を失う | Claude.ai コネクタ（Free でも可）と Cowork が残る |
| Agent SDK の課金分離が再開する | **当案は影響なし**（当アプリは Agent SDK を使わない・ログインを提供しない） | — |
| 認証なし公開サーバの濫用 | 費用・上流のブロック | §4.4。`build_dataset` は上限と生成レート制限。深刻なら Phase 2 を前倒し |
| Claude.ai の旧ダイアログの組織で "None" が選べない（Issue #402） | 個人には無関係。Team の管理者は DCR を期待 | Phase 2 で OAuth を用意 |
| 分析の誤用（重み・因果の誤読・ハザードの誤解） | 「アプリがそう勧めた」と受け取られる | §5.4 の禁じ手と限界の明文化・提案文のテンプレート（断定しない・出典と年次を必ず）・§11 のシナリオ受け入れテスト |

**セキュリティ**：Phase 1 はユーザーデータを持たない・書き込みツールを持たない（`readOnlyHint` のみ）。
説明文にプロンプトインジェクション的な指示を書かない（審査基準）。**Claude の資格情報・モデルの鍵は一切扱わない**——これが BYOK を避けた本来の目的と一致する。

---

## 8. 「Claude Code を真似る」のは何を

| 真似る価値がある | 真似ない（作らない） |
|---|---|
| **「API を公開し、頭脳は差し替え可能」という構造**（OpenCode の `serve`＝OpenAPI＋SSE をどのクライアントも叩く形。当アプリの §2 と同型） | エージェントループ・権限モデル・セッション・コンテキスト圧縮（Agent SDK が提供するもの＝再実装の価値なし） |
| ツール設計の作法（名前空間・`response_format`・ページング・意味のある識別子・行動を促すエラー文）— Anthropic "Writing tools for agents" | Claude Code 偽装（ヘッダ・プロンプト）、OAuth トークンの読み出し（禁止） |
| スキル（作法を Markdown で）・サブエージェント・hooks の分離 | アプリ内のチャット UI の再実装（MCP Apps で足りる） |
| 高次ツール＋低次ツールの組み合わせ（Hex：ツール 4 つで分析エージェントを委譲、Sentry：自然言語→クエリの「ツール内エージェント」。当アプリでは **§5.3 の 3 本が高次ツール**にあたる） | 全カラムを露出する `api_request` 型の万能ツール（審査で却下される・CLAUDE.md §2 のアンチパターン）・生 SQL（§5.5） |

---

## 9. 決めたこと・決めること

### 9.1 決めたこと（2026-09-01・推奨どおり合意済み）

| # | 論点 | **決定** | 見送った代替 |
|--:|---|---|---|
| 1 | 方式 | **E＋F**：リモート MCP＋Claude Code プラグイン＋Claude.ai/Cowork コネクタ。自前ハーネスは作らない | D：無改変 Claude Code の同梱（規約上は可だが不要） |
| 2 | Phase 1 の認証 | **`none`**（オープンデータ・読み取り専用・既存 API と同じ公開レベル）＋ WAF／ツール別レート制限 | 最初から Supabase OAuth 2.1（個人化が無いうちは摩擦だけ増える） |
| 3 | プラグインの置き場所 | **当リポジトリ直下に `.claude-plugin/marketplace.json`＋`plugins/ai-database-map/`** | 別リポジトリ（マニフェストが増えたら分離） |
| 4 | MCP Apps | **スパイクを経て導入**（MapLibre の CSP／blob worker を Claude Desktop で先に検証）。チャート系から | 出さない |
| 5 | ディレクトリ掲載 | **当面見送り**（Team/Enterprise 組織が要る）。導入リンクと README で配布。プラグインはコミュニティ枠（Console から個人提出可）を検討 | 組織契約して提出 |
| 6 | Gemini チャット | **残す**（非エンジニア・無料利用者向け。ToolSpec を共有するので二重保守にならない） | 段階的に縮小 |

### 9.2 追加で決めたこと（§5・分析グレード。2026-09-01・推奨どおり合意済み）

| # | 論点 | **決定** | 見送った代替 |
|--:|---|---|---|
| 7 | 分析グレードのツール（`list_stations`・`build_dataset`・`get_hazard_summary`）と方法論スキルを追加するか | **やる**——「高度な分析支援」の本体。行データは URL・ツール 3 回で枠を守る（§5.3） | Layer 1 だけで出す（横浜の例が枠的に成立しない） |
| 8 | 生 SQL ツール | **出さない**（§5.5。カタログ経由の `build_dataset`＋ローカル pandas で同等以上） | 公開ビュー限定の SELECT のみを別途設計 |
| 9 | 駅別ハザードの事前計算（パイプライン・全駅） | **やる**——`get_hazard_summary` と `include_hazard` の前提（G3）。`metric_catalog` には入れない（「災害は指標ではない」を維持。**2026-09-03 に再検討し維持で合意**——理由は §10 の「▶ PR-6 実装方針」） | 都度計算（上流負荷・遅延・レート制限と矛盾）／指標として catalog に入れる（再検討の上見送り） |
| 10 | `stations.municipality` 列の追加（N03 空間結合・G1） | **やる**——「横浜市で」を bbox の手作業にしない | bbox／`near` で代替し続ける |

> 覆したくなったら、コードより先にこの表を書き換える（`260828_fix_flood.md` §7 と同じ作法）。

---

## 10. 段取り（PR の切り方・案）

| | 内容 | 依存 |
|---|---|---|
| **PR-1** | `ToolSpec` の切り出し（`src/ai/tools.ts` から純粋定義を分離。AI SDK 側の挙動は不変）＋テスト | — |
| **PR-2** | `/api/mcp`（mcp-handler 2・認証なし・Layer 1 の 8 本＋`catalog://metrics` resource・`readOnlyHint`・サイズ上限）＋ MCP Inspector の CI＋ WAF とツール別レート制限 | PR-1 |
| **PR-3** | Claude Code プラグイン（marketplace.json・plugin.json・`.mcp.json`・知識型スキル 2・コマンド型スキル 2・サブエージェント・hooks）＋ `claude plugin validate --strict` の CI | PR-2 |
| **PR-4** | **G1**：`stations.municipality`（パイプラインで N03 結合）＋ `list_stations` | PR-2 |
| **PR-5** | **`build_dataset`**（melt→pivot・署名 URL・meta.json に意味と出典・上限実測）＋ `scripts/fetch_dataset.py`＋`analyze-csv` スキル | PR-4 |
| **PR-6** | **G3**：駅別ハザードの事前計算パイプライン（既存 `pointHazard` をオフライン実行・版管理）＋ `get_hazard_summary`＋`build_dataset` の `include_hazard` | PR-2（パイプラインは独立に着手可） |
| **PR-7** | **方法論スキル `station-recommendation`**＋`/ai-database-map:recommend`＋シナリオ受け入れテスト（§11） | PR-5・PR-6 |
| **PR-8** | 導入ページ（README／LP：導入リンク・`claude mcp add`・プラン別の注意・枠の注意）＋ `.codex-plugin` | PR-3 |
| **PR-9** | MCP Apps スパイク（`trendChart` を `ui://` に。MapLibre は可否判定まで） | PR-2 |
| **PR-10** | Phase 2：Supabase OAuth 2.1（DCR ON・ES256・同意画面）＋ lazy auth | 保護ツールが生まれたとき |

**PR-2 で使い始められ（Layer 1）、PR-5〜7 が「高度な分析支援」の本体**。PR-6 のパイプラインは重いので早めに走らせる。

> **✅ PR-1 完了（2026-09-01）。** `src/ai/tool-specs.ts` に 9 ツールの純粋定義を分離した。
> `ToolSpec` は AI SDK にも EffectCollector にも依存せず、`run` が
> `{ effects, forLlm }` を**値として返す**（押し込む先は消費側が決める）。`tools.ts` は
> `toolFromSpec` で包むだけの薄い層になり、**説明文・スキーマ・エラー文言は 1 文字も変えていない**。
> 構造化エラー（`{error, hint}`）は例外ではなく `forLlm` として返す整理にし、
> 分離前の per-tool try/catch はアダプタの `errorFallbackJa` に写した（`getMetricsCatalog`
> だけは分離前どおり捕捉しない）。不変条件は `tests/ai-tool-specs.test.ts` が固定——
> Gemini が見る説明・スキーマが Spec と**同一の参照**であること、副産物の順序、
> エラー 3 態（Error／非 Error／捕捉なし）、`origin` の伝搬。

> **✅ PR-2 完了（2026-09-01）。** `/api/mcp` を `mcp-handler@2.1`＋`@modelcontextprotocol/server@2`
> で実装（ステートレス・Redis なし・`maxDuration` 60s）。ツールは `ai/mcp-tools.ts` が
> ToolSpec から生成：snake_case 名（例 `search_stations`）・title 日本語・**説明は Spec の
> 日本語そのまま＋英語 1 文併記**・全ツール `readOnlyHint`・`_meta["anthropic/maxResultSizeChars"]`。
> text＝Gemini と同一の要約 JSON、**structuredContent＝GUI Chat Protocol（パネル＋mapActions）**
> （例：`get_hazard_at_point` → `hazardCard`＋`showPoint`/`setHazardLayers`）。
> カタログは `catalog://metrics` resource としても配信。濫用対策は二層——ルートで IP 全体
> 60/分（429＋`Retry-After`）、ツール別に上流系（警報 10・避難 10・脱出 10・地点 15）/分
> （`isError`＋再試行案内・IP ごとに独立）。実測（MCP Inspector CLI＋curl）——tools/list 9 本・
> 実呼び出し（検索/カタログ/ハザード）・resources read・**2025-06-18 世代の initialize と
> ステートレス tools/list が互換層で通る**（GET は 405）・70 連打で 429。
> 契約は `tests/mcp-tools.test.ts`（8 件）が固定。認証は決定 2 どおり `none`（Phase 1）。
> ⚠ 運用側の残作業：Vercel WAF ルール（Anthropic egress `160.79.104.0/21` 許可）と
> Spend Management はダッシュボード設定（コードでは持てない）。

> **✅ PR-3 完了（2026-09-02）。** Claude Code プラグインを当リポジトリ直下に置いた——
> `/plugin marketplace add kusui26/AI-Database-Map` → `/plugin install ai-database-map@ai-database-map`。
> 構成：`.claude-plugin/marketplace.json`（リポ直下）＋`plugins/ai-database-map/`
> （plugin.json 0.1.0・`.mcp.json`＝remote http（`AIDB_MCP_URL` で差し替え可・既定は本番）・
> 知識型スキル 2（`station-analysis`＋references 3 本・`hazard-reading`）・コマンド型スキル 2
> （`/ai-database-map:station`・`:rank`。拡張は `argument-hint` と `allowed-tools` に限定）・
> サブエージェント `data-analyst`（tools は MCP 9 本に限定）・SessionStart フック 1 文）。
> **PreToolUse の半径検証は見送り**（サーバの単一の真実を殻で複製しない）。
> 検証：`claude plugin validate --strict` がプラグイン・マーケットプレイス・skills・agents の
> 全てで合格（CLI 2.1.251）、CI にも同ステップを追加。`tests/claude-plugin.test.ts`（9 件）が
> マニフェスト・**完全修飾ツール名の実在**（`mcp__plugin_ai-database-map_station-data__*` を
> `MCP_TOOL_CONFIGS` と突き合わせ）・知識型スキルの標準フィールド限定・フック JSON を固定。
> 本番 `/api/mcp` の稼働も確認（tools/list 応答）。`userConfig.api_token` は導入時の入力摩擦を
> 避けるため Phase 2（保護ツールが生まれるとき）に送った（§4.5 の記述から変更）。

> **✅ PR-4 完了（2026-09-02・G1 解消）。** 方式は「サイドカー＋ローダ結合」（`station_routes` と
> 同じ流儀・上流の整形 CSV には触れない・調査どおり将来は上流統合に前方互換）。
> パイプライン：`fetch_admin_boundaries.py`（N03 **2026 年版**・全国 803MB）→
> `build_municipality.py`（9,273 駅 × 125,130 ポリゴンを空間結合。`prefecture` と同じ方法論。
> 政令市は市名＋区名・最近傍フォールバックは同一都道府県内のみ＝**2 駅・最大 442m**・
> 都道府県の全数照合パス）→ `data/derived/station_municipality.csv`（1,425 市区町村・横浜市 137 駅）→
> `load_municipality.py`（temp→UPDATE・**全駅に付かなければ失敗**）。`load_to_supabase.py` の
> フルロードにも同一トランザクションで組み込み、**CSV が無ければロード自体を失敗**させる（hard-fail）。
> DB：migration `20260902120000`（列 2 本＋前方一致 index＋RPC `list_stations`＋`search_stations` に
> municipality 追加）を `supabase db push` で適用し、データも投入済み。
> API/MCP：`/api/stations?municipality=横浜市`（≤2000・50 件の頭切りをしない別枝）と
> MCP/Gemini 共通の **`listStations` ツール**（識別子と位置だけ・§5.3 の入口）。プラグインは
> 0.2.0（agent・スキルに list_stations 導線）。⚠ §5.3 のセレクタのうち operators／routes／bbox／
> near は PR-5（`build_dataset`）で共通化する際に足す（未実装）。

> **✅ PR-5 完了（2026-09-03）。** `build_dataset`＝分析グレードの本体。
> **方式は「保存しない署名 URL」**——Vercel Blob 等のストアを増やさず、URL 自体が「HMAC 署名済みの
> クエリ定義」（`DATASET_URL_SECRET`・base64url(deflateRaw)・**24 時間で 410**）で、GET のたびに
> `/api/dataset` が**ライブの DB から CSV を再生成**する。値が常にアプリ／Layer 1 ツールと一致する
> ため、§11 の「データ整合」を検証項目ではなく**構造で**満たす。
> 列解決は `resolveMetricKey`（rank／散布と同じ解決器）＋カタログのみ（`src/ai/dataset/columns.ts`・
> ファミリ×years 展開・重複排除・値列 ≤60）。CSV は RFC 4180・**値の欠損＝空欄／フラグ欠損＝0**
> （0 非格納の規約どおり。notes と meta.json に明記）・信頼性フラグ列は**自動同伴**（§5.4-4 を形で
> 強制）。meta.json に列の意味・単位・年次・source／license（案 C と同じ「権利表記を落とさない」）。
> grps ≤500・生成 10/分（IP）・`maxDuration` 60s。
> **セレクタ共通化（PR-4 の ⚠ 解消）**：`list_stations` RPC／ToolSpec／REST `/api/stations` に
> operators／routes／routeTypes（述語は rank・散布と同じ `station_matches_filters` を共有）・
> bbox・near・grps。migration `20260903090000` は**本番適用済み**。実測（DB 直）——東急電鉄 98 駅・
> 東海道新幹線 17・新幹線 103・bbox（横浜周辺）21・near（横浜 1km）6・
> 「東海旅客鉄道×東北新幹線」= 0 件（260801 の不変条件を維持）。
> **E2E（本番ビルド＋本番 DB）**：MCP 11 本目（3 番目）・横浜市×8 ファミリ → **137 駅×20 列
> CSV 18KB・URL 352 字**・pandas で読み 横浜#0 の pop_2020_1km が DB 直値と完全一致・
> meta（sources 5 群）・改竄／トークン無し 400・期限切れ 410（単体テスト）・grps＋long・
> 構造化エラー 3 態（排他・未知指標・未知の県）・レート制限 429 実測。
> プラグイン **0.3.0**：**`analyze-csv` スキル新設**（§5.4 の作法の CSV 版——欠損とフラグを黙って
> 使わない・正規化してから合成・重みはユーザーに確認・±20% 敏感度・出典列挙・URL 失効時の一手）＋
> data-analyst／station-analysis に導線＋ `scripts/fetch_dataset.py`（stdlib のみ・再現性 §5.4-8）。
> **設計判断 2 点**：① SDK（@modelcontextprotocol/server@2）の型に `resource_link` が無いため、
> URL は text JSON の `url`／`metaUrl` で返す（structuredContent は従来どおり）。
> ② `buildDataset` は **Gemini（アプリ内）に出さない**（§5.6 どおり・コード実行環境が無い。
> `tests/ai-tool-specs.test.ts` で固定）。`include_hazard` は予定どおり PR-6 で。
> ⚠ 運用：Vercel に **`DATASET_URL_SECRET`**（`openssl rand -hex 32`）を設定する。
> 未設定でも他ツールは無傷で、build_dataset だけが文脈つきエラーで落ちる。

> **▶ PR-6 実装方針（2026-09-03 合意。決定 9「災害を指標にしない」を再検討し維持）。**
>
> 再検討の結論を、ドクトリンでなく**壊れずに済む 3 つの契約**として記録する：
> ①**値の契約**——`station_values` は 1 セル＝`value: real`（数値 1 個）。ハザード応答の
> 安全上の本体は**言葉**（立退き／垂直避難・「白＝安全ではない」・時制・出典・免責）で、
> 数値だけカタログに入れても言葉の置き場に別テーブルが要り、「1 カタログ」にならない。
> ②**消費側の契約**——カタログ駆動のランキング・散布・カタログダイジェスト・詳細タブが
> **自動で拾い**、limitations を出す場所のないランキング UI に「浸水しない駅ランキング」が
> 現れる（`260828_fix_flood.md` で潰した「安全と言う」事故のアプリ本体での再発）。エントリ
> ごとの除外・命名文法（`{接頭辞}_{年}_{半径}`——ハザードには年も半径もない）の例外・
> リゾルバの特例とガードを足し続けるより、最初から別カタログの方がコードが少ない。
> ③**更新の契約**——ハザードマップは自治体が随時更新＝**独立に再計算**でき、
> `computed_at`／`version` を応答に必ず付ける。metric 系スキーマに版の概念はない。
> **ユーザーが欲しい「1 枚の表」は `build_dataset` の `include_hazard` が出口で統合する**
> （`hazard_` 接頭辞・meta.json に limitations と出典を同梱）——**分析面では統合・格納面では分離**。
>
> **形（PR-4 サイドカーと「思想は同じ・形が違う」3 点）**：
> ①ビルダーは Python/geopandas でなく **TS**。既存の地点ドメイン関数 **`pointHazard`**
> （地図 UI・`/api/hazard/point`・AI ツールが通る同一の関数）を全 9,273 駅にオフライン実行する。
> Python 再実装は判定ロジックの二重化で、修正が片方だけに入った日に**アプリの災害タブと
> 事前計算が同じ駅で食い違う**。§11 の受け入れ条件「ライブの `get_hazard_at_point` と
> 完全一致（層化サンプリング）」は、同じコードを走らせるから成立する。
> ②格納は `stations` の列でなく**別テーブル `station_hazard`**（`version`／`computed_at` つき）。
> ③ローダは**独立**（フルロードの hard-fail 同梱にしない——統計の年次更新のたびに重い
> タイルバッチを要求しない）。上流整形（`script/create_dataset_for_AI_Database_Map.ipynb`・
> `station_dataset.csv`・市区町村サイドカー）には**一切触れない**（座標は既存の駅データを読むだけ）。
>
> **市区町村（PR-4）の上流統合**：方向性は合意——空間結合は統計整形（notebook/pipeline）の
> 世界の仕事で、いずれ上流に吸収してサイドカーを廃止する。ただしタイミングは PR-6 でなく
> **次のデータセット刷新**（年度更新・指標追加）のついで——今やると 806 列の再生成と全量検証
> だけが増える（得る機能ゼロ）。それまでは「サイドカー＋ローダ hard-fail」が正。統合方向も
> `.ipynb` に足すのではなく **notebook を `pipeline/` スクリプト群へ寄せる**既定方針に従う。

> **✅ PR-6 完了（2026-09-03・G3 解消）。** 上の方針どおりに実装した。
> **パイプライン**：`hazardPointAt` を追加分離した `assembleHazardPoint`（組み立て 1 か所・
> API 不変）を、`pipeline/build_station_hazard.ts`（tsx）が全 9,273 駅にオフライン実行
> （メッシュ＋公式タイル・**浸水ナビなし**・1 次メッシュ順で LRU が効く・並列 2・再開可能）。
> **実測 48 分（3.2 駅/秒）**で完走。射影は `domain/hazard/summary.ts` → 形は
> `shared/hazard-summary.ts`（version 1・DB/jsonl/応答/CSV の単一の真実）。
> **実バグを 1 件発見・修正**：広島湾岸の高潮タイルだけ**パレット PNG（カラータイプ 3）**で
> 配信されており、自前デコーダが読めず 72 駅が失敗（＝本番 `/api/hazard/point` でも同じ駅で
> 1 レイヤ欠けていた）。`shared/png.ts` に PLTE＋tRNS 対応を追加（fail-fast は維持・
> `tests/png-palette.test.ts`）。修正後、大竹#0 は**高潮浸水域内**と正しく判定される。
> **DB**：migration `20260903150000`（`station_hazard`・RPC `station_hazard_summaries` ≤500）
> 適用済み・独立ローダ `load_station_hazard.py`（**全駅揃わなければ失敗**・フルロード非同梱）で
> **9,273 行投入済み**。分布：none 2,570／caution 657／warning 2,416／danger 1,686／
> **critical 1,944**。避難の目安：立退き 3,630・垂直 3,067・その場 1,611・判定不能 965。
> uncovered（図なし）：内水 6,046・高潮 5,160・津波 3,022——**整備状況の偏りが数字で見える**
> （「none＝安全」と読ませない設計が全国規模で効く）。
> **§11 データ整合（実測）**：系統抽出 48 駅で、ライブ（浸水ナビ込み）との**厳密フィールド
> （レベル・避難・nearby/uncovered・標高）完全一致 48/48**（ナビ込み比較 36 駅・上流不安定で
> 区分値のみ比較 12 駅）。`worstJa` の言い方差 2 駅＝ナビの実測 m 表記（想定どおり・
> レベルは不変）。検証は `pipeline/check_station_hazard.ts`（再実行可能）。
> **ツール**：`get_hazard_summary`（12 本目・grps ≤500・limitations と出典を必ず同梱・
> **Gemini には出さない** §5.6）＋ `build_dataset` の **`includeHazard`**（`hazard_` 18 列＝
> 総合/5 グループのレベル・避難・標高・nearby/uncovered フラグ×5。トークンに hazard フラグ・
> 旧トークン互換）。プラグイン **0.4.0**（analyze-csv／station-analysis／data-analyst に導線）。

---

## 11. 検証計画

- **契約**：MCP Inspector 2.4（Node ≥22.19）で `tools/list`／`tools/call` を全ツール、protocol era を legacy／2026-07-28 の両方で。Zod の入力を境界値で
- **Claude Code**：`claude mcp add` → `/mcp` → `claude plugin details`（Context cost）→ `/usage`（MCP 寄与率）。**Pro 相当の枠で「横浜の例」1 往復が収まるか**を実測
- **Claude.ai**：カスタムコネクタ（Authentication=None）で追加 → web／Desktop／mobile で同じ答え。**別ホストへの 3xx が無い**、`.well-known`、egress からの到達
- **Cowork**：プラグインを git URL で入れ、hooks／サブエージェント／Excel 出力
- **言うことを割らない**：同じ質問を Gemini チャットと Claude 経由で投げ、`structuredContent` が GUI Chat Protocol の型に一致し、水害の言い回し（§7.5）が崩れない（既存 eval の駅詳細・災害カテゴリを流用）
- **データ整合**：`build_dataset` の CSV の値が Layer 1 の単発ツール・アプリ UI と一致（抜き取り）。`get_hazard_summary` の事前計算値が `get_hazard_at_point` のライブ値と一致（全国から層化サンプリングで N 駅・完全一致すべき——同じ関数を通すため）
- **シナリオ受け入れテスト（§5 の本丸）**：「横浜市で中古マンション、おすすめの駅は？」を golden シナリオとして Claude Code＋プラグインで実走し、チェックリストで判定：
  ①重み付けの**前に**好みを聞いたか ②カタログのキーだけ使ったか ③単位・半径・年次を明示したか ④正規化してから合成したか
  ⑤ハザードを線形加点していないか・「安全」と言っていないか ⑥敏感度に触れたか ⑦出典と限界（地価は代理・代表点 1 点）を述べたか
  ⑧ツール呼び出しが「少数回＋ローカル分析」になっているか。**5 回走らせて 5 回通る**までスキルを調整（スキルの evals として保存）
- **濫用**：WAF ルールの発火、ツール別の 429、`build_dataset` の上限と 429、上流 429 時の正直な応答
- **MCP Apps**：Claude Desktop で `trendChart` の inline 描画、MapLibre のタイル取得と blob worker の可否、150,000 文字超時のフォールバック

---

## 12. やらないこと

- **自前ハーネスでユーザーの Claude OAuth を使う**（§2・禁止・遮断実績）。`claude setup-token` や `~/.claude` の資格情報を読み出さない
- **Claude Code を偽装する**（ヘッダ・プロンプト）。製品名に "Claude Code" を使わない
- **BYOK**（本件の前提）。**当アプリが Anthropic の API 費を払う**（C 案）
- **書き込み系ツール**を Phase 1 で出す。**万能クエリツール**（生カラム露出）・**生 SQL**（§5.5）を出さない
- **サーバ側の重み付き「おすすめスコア」API**（好みはエージェントとユーザーの対話で決める。固定レシピはアプリ機能として別途・plan_house_hunting）
- **リアルタイム警報（「いま」）の一括バッチ**（上流負荷と鮮度。事前計算は静的な想定区域だけ）
- **ハザードを `metric_catalog` に混ぜる**（「災害は指標ではない」・`260828_fix_flood.md` §4.1 の決定を維持）
- **Claude 専用の作り**にする（MCP の可搬性を捨てない）
- **Gemini チャットの廃止**（非エンジニア・無料利用者の入口）

---

## 13. 参考（一次情報・2026-08-28 閲覧）

**規約・認証**
- Claude Code Legal and compliance — https://code.claude.com/docs/en/legal-and-compliance
- Claude Code Authentication（`setup-token`）— https://code.claude.com/docs/en/authentication
- Agent SDK overview（第三者の claude.ai ログイン禁止）— https://code.claude.com/docs/en/agent-sdk/overview
- Consumer Terms — https://www.anthropic.com/legal/consumer-terms ／ Usage Policy — https://www.anthropic.com/legal/aup
- Use the Claude Agent SDK with your Claude plan（6/15 停止告知）— https://support.claude.com/en/articles/15036540
- OpenCode "anthropic legal requests"（PR #18186）— https://github.com/anomalyco/opencode/pull/18186 ／ 現行 docs — https://opencode.ai/docs/providers/
- Roo Code Issue #10645 — https://github.com/RooCodeInc/Roo-Code/issues/10645
- 報道：VentureBeat（2026-01, 04, 05）・The Register（2026-02-20, 04-06）・GIGAZINE（2026-02-20）

**Claude 側の面**
- Custom connectors（プラン・追加方法）— https://support.claude.com/en/articles/11175166
- Building connectors（認証・制限・審査・提出・troubleshooting）— https://claude.com/docs/connectors/building/
- Connector 認証方式一覧 — https://claude.com/docs/connectors/building/authentication ／ lazy auth — https://claude.com/docs/connectors/building/lazy-authentication
- MCP Apps（Claude）— https://claude.com/blog/interactive-tools-in-claude ／ Getting started — https://claude.com/docs/connectors/building/mcp-apps/getting-started
- Cowork — https://claude.com/docs/cowork/overview ／ プラグイン — https://claude.com/docs/cowork/guide/plugins ／ Use plugins in Claude — https://support.claude.com/en/articles/13837440
- Claude Code plugins / marketplaces / skills / mcp / hooks — https://code.claude.com/docs/en/{plugins, plugin-marketplaces, discover-plugins, skills, mcp, hooks}
- Agent Skills 仕様 — https://agentskills.io/specification ／ best practices — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- 公式プラグイン例：knowledge-work-plugins/data — https://github.com/anthropics/knowledge-work-plugins/tree/main/data ／ claude-plugins-official — https://github.com/anthropics/claude-plugins-official
- Desktop Extensions（.mcpb）— https://claude.com/docs/connectors/building/mcpb
- Writing tools for agents — https://www.anthropic.com/engineering/writing-tools-for-agents

**MCP・実装**
- MCP 仕様 2026-07-28 changelog — https://modelcontextprotocol.io/specification/2026-07-28/changelog ／ Claude のロールアウト — https://claude.com/blog/bringing-mcp-2026-07-28-to-claude
- TypeScript SDK v2 移行 — https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html
- mcp-handler 2.x — https://github.com/vercel/mcp-handler ／ changelog — https://vercel.com/changelog/latest-mcp-spec-now-supported-in-mcp-handler
- MCP Apps SDK — https://github.com/modelcontextprotocol/ext-apps ／ SEP-1865 — https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- Supabase Auth OAuth 2.1 server — https://supabase.com/docs/guides/auth/oauth-server/getting-started ／ MCP — https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication ／ CIMD 未対応 — https://github.com/orgs/supabase/discussions/41695
- Vercel WAF rate limiting — https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting ／ Fluid compute — https://vercel.com/docs/fluid-compute
- AI SDK v6 `tool()` — https://ai-sdk.dev/v6/docs/reference/ai-sdk-core/tool ／ `@ai-sdk/mcp` — https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools
- MCP Inspector — https://modelcontextprotocol.io/docs/tools/inspector

**先行事例**
- PostHog ai-plugin（1 リポジトリで多ホスト）— https://github.com/PostHog/ai-plugin
- Hex MCP／Claude コネクタ（高次ツール＋MCP Apps）— https://learn.hex.tech/docs/api-integrations/mcp-server
- Supabase MCP（`read_only`・`features` スコープ）— https://supabase.com/docs/guides/getting-started/mcp ／ Sentry MCP — https://github.com/getsentry/sentry-mcp
- 国土交通省 地理空間 MCP Server（α・2026-02-26）— https://www.mlit.go.jp/tochi_fudousan_kensetsugyo/tochi_fudousan_kensetsugyo_fr17_000001_00047.html
- OpenAI "Sign in with ChatGPT"（ID 連携のみ）— https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt ／ Codex plugins — https://developers.openai.com/codex/plugins
- Linux Foundation AAIF（MCP 寄贈）— https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
