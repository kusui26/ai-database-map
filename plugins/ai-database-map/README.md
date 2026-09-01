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

- アプリ本体：https://ai-database-map.vercel.app （出典・ライセンス一覧はアプリ内 ⓘ）
- リポジトリ：https://github.com/kusui26/AI-Database-Map
