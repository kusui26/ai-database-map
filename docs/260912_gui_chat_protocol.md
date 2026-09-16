# コーディングエージェント × AI Database Map — GUI Chat Protocol で「AI ネイティブな分析ツール」に仕上げる（実装・改善プラン）

作成：2026-09-12。前身は [`260828_research_claude_auth.md`](./260828_research_claude_auth.md)（§10 の梯子 PR-1〜PR-9b＝#113〜#125 まで完走）。
本書はその**更新版**——MCP Apps（チャット内 iframe）の却下と、GUI Chat Protocol（型つきデータ → 登録済みビューア）の採用を反映した「次の梯子」を定める。
前身の §1〜§9 のうち今も有効な結論は §1.1 に要約し、規約・認証・分析グレードのツール設計の詳細は前身を参照する（重複して書かない）。

---

## 0. サマリ（結論先出し）

**問い**

1. MCP Apps（Claude.ai のチャット内 iframe に地図・パネルを描く方式・PR-9/9b）は**使いにくい**ので却下する（iframe を使わない MCP Apps の可能性は残す）。
2. **プラグイン＋スキル**の方向で、Claude Code のような**コーディングエージェント**と当アプリを連携し、データ分析支援を実装・改善したい。
3. プロのソフトウェアエンジニアからの助言：MulmoChat / MulmoClaude / MulmoTerminal は中島聡氏提案の **GUI Chat Protocol** で MCP と GUI を連携している。
   「MCP App＝MCP が表示すべき HTML を返し Chat アプリが iframe で表示」「GUI Chat Protocol＝MCP が表示すべき**型つきデータ**を返し、Chat アプリが型に**登録された viewer** で表示（web に限らない）」。実装面・配布・再利用・柔軟性で比較したい。母艦（MulmoChat/Claude）があるのは良い。「Claude Code + GUI で AI ネイティブなツールを作って配布しやすい」——この面でアピールすると良い。

**答え（3 行）**

1. **GUI の契約を「HTML を返す」から「型つきデータを返す」に戻す。** 当アプリは設計当初から **GUI Chat Protocol (Map Edition)**（Zod のパネル 10 型＋地図操作 7 型・`src/shared/protocol.ts`）を持ち、MCP の `structuredContent` にも載せている。足りないのは「その型を描く**ビューアが、ユーザーの母艦に登録されている**こと」だけで、これは MCP Apps の iframe より小さく、可搬で、テストしやすい。
2. **母艦＝MulmoTerminal / MulmoClaude（GUI Chat Protocol ホスト）を採る。** どちらも**無改変の Claude Code／Codex** を動かし、その**セッションに GUI ツール（`presentChart`・`presentForm`・`presentHtml`…）を MCP で差し込む**構造なので、当アプリのリモート MCP（データ）と母艦のプレゼンタ（描画）は**同じ会話の中で LLM が合成できる**。段階化する——**T1：母艦のプレゼンタ合成**（当アプリ側はデータを「プレゼンタ対応」にするだけ・今日から動く）→ **T2：地図ビューアを GUI Chat Protocol プラグイン（npm）として届ける**（型つきデータ → 当アプリ製 viewer）。
3. **役割分担は不変**：データと意味＝サーバ（リモート MCP・カタログ）／方法論と禁じ手＝スキル／判断と対話＝エージェント（ユーザーの Claude/Codex）。GUI は 4 層目「**描画語彙＝母艦のプレゼンタ＋当アプリのビューア**」で、**ドメイン・プロトコル・既存 API・Gemini チャットは無改変**。

**段階（何がどこで見えるか）**

| 段 | 何を足すか | Claude Code 単体 | MulmoTerminal / MulmoClaude | claude.ai |
|---|---|---|---|---|
| **T0**（現状） | なし | テキスト・Markdown 表 | 同左（ターミナル） | テキスト |
| **T1** プレゼンタ合成 | サーバ：`present: "echarts"`（パネル→ECharts option）・`render_map`（地図レポート HTML・署名 URL）／スキル：母艦検出と作法 | Markdown＋ファイル（HTML はブラウザで開く） | **Canvas に チャート・フォーム・地図・文書**（母艦の標準ツール） | テキスト |
| **T2** 自前ビューア | `@…/gui-chat-plugin`（1 ツール・action 判別・Vue View＝共通レンダラ＋MapLibre） | — | **型つきデータをそのまま地図＋パネルで描く** | — |
| T1′ Artifacts（任意） | スキル `report` | **claude.ai 上の HTML レポート**（Pro/Max 可・タイル地図は不可） | — | — |

**決定の要点（§8 に表）**：決定 4（MCP Apps 導入）を**覆して却下**、決定 1〜3・5〜10 は維持。新規の決定 11〜19（撤収の範囲／GUI 契約＝GCP／T1 先行／地図の T1 実装＝Leaflet 同梱の `<img>` タイル／T2 プラグインと配布先／スキルの母艦対応／MulmoClaude MCP カタログ掲載 PR／Artifacts／npm 名）は **2026-09-13 に推奨どおり合意済み**——以後はこの表がコードより先に来る。

---

## 1. 前回からの変化（何が終わり、何を覆すか）

### 1.1 到達点（2026-09-03 時点・すべて `main` にマージ・本番反映済み）

| 層 | 実体 | 状態 |
|---|---|---|
| データと意味 | リモート MCP `/api/mcp`（mcp-handler 2・認証なし・読み取り専用・IP 60/分＋ツール別）——**13 ツール**（Layer 1 の 8 本＋分析グレード `list_stations` / `build_dataset` / `get_hazard_summary`＋`get_metrics_catalog`＋Spec 外 `map_probe`）。`structuredContent`＝Map Edition（panels＋mapActions）＋`result`（LLM 向け要約） | 稼働（tools/list 13 本・health 200 を 2026-09-06 に確認） |
| 方法論 | Claude Code プラグイン 0.7.0：`station-analysis`（分析の型 8 段）＋用途レシピ（住宅 `/recommend`・輸送 `/demand`・出店 `/market`）＋`analyze-csv`・`hazard-reading`＋`data-analyst` サブエージェント＋hooks。Codex 用 `.codex-plugin` | golden 受け入れ 住宅 5/5・輸送 3/3・出店 3/3 |
| 導入 | `/ai` 導入ページ・README・claude.ai コネクタ事前入力リンク・Cowork | 公開 |
| **UI（MCP Apps）** | `ui://ai-database-map/panels.html`（15.9KB・依存ゼロ・手書き SVG）＋`map-panels.html`（約 1.16MB・MapLibre 同梱）＋`map_probe` | claude.ai 実機で描画確認済み → **本書で却下** |

### 1.2 MCP Apps（iframe）を却下する理由と、残すもの

| 却下の理由 | 中身 |
|---|---|
| **UX** | チャット内の小さな iframe に地図を押し込む体験が悪い（スクロール競合・全画面は best effort・複数結果の切替不可）。分析の途中で「見比べる」用途に向かない |
| **描けるホストが 1 つ** | Claude.ai／Desktop だけが描く。**Claude Code・Codex・母艦はテキストにフォールバック**——本命のコーディングエージェント側で無意味 |
| **運用の罠** | ホストが「ツール→UI リソース」対応を**コネクタ単位でキャッシュ**（前回 ⚠）。`_meta.ui` を変える度に「コネクタ削除→再追加」を利用者に強いる |
| **大きさと CSP** | 地図版は 1.16MB の HTML を毎回 resources/read で配る。接続先は `_meta.ui.csp` に列挙（3 オリジン）——仕様上は可だが、ホスト実装依存が強い |
| **契約の向き** | 「HTML を返す」＝**描画をサーバが握る**。CLAUDE.md §2「意味はサーバ・UI は薄い層」の思想には合うが、**描画までサーバ**は過剰で、母艦が持つ描画語彙（チャート・フォーム・表）を再発明することになる |

**残すもの**（撤収後も価値がある部品）

- **手書き SVG のパネル・レンダラ**（`panel-app.ts` の `VIEWER_JS`：10 パネル型・XSS 安全・依存ゼロ）——T2 ビューアの中身になる。ただし現状は**文字列テンプレート内の JS**なので、**TS モジュールに切り出す**（PR-11）
- **mapActions の描画意味論**（`map-panel-app.ts`：showPoint／highlightPoints（緑番号）／flyTo+selectStation（半径円）／setHazardLayers（base→overlay・地形×0.7・キキクル timesUrl 差込）／highlightStations は座標なしで描かない／clearOverlays）——T1 の地図レポートと T2 ビューアが**同じ規則**で描く
- **ハザード定義と接続先の「カタログから算出」**（手書き禁止）——T1/T2 のタイル URL・出典・CSP 宣言に流用
- **レンダリングテスト**（protocol にパネル型を足すと描き忘れで落ちる網羅テスト・Playwright 実レンダ）——ビューア・モジュールのテストとして移植

**捨てるもの**：ツールの `_meta.ui.resourceUri`・`ui://` リソース 3 本・`map_probe`・ext-apps ハンドシェイク（`ui/initialize`…）・`MCP_APP_MIME_TYPE`。

**「iframe を使わない MCP Apps」の余地**：ext-apps 仕様（2026-01-26・SEP-1865）の UI は `text/html;profile=mcp-app` の**HTML のみ**で、型つきデータをホスト部品で描く契約は無い。MCP 側の標準に「型つき UI」が入ったら再考する。当面は追わない（§11）。

### 1.3 助言の受け止め（当プロジェクトの原則との一致）

| 助言 | 受け止め |
|---|---|
| vibe coding で作ってもセキュリティの問題で外部サーバに公開しづらい | 当アプリは**既に公開済み**で、公開面は「オープンデータ・読み取り専用・認証なし・レート制限」に限定してある（前身 §4.4）。母艦経路は**母艦がローカル**（localhost）で動くので、配布物（プラグイン・スキル・ビューア）に**サーバの資格情報は一切要らない**。分析の成果物（CSV・スクリプト・レポート）は**ユーザーのワークスペースに残る**——MulmoClaude の第 4 の約束「蓄積はユーザーのもの」と同じ向き |
| token 費用の問題でユーザーの AI を使いたい | 決定 1 のまま（推論はユーザーのサブスク・当アプリは鍵に触れない） |
| AI ネイティブ（AI が操作する）アプリは cc／codex ベースが楽 | 自前ハーネスは規約で禁止・遮断実績（前身 §2）。**母艦＝無改変 Claude Code／Codex を動かすもの**を使う。MulmoTerminal は対話 CLI を PTY で、MulmoClaude は Agent SDK で動かす（§7 のリスク参照） |
| Claude Code + GUI で AI ネイティブなツールを作って配布しやすい——公式含めそういうツールが無いならアピールを | 当アプリを**その実例**として位置づける：「意味を持つ共通 API（MCP）＋作法（スキル）＋型つき GUI（GUI Chat Protocol）」の 3 点セットを 1 リポジトリから配布する形を README/LP で前面に出し、母艦のカタログにも載せる（決定 17） |

### 1.4 用語：「GUI Chat Protocol」が 2 つある

- **Map Edition**：当アプリが 2026-07 に設計した応答契約（`src/shared/protocol.ts`：`Panel` 10 型・`MapAction` 7 型・`MapResponse`）。UI（クリック）と Gemini（会話）と MCP が同じ型を produce/consume する
- **GCP**：receptron の `gui-chat-protocol`（npm **2.0.0**・2026-08-03）。ツール結果 `ToolResult` の `data` に**型つきペイロード**を載せ、ホストが**登録済み viewer**で描く契約と、プラグインの実行時 API

以後、前者を **Map Edition**、後者を **GCP** と書く。両者は「型つきデータで UI を駆動する」という同じ思想で、**Map Edition のパネル配列は GCP の `data` にそのまま載る**（§2.5 の対応表）。

---

## 2. GUI Chat Protocol（GCP）— 一次情報から（2026-09-12 閲覧）

### 2.1 中核：`ToolResult` と「`data` が描画を決める」

```ts
// gui-chat-protocol 2.0.0 src/types.ts（要点）
interface ToolResult<T = unknown, J = unknown> {
  message: string;        // LLM に返る実行結果（必須）
  data?: T;               // ★ viewer 用の型つきペイロード。LLM には見えない。設定＝「カードを描け」
  jsonData?: J;           // LLM が後続ターンで読み返す構造化コピー（描画とは無関係）
  instructions?: string;  // LLM への後続指示（「フォームの送信を待て」など）
  title?: string; action?: string; updating?: boolean; viewState?: Record<string, unknown>;
}
```

| 組み合わせ | 挙動 | 当アプリでの対応 |
|---|---|---|
| `data` のみ | カード描画・LLM は `message` だけ | 地図・パネル（数値は LLM に別途 `message`/`jsonData` で） |
| どちらも無し | 描画なし（narrate-only） | `list_stations`・`build_dataset` の応答（今の text と同じ） |
| `data`＋`jsonData` | 描画し、LLM も同じ形を読む | パネルの要約を `jsonData`（現 `result`）に |

**LLM から見ると普通の function calling**（"not a new architecture"）——ツール定義は OpenAI 互換 JSON Schema、結果はテキスト。UI が `data.type` で viewer を選ぶだけ。**モデル非依存**（Claude/GPT/Gemini/オープンウェイト）。双方向：`presentForm` の送信は**次のユーザーターンのテキスト**として LLM に届く。

### 2.2 プラグインの形：`ToolPluginCore` と factory（`definePlugin`）

- 旧形：`{ toolDefinition, execute(context, args) → ToolResult, generatingMessage, isEnabled, viewComponent?, previewComponent? }`。Vue（`gui-chat-protocol/vue`）と React（`/react`）のアダプタ
- 新形（0.3+・推奨）：`definePlugin((runtime) => ({ TOOL_DEFINITION, async <name>(args: unknown) {…} }))`。`runtime` は**プラグイン単位にスコープ**された `pubsub`・`files.{data,config,artifacts}`・`log`・`fetch/fetchJson(parse 必須)`・`locale`。ブラウザ側は `useRuntime()`（`dispatch`・`subscribe`・`openUrl`）。fs/path/console の直接 import は ESLint preset で禁止
- 配布：npm パッケージ（`dist/index.js`＝サーバ半分・`dist/vue.js`＝ブラウザ半分・`style.css`）。例 `@gui-chat-plugin/weather` 2.0.0（peer：`vue ^3.5`・`gui-chat-protocol ^2.0.0`）。雛形 `npx create-mulmoclaude-plugin <name>`（`--dev-plugin` で母艦にホットロード）

### 2.3 ホストの配線：母艦はどうやって Claude Code／Codex に GUI を差し込むか

MulmoTerminal の `docs/gui-protocol-spike.md`（Phase III・実機検証済み）とソースから：

```
 対話 claude / codex（PTY・無改変）
   │ MCP ツール呼び出し  presentChart({ document })
   ▼
 母艦の in-process GUI MCP（Streamable HTTP・/api/mcp/<group>/<sessionId>）
   │ POST /api/plugin/<tool>  ── プラグインの execute → { data, message, instructions }
   ▼
 toolResult を sessionId で保存・publish（data があるときだけ）
   ▼
 Canvas（Vue・Shadow DOM の PluginFrame）── getPlugin(toolName).viewComponent が data を描く
   │ ユーザーがフォーム送信 → sendTextMessage → PTY に「次のユーザーターン」として入力
```

- **ツール名**は MCP サーバ id が前置される：MulmoTerminal のワークスペース・セルは `mcp__mt__presentChart`、プロジェクト・ディレクトリのセルは `mcp__mulmoterminal-render__presentChart`（**Canvas スイッチ**が `claude mcp add -s local` で `.claude.json` に登録・グループ `render/data/media/external`）。MulmoClaude は `mcp__mulmoclaude__presentChart`。Codex は `mcp-<id>-presentChart`
- **外部 MCP（当アプリ）**は別サーバ id で並列に載る：MulmoTerminal は Settings → `userMcpServers`（`{ id, url }`・**ワークスペース**で起動した Claude セッションに合流）、または各ディレクトリの `.mcp.json`／`claude mcp add`。MulmoClaude は Settings → **MCP Servers タブ**（HTTP は「every mode で動く」）＝`<workspace>/config/mcp.json`（Claude CLI 互換形式）。**外部 MCP の結果はテキスト扱い**——`structuredContent` を viewer に回す仕組みは無い（§2.5 の含意）
- **GUI プラグインの読込**：MulmoTerminal は同梱の `plugins/plugins.json`（markdown・form・generate-image・chart・collection・html・google・mulmoscript・shapescript）で固定＝**利用者が第三者プラグインを足す経路は今は無い**（→ T2 は upstream PR）。MulmoClaude は **runtime plugin**（`~/mulmoclaude/plugins/<pkg>.tgz`＋`plugins.json` の手動 ledger・`--dev-plugin`・install CLI は未出荷）
- **権限**：MulmoTerminal は terminal-native（`--allowedTools` で描画系を自動許可・課金系は残す）。Codex はサーバ単位で自動承認
- **Codex**：MulmoTerminal の codex セルも同じ GUI ツールを受け取る（`-c mcp_servers.<id>.url=`）
- **Claude Code のプラグイン／スキル**：MulmoTerminal は対話 CLI なので当アプリのプラグイン（ユーザースコープ）がそのまま効く。MulmoClaude は Agent SDK 起動だが `--strict-mcp-config` を撤廃して**ユーザーのコネクタを継承**する（docs/claude-ai-connector-setup.md）——プラグインのスキルまで載るかは**要実機確認**（載らなければ `<workspace>/.claude/skills/` にコピー＝MulmoClaude の作法）

### 2.4 母艦のプレゼンタ（描画語彙）——LLM が合成に使えるもの

| ツール | 入力 | 描画 | 当アプリでの使い道 | 制約 |
|---|---|---|---|---|
| `presentDocument` | Markdown（画像プレースホルダ可） | 文書 | 結論・表・限界・出典 | — |
| `presentChart` | `document.charts[].option`＝**ECharts の option をそのまま**（関数不可＝JSON のみ） | ECharts（線・棒・散布・ヒートマップ…） | 推移・半径別・散布・ランキング | option は LLM が組む → **サーバが option を同梱**すれば転記ミスが無い（T1） |
| `presentForm` | fields（text/textarea/radio/dropdown/checkbox/date/time/number・validation） | フォーム | **要件の聞き取り**（予算・通勤先・災害許容度） | 回答は次ターンのテキスト（JSON） |
| `presentSpreadsheet`（MulmoClaude） | sheets[].data（セル＋数式） | 表計算 | 少数駅の比較表 | 大きな表は LLM 経由で重い→CSV はローカル |
| `presentHtml` | `html`（自己完結）or `path`（既存ファイル） | **sandbox iframe**：`sandbox allow-scripts; default-src 'none'; script/style 'unsafe-inline'＋CDN 許可（jsdelivr/unpkg/cdnjs/Google Fonts/plot.ly）; connect-src 'none'`。MulmoTerminal は `img-src … https:`（外部画像可）。MulmoClaude は既定で外部 img 不可・`config/csp.json` で追加可 | **地図レポート**（§4.3） | **fetch/XHR 不可＝MapLibre（タイルを XHR）は動かない**。`<img>` タイル（Leaflet 方式）は MulmoTerminal で可 |
| `presentCollection`／`manageCollection` | スキーマ駆動の記録 | 表・カンバン・カレンダー | 分析結果の保存（将来） | data グループ |
| `generateImage`・`presentMulmoScript`・`presentShapeScript` | — | 画像・動画/スライド・3D | 対象外 | — |

### 2.5 Map Edition ↔ GCP の対応表（設計の要）

| Map Edition（当アプリ） | GCP | 備考 |
|---|---|---|
| `Panel[]`（`type` 判別の 10 型） | `ToolResult.data`（viewer が `type` で描き分け） | **配列ごと `data` に載せる**。viewer は既存レンダラ |
| `MapAction[]`（7 型） | `data.mapActions`（viewer が解釈） | 同じ意味論（§1.2） |
| `placement: inline / drawer / modal`・`size` | `previewComponent`（サイドバー）／`viewComponent`（キャンバス） | inline＝preview、drawer/modal＝view |
| `forLlm`（要約 JSON・現 `structuredContent.result`） | `message`＋`jsonData` | LLM の見える面は今と同じ |
| `limitationsJa`・`disclaimerJa`・`notes` | `instructions`（LLM への後続指示）にも写す | 「安全と言わない」規範をホスト越しに保つ |
| `structuredContent`（MCP） | 母艦の**外部 MCP 経路では描かれない** | だから T1 は「プレゼンタ合成」、T2 は「当アプリ製プラグイン」が要る |

### 2.6 「AI ネイティブ業務アプリの型」との同型性

GCP リポジトリの `spec/AI_NATIVE_BUSINESS_APP_ARCHITECTURE.md` の反転図——「UI が特権の SaaS」→「API が製品で、構造化 UI と LLM が対等に叩く」——は **CLAUDE.md §2 の図そのもの**である。同文書の要点：

- ドメイン・プラグインは**狭く**保ち、描画は**共有のプレゼンタ**（`presentChart` 等）に任せる。「a business application does not ship its own chart library; it ships chart-ready data, and the LLM binds the two at runtime」
- LLM は単一プラグインの操作者ではなく**プラグイン横断の合成演算子**（"composition operator"）
- 専用 viewer が要るのは「Markdown では足りず固有の UI が要るとき（chart／spreadsheet／**map**／canvas）」（MulmoClaude `docs/extension-mechanisms.md` §6.3）

→ **T1（合成）を主経路、T2（自前 viewer）は地図に限る**根拠。当アプリの「意味はサーバ・描画は薄い層」に、「描画語彙は母艦」が加わる。

---

## 3. 比較：MCP Apps／GUI Chat Protocol／テキスト＋Artifacts

| 観点 | **MCP Apps（iframe・却下）** | **GUI Chat Protocol（採用）** | テキスト＋Claude Code Artifacts |
|---|---|---|---|
| 契約 | ツールが `ui://` の **HTML** を返す。ホストが iframe。ハンドシェイク（`ui/initialize`…）・CSP は `_meta.ui.csp` | ツール結果 `data` に**型つきデータ**。ホストが型に登録された **viewer**（Vue/React 部品）で描く | 結果はテキスト。Claude Code が HTML を書いて claude.ai に**公開ページ**として載せる |
| 実装（当アプリ側） | 単一 HTML に描画を全部同梱（1.16MB・依存ゼロ制約・自前 JSON-RPC）。**描画をサーバが持つ** | **T1**：サーバは「プレゼンタ対応データ」（ECharts option・地図 HTML）を返すだけ。**T2**：npm パッケージ 1 本（Vue View＋MapLibre＋共通レンダラ）。**描画は母艦かプラグイン** | スキル 1 枚＋レポート雛形。地図タイルは不可（外部画像 NG） |
| 配布 | MCP サーバに同梱（配布物なし）。ホストのキャッシュ問題 | T1：**追加配布なし**（MCP URL＋スキルは既存プラグイン）。T2：npm＋母艦への登録（MulmoClaude は ledger 手動／MulmoTerminal は同梱 PR） | 配布なし |
| 再利用 | Claude.ai/Desktop 専用。他ホストは非対応 | **母艦のプレゼンタは全プラグイン共通**（改善が横展開）。当アプリの viewer も**任意の GCP ホスト**（MulmoChat／MulmoClaude／MulmoTerminal／将来のホスト）で使える。React 版も同じ core から | claude.ai 依存 |
| 柔軟性 | 全画面は best effort。iframe 間・チャット間の連携なし | **双方向**（フォーム→次ターン）・複数結果の履歴・`updating`・`viewState`・pubsub（他プラグインとの連動・collection 保存） | 静的ページ（DB/コネクタ呼び出しの capability あり） |
| 到達面 | claude.ai web/Desktop | **Claude Code・Codex（母艦経由）**・MulmoClaude・MulmoChat。web に限らない（母艦がネイティブ UI でも同じ契約） | Claude Code（Pro/Max/Team/Ent） |
| セキュリティ | ホストの sandbox iframe。当アプリの HTML を毎回配布 | 母艦は**ローカル**。当アプリの公開面は変わらない（読み取り専用 MCP）。プラグインは母艦の ESLint preset／`files` スコープで隔離 | claude.ai ホスティング・厳格 CSP |
| 規約 | 変化なし | **変化なし**（母艦は無改変 Claude Code／Codex を本人が動かす） | 変化なし |
| 保守 | ext-apps の版追随・ホスト実装差・キャッシュ | GCP 2.0 の契約（小さい・一読できる）・母艦の release 追随 | 少 |
| 当アプリの実績 | PR-9/9b で実機 OK（→ UX で却下） | Map Edition が**既に GCP 相当**。viewer 部品あり | Artifact ツールで公開可（本セッションでも利用可） |

**判定**：GUI 契約は GCP（型つきデータ）へ。「描画語彙は母艦」に寄せる T1 を先に出し、地図だけ T2 で当アプリの viewer を配る。Artifacts は「母艦を持たない Claude Code 利用者」向けの補助（T1′）。

**「地図をどこで描けるか」**（地図が本プロジェクトの固有価値なので別表にする）

| 面 | 描けるか | 方式 |
|---|---|---|
| Claude Code CLI 単体 | △ | `render_map` の HTML をローカルに保存し `open`（ブラウザ） |
| Claude Code Artifacts | ✗（タイル） | 外部画像が CSP で不可。SVG の簡易図のみ |
| claude.ai（MCP Apps） | ○ だが却下 | — |
| MulmoTerminal `presentHtml` | **○** | `img-src https:` → **`<img>` タイル（Leaflet）**。MapLibre は `connect-src 'none'` で不可 |
| MulmoClaude `presentHtml` | △ | 既定は外部 img 不可。`config/csp.json` に `img-src`（地理院・ハザードマップポータル・気象庁）を足せば ○ |
| **GCP ビューア・プラグイン（T2）** | **◎** | 母艦の Canvas 内で **MapLibre**（Web UI と同じ描画・CSP の制約を受けない） |
| Web UI（既存） | ◎ | MapLibre |

---

## 4. 採用アーキテクチャ

### 4.1 全体図

```
   ユーザーのマシン（母艦はローカル・推論はユーザーのサブスク）
   ┌──────────────────────────────────────────────────────────────────────┐
   │ MulmoTerminal / MulmoClaude（GUI Chat Protocol ホスト）                 │
   │                                                                      │
   │   ┌───────────────┐  in-process GUI MCP（mt / mulmoclaude）            │
   │   │ Claude Code   │◄─┤ presentChart / presentForm / presentHtml /      │
   │   │  or Codex     │  │ presentDocument / manageCollection …            │
   │   │ （無改変）     │  │ [T2] stationArea（当アプリ製プラグイン）          │
   │   └──────┬────────┘  └────────────┬─────────────────────────────────┘ │
   │          │ 当アプリのプラグイン        │ Canvas（Vue・Shadow DOM）          │
   │          │ （skills / .mcp.json）      ▼  チャート・フォーム・地図・文書     │
   └──────────┼───────────────────────────────────────────────────────────┘
              │ リモート MCP（HTTP・認証なし・読み取り専用・レート制限）
   ┌──────────▼──────────────────────────────────────────────────────────┐
   │ 当アプリ（Vercel）  /api/mcp                                          │
   │   ToolSpec 12 本（Gemini と共有）→ structuredContent = Map Edition     │
   │   [T1] present:"echarts" → presenters.echarts（純関数・パネル→option）  │
   │   [T1] render_map({ mapActions }) → 地図レポート HTML（署名 URL・24h）   │
   │   domain / catalog（単一の真実）/ Supabase（PostGIS・RLS）              │
   └─────────────────────────────────────────────────────────────────────┘
```

CLAUDE.md §2 の図に「ユーザーの Claude」が並ぶ前身 §4.1 の構造は不変。変わるのは **UI の出口**——「iframe（サーバの HTML）」から「母艦の viewer（型つきデータ）」へ。

### 4.2 3 層（T0 / T1 / T2）の定義

| 段 | 当アプリが足すもの | 動く場所 | 依存 | 配布 |
|---|---|---|---|---|
| **T0** | なし（現状） | 全クライアント | — | — |
| **T1** | サーバ：`present` オプション・`render_map`／スキル：母艦検出と作法／レンダラの TS 化 | MulmoTerminal・MulmoClaude（プレゼンタがあるとき）。無ければ T0 に自動退避 | 母艦のプレゼンタ契約（`presentChart` の ECharts option・`presentHtml` の CSP） | **追加配布なし**（既存プラグインの更新のみ） |
| **T2** | GCP プラグイン（npm）：1 ツール `stationArea`・Vue View（共通レンダラ＋MapLibre）・Preview | 任意の GCP ホスト | `gui-chat-protocol ^2.0`・`vue ^3.5`・母艦の登録 | npm＋MulmoClaude ledger／MulmoTerminal 同梱 PR |
| T1′ | スキル `report`（HTML レポート→Artifact） | Claude Code（Pro/Max/Team/Ent） | Artifact ツール | なし |

### 4.3 T1 の中身：「プレゼンタ対応データ」＝サーバ側アダプタ（意味はサーバ・描画語彙は母艦）

**(a) `present: "echarts"`（MCP アダプタ層だけの opt-in）**

- `mcp-tools.ts` の登録時に、**ToolSpec の inputSchema を `extend({ present: z.enum(['echarts']).optional() })` で包む**（ToolSpec 本体・Gemini 側は無改変）。アダプタが `present` を剥がして `spec.run` を呼び、結果の panels を純関数 `toEChartsOptions(panels)`（`src/shared/presenters/echarts.ts`）で option 配列に変換し、`structuredContent.presenters.echarts` に載せる
- 対象は**数値パネルだけ**：`trendChart`（折れ線・`stacked` は積み上げ棒・null は途切れ・`totals` は上書き値）・`barChart`（横棒・`emphasis`）・`scatter`（クラスタ色・`clusterCount`）・`rankingTable`（横棒 Top-N）・`statTable`（表は Markdown に任せる＝変換しない）。**`hazardCard`・`evacuationList`・`escapeDirection` は変換しない**（チャートにすると危険度・免責・時制が落ちる——`instructions` と Markdown で運ぶ）
- option は**関数を含まない JSON**（ラベルは ECharts の文字列テンプレート・単位は軸名・年次はタイトル）。信頼性フラグ ⚠ は副題とラベルに出す。⚠ **出典は数値パネルが持っていない**（protocol の `sources` はハザード系 3 型だけ）ので、副題に載せるのは単位・⚠・注記で、出典は**周辺の文書**（`presentDocument`）で述べる——スキルの仕事（PR-14）
- 既定 OFF（結果サイズを増やさない）。スキルが「Canvas があるときだけ `present:"echarts"` を付け、返った option を**そのまま** `presentChart` に渡す」と教える（転記ミスをゼロに）
- Claude Code は structuredContent を LLM に見せる（PR-7 の発見）ので、option は LLM の目に入り、そのまま次のツール呼び出しに転記できる

**(b) `render_map({ mapActions, title? })`（14 本目・MCP のみ・署名 URL）**

- **入力は Map Edition の `MapAction[]` そのもの**（Zod を再利用）。エージェントは直前のツール結果の `structuredContent.mapActions` を**そのまま渡す**（数オブジェクトで小さい）。サーバが `grp` → 座標・半径円、`setHazardLayers` → カタログのタイル URL・出典・不透明度、`highlightPoints` → 番号マーカーに解決する——**§1.2 の描画意味論を同じ規則で**
- 出力：`{ url（署名 URL・24h・`build_dataset` の `token.ts` を再利用）, expiresAt, layers: [{key,labelJa,sourceJa}], note }`。**HTML は LLM を通らない**（curl／`scripts/fetch_map.py` で `artifacts/html/…` に保存し `presentHtml({ path })`）
- HTML の作り：**Leaflet を同梱**（`node_modules/leaflet/dist` を実行時読込・MapLibre と同じ `outputFileTracingIncludes` 方式・約 150KB）。ベース＝地理院 淡色**ラスタ**（現 `map-panel-app.ts` の `BASEMAP_TILE_URL` と同じ）、ハザードは PNG タイルを不透明度つきで重ねる（**カタログから算出**）。タイルは `<img>` で読む＝**`connect-src 'none'` の sandbox iframe でも描ける**（MulmoTerminal で実証する。MulmoClaude は `config/csp.json` の `img-src` 追記を導入手順に書く）。マーカー・半径円は DOM/SVG。出典・免責・「10 分毎更新」注記は本文と同じ文言
- 代替案（決定 14）：依存ゼロの「静的スリッピーマップ」（タイル格子を自前で並べる・パン/ズームなし・<20KB）。**推奨は Leaflet**（パン/ズームが要る・実装量が少ない・`<img>` タイルが標準）
- レート制限 10/分・`mapActions` ≤ 20 件・`highlightPoints` ≤ 50 点。410（期限切れ）は `render_map` を呼び直す

**(c) フォームで要件を聞く**（スキル側のみ）：`presentForm` があるときは、分析の型 §1「要件を先に聞く（1 回だけ）」を**フォーム 1 枚**で行う（予算/資産・通勤先/路線・災害の許容度＝足切り/減点・暮らしの好み）。無いときは従来どおり文章で聞く。

**(d) 表**：少数（≤ 30 行）は Markdown 表（`presentDocument`）、MulmoClaude では `presentSpreadsheet` も可。多数は CSV をローカル（現行どおり）。

### 4.4 T2：GCP ビューア・プラグイン `@<scope>/gui-chat-plugin`

- **1 パッケージ＝1 ツール** `stationArea({ action, …args })`（GCP の慣例：`manageAccounting`／`manageCollection` と同じ action 判別・`ToolResult.action` に写す）。`action` は当アプリのツール名（`get_station_detail`／`rank_stations`／`compare_growth`／`get_hazard_at_point`／`get_hazard_alerts`／`find_evacuation_sites`／`find_escape_direction`／`search_stations`…）。**TOOL_DEFINITION は当アプリの `tools/list` からビルド時に生成**（`oneOf` で action 別スキーマ・版同期テストで乖離を落とす）——定義を二重に書かない
- **execute（母艦のサーバ側）＝当アプリ `/api/mcp` への薄い MCP クライアント**（`tools/call` を `runtime.fetchJson(parse: Zod)` で）。返す `ToolResult`：`message`＝content の text、`jsonData`＝`result`、`data`＝`{ panels, mapActions, action }`、`instructions`＝`limitationsJa`／免責（ハザード系）。**当アプリのサーバは無改変**（ドメインもプロトコルも）
- **View（Vue SFC）**＝薄い枠：PR-11 で TS 化した共通レンダラ（`renderPanels(root, panels)`）を mount し、`mapActions` があれば **MapLibre**（npm 依存・Web UI と同じ版）を Shadow DOM 内に描く（母艦は chart/form の CSS を `?inline` で shadow に注入する流儀）。**Preview**＝1 行要約（駅名・危険度チップ）。ハザードの色・語彙は共通定数
- 配布：npm publish（`files: dist`・peer `gui-chat-protocol ^2.0`・`vue ^3.5`）。導入は **ユーザーが自分で**——`~/mulmoclaude/plugins/` に tgz を置き `plugins.json` に 1 行（開発は `mulmoclaude --dev-plugin ./packages/gui-chat-plugin`）。**同梱（プリセット）は提案しない**——`PRESET_PLUGINS` は**全員に対して空**で、それが設計上の現状だから（§4.4.1・決定 15 改）
- **スキルとの整合**：母艦に `stationArea` があるときはそれを使い、無ければ `station-data` の MCP ツールを使う（§4.5 の解決規則）。二重に呼ばない
- 置き場：当リポジトリの pnpm workspace に `packages/gui-chat-plugin/`（Next アプリと依存を分離・Vue はここだけ）。React 版（`ToolPluginReact`）は当面作らない（母艦が Vue）

### 4.4.1 T2 の配布先は「同梱」ではない（2026-09-15・先方のドキュメントで確認）

当初 §4.4 と決定 15 は「MulmoTerminal の `plugins/plugins.json` に同梱してもらう PR を出す」を
前提にしていた。**この前提は成り立たない。** 先方の `docs/plugin-runtime.md` に書かれている事実。

| 供給源 | 置き場所 | 管理者 |
| --- | --- | --- |
| **プリセット（同梱）** | `server/plugins/preset-list.ts` | リポジトリのコミッタ |
| **ユーザー導入** | `~/mulmoclaude/plugins/<pkg>.tgz` ＋ `plugins.json` | 利用者本人 |

**`PRESET_PLUGINS` は空**で、「枠組みはあるが既定で同梱されるプリセットは無い」と明記されている。
理由も書かれている——`@gui-chat-plugin/weather` をプリセットにしたところ、ledger からも導入していた
利用者の環境で毎回「名前が衝突している」警告が出た。その二重状態を綺麗に扱えるまでプリセットは空のまま。
つまり**同梱は特定の誰かに閉じているのではなく、いま全員に対して閉じている**。

**ビルトインのほうも外部には開いていない**：`src/plugins/<name>/` に `meta.ts` を置く＝先方の
リポジトリにコードをマージすることであり、外部からの PR は受け付けない方針（§4.6.1 の経緯）。

### カタログの物差しはここには効かない（こちらの推測の訂正）

「特定の国のデータセットは同梱リストに載せない」という #3176 の判断が T2 にも及ぶ、と一度考えたが
**誤り**だった。先方のドキュメントが「最初に入れてみるのに良い」として挙げている例が
`@gui-chat-plugin/weather`——**気象庁の日本限定データ**のプラグインで、発行者は中島さんと有元さん本人。
同スコープには `google-map`・`mindmap`・`camera`・`present3d` など 8 本が並ぶ。
ランタイム・プラグインは**そもそも審査されない**ので、地域限定かどうかは判断軸に入らない。

### 結論

- **同梱の提案はしない**（PR-17 から削除）。配布は **npm 公開＋利用者の ledger 導入**のみ
- 命名は既存の慣行 `@gui-chat-plugin/*` に寄せる
- **着手は導入 CLI（Phase D＝`yarn plugin:install`）が出てから**。同ドキュメントに「Phase D は未出荷、
  それまで導入は手作業」とある。tgz を置いて ledger を手で編集する手間を越えて届く相手は、
  母艦を使い・当プラグインを使い・さらにもう 1 段の手作業を厭わない層に限られる。
  T1 は既に両方の母艦で地図とチャートを出せているので、T2 の上積みは「HTML を経由しない・
  もう少し綺麗」であって機能の有無ではない。**同じ労力なら、CLI が出てからのほうが届く範囲が広い**
- この確認に **issue は使っていない**（公開ドキュメントとコードだけで確定した）。先方の時間を使わない

### 4.5 スキルの母艦対応

| 項目 | 内容 |
|---|---|
| ツール名の解決規則 | 完全修飾名は環境で変わる：`mcp__plugin_ai-database-map_station-data__<tool>`（Claude Code プラグイン）／`mcp__station-data__<tool>`（`claude mcp add`・MulmoTerminal `userMcpServers` の id）／`mcp__<任意 id>__<tool>`（MulmoClaude Settings）／`mcp__mulmoclaude__stationArea`（T2）。SKILL.md は「`station-data` サーバの同名ツール」と**論理名**で書き、`session-context.sh` が起動時に実名の探し方（`/mcp`・tools 一覧）を 1 行足す |
| 母艦の検出 | tools に `presentChart`／`presentForm`／`presentHtml`（接頭辞は問わない）があれば **Canvas モード**。作法：要件はフォーム／数値は `present:"echarts"`→`presentChart`／地図は `render_map`→保存→`presentHtml({path})`／結論・表・限界・出典は `presentDocument`。無ければ現行の Markdown 出力 |
| 成果物の保存規約 | 母艦：`<workspace>/artifacts/`（CSV・meta・スクリプト・地図 HTML・レポート）。Claude Code 単体：`./data/`。**再現可能**（同じ CSV とスクリプトで同じ表が出る） |
| 禁じ手の維持 | `presentChart` のタイトル・凡例に「安全」「危険度スコア」を書かない／ハザードはチャート化しない／出典と限界を Canvas の文書に必ず載せる（`instructions` にも同梱） |
| `data-analyst` サブエージェント | `tools:` に 2 通りの綴り（プラグイン用と `claude mcp add` 用）を並べる。加えて **CSV をローカルで解析する道具**（`Bash`/`Read`/`Write`/`Glob`/`Grep`）を持たせ、**図は出さず親に返す**——Canvas は親のセッションのもので、プレゼンタの実名はフロントマターに書けない。報告の**限界・出典・正規化の脚注は要約させない**（親がそのまま使う） |
| evals | golden に **Canvas 版**（`golden-yokohama-canvas`）を追加：①フォームで聞く ②`list_stations`→`build_dataset` 1 回 ③`presentChart` ≥1 ④`render_map`→`presentHtml` ⑤限界・出典を `presentDocument` に。ローカルランナーは MulmoTerminal を起動できないが、**プレゼンタだけを模した stdio MCP**（`pipeline/canvas_stub_mcp.mjs`・実機と同じ名前・引数・`required`）を `--mcp-config` で差し込めば**自動で実走・採点できる**（`--scenario canvas`）。実機の手動確認は §10 のとおり別途 |

### 4.6 配布と導入（母艦別）

| 面 | 手順（利用者） | 当アプリ側の作業 |
|---|---|---|
| Claude Code 単体 | 既存：`/plugin marketplace add kusui26/AI-Database-Map` → install | プラグイン更新（0.8.0） |
| **MulmoTerminal**（Claude/Codex） | ①**ワークスペースにしたいディレクトリで** `npx mulmoterminal@latest`（`npx` 起動では**そこが WORKSPACE**。直接起動なら `~/mulmoclaude`）。②Settings → `userMcpServers` に `{ id: "station-data", url: https://ai-database-map.vercel.app/api/mcp }`（**次のセッションから**有効）。③セルは候補チップの **WORKSPACE** を選ぶ＋Agent は Claude。④プラグインは Claude Code に **user scope** で導入済みであること。**Canvas のスイッチは触らない**——ワークスペースでは表示されず、GUI ツールは自動で付く（§4.6.1） | README/LP に「母艦で使う」節・スクリーンショット・`.mcp.json` 雛形 |
| **MulmoClaude** | ①Settings → **MCP servers** に HTTP を追加（`<workspace>/config/mcp.json`）——**必須**。登録しないとツールが 1 つも呼べない。②スキルを `<workspace>/.claude/skills/` に**相対 symlink** で置く——**Docker サンドボックスを使うときだけ必須**（既定は使う）。サンドボックス内では Claude Code がプラグインを解決できない（`receptron/mulmoclaude#3186`）。③地図を出すなら `<workspace>/config/csp.json` に `img-src`（再起動不要）。④T2：`plugins/` に tgz＋`plugins.json` に 1 行（**利用者が自分で**・同梱は無い＝§4.4.1）（①〜③は §4.6.1） | 導入ページ・**MCP カタログ掲載 PR**（`src/config/mcpCatalog.ts`：`type:"http"`・`riskLevel:"low"`・認証なし・i18n 8 ロケール・決定 17）・**upstream 要望**（プラグインのスキルも走査してほしい） |
| Codex（MulmoTerminal） | codex セル＋`.codex-plugin`／`codex mcp add` | **実導入検証**（前回未検証のまま） |
| claude.ai / Cowork | 既存コネクタ（テキスト） | `_meta.ui` 撤収後に「コネクタ再追加」案内（最後の 1 回） |

### 4.6.1 実機で分かったこと（2026-09-14／15 実走・MulmoTerminal 4.21 / MulmoClaude 1.16）

母艦は「同じ Claude Code を動かすもの」と括れない。**プラグインがそもそも読み込まれるか**と
**どのツールを許可するか**が別物で、そこが導入手順の実体になる。以下は
パッケージのソースを逐語で読み、実機で確かめた事実（① は 2026-09-15 に原因を訂正した）。

**① Docker サンドボックスの中で、Claude Code がプラグインを解決できない。**
MulmoClaude は既定で Docker サンドボックスの中にエージェントを置く。そのとき**プラグインが
丸ごと不活性**になる——スキル・スラッシュコマンド・MCP サーバ・SessionStart フックのすべてが届かない。
**症状が無言**なのが厄介で、エラーも警告も出ないまま、作法を知らないエージェントが自己流で答える。
実走では**結果を出してからフォームを出し**（型①の逆）、`render_map` も `presentHtml` も一度も呼ばれず、
`artifacts/html/` は空のままだった。

> ⚠ **2026-09-15 訂正。** ここには当初「MulmoClaude がプラグインのスキルを走査しないから」と書いていた。
> `server/workspace/skills/discovery.ts` の走査ルートが 2 つだけなのは事実だが、**それは症状の原因ではない**。
> MulmoClaude は**エージェントに渡すスキル一覧を自前で組み立てていない**——本物の `claude` CLI を spawn し、
> `--allowedTools` に裸の `Skill`（＝全スキル許可）を渡すだけで、発見は CLI の仕事。`discoverSkills()` が
> 供給しているのは一覧 UI・`manageSkills`・ブリッジの `/help`・スケジューラ・表示用の後付けだけ。
> 誤りの指摘は upstream から（`receptron/mulmoclaude#3175`）。**観測（`Skill` 0 件）と機構（なぜ 0 件か）を
> 確かめずに結びつけた**のが原因で、symlink で直ったことが誤った説明の裏づけに見えていた。

**真因はパスの不一致（実測）。** Claude Code の台帳が**ホストの絶対パス**を持つ一方、
コンテナのホームは `/home/node`（MulmoClaude が `HOME=/home/node` を明示的に渡す）。

| 台帳 | キー |
| --- | --- |
| `~/.claude/plugins/known_marketplaces.json` | `installLocation` |
| `~/.claude/plugins/installed_plugins.json` | `installPath` |

コンテナ内の `claude plugin list` は `✘ failed to load / Marketplace … cache-miss` と言う。
**両方を書き換えないと直らない**——`installLocation` だけだと `plugin list` は `✔ enabled` になるのに
エージェントには届かず、`installPath` だけだと `cache-miss` のまま。両方直すとコマンド・スキル・フックが
戻る。影響は当プラグインに限らず、`claude-plugins-official` を含む登録済みマーケットプレイス全部。
upstream に報告済み（`receptron/mulmoclaude#3186`）。**サンドボックスを使わなければ何も要らない。**

**回避策は `<workspace>/.claude/skills/` への相対 symlink。** これが効くのは、CLI が**作業ディレクトリの
`.claude/skills/` を自分で読む**から（MulmoClaude の discovery とは無関係）。
相対にする理由は、ワークスペースが `/home/node/mulmoclaude`、`~/.claude` が `/home/node/.claude` に
マウントされ、**ホームからの相対位置がホストと一致する**こと。だから 3 階層上がる相対リンクは両方で解決し、
絶対パスはコンテナ内で切れる。実イメージ `mulmoclaude-sandbox` の中で 6/6 解決することを確かめた。
リンク先は**マーケットプレイスの複製**（`~/.claude/plugins/marketplaces/…`）にする——
パスに版番号が入らないので `/plugin` 更新にそのまま追随する。キャッシュ側
（`…/cache/<name>/<version>/`）は更新のたびに切れる。
なお #3184（2026-09-15 マージ・未リリース）で MulmoClaude はプラグインのスキルも走査するようになったが、
それは**一覧に見えるようになるだけ**で、エージェントが呼ぶかどうかは変わらない。

置くのは**方法論の 6 本だけ**（`station-analysis`・`station-recommendation`・`transport-planning`・
`market-analysis`・`analyze-csv`・`hazard-reading`）。コマンド版 5 本は置かない——`$0` が展開されず
本文に生の `$0` が残り、description が**存在しないスラッシュコマンド**を案内するため。
スキル間の参照はすべて相対パス（`../station-analysis/SKILL.md`・`references/canvas.md`）なので、
6 本だけでも相互リンクと Canvas の参照は壊れない。自然文の質問は方法論側の description が拾う。

**② MulmoClaude の `--allowedTools` は厳格な許可制。** 許可されるのは
`BASE_ALLOWED_TOOLS`＋`extraAllowedTools`＋`mcp__mulmoclaude`＋claude.ai コネクタ＋
**`config/mcp.json` に登録したサーバ**だけ（`server/agent/config.ts`）。プラグイン同梱の MCP 定義は
読まれても**許可されない**ので、Settings での登録は任意ではなく必須。`Skill` は素で許可されている
（＝全スキル可）ので、スキルさえ置けば呼べる。

**③ MulmoTerminal は WORKSPACE のセルだけが GUI ツールと `userMcpServers` を受け取る。**
プロジェクト・ディレクトリのセルには GUI MCP が付かず、`userMcpServers` の合流も無い。
しかもワークスペースでは **Canvas スイッチが消え**、「GUI ツールはすでに全部使える」という 1 行に
置き換わる——つまり「起動フォームの Canvas を ON」という案内は、推奨経路では**存在しない操作**を
指していた。正しい指示は「候補チップの先頭にある **WORKSPACE** を選ぶ」。このチップは
ラベルと印つきで常に先頭、削除もできない。`npx` 起動では**コマンドを打ったディレクトリ**が
WORKSPACE になる（直接起動時のみ `~/mulmoclaude`）。

**④ CSP は母艦で違う。** MulmoTerminal の `presentHtml` は
`img-src 'self' <CDN> data: blob: https:` を返すので**地図タイルはそのまま出る**。
MulmoClaude の既定に `https:` は無いので `<workspace>/config/csp.json` に
`{"img-src": [...]}` を足す。受け付けるのは **`https://ホスト名` だけ**で、パスやワイルドカードは
`sanitizeCspExtra` が黙って落とす。**再起動は不要**（リクエストごとに読み直す）。
広げたことは起動時に警告としてログに出る。

**結果**：両方の母艦で、フォーム → チャート → 地図 → 文書がそろうところまで実機で確認した
（MulmoTerminal 2026-09-14／MulmoClaude 2026-09-15）。§10 の「残る手動確認」はこれで解消。

### 4.7 Claude Code 単体の GUI：Artifacts（T1′・任意）

- 公式 docs（2026-09-12 閲覧）：**Pro/Max/Team/Enterprise** で利用可・`/login` セッション必須・HTML/MD 1 ページ・16MiB・**外部画像は CSP で不可**（タイル地図は不可）・スクリプトは cdnjs/jsDelivr 等から可（ECharts は可）・**claude.ai コネクタを viewer から呼ぶ live ページ**が作れる（当アプリのコネクタを viewer が叩くダッシュボード＝面白いが、コネクタは claude.ai 側の設定が要る）
- 位置づけ：母艦を持たない Claude Code 利用者向けの「レポートを 1 枚に」。スキル `report`（`/ai-database-map:report`）で「表＋ECharts＋限界・出典」を HTML 化し Artifact に公開。地図は SVG の簡易図か、`render_map` の HTML を別途ローカルで開く

### 4.8 Web UI・Gemini チャットとの関係（不変条件）

- `src/domain`・`src/shared/protocol.ts`・既存 `app/api`・`src/ai/tool-specs.ts`（Gemini と共有）は**無改変**（前身どおり「Step2 は純加算」）。`present` は MCP アダプタ層の拡張、`render_map` は MCP 専用ツール（`build_dataset` と同じ扱い・Gemini には出さない）
- Web UI の React パネル部品と、ビューアの共通レンダラ（vanilla TS）は**描画の二重実装**だが、**意味（domain・protocol）は共有**しているので CLAUDE.md §2 の禁止（ドメインロジックの二重化）には当たらない。統合は将来の別議論

---

## 5. 分析支援そのものの改善（GUI 以外・同じ梯子で拾う）

| # | 改善 | 効く場面 |
|---|---|---|
| 5.1 | 要件聞き取りの**フォーム化**（§4.3(c)）——golden ① の安定化（聞き漏れ・聞きすぎの両方を潰す） | 住宅・出店 |
| 5.2 | 結果の「見える化」規範：**表＋チャート＋地図＋限界・出典**を 1 セットで（母艦では Canvas に文書・チャート・地図の 3 枚） | 全ユースケース |
| 5.3 | **再現可能な成果物**をワークスペースに残す（CSV・meta・スクリプト・HTML）——「蓄積はユーザーのもの」。将来：分析結果を `manageCollection` で記録（母艦の data グループ） | 継続利用 |
| 5.4 | Codex の実導入検証（母艦の codex セル・`.codex-plugin`） | 到達面 |
| 5.5 | `list_stations` の 0 件 note・`build_dataset` の notes を `instructions` 相当として必ず本文へ（母艦でも落ちない） | 品質 |
| 5.6 | データ拡張（`dataset.md` §4）は**別トラック**のまま。おすすめ駅のアプリ機能化（`plan_house_hunting.md`）は **§13 で引き取った**（2026-09-15） | — |

---

## 6. ユーザー体験（横浜の例・MulmoTerminal）

```
（ワークスペースの claude セル・Canvas ON・station-data を userMcpServers に登録済み）
ユーザー: 横浜市で中古マンションを買おうと思う。おすすめの駅は？
Claude : [presentForm] 3 点だけ教えてください（予算重視/資産重視・通勤先/路線・災害の許容度＝足切り/減点）
         → Canvas にフォーム。送信すると JSON が次のターンとして届く
Claude : [list_stations 横浜市 → 137 駅] [build_dataset 137 駅×20 列（includeHazard）→ CSV URL]
         [Bash: fetch → pandas で正規化・重み合成・±20% 敏感度]
         [presentChart ← 上位 10 駅の合成スコア（present:"echarts" の option を転記）]
         [render_map ← 上位 5 駅の highlightPoints＋洪水想定区域 → HTML → presentHtml]
         [presentDocument ← 結論の表・効いた要因/弱点・限界（地価は代理・代表点 1 点・想定であり現況ではない）・出典]
         テキスト：上位 3 駅は重みを ±20% 振っても不動、4・5 位は入れ替わります。
```

ツール呼び出しは**データ 3 回＋描画 4 回**。モデルに入るのは要約と小さな option だけ。Canvas には「フォーム→チャート→地図→文書」が履歴として残り、後から見比べられる。Claude Code 単体では同じ会話が Markdown＋ファイル（HTML はブラウザで）に退避する。

---

## 7. コストとリスク

| リスク | 影響 | 緩和 |
|---|---|---|
| **母艦依存**（receptron のリリース速度：mulmoterminal 4.20.0／mulmoclaude 1.15.1（2026-09-11）・gui-chat-protocol 2.0.0（2026-08-03）） | プレゼンタの引数（ECharts option・`presentHtml` の CSP）が変わると T1 が崩れる | T1 は**標準の描画語彙**（ECharts option・自己完結 HTML）だけに依存。契約を `tests/` に固定（option の形・HTML に fetch が無いこと） |
| **T2 の配布が未成熟** | MulmoTerminal は同梱プラグインのみ・MulmoClaude は手動 tgz | T1 を主経路にし、T2 は MulmoClaude（`--dev-plugin`／ledger）で先行、MulmoTerminal は upstream PR |
| **CSP** | `presentHtml` は fetch 不可・MulmoClaude は外部 img 既定不可 | `<img>` タイル（Leaflet）＋`csp.json` の導入案内。MapLibre は T2（Canvas 内）に限る |
| **MulmoClaude は Agent SDK 経由** | 前身 §2.2 の「Agent SDK 経由の課金分離」が再開すると、MulmoClaude 利用者の枠の扱いが変わる（当アプリの規約リスクではない） | MulmoTerminal（対話 CLI）は影響薄。当アプリは両方に同じものを出す |
| トークン | `present:"echarts"` は結果を増やす | opt-in・数値パネルのみ・option を最小化 |
| 地図スタックが 2 つ（T1 Leaflet／T2・Web UI MapLibre） | 描画の二重保守 | 意味論（mapActions→印・面・円）は 1 か所の TS（共通レンダラの `mapSemantics.ts`）に置き、両者はそれを描くだけ |
| Vue の追加 | Next（React）リポジトリに別フレームワーク | `packages/gui-chat-plugin/` に隔離（pnpm workspace・別 tsconfig・別 lint） |
| 二重呼び出し（T2 の `stationArea` と `station-data` の両方が見える環境） | 同じ質問を 2 回叩く | スキルの解決規則（§4.5）：`stationArea` があるときはそれを優先 |
| claude.ai の `_meta.ui` キャッシュ | 撤収後も旧 HTML が出る利用者がいる | 撤収 PR の案内に「コネクタ再追加」（最後の 1 回） |

**当アプリ側の費用**：変化なし（モデル費 0・Vercel 関数＋Supabase 読み取り・`render_map` は HTML 生成のみ）。**ユーザー側**：母艦は無料（MIT）。母艦の描画ツールは枠を消費しない（`--allowedTools` で確認プロンプトも出ない）。

---

## 8. 決めたこと・決めること

### 8.1 前身の決定 1〜10 の扱い

| # | 前身の決定 | 扱い |
|--:|---|---|
| 1〜3 | E＋F（リモート MCP＋プラグイン＋コネクタ）／Phase 1 認証 `none`／プラグインは当リポジトリ直下 | **維持** |
| 4 | MCP Apps を（スパイクを経て）導入 | **覆す→却下**（§1.2）。撤収は決定 11 |
| 5 | ディレクトリ掲載は見送り | 維持（母艦の **MCP カタログ**は別枠＝決定 17） |
| 6〜10 | Gemini 残す／分析グレード 3 本／生 SQL 出さない／ハザード事前計算／市区町村列 | **維持** |

### 8.2 新しく決めたこと（2026-09-12 提案・**2026-09-13 に推奨どおり合意済み**）

| # | 論点 | **決定** | 見送った代替 |
|--:|---|---|---|
| 11 | MCP Apps 撤収の範囲 | `_meta.ui`・`ui://` 3 リソース・`map_probe`・ハンドシェイクを**本番から外す**。レンダラと mapActions 意味論は **TS モジュール化して残す**（T1/T2 の部品） | env フラグで温存（保守が残る・却下の意図に反する） |
| 12 | GUI の契約 | **GUI Chat Protocol（型つきデータ→登録ビューア）**。母艦＝MulmoTerminal／MulmoClaude | 自前チャット UI（規約・工数で不採用） |
| 13 | 段階 | **T1（プレゼンタ合成）を先に**、T2（自前ビューア）は地図に限って後追い | T2 から着手（配布が未成熟で価値が出るまで長い） |
| 14 | 地図の T1 実装 | **Leaflet 同梱**（`<img>` タイル・パン/ズーム・約 150KB・`leaflet` を依存に追加） | 依存ゼロの静的スリッピーマップ（小さいが操作不可） |
| 15 | T2 プラグインと配布先（**→ 15′ で改定**） | **作る**（`packages/gui-chat-plugin`・npm 公開・MulmoClaude ledger で先行・MulmoTerminal は同梱 PR を提案） | 作らない（地図が母艦で二級のまま） |
| 15′ | ↑の**改定**（2026-09-15・§4.4.1） | **同梱 PR は出さない**（プリセットは全員に対して空）。配布は npm 公開＋利用者の ledger 導入のみ。**着手は導入 CLI（Phase D）が出てから**——いまは手作業導入で届く相手が狭く、T1 が両方の母艦で地図とチャートを出せている | 予定どおり PR-16/17 に着手する |
| 16 | スキルの母艦対応 | 論理名解決・Canvas 検出・フォーム聞き取り・成果物規約・golden Canvas 版 | 母艦専用スキルを別に作る（二重保守） |
| 17 | MulmoClaude MCP カタログへの掲載 PR（外部貢献） | **出す**（認証なし・低リスク・カタログ基準「built-in で代替不能」を満たす）。i18n 8 ロケールは当方で書く | 出さない（導入は手動のまま） |
| 18 | Artifacts（T1′） | スキル 1 枚の**最小対応**（優先度低・PR-18） | やらない |
| 19 | npm スコープ／パッケージ名 | `@kusui26/ai-database-map-gui-plugin`（要 npm アカウント）または無スコープ | — |

> 覆したくなったら、コードより先にこの表を書き換える（前身と同じ作法）。
> 合意（2026-09-13）を受けて **PR-11 から着手する**。

---

## 9. 段取り（PR の切り方・案）

| | 内容 | 依存 | 受け入れ |
|---|---|---|---|
| **PR-11** | **MCP Apps 撤収＋ビューア部品の TS 化**：`_meta.ui`／`ui://` 3 リソース／`map_probe`／ハンドシェイクを外す。文字列 JS を**純 TS**へ——パネル描画は `src/shared/viewer/{vnode,charts,panels,styles}.ts`（protocol → VNode → HTML・DOM 非依存）、地図の意味論は `src/domain/map/scene.ts`（mapActions → 描くもの。ハザードの順序・不透明度・出典は既存 domain を再利用）。旧テストを移植 | — | tools/list に `_meta.ui` も `map_probe` も無い（本番ビルド実測）／ビューア網羅テスト緑／`pnpm build` 緑／claude.ai で iframe が出ずテキストに戻る（実機） |
| **PR-12** | **T1 プレゼンタ・アダプタ**：`present:"echarts"`（MCP 層の `extend`）＋`src/shared/presenters/echarts.ts`（trendChart／barChart／scatter／rankingTable）＋テスト（パネル型網羅・関数を含まない・単位/年次/⚠ の反映） | PR-11 | `present` 無しの結果が**バイト同一**（回帰）／option を ECharts に食わせて描ける（Playwright・cdnjs の ECharts で実レンダ） |
| **PR-13** | **T1 地図 `render_map`**：`MapAction[]` 入力・Leaflet 同梱・カタログ由来のタイル/出典/不透明度・署名 URL（`token.ts` 再利用）・`scripts/fetch_map.py`＋curl 手順・レート制限 | PR-11 | HTML に fetch/XHR が無い（静的検査）／`sandbox allow-scripts; connect-src 'none'; img-src https:` を模した iframe で Playwright 実レンダ（タイル `<img>` 取得・マーカー・半径円・面）／410/429 実測 |
| **PR-14** | **スキル母艦対応＋evals**：論理名解決・Canvas 検出・`presentForm` 要件・成果物規約・`data-analyst`・golden Canvas 版・プラグイン 0.8.0（CHANGELOG・README） | PR-12・13 | **達成**：Canvas 実走 3/3（プレゼンタのスタブ）＋ Claude Code 単体の golden 11/11（housing 5・transport 3・market 3）＝**14/14**。母艦の実機確認は §10 に残る |
| **PR-15a** | **導入手順の訂正**（追加ではなく**修正**——実機で 3 か所の誤りが判明・§4.6.1）：プラグイン README と `/ai` の母艦節を書き直す。MulmoClaude は**スキルの symlink と MCP 登録が必須**（現状は「読まれない場合はコピー」と条件付きで、そのままでは動かない）／MulmoTerminal は **WORKSPACE のセル**を選ぶ（「Canvas を ON」は推奨経路に存在しない操作）／`csp.json` はホスト名のみ・再起動不要 | PR-14 | 手順どおりに**まっさらなワークスペースで**再現できる／文言をテストで固定 |
| **PR-15b** | **配布（外部依存）**：MulmoClaude **MCP カタログ掲載 PR**（`src/config/mcpCatalog.ts`：`type:"http"`・`riskLevel:"low"`・認証なし・i18n 8 ロケール・決定 17）・**upstream 要望**（プラグインのスキルも走査してほしい＝手作業の symlink を全員ぶん不要にする）・Codex 実導入検証 | PR-15a | カタログ PR を提出／要望を起票／**Codex は CLI 導入後**（現在ブロック） |
| **PR-15c** | **原因の訂正**：`§4.6.1 ①` とプラグイン README・`/ai`・ルート README の因果を差し替える（走査ルートの話ではなく **Docker サンドボックス内でプラグインが解決できない**）。symlink が要る条件を**サンドボックス使用時だけ**に限定し、`#3186` を参照。プラグイン 0.8.2 | PR-15a | 誤った因果が残っていない（テストで否定を固定）／条件つきの手順になっている |
| **PR-15d** | **導入ページを「届く」形にする**：`/ai` の並びを**理由 → 実例 → 導入**へ組み替え（実走の応答から抜粋した表・弱点・限界を載せる）。`/ai` 専用の OG 画像（共有カード）・`sitemap.ts`・`robots.ts`（`/api` は除外）・canonical。プラグイン README から導入ページへの導線 | PR-15a | 冷たい読者が**理由を先に**読める（節の並びをテストで固定）／共有カードが 1200×630 の PNG で出る／sitemap が本番 URL を指す |
| **PR-16** | **T2 プラグイン**：`packages/gui-chat-plugin`（`definePlugin`・`stationArea` action 判別・`tools/list` からの定義生成＋版同期テスト・Vue View＝共通レンダラ＋MapLibre（Shadow DOM）・Preview・i18n） | PR-11 | `mulmoclaude --dev-plugin` で全 action の描画（地図・パネル・免責）／`vue-tsc`・lint 緑／`npm pack` 可 |
| **PR-17** | **T2 配布**：npm publish・利用者向けの ledger 導入手順・スキルの `stationArea` 優先規則の実走。**同梱提案 PR は削除**（前提が成り立たない・§4.4.1） | PR-16 | MulmoClaude で「横浜駅の詳細を見せて」→ Canvas に地図＋パネル（実機） |
| **PR-18** | Artifacts レポート（`/ai-database-map:report`）——任意 | PR-14 | Pro/Max セッションで Artifact が公開される |
| **W1〜W6** | **「おすすめ駅」の Web 実装**（§13）——domain の純関数 → 結線 → `/api/recommend` → 画面 → 仕上げ。MCP と `protocol.ts` は無改変 | PR-15d | §13.8 のとおり |

PR-11〜13 は独立に着手可（12 と 13 は並行）。**T1 は PR-14 で完成**、T2 は PR-16/17（決定 15′ で導入 CLI 待ち）。運用（Vercel WAF・Spend Management）は前身のまま。
**PR-15d のあと、この文書の梯子に着手すべきものは残っていない**——次は §13 の W1〜W6（おすすめ駅の Web 実装）。
**PR-15 を 15a／15b に割ったのは、前半が「案内の追加」ではなく「誤った案内の修正」だから**——手順どおりにやると MulmoClaude では無言で失敗する（§4.6.1 ①）。外部レビュー待ちの 15b に引きずられず先に出す。T2（PR-16/17）は投資が大きく、**人が T1 を導入できること**が前提なので 15a の後。

> **✅ PR-11 完了（2026-09-13）。** MCP Apps を本番から外し、価値のある部分だけを純 TS にした。
>
> **外したもの**：全ツールの `_meta.ui`／`ui://` リソース 3 本（`panels.html`・`map-panels.html`・
> `map-probe.html`）／`map_probe`（13 → **12 ツール**）／ext-apps のハンドシェイク／
> `MCP_APP_MIME_TYPE`／`McpToolConfig` の `panelUi`・`mapUi`／`src/ai/mcp-app/` 4 ファイル
> （文字列に埋めた JS・HTML が約 1,900 行）／`next.config.ts` の `outputFileTracingIncludes`
> （MapLibre を実行時に読まなくなったため。`maplibre-gl` は Web UI の依存として残る）。
>
> **残したもの**（文字列 JS → 型のついた純関数）：
> `src/shared/viewer/vnode.ts`（DOM を持たない木＋HTML 直列化。**エスケープをここの責務に固定**）／
> `charts.ts`（手書き SVG：欠損で線を切る・積み上げは `totals` を優先・クラスタ色）／
> `panels.ts`（**判別ユニオンを網羅する switch**——protocol にパネル型を足すと型エラーで落ちる）／
> `styles.ts`（CSS。クラスの対応はテストが固定）／
> `src/domain/map/scene.ts`（mapActions →点・通し番号・半径円・レイヤ・矩形・接続先）。
>
> **層の分け方**：markup は protocol にしか依存しないので `shared`、地図の意味（描画順・不透明度・
> 出典）はハザード・カタログに依存するので `domain`。**`shared` → `domain` の逆流を作らない**
> （この分割のために 1 ファイルを 2 か所へ置いた）。
>
> **重複の解消が最大の利得**：旧ビューアは `LEVEL_COLORS`／`levelLabel`／`evacLabel`／パレット／
> `fmtNum`／`drawOrder`／不透明度の丸め／円の近似を**文字列 JS に複製**し「変えるときは両方」と
> 注記していた。すべて `shared/constants`・`shared/format`・`domain/hazard/*` の実体に置き換わり、
> 注記ごと消えた。ついでに危険度を**色＋記号＋テキストの 3 要素**へ揃えた（`260824_flood.md` §7.6）。
>
> **テストが弱点を 1 件検出**：`series.color` は**サーバ由来のまま** `style` 属性に書かれていた。
> T2 のビューアは（当アプリとは限らない）MCP サーバの応答も描きうるので、`#hex` だけを受理する
> ガードを足した（合わない色は予備色へ落とす）。
>
> **検証**：typecheck・lint・**ユニット 782 全緑**（`viewer-panels` 14＋`viewer-map-scene` 16 を新設し、
> 旧 `mcp-app` の 16 件を移植）・`pnpm build` 緑。**ローカル本番ビルドで実測**——tools/list は 12 本で
> `_meta.ui` ゼロ、resources は `catalog://metrics` のみ、`map_probe` は `-32602 Tool not found`、
> `get_station_detail` の `structuredContent` は `{result, panels, mapActions}` のまま（回帰なし）。
> さらに**本番データで実レンダ**：4 ツールの実応答（駅詳細・地点ハザード・ランキング・避難場所）を
> 新モジュールに通し、6 パネル型と地図シーン（半径円 1km／ハザード 4 層が base→overlay 順／
> 避難先 6 点）を描画。`<script` ゼロ・CSS クラスの欠落ゼロ・**免責と網羅性注記と理由の 15 文が
> すべて出力に残る**ことを確かめた（安全側の文言が抽出で落ちていない）。
>
> ⚠ **残る手動確認**：claude.ai で iframe が消えてテキストに戻ること。ホストが
> 「ツール→UI リソース」対応をコネクタ単位でキャッシュするので、**コネクタを削除→再追加**してから見る
> （§1.2 の運用の罠。これが最後の 1 回になる）。

> **✅ PR-12 完了（2026-09-14）。** 母艦の `presentChart` に**そのまま渡せる** ECharts の option を
> サーバが組んで返すようにした（T1 の半分）。
>
> **足したもの**：`src/shared/presenters/echarts.ts`（パネル → option・純関数）と、MCP アダプタの
> 表示用パラメータ **`present:"echarts"`**。指定すると `structuredContent.presenters.echarts` に
> `{ title, charts: [{ title, type, option }] }` が入る——`presentChart` の `document` の形そのもの。
> 受けるのは**数値のパネルを返す 3 ツールだけ**（`get_station_detail`・`rank_stations`・
> `compare_growth`）で、説明は**ツール説明ではなく Zod の `describe`** に置いた（使わない
> クライアントに毎回課金しないため）。
>
> **設計**：①option は**サーバが組む**——エージェントに組ませると単位・年次・⚠・欠損の扱いが
> 会話ごとに揺れる。②**JSON だけ**を型（`JsonValue`）で強制したので、関数を書くとコンパイルが
> 通らない。③変換するのは `trendChart`（折れ線／積み上げ）・`barChart`・`rankingTable`・`scatter`
> の 4 型で、**`hazardCard`・`evacuationList`・`escapeDirection` は変換しない**（危険度は順序尺度・
> 免責と時制が落ちる）。④整形済み文字列（`formatted`）は ECharts の文字列テンプレートとして
> **そのままラベルに出す**ので、桁区切りも符号も Web UI と一致する。⑤積み上げの**合計は
> 内訳の丸め和ではなく `totals`** を点線＋ラベルで重ねる（`docs/sales.md` §4.5 の食い違いを図で消す）。
>
> **`present` なしの応答は 1 バイトも変わらない**（`run` に届かないことを Zod の strip が保証。
> 本番ビルドで `rank_stations` の有無を突き合わせ、`result`・`panels`・`mapActions` が
> **バイト同一**であることを実測）。
>
> **本物の ECharts（cdnjs 6.1.0）で描かせて 4 件の実問題を見つけた**——どれも静的検査では出ない：
> ① ランキングのツールチップに **`10.8000001907349`**（`float4` 保存に由来する見せかけの桁・
> `docs/260816_supabase_restart.md`）。ECharts の整形は関数でしかできないので、**図に置く値を
> 有効数字 7 桁へ丸める**ようにした（棒の長さは変わらず、読めない桁だけ消える）。
> ② 散布の y 軸名（長い日本語）が**副題と重なる** → 回転（`nameRotate: 90`）＋左余白 64px。
> ③ 点を `[x, y, 駅名]` の配列にすると option は **45% 小さくなる**（1,400 点で 56KB → 29KB）が、
> ツールチップが「2.4,70.5,ゆめが丘」と駅名を重ねて出す。次元を指す記法（`{@[0]}` / `{c0}`）は
> `series.data` でも `dataset` でも**解決しないことを実機で確かめた**ので、
> **`{ name, value: [x, y] }` を採る**（大きさより「どの駅か読める」を優先）。
> ④ 年が 2 つだけの積み上げ棒が画面の半分を占める → `barMaxWidth: 48`。
>
> **検証側の欠陥も 1 つ**：最初の実レンダはアニメーション中のフレームを測っていて、積み上げ棒を
> 「描けた」と数えながら**実際には棒が無かった**。`chart.on('finished')` を待ってから測る形に直したら
> 描画画素が 11,426 → 176,988 に変わった。**待たない測定は嘘をつく**——次に実レンダを書くときも同じ。
>
> **検証**：typecheck・lint・**ユニット 812 全緑**（`presenters-echarts` 24 件を新設。見本は
> `tests/fixtures/panels.ts` に出して `viewer-panels` と共有——パネル型を足すと両方が同時に落ちる）・
> `pnpm build` 緑。本番ビルドで 5 系統を実測（ランキング 12 件／人口の推移 3 系列／売上の積み上げ＋
> 半径別の棒／散布 328 点／散布 1,400 点）、**すべて console の error・warning ゼロで描画**、
> 系列色も全部画面に出た。ツールチップは「12. 鈴木町 10.8」「2016 小売 1,469.2 …合計 1,902.3」
> 「ゆめが丘 2.4, 70.5」。
>
> ⚠ **大きさの性質**：散布の option は駅数に比例する（328 点 14KB／1,400 点 56KB）。応答自体も
> パネルで同じだけ大きいので、**広い範囲の散布は `present` を付ける前に対象を絞る**——
> 分析の型（§2 対象集合）で既に言っていることを、PR-14 のレシピで明示する。
> `maxResultSizeChars` は既定のまま触っていない（上限を上げても超えるときは超えるので、
> ホストの退避に任せる）。

> **✅ PR-13 完了（2026-09-14）。** 地図を **`render_map`**（13 本目）で出せるようにした。T1 の残り半分。
>
> **形**：入力は Map Edition の **`MapAction[]` そのもの**（直前のツール結果の
> `structuredContent.mapActions` をそのまま渡す）。返すのは**短命 URL だけ**で、HTML は
> LLM を通らない。`GET /api/map?t=…` が開かれるたびに、サーバが駅の座標を引き直し、
> キキクルの時刻を取り直して HTML を組む——`build_dataset` と同じ「何も保存しない」方式なので、
> **開くたびに最新の面**になる。署名・圧縮・鍵は `ai/signed-url.ts` に切り出して
> `build_dataset` と共有した（データセットの URL を地図の入口へ投げても payload の形が違って落ちる）。
>
> **サーバだけができること**：`highlightStations`（grp だけで座標が無い）を**座標に解決して描く**。
> ブラウザのビューアは DB を引けないので PR-11 では「描かない」が正しかったが、`render_map` は
> 引ける——結果、**ランキングの上位駅がそのまま地図になる**（実測：神奈川県の上位 8 駅）。
> `domain/map/scene.ts` に `stations` を渡す口を足しただけで、渡さなければ挙動は従来どおり。
>
> **描き方**：**Leaflet 1.9.4 をインライン同梱**（147KB＋CSS 15KB・`node_modules` から実行時に読む＝
> 版ズレしない。Vercel へは `outputFileTracingIncludes`）。タイルは **`<img>`** で読むので
> 母艦の `presentHtml`（`connect-src 'none'`）でも描ける——**MapLibre では描けない**ことが
> 決定 14 の理由で、それを実機で確かめた。当アプリが返す HTML にも CSP を付ける：
> `sandbox allow-scripts`（直接開かれても当オリジンから切り離す）＋ `img-src` は
> **実際に載せるレイヤのオリジンだけ**（カタログから算出）。
>
> **実レンダで 1 件の実問題**：避難場所 5 件の**名前が重なって判読できなかった**。
> 地図には**番号だけ**を置き、名前は本文の「地図の番号」一覧で読ませる形に変えた
> （`evacuationList` パネルと同じ並び）。駅名も 12 件を超えたら出さず、そのことを本文で断る。
> あわせて**どの地図にも注意が 1 つは付く**ようにした（二次加工である／印は位置を指すだけで
> 経路ではない／駅は代表点）——地図は文脈から切り離して眺められるので、
> 断定的に見える状態を作らない（`docs/260824_flood.md` §7.5）。
>
> **検証**：typecheck・lint・**ユニット 838 全緑**（`map-report` 22 件を新設・シーンの駅解決 4 件を追加）・
> `pnpm build` 緑。**本番ビルドで 4 系統を実測**——駅詳細（半径円＋中心の印）／ランキング
> （grp → 座標の 8 駅）／地点ハザード（面 4 層）／避難場所（番号つき 5 件）。
> **母艦と同じ CSP**（`sandbox allow-scripts; connect-src 'none'; img-src … https:`）を付けた
> iframe で開き、タイルを route で偽 PNG にして実測：取得 15／15／75／8 本、タイル層 5 層
> （ハザード）、マーカー・半径円・凡例・注記がすべて描画、**console の error・warning ゼロ・
> 失敗リクエストなし**。エラー系も実測——改竄 400 `BAD_TOKEN`、期限切れ 410 `MAP_EXPIRED`、
> 11 回目で 429（`Retry-After` つき）、描けない入力は URL を作らず理由と次の一手を返す。
>
> **配布物**：`scripts/fetch_map.py`（URL → HTML を保存）。ツール応答の `howToJa` が
> 「保存して presentHtml などに渡すか、ブラウザで開く」と言う。ツールは 12 → **13 本**
> （README・`/ai`・Codex プラグインの表記も更新）。Gemini には出さない——アプリは自前の地図を
> 持っているので、HTML の地図ページを渡す相手がいない。

> **✅ PR-14 完了（2026-09-14）。** スキルを**母艦でも Claude Code 単体でも同じ答えが出る**形にした。
> T1 はこれで完成。図は**足し算**であって、言葉の置き換えではない。
>
> **ツール名を論理名に**：スキル本文から完全修飾名（`mcp__plugin_ai-database-map_station-data__…`）を
> 全部外し、**末尾一致で解決する**規則を骨格（`station-analysis`）と SessionStart の 1 文に置いた。
> 接頭辞は 5 通り以上ある（プラグイン／`claude mcp add`／母艦の `userMcpServers`／プロジェクト・セルの
> `mulmoterminal-render`／ワークスペースの `mt`）うえ、**Codex は区切りがハイフンで id の `-` が `_` になる**
> （`mcp-station_data-build_dataset`。母艦の README で確認）。列挙は不可能なので `allowed-tools` は
> **列挙できるものだけ**に残した——`/station`・`/rank` は 2 通りの綴りを併記、分析 3 コマンド
> （`/recommend`・`/demand`・`/market`）は**外した**（ローカル解析の `Bash` と、名前が環境依存の
> プレゼンタが要るため）。`data-analyst` も同じ理由でローカル解析の道具を持ち、
> **図は出さず親に返す**（Canvas は親のセッションのもの）。
>
> **Canvas の作法**：`station-analysis` に「図を出せる環境では図も出す」節と
> `references/canvas.md`（検出・何をどれで見せるか・引数の形・地図 3 手・禁じ手・置き場所）。
> 線引きは **「サーバから取れる図はサーバに作らせる／自分で計算した値（合成スコア等）は
> 自分で option を書いてよい、ただし単位・年次・正規化の脚注と ⚠ を自分で添える」**。
> `hazard-reading` には**ハザードをチャートにしない**（順序尺度・免責と時制が落ちる）を明文化した。
>
> **引数の形は実機の定義に合わせた**——npm から 4 つのプレゼンタ・プラグインを取り、
> `TOOL_DEFINITION` を逐語で読んだ（`@mulmoclaude/chart-plugin@3.0.1` ほか）。
> `presentDocument` は **`title` が必須**で、`filenamePrefix` が無いと保存名が `document` に落ちて
> 後から探せない。`presentHtml` は `path`（本文を貼り直すと母艦では**複製**になる）。
> スキル・スタブ・グレーダの 3 つを同じ形に揃えた。
>
> **受け入れテストを自動化した**：母艦はヘッドレスで動かせないが、**プレゼンタだけを模した
> stdio MCP**（`pipeline/canvas_stub_mcp.mjs`・依存ゼロ・実機と同じ名前／引数／`required`／
> **プロパティの説明文まで**）を `--mcp-config` で差し込めば、「何をどの順で、どんな引数で
> 呼んだか」は stream-json に残る。§4.5 が「手動 5 回」としていたところを `--scenario canvas` の
> 実走に置き換えた（決定的グレーダ 7 本：フォームで聞く／チャート／地図＋`presentHtml`（path で・
> `html` に貼り直さない）／文書（`title`＋`filenamePrefix`）／**ハザードをチャートにしていない**）。
>
> **実走が設計の穴を出した**——どれも机上では出ない。**スキル側**：
> ① 薄いコマンドカードの「**この段階ではツールを呼ばない**」が `presentForm` まで禁じていた。
> ターン 1 で読まれるのは**カードだけ**（骨格も方法論もロードされない）なので、カードに
> 書いていないことは起きない。「**データツール**は呼ばない」に直した。
> ② `data-analyst` に `Bash` を持たせたら**丸ごと任せられるようになり**、親が報告を要約するときに
> **出典を落とした**。能力を上げたら受け渡しが弱点になった——サブエージェント側に
> 「限界・出典・正規化の脚注は要約しない（親がそのまま使う）」を書いた。
> ③ 正規化の方法を**図の副題にだけ書いて文章から消した**回があった（canvas.md の禁じ手そのもの）。
> `presentDocument` の必須項目に**スコアの作り方（正規化・重み）**を明記し、
> 「副題に書いたから文章では省く」を禁じ手に足した。
>
> **そして、いちばん効いた発見**：**スキルが 1 つもロードされない回がある**。ターン 1 でも本走でも
> 起きる（実測）。そのとき残る文脈は **SessionStart の 1 文だけ**なので、そこに置くものを
> 「守られないと答えが間違う／無駄が出る」ものに絞って書き直した（573 字）——カタログで
> キーを確認・単位/半径/年次・**対象集合は 1 回**（路線は配列でまとめる）・**正規化してから合成し
> 方法と重みを 1 行**・災害の時制と「安全」禁止・**最後に限界と出典（要約でも削らない）**・
> ツール名は末尾一致・要件は先に 1 回（`presentForm` があればフォーム）・Canvas の 3 手。
> 上の ①〜③ は**スキルを読めば分かること**だったが、読まれない回があるのだから、
> 読まれなくても壊れない最小限は 1 文の側に要る。
>
> **測り方の穴も 3 つ**——スキルではなくハーネスが間違っていた。
> ④ スタブが**実機より情報の少ないスキーマ**だった。本物は各プロパティに説明を持ち、
> `filenamePrefix` には「これが保存ファイルを見つけられるようにする」と書いてある。
> 省いたまま測るのは実機より不利な条件での採点なので、説明文も写した。
> ⑤ 「ハザードをチャートにしない」の判定が、**注記の言葉**まで数えていた。3 回とも副題に
> 「洪水 `hazard_flood_level` が danger 以上の 3 駅は除外」と**正しく書いていて落ちた**
> （3 回ぶん無駄にした）。判定を**描かれる次元**（系列・`dataset`・軸・凡例）だけに絞り、
> 境目を `pipeline/eval_graders_test.py` で固定した——**正しい応答を落とすグレーダは、
> 見逃すグレーダと同じくらい悪い**。
> ⑥ `render_map` を「データ往復」に数えていたので、**図を出す環境だけ予算が 1 本狭かった**。
> `get_metrics_catalog` と同じ理由（データセットを取り直さない）で除外した。
>
> **検証**：typecheck・lint・**ユニット 848 全緑**（プラグイン検査を 14 → 24 件に。実走で見つけた
> 退行はすべてテストで固定した）・`claude plugin validate --strict`・グレーダ自体の検査
> （`pipeline/eval_graders_test.py`）。**実走は最終ツリーで 14/14**——Canvas **3/3**（22 判定すべて
> 3 回とも通過）／Claude Code 単体の回帰は housing **5/5**・transport **3/3**・market **3/3**
> （§11 の受け入れ条件どおり）。母艦の**実機**（MulmoTerminal / MulmoClaude の Canvas ON）での
> 手動確認は §10 のとおり**残っている**——スタブは名前・引数・`required`・説明文まで写したが、
> 実際に描かれる絵と CSP は実機でしか見られない。
>
> **CSP の実機差**：MulmoTerminal の `presentHtml` は `img-src 'self' <CDN> data: blob: https:` なので
> 地図タイルは**そのまま出る**。MulmoClaude の既定には `https:` が無いので `config/csp.json` に
> `img-src` を足す（`https://ホスト名` だけ・パスもワイルドカードも受け付けない——`sanitizeCspExtra`）。
> README をこの差に合わせた。

> **✅ PR-15a 完了（2026-09-15）。** 母艦の導入手順を**訂正**した。足りなかったのではなく、
> **書いてあるとおりにやると動かなかった**——出荷済みの手順に 3 か所の誤りがあり、どれも
> 実機で初めて分かった（§4.6.1）。とくに MulmoClaude は、手順どおりでも**スキルが 1 つも届かず**、
> エラーも警告も出ないまま答えの質だけが落ちる状態だった。
>
> **直したもの**：プラグイン README の母艦節を、ホストごとに 2 つへ分けて全面的に書き直した
> （両者は「同じ Claude Code を動かすもの」ではなく、**スキルの読み先**と**ツールの許可**が違う）。
> 導入ページ `/ai` には母艦の節が**そもそも無かった**ので新設し、スキルのリンクと `csp.json` を
> **コピーできる 1 行**で配った。ルート README からは手順へのポインタを張った。
>
> **退行を止める仕掛け**：`tests/host-setup-docs.test.ts`（7 件）。**誤った案内は実行時に何も起こさない**
> ——静かに壊れるものはテストで留めるしかない。肯定だけでなく**否定**も固定した
> （「読まれない場合」「Canvas を ON」という旧文言を書けない）。リンク先が
> **相対**であること（絶対パスは Docker で切れる）、**`marketplaces/` を指す**こと
> （`cache/` は版番号入りで更新のたびに切れる）、案内するスキルが**実在し `$0` を含まない**こと、
> README と `/ai` が**同じ 6 本**を案内していること、までを機械で見る。
>
> **検証**：typecheck・lint・**ユニット 855 全緑**・`plugin validate --strict`・`pnpm build` 緑。
> 加えて**手順そのものを実行して確かめた**——まっさらな偽ホームを作り、README の手順と、
> **本番ビルドが実際に配信した HTML から取り出したコマンド**の両方を流して、6 本のリンクが
> 解決し `csp.json` が 3 ホストで書けることを実測。文書は読んで正しそうでも、走らせるまで正しくない。
>
> **残り**：PR-15b（MulmoClaude のカタログ掲載 PR・**upstream 要望**＝プラグインのスキルも
> 走査してほしい・Codex 実導入検証）。Codex は CLI 未導入でブロック中。

---

## 10. 検証計画

- **契約（ユニット）**：presenters（option の形・単位・年次・⚠・関数なし）／ビューア・モジュール（10 パネル型網羅＝旧テスト移植）／`render_map`（`MapAction` の Zod 再利用・タイル URL と出典がカタログ由来・HTML に fetch/XHR/WebSocket が無い）／ツール名の論理名解決
- **E2E（ローカル本番ビルド）**：tools/list 13 本（`map_probe` 無し）・`_meta.ui` 無し・`present` 有無の結果差分・`render_map` の 200/410/429
- **実レンダ（Playwright）**：ECharts option を cdnjs の ECharts で描画／地図 HTML を **母艦と同じ CSP**（`sandbox allow-scripts; default-src 'none'; connect-src 'none'; img-src https:`）の iframe で描画し、タイル `<img>` の取得数・マーカー・面を実測（PR-9b の偽タイル route を流用）
- **母艦・実機（MulmoTerminal）**：✅ **確認済み（2026-09-14）**——WORKSPACE のセル＋`userMcpServers` で横浜 golden を実走し、フォーム → チャート → **地図** → 文書まで描画。Canvas スイッチは不要だった（§4.6.1 ③）。⏳ 残り：Codex セル（**Codex CLI 未導入でブロック**）／プロジェクト・ディレクトリのセル（`.mcp.json`＋Canvas スイッチ・`userMcpServers` は合流しない経路）
- **母艦・実機（MulmoClaude）**：✅ **確認済み（2026-09-15）**——`config/mcp.json` 登録＋`.claude/skills/` への相対 symlink 6 本＋`config/csp.json` で地図まで描画。**サンドボックスを使うと symlink 無しでは作法が 1 つも届かず地図に到達しない**こと、**サンドボックスを外せば symlink 無しでも届く**ことを実測（§4.6.1 ①）。⏳ 残り：T2 を `--dev-plugin` で全 action
- **回帰**：Claude Code 単体の golden 11/11（既存ランナー）・Gemini eval（既存）・claude.ai コネクタで iframe が消えテキストが出る

---

## 11. やらないこと

- **MCP Apps への追加投資**（ext-apps が「型つき UI」を持つまで再考しない）
- **自前ハーネス／BYOK／Agent SDK 経由の自前チャット**（前身 §12・規約）。母艦を**フォーク・改造しない**（要望は upstream PR）
- **母艦のプレゼンタ相当の再実装**（チャート・フォーム・表・文書は母艦の語彙を使う。当アプリの viewer は**地図＋Map Edition パネル**に限る）
- **Next アプリに Vue を混ぜる**（T2 は別パッケージ）
- **ドメイン・プロトコル・ToolSpec・既存 API の改変**（`present` はアダプタ層、`render_map` は MCP 専用の純加算）
- **生 SQL・サーバ側おすすめスコア API・ハザードの指標化・Gemini チャット廃止**（前身どおり）
- **T1 の地図に MapLibre**（`connect-src 'none'` で動かないことが分かっている）
- **T2 の同梱（プリセット）を先方に提案すること**——`PRESET_PLUGINS` は全員に対して空で、それが設計上の現状（§4.4.1）。配布は npm 公開＋利用者の ledger 導入に限る

---

## 12. 参考（一次情報・2026-09-12 閲覧。リポジトリはスクラッチパッドに clone して逐語確認）

**GUI Chat Protocol**
- receptron/gui-chat-protocol（commit `06c6ff4`・2026-08-03・npm `gui-chat-protocol` 2.0.0）：`README.md`／`spec/GUI_CHAT_PROTOCOL.md`（動機・Enhanced Tool Call・双方向・Roles・OS 構想）／`spec/API_REFERENCE.md`（`ToolResult`・"data gates rendering"）／`spec/PLUGIN_RUNTIME.md`（factory・`PluginRuntime`・`useRuntime`・ESLint preset）／`spec/CREATING_A_PLUGIN.md`／`spec/AI_NATIVE_BUSINESS_APP_ARCHITECTURE.md`（反転図・composition operator）／`src/types.ts`
- MulmoChat（`GUI_CHAT_PROTOCOL.md` は上記へ移動済み）／`@gui-chat-plugin/weather` 2.0.0（exports `.`/`./core`/`./vue`/`./style.css`・peer `vue ^3.5`・`gui-chat-protocol ^2.0.0`）
- 中島聡氏：LinkedIn "GUI Chat Protocol: Enabling Conversational AI with …"／X "From Man–Machine to Man–Machine–AI Interfaces"／MulmoClaude `MANIFEST.md`「How AI-Native Applications Should Be Built」（4 つの約束・3 つのパターン）

**MulmoClaude**（receptron/mulmoclaude・commit `809d968`・2026-09-11・npm 1.15.1）
- `README.md`（Quick Start・MCP Servers タブ・`config/mcp.json`）／`docs/extension-mechanisms.md`（7 機構・§6 設計指針「まず skill・plugin は最後」）／`docs/plugin-runtime.md`（tgz ledger・`--dev-plugin`・衝突規則）／`docs/plugin-development.md`／`docs/mcp-sandbox.md`（HTTP は sandbox でも動く）／`docs/csp-config.md`（`config/csp.json`）／`docs/claude-ai-connector-setup.md`（`--strict-mcp-config` 撤廃）
- `src/config/mcpCatalog.ts`（`McpCatalogEntry`・16 entries・選定基準）／`packages/plugins/{chart,html,form}-plugin/src/core/definition.ts`（`presentChart` は ECharts option・`presentHtml` は自己完結 HTML／`path`）／`packages/plugins/html-plugin/src/vue/View.vue`（`sandbox="allow-scripts"`）／`packages/core/src/remote-view/index.ts`（CDN 許可リスト）／`packages/create-mulmoclaude-plugin`／`server/agent/mcp-server.ts`（ブローカ・`data` で描画を決める）

**MulmoTerminal**（receptron/mulmoterminal・commit `100d4a0`・2026-09-11・npm 4.20.0・手元は 4.16.0）
- `README.md`「Wiki, Collections & the GUI panel」「MCP server ids」「`userMcpServers`」／`docs/gui-protocol-spike.md`（Phase I〜III・PTY での GUI 成立）／`docs/mulmoclaude-parity.md`／`common/toolGroups.ts`（render/data/media/external）／`server/mcp/broker.ts`／`server/infra/gui-mcp-registration.ts`（`claude mcp add -s local`）／`server/session/mcp-config.ts`／`server/infra/plugins-registry.ts`＋`plugins/plugins.json`（同梱セット）／`server/backends/html.ts`（`presentHtml` の CSP：`connect-src 'none'`・`img-src … https:`）／`docs/guide/en/basics.html`（Canvas スイッチ）

**Claude Code**
- Artifacts — https://code.claude.com/docs/en/artifacts（Pro/Max/Team/Enterprise・CSP・コネクタ呼び出し・16MiB）
- 前身の参考（規約・MCP・mcp-handler・ext-apps SEP-1865・Supabase OAuth・PostHog 方式）— [`260828_research_claude_auth.md`](./260828_research_claude_auth.md) §13

**当アプリ**
- `src/shared/protocol.ts`（Map Edition）／`src/ai/mcp-tools.ts`（アダプタ・`structuredContent`）／**`src/shared/viewer/{vnode,charts,panels,styles}.ts`**（パネル → VNode → HTML）／**`src/domain/map/scene.ts`**（mapActions → 描くもの）／`src/ai/dataset/token.ts`（署名 URL）／`plugins/ai-database-map/`（スキル・evals）。撤収した `src/ai/mcp-app/*` は PR-11 以前の履歴にある

---

## 13. 次のトラック：「おすすめ駅」の Web 実装（2026-09-15 起案）

### 13.1 位置づけ

T1 は完成し、母艦での実機確認も導入ページの整備も終わった（§4.6.1・§9 の PR-15a〜d）。
**この文書の梯子に、いま着手すべきものは残っていない**——T2 は決定 15′ で導入 CLI 待ち、
PR-18 は任意。§5.6 が「別トラックのまま」としていた
[`plan_house_hunting.md`](./plan_house_hunting.md) を、ここで引き取る。

**既存プランは捨てない。** スコアリングの定式化（エリア内での相対比較）・ペルソナ・UX の骨格・
純加算の線引きは、そのまま通用する。この節が足すのは **2026-07 の起案から今日までに変わった前提**と、
それに伴う設計判断の更新である。矛盾した箇所はこの節が優先する。

### 13.2 この 1 か月で前提が変わった 5 点

| # | 起案時（2026-07） | いま | 影響 |
|---|---|---|---|
| 1 | **市区町村カラムが無い**（制約①）。エリアは都道府県＋bbox 止まり | `stations.municipality` / `municipality_code` と RPC `list_stations`（前方一致）が**入っている**（#116） | 「横浜市で」が**そのまま言える**。決定 2 が解ける |
| 2 | 災害データは未整備 | `station_hazard`（全 9,273 駅・事前計算）＋ `stationHazardSummaries(grps)` が**アプリから引ける** | 足切り／段階減点を**Web でも**扱える |
| 3 | 方法論は机上 | **スキルとして実装され、実走 14/14 で通っている**（正規化してから合成・災害は線形加点しない・±20% 敏感度・限界と出典） | Web 版は**検証済みの規範を移植**する作業になり、設計の不確かさが小さい |
| 4 | 多駅×多指標は `valuesForColumns` | 実体は **`datasetRows(grps, keys)`**（`src/db/queries.ts:139`・RPC `dataset_rows`・jsonb） | 再利用先の名前が変わっただけ。DB は無改変のまま作れる |
| 5 | AI ツールは `src/ai/tools.ts` に足す | **`tool-specs.ts` が単一の真実**で、`tools.ts`（Gemini）と `mcp-tools.ts`（MCP）は薄いアダプタ。`MCP_TOOL_CONFIGS` は**全 Spec を網羅する型**なので、Spec を足すと MCP にも出る | §13.3 の判断が必要になる |

### 13.3 §11「サーバ側おすすめスコア API を作らない」と矛盾しない

§11 のこの項は前身から引いたもので、根拠は前身
[`260828_research_claude_auth.md`](./260828_research_claude_auth.md) にある。

> サーバ側の重み付き「おすすめスコア」API（好みはエージェントとユーザーの対話で決める。
> **固定レシピはアプリ機能として別途・plan_house_hunting**）

つまりこの決定は **MCP の面**についてのものであり、**アプリ機能としての実装は明示的に許されている**。
禁じているのは「サーバが利用者の好みを勝手に決めること」で、Web 機能は逆に
**既定を宣言したうえで利用者が重みを動かせる**形にするので、趣旨にも反しない。

**したがって線引きはこうする。**

- **MCP には出さない。** `recommend_stations` のような外部エージェント向けツールは作らない。
  スキルは従来どおり `build_dataset` → ローカルで合成を続ける（好みは対話で決まる）
- **Web には出す。** `src/domain/recommend`（純関数）＋ `/api/recommend` ＋ UI。
  画面には対話の相手がいないので、**既定レシピ＋重みスライダ**がその代わりになる
- **二重定義を作らない。** 指標セット・向き・正規化・ハザードの扱いは **domain が唯一の定義**とし、
  スキルの方法論カードと**同じ規範**を実装する（§13.4）

> ⚠ **MVP ではツール表面に一切触らない。** アプリ内 Gemini チャットからも呼べるようにするのは
> 後段のブロックにする。`MCP_TOOL_CONFIGS` が全 Spec を網羅する型である以上、Spec を足すと
> MCP にも出てしまうので、「Gemini だけに出す」を表現する手段（面ごとの出し分け）を
> **その時に決める**。先に決めない——必要になるまで構造を増やさない。

### 13.4 スコアの定義——スキルと同じ規範に揃える

実走で通っている規範（`station-analysis` の「分析の型」§5〜⑧）を、そのまま domain の仕様にする。

1. **正規化してから合成する。** 単位の違う値を素で足さない。**採った方法を必ず 1 行で表示する**
2. **重みは利用者のもの。** 既定を宣言し、UI で動かせる。合計と各指標の向きを明示する
3. **災害は線形加点しない。** 順序尺度なので、**足切り**か**段階減点**のどちらかを利用者が選ぶ。
   除外したときは**駅数と代表例**を出す
4. **±20% の敏感度**を必ず計算し、順位が「頑健」か「僅差」かを言う
5. **欠損とフラグ（⚠）を黙って使わない。** 除外か注記かを明示し、件数を書く
6. **限界と出典を必ず末尾に**（地価は公示価格＝マンション価格の代理・駅の代表点基準・
   ハザードは想定であって現況ではない）

**正規化の方法**は domain が 3 つ（パーセンタイル／min-max／z-score）を持ち、
**Web の既定はエリア内パーセンタイル**にする。理由は説明しやすさ（「エリア内で上位 12%」）と、
⚠ の付く外れ値に強いこと。スキルが min-max を使う回があっても構わない——
**規範は「正規化して、どの方法かを書く」であって、方法の固定ではない**。
ただし同じ方法を指定すれば同じ順位になること（domain がその唯一の実装であること）は担保する。

### 13.5 `plan_house_hunting.md` §9 の 5 決定——更新版の答え

| # | 当時の問い | 更新版の答え |
|---|---|---|
| 1 | domain＋共通 API を additive に拡張してよいか | **よい。** ただし **MCP の面は無改変**（§13.3）。MVP は `protocol.ts` も無改変 |
| 2 | エリア粒度は都道府県でよいか | **市区町村を既定にする。** #116 で入った。都道府県・市区町村・bbox の 3 つを受ける |
| 3 | ファミリー既定重みで進めてよいか | **スキルの既定に揃える。** 実走で通っている値をそのまま初期値にし、UI で動かす |
| 4 | MVP は既存パネル再利用でよいか | **そもそも Panel を使わない**（起案時の想定を訂正）。既存のランキング画面（`src/components/ranking/` ＋ `/api/ranking`）は**Panel を経由せず専用コンポーネントが API を直接読む**作りで、おすすめ画面も同じにする。Panel の語彙が要るのは**アプリ内チャットから呼べるようにするとき（W6）だけ**。`rankingTable` は単一指標用（`metricKey` / `unit` を持つ）なので、合成スコアを流し込むと意味がずれる |
| 5 | 地価水準は情報表示・非加点でよいか | **トグルにする。** 「予算重視（安いほど良い）／資産価値重視（上昇率を重く）」。スキルが実走で採っている振り替えと同じ考え方 |

### 13.6 触る面・触らない面

```
   触る                                    触らない
   ─────────────────────────              ─────────────────────────
   src/domain/recommend/**（新規・純関数）   src/ai/tool-specs.ts（MVP）
   src/app/api/recommend/route.ts（新規）    src/ai/mcp-tools.ts
   src/components/recommend/**（新規）       src/shared/protocol.ts（Panel を使わない）
   src/shared/api.ts（型の追加）             src/db/（RPC 追加なし・datasetRows 再利用）
                                            既存パネル・既存 API・Gemini チャット
```

**画面は既存のランキングと同じ作り**にする——`src/components/ranking/`（`RankingDialog` /
`RankingBody` / `useRanking.ts`）が `/api/ranking` を直接読んで自前のコンポーネントで描いている。
おすすめ画面もこれに倣う。Panel は**チャットと MCP のための語彙**なので、Web の画面は通さない。

**DB は無改変**で作れる。`listStations`（市区町村の前方一致）で対象集合、
`datasetRows(grps, keys)` で駅×指標、`stationHazardSummaries(grps)` で災害——3 つとも既にある。

### 13.7 PR の切り方（案）

| | 内容 | 依存 | 受け入れ |
|---|---|---|---|
| **W1** | **domain（純関数）**：`normalize`（3 方法）・`compose`（重み付き合成）・`hazardGate`（足切り／段階減点）・`sensitivity`（±20%）・`presets`（ペルソナ既定）。境界値と欠損・⚠ のテストを厚く | — | 単体テストが**規範 6 項目**（§13.4）を 1 つずつ固定している |
| **W2** | **結線**：`listStations` → `datasetRows` → `stationHazardSummaries` → domain。実データ（横浜市 137 駅）で**スキルの実走結果と突き合わせる** | W1 | 同じ方法・同じ重みなら順位が一致する |
| **W3** | **`/api/recommend`**：Zod で入出力・薄い HTTP ラッパ。レート制限と入力上限（駅数・指標数） | W2 | 400/429 の実測。既存 API の応答が**バイト同一** |
| **W4** | **UI（MVP）**：おすすめモーダル（エリア選択・ペルソナ・重みスライダ・災害の扱い）＋結果の表＋地図ハイライト＋**限界と出典** | W3 | ヘッドレスで実レンダ。**正規化の方法・重み・除外件数・敏感度・限界**が画面に出ている |
| **W5** | **仕上げ**：空振り（0 件・全除外）の言い方、⚠ の見せ方、モバイル、URL 共有（`nuqs`） | W4 | 実データで 3 エリア（横浜市・世田谷区・札幌市）を通す |
| **W6**（任意） | アプリ内 Gemini チャットからも呼べるようにする。ここで**面ごとの出し分け**を決める（§13.3 の ⚠） | W4 | MCP の `tools/list` が**13 本のまま**であることをテストで固定 |

> **✅ W1 完了（2026-09-15）。** `src/domain/recommend/`（純関数・826 行）＋テスト **39 件**。
> DB も HTTP もカタログも読まない層として切り、**規範 6 項目のうち 5 つをテストで 1 つずつ固定**した
> （残り 1 つ「限界と出典を末尾に」は見せ方の約束なので W4 の実レンダで見る）。
>
> **実装しながら決めたこと**——どれも「黙ってやらない」ための選択。
> ①**正規化は残った駅の分布で**行う（足切りで外した駅を分布に残すと、候補の中での相対位置がずれる）。
> ②**重み 0 の指標は仕分けに使わない**——画面でスライダを 0 にしただけで、その列が欠けている駅が
> 静かに消える事故を防ぐ。③差が付かなかった指標は `degenerate` として返す（全員 0.5 にするのは
> 引き分けとして正しいが、黙ってやると効いていない指標が効いたように見える）。
> ④`uncovered`（区域図が無い）とサマリ未取得は、除外も通過もせず**不明の印**だけ付ける——
> 安全側に倒せば未整備なだけの駅が消え、危険側に倒せば「足切りを通った＝大丈夫」と読まれる。
> ⑤段階減点は**レベル → 減点の表引き**にした（`level × 係数` にすると順序尺度を数値として
> 扱うことになる）。⑥敏感度は**1 指標ずつ ±20%**（2^M の総当たりではない）。正規化は重みに依らないので
> やり直さず、**違いが重みだけに由来する**ようにした。
>
> **プリセットはスキルの表と同じ数値**にした。同じ質問に、入口が違うだけで別の既定が出ることを避ける。
> 指標の指定はファミリ名か正確な key（`rate_covid` のように変種があるものだけ key）で、
> 解決は上の層——`build_dataset` と同じ規約に合わせた。
>
> **品質ゲートが 2 回こちらの誤りを捕まえた。** ①`certainty: 'assumed'` という**存在しない値**を
> 書いていた（実際は `exact | partial | unknown`）。vitest は型を見ないので 20 件すべて緑のまま通り、
> `tsc` が止めた。②`as HazardLevel` を書いて lint に落とされた。列挙（`HAZARD_LEVELS`）を走査する形に
> 直したら、**5 段すべてを回すテストに変わった**——規約に従ったら検査が厚くなった。
>
> **検証**：typecheck・lint・**ユニット 902 全緑**・`pnpm build`・依存境界テスト（domain → UI/api/ai を
> 禁じる ESLint）緑。次は W2（結線と、スキルの実走結果との突き合わせ）。

> **✅ W2 完了（2026-09-15）。** 結線（`gather.ts`＝DB を読む唯一のファイル・`metrics.ts`＝
> ファミリ名から key を解決・`run.ts`＝解決 → 取得 → 合成）。
> **実データでスキルの実走と突き合わせ、上位 6 駅まで完全に一致した。**
>
> | | スキル実走（2026-09） | ドメイン |
> | --- | --- | --- |
> | 足切りで外れた駅 | 横浜・石川町・保土ヶ谷（洪水 critical） | **同じ 3 駅・同じ理由** |
> | 上位 6 | 戸塚・桜木町・東神奈川・山手・新杉田 ⚠・鶴見 | **同じ並び** |
> | ⚠ の付く駅 | 新杉田（地価系が低分母） | 同じ |
> | 頑健さ | 「3〜8 位は僅差の集団」 | 僅差（敏感度が独立に同じ判定） |
>
> **一度は食い違い、理由が分かった。** 最初の実行では 4 位以下がずれた。原因は候補集合で、
> こちらが 18 駅・実走が 17 駅。差の 1 駅は**羽沢横浜国大**——実走は「東京方面への直通が主では
> ないので参考扱い」という**エージェントの判断**を挟んでいた。min-max は候補集合の最小・最大に
> 依るので、1 駅の増減がそのまま順位に出る。その 1 駅を揃えたら完全に一致した。
>
> **この食い違いが W4 の要件を 1 つ決めた。** 画面にはその判断をする相手がいない。だから
> **候補集合は明示的な絞り込みだけで決まり、「何を候補にしたか」を画面に必ず出す**。
> 出さないと、同じ重み・同じ方法なのに違う順位が出る理由を、読む人が知る手立てが無い。
>
> **結線で決めたこと**：往復は **3 回だけ**（対象集合 → 駅×列 → 災害サマリ）。駅ごとに問い合わせない。
> `datasetRows` が値の無い列をキーごと返さない性質をそのまま活かし、**欠損を 0 で埋めない**。
> 災害サマリが取れない駅は `hazard: null`＝不明（安全ではない）。
> 路線名は **`京浜東北線` がデータに無い**（国土数値情報では東海道線・東北本線に含まれる）ことも分かった。
>
> **検証**：typecheck・lint・**ユニット 913 全緑**（解決器 11 件を新設）・`pnpm build`。
> 実データの突き合わせは `tests/domain-recommend-live.test.ts`（3 件）。DB が要るので既定は skip、
> `RECOMMEND_LIVE=1` で走る——**実行して 3 件とも緑**。次は W3（`/api/recommend`）。

> **✅ W3 完了（2026-09-16）。** `GET /api/recommend`（薄い HTTP ラッパ）＋入出力の契約
> （`recommendQuerySchema` / `recommendResponseSchema`）＋語彙の置き場（`src/shared/recommend.ts`）。
> **既存 API の応答は 18 本すべてバイト同一**で、MCP の `tools/list` も 13 本のまま
> （25,436 バイトまで一致）——main と本ブランチをそれぞれビルドして実サーバの応答を保存し、
> `cmp` で突き合わせた。
>
> **応答は順位だけを返さない。** 型の側で省けないようにしてある——採った方法（`methodJa`）・
> 正規化後の重み・**何を候補にしたか**（`area` ／ `candidateCount`）・外した駅と理由・
> ±20% の敏感度・限界・出典。UI はこの 1 つの形だけを読む（意味づけをフロントに置かない）。
>
> **3 つのガード**：①レート制限 30/分（IP・固定窓）②絞り込み必須（無いと全国 9,273 駅）
> ③候補上限 800 駅。③は**切り詰めずに 400** にする——`list_stations` は乗降客数の降順なので、
> 黙って頭を切ると「上位 N 駅の中での順位」という**言っていない判断**が混ざる。
>
> **実装中に 2 つ、こちらの誤りが実測で出た。**
>
> ① **PostgREST の 1,000 行の壁。** `list_stations` は SQL 側が `lim` を 2,000 まで受けるのに、
> PostgREST が先に 1,000 行で打ち切る。上限を 1,000 に置いていたので「1,001 件目が来たら多すぎる」
> という判定が**永久に成立せず**、4 県指定が 200 で返っていた——**上位 1,000 駅に切り詰めた順位**を、
> 全県の順位として。スモークの異常系が捕まえた。上限を 800 に下げ、壁そのものを
> `src/db/queries.ts` に書き残した（`/api/dataset` も同じ壁の上にいる）。
>
> ② **「いちばん新しい」が指標によって逆の意味になる。** ファミリ名の解決（W2）は年の新しい順に
> 選んでいたが、将来人口は**終点年**が動く（2025〜2070）ので最も遠い 2070 年が、
> 地価トレンドは**起点年**が動く（2011〜2025）ので最も短い 1 年が選ばれていた。どちらも
> 住まい探しの問いには的外れで、**スキルの実走とは別の列**で計算していたことになる。
> プリセットに `spanYears`（何年ぶんの変化で見るか）を持たせ、期間で選ぶようにした。
> 年ではなく期間なので、データが 1 年進んでも意味が保たれる。
>
> **これで「画面の既定 ＝ スキルの実走」が列まで揃った。** 実データの突き合わせ
> （`tests/domain-recommend-live.test.ts`）は、手で書き写した key ではなく
> **プリセットをそのまま**渡す形に変え、それでも実走と一致する。
>
> **API を実サーバで叩くと、W4 の要件が目に見える形で出た。** 同じ条件（横浜市・東海道線/根岸線/
> 横須賀線・予算重視・min-max・洪水 danger 足切り）で、除外 3 駅と 1〜3 位は実走と同じ
> （戸塚 0.6921・桜木町・東神奈川）。4 位以下は違う——**候補が 18 駅**だからで、実走の 17 駅とは
> 羽沢横浜国大の 1 駅ぶん違う（エージェントの判断は API には無い）。応答が `candidateCount: 18` と
> `area.labelJa` を返すので、**読む人はその理由に辿り着ける**。W4 はこれを画面に出す。
>
> **検証**：typecheck・lint・**ユニット 966 全緑**（入口 21・応答 19・ルート 8 を新設）・`pnpm build`。
> `tests/api.smoke.sh` に 200/400/429 を追加し、実サーバで **41/41 パス**
> （400 は 4 通り・429 は 31 回目で実測。429 はローカルのみ——本番は複数インスタンスで固定窓が割れる）。
> 次は W4（UI）。

> **✅ W4 完了（2026-09-16）。** FAB に「おすすめ」を足し、モーダル（`src/components/recommend/`）で
> エリア・ペルソナ・重み 6 本・災害の扱い・正規化の方法を選ぶ。**ヘッドレスで実レンダして
> 27 項目すべて緑**（`tests/ui.recommend.smoke.py`・実サーバ・スクリーンショット付き）。
>
> **画面に必ず出るもの**（§13.4 の規範）——候補集合（`候補 137 駅 → 順位 100 駅・神奈川県・横浜市`）・
> 正規化の方法・重み（%＋向き）・除外件数と内訳（`除外 37 駅（災害 28・欠損 9）`）・
> 敏感度・限界・出典。どれか 1 つでも消えたらスモークが落ちる。
>
> **並べ方で決めたこと。** ①**候補の数を最初に**言う（W2 の知見。候補が変われば順位も変わる）。
> ②**敏感度は表より前**に置く——「僅差」は順位全体にかかる断りなので、読んだ後では遅い。
> ③**限界と出典は畳まない**（§13.4-6）。④除外は件数を常に出し、駅ごとの理由は畳む（代表例）。
>
> **凡例が 3 役を兼ねる。** 指標名・重み（%）・帯の色を 1 か所に置いた。順位の下に
> **寄与の帯**（正規化値 × 重みを積んだ 1 本）を敷いてあるので、「この駅は地価の安さで上がっている」が
> その場で読める。⚠ **重み 0 の指標には色を振らない**——domain は重み 0 を合成に使わず応答の
> `metrics` からも落とすので、素直に並び順で色を振ると**凡例と帯が 1 つずつずれ、別の指標の話を読む**
> ことになる（`colorIndexes` が `activeMetrics` と同じ規則で振る）。
>
> **市区町村は実データから出す。** 自由入力だと 1 文字違うだけで 0 件になり、理由が画面から分からない。
> `/api/stations?prefecture=…` の駅一覧から組み立て、**駅数つき**で出す（選ぶ前に候補の大きさが分かる）。
> 区を持つ市には「横浜市（全区）」も並べる——前方一致で区をまとめられること（#116）に、
> 画面から辿り着けるようにするため。
>
> **割合はサーバと同じ関数で出す。** スライダの `%` は `shareOfWeights`（domain）を UI からも呼ぶ。
> 同じ重みなのに画面と応答で違う % が出る、を構造的に防ぐ。
>
> **実レンダが 2 つ捕まえた。** ①**閉じると条件が全部消えた**——モーダルの中身は閉じるたびに
> unmount される。エリアと重み 6 本を組んでから「閉じて地図で確かめる → 開いて直す」をするのが
> 普通の使い方なので、機能として成立しない。`src/stores/recommendStore.ts` に覚えさせた
> （W5 の URL 共有で置き換わる）。②**390px で「予算重視」がモーダルの外に出て押せなかった**——
> セグメントに `overflow-x-auto` が無かった。横スクロールバーは出ていないので、
> 画面幅の検査だけでは気づけない壊れ方だった。
>
> **API 側の小さな追加**：応答の指標に `shortLabelJa`（レシピが付けた「将来人口」）を足した。
> カタログのラベルは年と半径まで入っていて（「将来人口増減率（2020→2040年・R6推計・1km圏）」）、
> 凡例に 5 本並べると読めない。長い方は注記に出るので、見出しは短い方を使う。
>
> **検証**：typecheck・lint・**ユニット 995 全緑**（画面の純関数 26 件を新設）・`pnpm build`・
> ヘッドレス実レンダ 27/27（デスクトップ 1280px）。モバイル 390px でも横スクロールなしで
> 全コントロールに手が届くことを実測。次は W5（空振りの言い方・⚠ の見せ方・モバイル・URL 共有）。

> **✅ W5 完了（2026-09-16）。** 仕上げの 4 点（空振りの言い方・⚠ の見せ方・モバイル・URL 共有）。
> **ヘッドレス実レンダ 72 項目すべて緑**、**実データ 3 エリア（横浜市 137／世田谷区 38／札幌市 94）**を通した
> （`tests/ui.recommend.smoke.py`）。
>
> **条件を URL に置いた。** `?rec=true&recPref=神奈川県&recMuni=横浜市&…` の 14 パラメータ。
> **既定は書かない**（nuqs の `clearOnDefault`）ので、URL には「変えたところ」だけが残る。
> 読むのは開いたときだけで、以後は書くだけ（`history: 'replace'`）——双方向にしないぶん、
> 戻る/進むで条件の途中に落ちることがない。W4 で置いた `recommendStore` は役目を終えたので消した。
> 検査は文字列ではなく**同じリクエストになるか**で見る（既定と同じ重みは URL に載らないので、
> 文字列は往復で変わりうる）。壊れた値・古いリンクは既定に倒し、落ちない。
>
> **空振りに、次の一手を付けた。** 3 つの形に分けて、それぞれ実データで確かめた。
> ①**候補 0**（箱根町 × 東海道線）→「路線・会社・種別の指定を外すと」。
> ②**全除外**（世田谷区・洪水「注意」以上を足切り）→「候補 38 駅は、すべて候補から外れました」＋
> 「『注意』から『警戒』に緩めると」＋「『段階減点』にすると」。
> ③**少なすぎ**（二宮町・1 駅）→「1 駅の『1 位』は順位ではない」。
> 理由はこちらが持っているのだから、「該当なし」で黙らない。
>
> **⚠ は「どの指標が」まで言う。** 行の印に `aria-label`（「地価トレンドの値が信用できません」）を付け、
> 帯の該当区間に**斜線**を重ね（色は凡例と対応させたまま）、表の上に件数つきの一文を置いた。
> `⚠除外` を選んでいるときは「外した駅数」に言い換わる。
>
> **モバイルは「畳む」で解いた。** 390px ではつまみだけで画面の 6 割が埋まり、直して確かめるたびに
> 長くスクロールすることになっていた。**結果が出たら条件を畳み**、`神奈川県・横浜市 ファミリー（持続性）
> ／条件を変える` の 1 行にする。行は市区町村を 2 行目へ落とし、駅名が切れないことを**実寸**で確認した
> （`scrollWidth - clientWidth === 0`）。1 位がスクロールなしで見える（y=479）。
>
> **実レンダと実データが 2 つ捕まえた。**
> ①**順位 0 駅の画面が「頑健」と言っていた。** 振っても並びが変わらないのは**並べる相手がいない**からで、
> 順位が安定している証拠ではない。`sensitivityJa` に順位数を渡し、2 駅未満は
> 「比べる相手がいません」に変えた。
> ②**429 のあと SWR が裏で叩き直していた。** 「待ってください」と表示しながら再試行するのは
> 矛盾しているうえ、待ち時間が延びる。`shouldRetryOnError: false` にした（400 も、条件を直さない限り
> 何度やっても同じ）。
>
> **検証**：typecheck・lint・**ユニット 1,025 全緑**（URL 往復 14・空振り 13・⚠ 3 を新設）・`pnpm build`・
> ヘッドレス実レンダ **72/72**（デスクトップ 1280px ＋ モバイル 390px、3 エリア）。
> §13.7 の梯子（W1〜W5）はこれで完了。残るのは任意の W6（アプリ内チャットへの露出）。

### 13.8 検証計画

- **純関数**：正規化 3 方法の同値性・順序不変性、全欠損・単一駅・同値の扱い、⚠ 除外時の件数、
  足切りで 0 件になる場合、重み合計が 1 でない場合
- **スキルとの一致（W2 の核心）**：横浜市の同じ条件で、スキルの実走結果と domain の出力を突き合わせる。
  **食い違ったらどちらかが規範から外れている**——数字が合うことより、**なぜ違うかを説明できること**を見る
- **無改変の証明**：既存 API・既存パネル・MCP の `tools/list` が変わらないこと（バイト比較）
- **実レンダ**：ヘッドレスで、画面に**方法・重み・除外・敏感度・限界・出典**が出ていること
- **実データの妥当性**：3 エリアで上位が直感と大きくずれないか。ずれたら**重みではなく指標の向きを疑う**

### 13.9 この機能でやらないこと

- **MCP にツールを足す**（§13.3・§11）。外部エージェントの好みはエージェントが聞く
- **`protocol.ts` の変更**。Web の画面は Panel を通さない（既存のランキング画面と同じ作り）。Panel が要るのはチャットに出すとき（W6）だけ
- **DB マイグレーション**。3 つの既存 RPC で足りる
- **サーバが重みを決め打ちすること**。既定は宣言、変更は利用者
- **ハザードを指標化して線形加点すること**（順序尺度・§13.4-3）
- **スコアの「正解」を主張すること**。方法が変われば順位は変わる。だから方法を書く
