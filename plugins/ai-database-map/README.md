# AI Database Map プラグイン（Claude Code / Cowork）

全国 9,273 駅の**駅×半径オープンデータ**（乗降客数・人口・地価・バス停・事業所・従業者）と
**水害リスク**（想定区域・いまの警報・避難場所・脱出方向）を、あなたの Claude から直接照会・分析できます。
推論は**あなたのサブスクリプション**で動き、このプラグインはデータへの入口（リモート MCP）と作法（スキル）だけを提供します。

## インストール

### Claude Code（Pro / Max / Team / Enterprise）

```
/plugin marketplace add kusui26/AI-Database-Map
/plugin install ai-database-map@ai-database-map
```

プラグインなしで MCP サーバだけ使うこともできます：

```
claude mcp add --transport http ai-database-map https://ai-database-map.vercel.app/api/mcp
```

### MulmoTerminal で使う（図も出したいとき）

`presentChart` / `presentForm` / `presentHtml` を持つホストでは、表と文章に加えて
**チャートと地図**を出します。図が無い環境でも答えは変わりません（劣化しません）。

1. **ワークスペースにしたいディレクトリで起動**します。`npx mulmoterminal@latest` は
   **コマンドを打ったディレクトリ**をワークスペースにします。
2. **MCP サーバを足す**——Settings の `userMcpServers` に
   `{ "id": "station-data", "url": "https://ai-database-map.vercel.app/api/mcp" }`。
   反映は**次のセッションから**です。
3. **セルは候補チップの `WORKSPACE` を選ぶ**（Agent は Claude）。図のツールを受け取れるのは
   **このセルだけ**です。プロジェクトのディレクトリを選ぶと、図のツールも 2 の MCP も届きません。
   **Canvas のスイッチは探さないでください**——ワークスペースでは表示されず、
   「GUI ツールはすでに全部使える」という 1 行に置き換わります。
4. **スキルはこのプラグインのまま**効きます。追加の作業はありません。

地図のタイルはそのまま表示されます。CSP の設定は要りません。

### MulmoClaude で使う

MulmoClaude は既定で **Docker サンドボックス**の中でエージェントを動かします。そのとき
**Claude Code のプラグインが丸ごと読み込まれません**——スキルもスラッシュコマンドも MCP もフックも
届かず、しかも**エラーが出ません**。作法を知らないまま、答えの質だけが落ちます。

原因はパスの不一致です。プラグインの場所を記録している台帳がホストの絶対パス（`/Users/…`）を持つ一方、
コンテナの中のホームは `/home/node` なので、その場所が存在しません。upstream に報告済みです
（[receptron/mulmoclaude#3186](https://github.com/receptron/mulmoclaude/issues/3186)）。

設定は 3 つです。**2 はサンドボックスを使うときだけ**必要で、#3186 が直れば要らなくなります。
`npx mulmoclaude --disable-sandbox` で動かす場合は 2 を飛ばせますが、エージェントがホストで
直接動くようになります（サンドボックスの保護は外れます）。

1. **MCP サーバを足す**（必須）——Settings → **MCP servers** に HTTP で追加します
   （id は `station-data`、URL は上と同じ）。実体は `<workspace>/config/mcp.json` です。
   MulmoClaude がエージェントに渡す許可リストは**ここに登録したサーバから作られる**ので、
   登録しないとツールを呼べません。サンドボックスを使う場合は、そもそもプラグイン同梱の
   MCP 定義が読み込まれないため、なおさら必要です。
2. **スキルを置く**（サンドボックスを使う場合）——ワークスペース（既定 `~/mulmoclaude`）に
   1 回だけリンクを張ります。Claude Code は作業ディレクトリの `.claude/skills/` を自分で読むので、
   ここに置けばサンドボックスの中からでも届きます。

   ```bash
   mkdir -p ~/mulmoclaude/.claude/skills && cd ~/mulmoclaude/.claude/skills
   for s in station-analysis station-recommendation transport-planning \
            market-analysis analyze-csv hazard-reading; do
     ln -s "../../../.claude/plugins/marketplaces/ai-database-map/plugins/ai-database-map/skills/$s" "$s"
   done
   ```

   **相対リンクにしてください**——Docker サンドボックスの中でも解決します（絶対パスは切れます）。
   リンク先はマーケットプレイスの複製なので、`/plugin` で更新すると**自動で追随**します。

3. **地図のタイルを許可する**（必須）——`<workspace>/config/csp.json` を作ります。**再起動は不要**です。

   ```json
   {
     "img-src": [
       "https://cyberjapandata.gsi.go.jp",
       "https://disaportaldata.gsi.go.jp",
       "https://www.jma.go.jp"
     ]
   }
   ```

   受け付けるのは `https://ホスト名` だけです。パスやワイルドカードは黙って無視されます。

### 地図の出し方（母艦に共通）

`render_map` が返すのは HTML ページの短命 URL です。**保存してから** `presentHtml` に
パスで渡します（本文を貼り直すとページが複製されます）。

```bash
curl -sL '<url>' -o artifacts/html/map.html
```

リポジトリを持っているなら `python3 scripts/fetch_map.py '<url>' --out artifacts/html/map.html`
でも同じです。

### Claude.ai / Claude Cowork

Settings › Connectors › **Add custom connector** に
`https://ai-database-map.vercel.app/api/mcp` を追加（認証は None）。
Cowork では Customize › Plugins › **Add from a repository** に `kusui26/AI-Database-Map` も追加できます。

## 使い方

```
/ai-database-map:station 亀有 1000
/ai-database-map:rank pop_gr 1000 20
「神奈川県で人口が伸びていて地価が上がっていない駅は？」
「大阪駅の水害リスクと近くの避難場所を教えて」
```

図を出せる環境では、そのまま「横浜市で中古マンション、おすすめの駅は？」と聞くと、
要件をフォームで聞き → CSV を 1 回作って分析 → チャートと地図を Canvas に出し →
結論・限界・出典を文書にする、という流れになります。

長い調査は `data-analyst` サブエージェントに任せられます（結果だけが本体の文脈に返ります）。

## 注意

- **利用枠**：ツール結果はあなたのプラン枠（5 時間・週次）を消費します。既定の応答は簡潔にしてあります。
- **レート制限**：サーバ側に IP あたりの上限があります（全体 60/分、気象庁・国土地理院を叩くツールは 10〜15/分）。
  案内された秒数を待ってから再試行してください。
- **災害情報**：想定（ハザードマップ）と現況（気象庁の発表）は別物です。本プラグインは
  「安全」を保証せず、実際の避難は市町村の避難情報に従ってください。
- **出典**：数値は公的オープンデータの二次加工です。応答に含まれる出典表示を保持してください。
- **更新**：サードパーティのマーケットプレイスは自動更新が既定でオフです。
  `/plugin` › Marketplaces から更新できます。

## データとアプリ

- **導入ページ：https://ai-database-map.vercel.app/ai** （実際のやりとりの例・全クライアントの導入手順）
- アプリ本体：https://ai-database-map.vercel.app （出典・ライセンス一覧はアプリ内 ⓘ）
- リポジトリ：https://github.com/kusui26/AI-Database-Map
