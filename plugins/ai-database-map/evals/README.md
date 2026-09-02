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

## ケース（3 ユースケース＝CLAUDE.md §1 の想定ユーザー）

- `golden-yokohama-ask/` … 住宅購入・ターン 1：**データツールを呼ぶ前に**好み（予算/資産・
  通勤・災害の許容度）を聞くか（チェックリスト ①）
- `golden-yokohama-full/` … 住宅購入・本走：対象集合 → `build_dataset`
  （`includeHazard: true`）→ ローカル分析 → 上位 5 駅＋限界・出典（②〜⑧・runs 5）
- `golden-toyoko-demand/` … 輸送計画（東急東横線）：ダイヤ・断面・混雑を「持っていない」と
  明言しつつ、回復×将来で駅を分類できるか（runs 3）
- `golden-cafe-market/` … 出店・商圏（カフェ 3 駅・500m）：按分推計・コロナ影響年・
  proxy（昼間/競合/賃料）を明示して比較できるか（runs 3）

ローカルランナーは `--scenario housing|transport|market` で同じ 3 本を実走する。

## 注意

- 実走はログイン中のアカウントのサブスクリプション枠を消費する
- MCP はプラグイン既定＝本番（`https://ai-database-map.vercel.app/api/mcp`）
- `results*/` は生成物（コミットしない）
