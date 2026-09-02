"""golden シナリオ受け入れテストのローカルランナー（PR-7・§11）。

`claude plugin eval`（early access・未有効の環境向け代替）と**同じシナリオ・同じ判定基準**で
station-recommendation スキルを実走・採点する：

  ターン1: 「横浜市で中古マンション…おすすめの駅は？」→ ツールを呼ぶ前に好みを聞くか（①）
  ターン2: 好みの回答（予算重視・東京45分・洪水は足切り・重みはファミリー初期値）
           → list_stations → build_dataset(includeHazard) → ローカル分析 →
           上位5駅＋敏感度＋限界・出典（②〜⑧）

実行は `claude -p --plugin-dir plugins/ai-database-map`（セッション限定ロード・
グローバル状態を変更しない）。**ログイン中のアカウントの枠を消費する**。

    python3 pipeline/eval_recommend.py --runs 5
    （結果: plugins/ai-database-map/evals/results-local/<時刻>/ ・gitignore 済み）

受け入れ条件（§11）：5 回中 5 回、全グレーダ合格。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugins" / "ai-database-map"
RESULTS_BASE = PLUGIN_DIR / "evals" / "results-local"

# --plugin-dir 読み込みでは MCP ツール名が `mcp__station-data__<tool>`、
# インストール済みプラグインでは `mcp__plugin_ai-database-map_station-data__<tool>` になる。
# どちらでも数えられるよう **サフィックス一致**で判定する。
def is_station_tool(name: str, short: str) -> bool:
    return name.endswith(f"station-data__{short}") and name.startswith("mcp__")


def is_any_station_tool(name: str) -> bool:
    return name.startswith("mcp__") and "station-data__" in name

PROMPT_TURN1 = "横浜市で中古マンションを買おうと思っています。おすすめの駅はどこですか？"
PROMPT_TURN2 = (
    "予算重視でお願いします。通勤は東京駅まで45分以内が希望です。"
    "災害は、洪水の危険が高い駅を避けたい——足切りでお願いします。"
    "重みはファミリーの初期値でOKです。"
)

# 断定形だけを弾く。『「安全です」とは言えません』のような**正しい否定・引用**を
# 誤検知しない（run5 実測・採点側の教訓）。
FORBIDDEN_SAFETY = re.compile(r"(?:安全です|心配ありません|安全と言えます)[。！]|ご安心ください")

JUDGE_ASK_CRITERIA = """あなたは受け入れテストの採点者。以下はアシスタントの応答（家探しの相談のターン1）。
合格条件（全部満たすときだけ pass）:
- 「おすすめの駅」の順位付き提案をまだ出していない
- 利用者の好みを質問している：①予算重視か資産価値重視か ②通勤先/路線 ③災害リスクの許容度（種別と、足切りか減点か）のうち、③を含む少なくとも3点中2点以上
JSON だけを出力: {"pass": true/false, "reason": "1文"}"""

JUDGE_FULL_CRITERIA = """あなたは受け入れテストの採点者。以下は家探し分析の最終応答とツール使用の要約。
各項目を個別に判定し、JSON だけを出力:
{"c2_units": bool,       // 数値に単位・年次が添えられている
 "c3_normalized": bool,  // 正規化（z-score/min-max/パーセンタイル等）してから合成したと分かる
 "c4_hazard": bool,      // 洪水は足切りで扱い（除外に言及）、災害レベルを線形加点していない
 "c5_sensitivity": bool, // 重みを振った敏感度（±20%等）に触れ、頑健か僅差かを言っている
 "c6_limits": bool,      // 限界：地価は公示価格＝マンション価格の代理・駅の代表点基準・ハザードは想定（今ではない）のすべてに触れている
 "c7_top5": bool,        // 上位5駅前後の提案で、各駅に効いた要因と弱点がある
 "reason": "落ちた項目の理由を1-2文"}"""


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run_claude(
    prompt: str,
    cwd: Path,
    model: str,
    resume: str | None,
    timeout_s: int,
    raw_out: Path,
) -> dict:
    """1 ターン実行し、{session_id, text, tools:[{name,input}], cost} を返す。"""
    cmd = [
        "claude",
        "-p",
        "--plugin-dir",
        str(PLUGIN_DIR),
        "--dangerously-skip-permissions",
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--verbose",
    ]
    if resume:
        cmd += ["--resume", resume]
    cmd.append(prompt)
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout_s, check=False
    )
    raw_out.write_text(proc.stdout + "\n--- stderr ---\n" + proc.stderr)
    session_id, text, cost = None, "", 0.0
    tools: list[dict] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = event.get("type")
        if etype == "system" and event.get("subtype") == "init":
            session_id = event.get("session_id", session_id)
        elif etype == "assistant":
            for block in (event.get("message") or {}).get("content", []):
                if block.get("type") == "tool_use":
                    tools.append({"name": block.get("name", ""), "input": block.get("input", {})})
        elif etype == "result":
            text = event.get("result") or text
            session_id = event.get("session_id", session_id)
            cost = float(event.get("total_cost_usd") or 0)
    if proc.returncode != 0 and not text:
        raise RuntimeError(f"claude 実行に失敗（exit {proc.returncode}）: {proc.stderr[:300]}")
    return {"session_id": session_id, "text": text, "tools": tools, "cost": cost}


def judge(criteria: str, body: str, judge_model: str, timeout_s: int = 180) -> dict:
    """LLM 判定（JSON を返させて 2 回までパース再試行）。"""
    prompt = f"{criteria}\n\n--- 判定対象 ---\n{body[:9000]}"
    for _ in range(2):
        proc = subprocess.run(
            ["claude", "-p", "--model", judge_model, "--output-format", "json", prompt],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
        try:
            result = json.loads(proc.stdout).get("result", "")
            match = re.search(r"\{.*\}", result, re.S)
            if match:
                return json.loads(match.group(0))
        except (json.JSONDecodeError, AttributeError):
            continue
    return {"pass": False, "reason": "judge の応答を JSON として読めなかった"}


def tool_count(tools: list[dict], short_name: str) -> int:
    return sum(1 for t in tools if is_station_tool(t["name"], short_name))


def grade_run(turn1: dict, turn2: dict, judge_model: str) -> dict:
    """§11 チェックリストの決定的＋LLM 判定。verdicts: name → {pass, detail}。"""
    verdicts: dict[str, dict] = {}

    def add(name: str, ok: bool, detail: str) -> None:
        verdicts[name] = {"pass": bool(ok), "detail": detail}

    # --- ターン1（①）：ツールより先に聞く ---
    t1_build = tool_count(turn1["tools"], "build_dataset")
    t1_list = tool_count(turn1["tools"], "list_stations")
    add("ask/no-data-tools", t1_build == 0 and t1_list == 0, f"build={t1_build} list={t1_list}")
    ask_judge = judge(JUDGE_ASK_CRITERIA, turn1["text"], judge_model)
    add("ask/asks-preferences", ask_judge.get("pass", False), str(ask_judge.get("reason", "")))

    # --- ターン2（②〜⑧） ---
    builds = [t for t in turn2["tools"] if is_station_tool(t["name"], "build_dataset")]
    hazard_ok = any(t["input"].get("includeHazard") is True for t in builds)
    add("full/build-dataset-hazard", len(builds) >= 1 and hazard_ok, f"calls={len(builds)} hazard={hazard_ok}")
    add("full/list-stations", tool_count(turn2["tools"], "list_stations") >= 1, "")
    add("full/local-analysis(Bash)", any(t["name"] == "Bash" for t in turn2["tools"]), "")
    detail_calls = tool_count(turn2["tools"], "get_station_detail")
    add("full/few-detail-calls", detail_calls <= 3, f"get_station_detail={detail_calls}")
    mcp_calls = sum(1 for t in turn2["tools"] if is_any_station_tool(t["name"]))
    add("full/few-mcp-calls", mcp_calls <= 10, f"mcp calls={mcp_calls}")
    add("full/no-safety-claim", FORBIDDEN_SAFETY.search(turn2["text"]) is None, "")
    add("full/cites-sources", "出典" in turn2["text"], "")

    tool_summary = ", ".join(sorted({t["name"].split("__")[-1] for t in turn2["tools"]}))
    full_judge = judge(
        JUDGE_FULL_CRITERIA,
        f"[使ったツール] {tool_summary}\n\n[最終応答]\n{turn2['text']}",
        judge_model,
    )
    for key in ("c2_units", "c3_normalized", "c4_hazard", "c5_sensitivity", "c6_limits", "c7_top5"):
        add(f"full/{key}", full_judge.get(key, False), str(full_judge.get("reason", "")))

    verdicts["_pass"] = {"pass": all(v["pass"] for k, v in verdicts.items() if not k.startswith("_")), "detail": ""}
    return verdicts


def main() -> int:
    parser = argparse.ArgumentParser(description="golden シナリオ受け入れテスト（§11）")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--judge-model", default="haiku")
    parser.add_argument("--out", default=None)
    parser.add_argument(
        "--mcp-url",
        default=None,
        help="MCP の向き先を差し替える（AIDB_MCP_URL。例 http://localhost:3120/api/mcp。既定は本番）",
    )
    args = parser.parse_args()
    if args.mcp_url:
        import os

        os.environ["AIDB_MCP_URL"] = args.mcp_url
        print(f"AIDB_MCP_URL={args.mcp_url}")

    out = Path(args.out) if args.out else RESULTS_BASE / now_stamp()
    out.mkdir(parents=True, exist_ok=True)
    print(f"golden シナリオ: {args.runs} 回・model={args.model}・judge={args.judge_model} → {out}")

    passes, total_cost = 0, 0.0
    for run_no in range(1, args.runs + 1):
        work = out / f"run-{run_no}" / "work"
        work.mkdir(parents=True, exist_ok=True)
        print(f"--- run {run_no}/{args.runs} ---")
        turn1 = run_claude(PROMPT_TURN1, work, args.model, None, 600, out / f"run-{run_no}" / "turn1.jsonl")
        print(f"  turn1: tools={len(turn1['tools'])} cost=${turn1['cost']:.2f}")
        turn2 = run_claude(
            PROMPT_TURN2, work, args.model, turn1["session_id"], 1800, out / f"run-{run_no}" / "turn2.jsonl"
        )
        print(f"  turn2: tools={len(turn2['tools'])} cost=${turn2['cost']:.2f} text={len(turn2['text'])}字")
        verdicts = grade_run(turn1, turn2, args.judge_model)
        (out / f"run-{run_no}" / "verdicts.json").write_text(
            json.dumps(verdicts, ensure_ascii=False, indent=1)
        )
        ok = verdicts["_pass"]["pass"]
        passes += 1 if ok else 0
        total_cost += turn1["cost"] + turn2["cost"]
        failed = [k for k, v in verdicts.items() if not v["pass"] and not k.startswith("_")]
        print(f"  => {'PASS' if ok else 'FAIL'}" + (f"  落ちた項目: {failed}" if failed else ""))

    print(f"\n合格 {passes}/{args.runs}（実行コスト合計 ~${total_cost:.2f}）")
    (out / "summary.json").write_text(
        json.dumps({"passes": passes, "runs": args.runs, "cost_usd": total_cost}, ensure_ascii=False)
    )
    return 0 if passes == args.runs else 1


if __name__ == "__main__":
    sys.exit(main())
