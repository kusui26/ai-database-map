# スキル evals（golden シナリオ受け入れテスト）

`docs/260828_research_claude_auth.md` §11 の本丸——「横浜市で中古マンション、おすすめの駅は？」を
実走し、チェックリスト（①好みを先に聞く … ⑧少数回＋ローカル分析）で採点する。

## 実行方法

### A. `claude plugin eval`（公式ランナー・early access）

```bash
cd plugins/ai-database-map
claude plugin eval . --runs 5 --threshold 1.0
```

ケースはこのディレクトリの公式フォーマット（`case.yaml`＋`graders/*.md`）で書いてある。
アカウントで plugin eval が有効化されていれば、そのまま動く。

### B. ローカルランナー（early access 未有効の間の代替・同じ判定基準）

```bash
python3 pipeline/eval_recommend.py --runs 5
# デプロイ前の変更を試すときはローカルサーバへ向ける:
#   npm run build && PORT=3120 npm start &
#   python3 pipeline/eval_recommend.py --runs 5 --mcp-url http://localhost:3120/api/mcp
```

`claude -p --bare --plugin-dir plugins/ai-database-map` で**同じ 2 ターン会話**を実走し、
同じ決定的グレーダ＋LLM 判定（haiku）で採点する（結果は scratch へ・リポジトリを汚さない）。
どちらのランナーも **5 回中 5 回合格**が受け入れ条件（§11）。

## ケース（3 ユースケース＝CLAUDE.md §1 の想定ユーザー ＋ 母艦）

- `golden-yokohama-ask/` … 住宅購入・ターン 1：**データツールを呼ぶ前に**好み（予算/資産・
  通勤・災害の許容度）を聞くか（チェックリスト ①）
- `golden-yokohama-full/` … 住宅購入・本走：対象集合 → `build_dataset`
  （`includeHazard: true`）→ ローカル分析 → 上位 5 駅＋限界・出典（②〜⑧・runs 5）
- `golden-toyoko-demand/` … 輸送計画（東急東横線）：ダイヤ・断面・混雑を「持っていない」と
  明言しつつ、回復×将来で駅を分類できるか（runs 3）
- `golden-cafe-market/` … 出店・商圏（カフェ 3 駅・500m）：按分推計・コロナ影響年・
  proxy（昼間/競合/賃料）を明示して比較できるか（runs 3）

- `golden-yokohama-canvas/` … **母艦（Canvas）版**（PR-14）：図を出せる環境で、
  フォームで要件を聞き → `build_dataset` 1 回 → ローカル分析 → `presentChart` →
  `render_map` → 保存 → `presentHtml` → `presentDocument` に結論・限界・出典、まで通すか（runs 3）

ローカルランナーは `--scenario housing|transport|market|canvas` で同じ 4 本を実走する。

### 母艦（Canvas）版の走らせ方

MulmoTerminal / MulmoClaude はヘッドレスで動かせないので、**プレゼンタだけを模した
stdio MCP**（`pipeline/canvas_stub_mcp.mjs`）を `--mcp-config` で差し込んで実走する。
スタブは何も描かないが、**同じ名前・同じ引数**のツールなので「何をどの順で、どんな引数で
呼んだか」は stream-json に残り、そこで採点できる。

```bash
python3 pipeline/eval_recommend.py --scenario canvas --runs 3
```

決定的に見るのは：ターン1 で `presentForm` を出したか／`presentChart`・`render_map`・
`presentHtml`（**path で**・`html` に貼り直していない）・`presentDocument`（`title` 必須・
`filenamePrefix` つき＝後から探せる）を呼んだか／**ハザードをチャートにしていない**か。
文章の判定には `presentDocument` の本文も含める（結論がそちらにあるため）。

スタブのスキーマは**実機の定義に合わせてある**（`@mulmoclaude/chart-plugin` /
`form-plugin` / `html-plugin` / `markdown-plugin` の `TOOL_DEFINITION`——`required` と
プロパティの説明文まで）。緩めると、母艦で弾かれる形の呼び方を見逃す。

「ハザードをチャートにしない」は、**描かれる次元**（系列・dataset・軸・凡例）だけを見る。
タイトル・副題・注記に「洪水 danger 以上は除外」と書くのは**要求されている**ことなので、
そこを数えると正しい応答を落とす（実際に 3 回落とした）。境目は
`python3 pipeline/eval_graders_test.py` で固定してある。

## 注意

- 実走はログイン中のアカウントのサブスクリプション枠を消費する
- MCP はプラグイン既定＝本番（`https://ai-database-map.vercel.app/api/mcp`）
- `results*/` は生成物（コミットしない）
