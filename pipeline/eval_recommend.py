"""golden シナリオ受け入れテストのローカルランナー（PR-7 §11・3 ユースケース対応）。

`claude plugin eval`（early access・未有効の環境向け代替）と**同じシナリオ・同じ判定基準**で
方法論スキルを実走・採点する。シナリオは 3 つ（CLAUDE.md §1 の想定ユーザーに対応）：

  housing   … station-recommendation（横浜の家探し・§11 の golden。既定）
  transport … transport-planning（東急東横線の需要分析・ダイヤ検討材料）
  market    … market-analysis（カフェ出店の 3 駅商圏比較）

いずれも 2 ターン：ターン1 で「ツールより先に要件を聞くか」、ターン2 で本走
（対象集合 → build_dataset → ローカル分析 → 表＋限界・出典）を採点する。

実行は `claude -p --plugin-dir plugins/ai-database-map`（セッション限定ロード・
グローバル状態を変更しない）。**ログイン中のアカウントの枠を消費する**。

    python3 pipeline/eval_recommend.py --runs 5                 # housing
    python3 pipeline/eval_recommend.py --scenario transport --runs 3
    python3 pipeline/eval_recommend.py --scenario market --runs 3
    （--mcp-url http://localhost:3120/api/mcp でデプロイ前検証）

受け入れ条件：housing は 5/5（§11）・transport / market は 3/3。
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


# 「少数回」の判定はデータ往復（list/build/detail/hazard…）だけを数える。
# get_metrics_catalog は軽量なメタ照会（self-describing API の推奨経路）なので除外する。
def is_data_tool(name: str) -> bool:
    return is_any_station_tool(name) and not name.endswith("__get_metrics_catalog")


# 断定形だけを弾く。『「安全です」とは言えません』のような**正しい否定・引用**を
# 誤検知しない（run5 実測・採点側の教訓）。
FORBIDDEN_SAFETY = re.compile(r"(?:安全です|心配ありません|安全と言えます)[。！]|ご安心ください")

# --- シナリオ定義（プロンプト・決定的グレーダの設定・LLM 判定の基準） -------------

SCENARIOS: dict[str, dict] = {
    "housing": {
        "turn1": "横浜市で中古マンションを買おうと思っています。おすすめの駅はどこですか？",
        "turn2": (
            "予算重視でお願いします。通勤は東京駅まで45分以内が希望です。"
            "災害は、洪水の危険が高い駅を避けたい——足切りでお願いします。"
            "重みはファミリーの初期値でOKです。"
        ),
        "ask_criteria": """あなたは受け入れテストの採点者。以下はアシスタントの応答（家探しの相談のターン1）。
合格条件（全部満たすときだけ pass）:
- 「おすすめの駅」の順位付き提案をまだ出していない
- 利用者の好みを質問している：①予算重視か資産価値重視か ②通勤先/路線 ③災害リスクの許容度（種別と、足切りか減点か）のうち、③を含む少なくとも3点中2点以上
JSON だけを出力: {"pass": true/false, "reason": "1文"}""",
        "full_checks": {
            "c2_units": "数値に単位・年次が添えられている",
            "c3_normalized": "正規化（z-score/min-max/パーセンタイル等）してから合成したと分かる",
            "c4_hazard": "洪水は足切りで扱い（除外に言及）、災害レベルを線形加点していない",
            "c5_sensitivity": "重みを振った敏感度（±20%等）に触れ、頑健か僅差かを言っている",
            "c6_limits": "限界：地価は公示価格＝マンション価格の代理・駅の代表点基準・ハザードは想定（今ではない）のすべてに触れている",
            "c7_top5": "上位5駅前後の提案で、各駅に効いた要因と弱点がある",
        },
        "build_needs_hazard": True,
        "require_list": True,
        "require_search": False,
        "require_bash": True,
        "forbidden": FORBIDDEN_SAFETY,
    },
    "transport": {
        "turn1": "東急電鉄の路線について、ダイヤ見直しの参考になる駅ごとの需要分析をしてほしいです。",
        "turn2": (
            "対象は東急東横線でお願いします。目的は今後10年の需要維持性の把握（中期計画の材料）です。"
            "コロナからの回復と将来人口の両方を見たいです。"
        ),
        "ask_criteria": """あなたは受け入れテストの採点者。以下はアシスタントの応答（輸送計画の相談のターン1）。
合格条件（全部満たすときだけ pass）:
- 駅ごとの分析結果をまだ出していない
- ①何の検討材料か（目的） ②対象路線・区間の確定 ③時間軸（直近回復か中長期か）のうち 2 点以上を質問している
JSON だけを出力: {"pass": true/false, "reason": "1文"}""",
        "full_checks": {
            "j_units": "数値に単位・年次が添えられている",
            "j_method": "分析の方法（回帰・4象限分類・正規化など）を明記している",
            "j_scope": "ダイヤ・駅間の断面輸送量・混雑率・時間帯別データを「持っていない」と明言し、増発・減便など運行計画を断定していない",
            "j_proxy": "乗降客数は「駅の利用」であり通過する断面需要ではないことに触れている",
            "j_classify": "駅を分類または比較した表があり、駅ごとに根拠が付いている",
            "j_limits_sources": "将来人口が推計（一つの前提）であることと、出典に触れている",
        },
        "build_needs_hazard": False,
        "require_list": True,
        "require_search": False,
        "require_bash": True,
        "forbidden": None,
    },
    "market": {
        "turn1": "カフェの出店を考えています。候補駅の商圏分析をお願いできますか？",
        "turn2": (
            "業種はカフェ（飲食）です。商圏は徒歩圏の500mで。"
            "候補は横浜駅・武蔵小杉駅・自由が丘駅の3駅を比較してください。"
            "需要と競合のバランス重視で、地価も参考に見たいです。"
        ),
        "ask_criteria": """あなたは受け入れテストの採点者。以下はアシスタントの応答（出店相談のターン1）。
合格条件（全部満たすときだけ pass）:
- 商圏分析の結果をまだ出していない
- ①業種（対応するデータ区分） ②商圏の半径 ③候補駅の有無 ④重視軸 のうち 2 点以上を質問している
JSON だけを出力: {"pass": true/false, "reason": "1文"}""",
        "full_checks": {
            "j_units": "数値に単位・年次・半径（500m）が添えられている",
            "j_estimated": "売上が按分による推計であること、2021年調査＝2020年（コロナ影響年）に触れている",
            "j_proxy": "従業者＝昼間の活動量の proxy・競合＝同業集積の proxy（店舗数そのものではない）・地価＝賃料ではない、のうち 2 つ以上を明示している",
            "j_compare": "3 駅の比較表があり、各駅に強み/弱みが付いている",
            "j_no_promise": "「必ず儲かる」類の断定や、賃料・視認性などデータに無いことの断定をしていない",
            "j_limits_sources": "限界と出典に触れている",
        },
        "build_needs_hazard": False,
        "require_list": False,
        "require_search": True,
        # 少数駅（3 駅）の並記比較は preview から直接表を組んでよい（方法論 §6）——Bash 必須にしない。
        "require_bash": False,
        "forbidden": None,
    },
}

MCP_MAX_CALLS = 10
DETAIL_MAX_CALLS = 3


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


def full_judge_prompt(full_checks: dict[str, str]) -> str:
    lines = [f' "{key}": bool,  // {desc}' for key, desc in full_checks.items()]
    body = "\n".join(lines)
    return (
        "あなたは受け入れテストの採点者。以下は分析の最終応答とツール使用の要約。\n"
        "各項目を個別に判定し、JSON だけを出力:\n{\n" + body + '\n "reason": "落ちた項目の理由を1-2文"}'
    )


def tool_count(tools: list[dict], short_name: str) -> int:
    return sum(1 for t in tools if is_station_tool(t["name"], short_name))


def grade_run(scenario: dict, turn1: dict, turn2: dict, judge_model: str) -> dict:
    """ターン1（先に聞く）＋ターン2（本走）の決定的＋LLM 判定。"""
    verdicts: dict[str, dict] = {}

    def add(name: str, ok: bool, detail: str) -> None:
        verdicts[name] = {"pass": bool(ok), "detail": detail}

    # --- ターン1：ツールより先に聞く ---
    t1_build = tool_count(turn1["tools"], "build_dataset")
    t1_list = tool_count(turn1["tools"], "list_stations")
    add("ask/no-data-tools", t1_build == 0 and t1_list == 0, f"build={t1_build} list={t1_list}")
    ask_judge = judge(scenario["ask_criteria"], turn1["text"], judge_model)
    add("ask/asks-requirements", ask_judge.get("pass", False), str(ask_judge.get("reason", "")))

    # --- ターン2：本走 ---
    builds = [t for t in turn2["tools"] if is_station_tool(t["name"], "build_dataset")]
    if scenario["build_needs_hazard"]:
        hazard_ok = any(t["input"].get("includeHazard") is True for t in builds)
        add(
            "full/build-dataset-hazard",
            len(builds) >= 1 and hazard_ok,
            f"calls={len(builds)} hazard={hazard_ok}",
        )
    else:
        add("full/build-dataset", len(builds) >= 1, f"calls={len(builds)}")
    if scenario["require_list"]:
        add("full/list-stations", tool_count(turn2["tools"], "list_stations") >= 1, "")
    if scenario["require_search"]:
        found = tool_count(turn2["tools"], "search_stations") + tool_count(
            turn2["tools"], "list_stations"
        )
        add("full/search-or-list", found >= 1, f"calls={found}")
    if scenario["require_bash"]:
        add("full/local-analysis(Bash)", any(t["name"] == "Bash" for t in turn2["tools"]), "")
    detail_calls = tool_count(turn2["tools"], "get_station_detail")
    add("full/few-detail-calls", detail_calls <= DETAIL_MAX_CALLS, f"get_station_detail={detail_calls}")
    mcp_calls = sum(1 for t in turn2["tools"] if is_data_tool(t["name"]))
    add("full/few-mcp-calls", mcp_calls <= MCP_MAX_CALLS, f"data-tool calls={mcp_calls}")
    forbidden = scenario["forbidden"]
    if forbidden is not None:
        add("full/no-safety-claim", forbidden.search(turn2["text"]) is None, "")
    add("full/cites-sources", "出典" in turn2["text"], "")

    tool_summary = ", ".join(sorted({t["name"].split("__")[-1] for t in turn2["tools"]}))
    full_judge = judge(
        full_judge_prompt(scenario["full_checks"]),
        f"[使ったツール] {tool_summary}\n\n[最終応答]\n{turn2['text']}",
        judge_model,
    )
    for key in scenario["full_checks"]:
        add(f"full/{key}", full_judge.get(key, False), str(full_judge.get("reason", "")))

    verdicts["_pass"] = {
        "pass": all(v["pass"] for k, v in verdicts.items() if not k.startswith("_")),
        "detail": "",
    }
    return verdicts


def main() -> int:
    parser = argparse.ArgumentParser(description="golden シナリオ受け入れテスト（§11・3 ユースケース）")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="housing")
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

    scenario = SCENARIOS[args.scenario]
    out = Path(args.out) if args.out else RESULTS_BASE / f"{now_stamp()}-{args.scenario}"
    out.mkdir(parents=True, exist_ok=True)
    print(
        f"golden シナリオ({args.scenario}): {args.runs} 回・model={args.model}・judge={args.judge_model} → {out}"
    )

    passes, total_cost = 0, 0.0
    for run_no in range(1, args.runs + 1):
        work = out / f"run-{run_no}" / "work"
        work.mkdir(parents=True, exist_ok=True)
        print(f"--- run {run_no}/{args.runs} ---")
        turn1 = run_claude(
            scenario["turn1"], work, args.model, None, 600, out / f"run-{run_no}" / "turn1.jsonl"
        )
        print(f"  turn1: tools={len(turn1['tools'])} cost=${turn1['cost']:.2f}")
        turn2 = run_claude(
            scenario["turn2"],
            work,
            args.model,
            turn1["session_id"],
            1800,
            out / f"run-{run_no}" / "turn2.jsonl",
        )
        print(f"  turn2: tools={len(turn2['tools'])} cost=${turn2['cost']:.2f} text={len(turn2['text'])}字")
        verdicts = grade_run(scenario, turn1, turn2, args.judge_model)
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
        json.dumps(
            {"scenario": args.scenario, "passes": passes, "runs": args.runs, "cost_usd": total_cost},
            ensure_ascii=False,
        )
    )
    return 0 if passes == args.runs else 1


if __name__ == "__main__":
    sys.exit(main())
