"""e-Stat API の共通部品（`estat_api.py`）が、appId を出さないことを確かめる（2026-10-10 B5 で見つけたこと 3）。

requests の例外の文には URL（appId を含む）が入る。以前の取得スクリプト 4 本は、失敗したときにそれをそのまま出していた。

  1. 失敗の言い方：HTTP の誤りは状態だけ・接続の失敗と時間切れは型だけ・e-Stat の誤りは STATUS と ERROR_MSG・ほかの例外に
     紛れた appId は伏せる
  2. 呼び方：appId はここで足す（呼び出し側の引数に持たせない）・STATUS 0/1 は正常・再試行して成功すれば返す
  3. 取得スクリプト（所得・15〜64 歳人口・産業別・売上・エリアの公表値）は appId を自分で扱わない（`appId` の文字と
     `app_id()` の定義は estat_api.py にしか無い）
  4. --live：本物の e-Stat に小さな要求を出す。成功（表の一覧 1 件）と失敗（無い表・無い URL）の両方で、出す文に appId が出ない

    python3 pipeline/estat_api_test.py          # 通信を差し替えて確かめる（appId は使わない）
    python3 pipeline/estat_api_test.py --live   # 本物の e-Stat にも小さな要求を出す（.env の appId を使う・値は出さない）
"""

from __future__ import annotations

import re
import sys
from collections.abc import Callable
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import estat_api  # noqa: E402

FAKE_ID = "FAKEAPPID0123456789"
DATA_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"
LIST_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList"
FETCHERS = ("fetch_income", "fetch_sales", "fetch_working_age_mesh", "fetch_industry_mesh", "fetch_area_stats")


class Checks:
    def __init__(self) -> None:
        self.failed = 0
        self.total = 0

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.total += 1
        self.failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")


class FakeResponse:
    """requests.Response の代わり（状態・JSON・本文）。"""

    def __init__(self, status: int, payload: object = None, text: str = "") -> None:
        self.status_code = status
        self._payload = payload
        self.text = text
        self.encoding = "ISO-8859-1"
        self.url = f"{DATA_ENDPOINT}?appId={FAKE_ID}&statsDataId=0003448233"

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            # 本物と同じく、文に URL（appId つき）が入る
            raise requests.HTTPError(f"{self.status_code} Client Error: Bad Request for url: {self.url}", response=self)

    def json(self) -> object:
        return self._payload


def message_of(call: Callable[[], object]) -> str:
    """SystemExit で落ちたときの文（落ちなければ空）。"""
    try:
        call()
    except SystemExit as error:
        return str(error)
    return ""


def leaks(text: str, secret: str) -> bool:
    return secret in text or re.search(r"appId=(?!\*\*\*)", text) is not None


def with_fake_network(responder: Callable[..., FakeResponse]) -> list[dict[str, object]]:
    """requests.get・appId・待ち時間を差し替える（呼ばれた引数を返す）。"""
    calls: list[dict[str, object]] = []

    def fake_get(url: str, params: dict[str, object], timeout: float) -> FakeResponse:
        calls.append({"url": url, "params": params, "timeout": timeout})
        return responder(url, params)

    estat_api.requests.get = fake_get  # type: ignore[assignment]
    estat_api.app_id = lambda: FAKE_ID  # type: ignore[assignment]
    estat_api._app_id_or_none = lambda: FAKE_ID  # type: ignore[assignment]
    estat_api.time.sleep = lambda _seconds: None  # type: ignore[assignment]
    return calls


def check_describe(checks: Checks) -> None:
    http = requests.HTTPError(f"400 Client Error: Bad Request for url: {DATA_ENDPOINT}?appId={FAKE_ID}", response=FakeResponse(400))
    connection = requests.ConnectionError(
        f"HTTPSConnectionPool(host='api.e-stat.go.jp', port=443): Max retries exceeded with url: /rest/3.0/app/json/getStatsData?appId={FAKE_ID}"
    )
    timeout = requests.ReadTimeout(f"Read timed out. (read timeout=180) url={DATA_ENDPOINT}?appId={FAKE_ID}")
    checks.add(estat_api.describe(http) == "HTTP 400", "HTTP の誤りは状態だけ（URL を出さない）", estat_api.describe(http))
    checks.add(estat_api.describe(connection) == "ConnectionError", "接続の失敗は型だけ", estat_api.describe(connection))
    checks.add(estat_api.describe(timeout) == "ReadTimeout", "時間切れは型だけ", estat_api.describe(timeout))
    masked = estat_api.redact(f"x appId={FAKE_ID}&y {FAKE_ID} z", FAKE_ID)
    checks.add(FAKE_ID not in masked and "appId=***" in masked, "appId は `appId=…` も値そのものも伏せる", masked)


def check_status(checks: Checks) -> None:
    ok = [estat_api.checked({"ROOT": {"RESULT": {"STATUS": status}}}, "ROOT") for status in (0, "0", 1)]
    checks.add(len(ok) == 3, "STATUS 0・1 は正常（数でも文字でも）")
    try:
        estat_api.checked({"ROOT": {"RESULT": {"STATUS": 100, "ERROR_MSG": "統計表IDが不正です。"}}}, "ROOT")
        raised = ""
    except estat_api.EstatError as error:
        raised = str(error)
    checks.add(raised == "e-Stat STATUS 100: 統計表IDが不正です。", "STATUS がそれ以外なら STATUS と ERROR_MSG で落とす", raised)


def check_calls(checks: Checks) -> None:
    calls = with_fake_network(lambda url, params: FakeResponse(200, {"GET_STATS_DATA": {"RESULT": {"STATUS": 0}}}))
    payload = estat_api.get_json(DATA_ENDPOINT, {"statsDataId": "0003448233"}, context="試し", root="GET_STATS_DATA", timeout_s=9)
    sent = calls[-1]["params"] if calls else {}
    checks.add(payload == {"GET_STATS_DATA": {"RESULT": {"STATUS": 0}}} and sent == {"appId": FAKE_ID, "statsDataId": "0003448233"},
               "appId はここで足す（呼び出し側の引数に持たせない）", f"{sorted(sent)}")
    attempts = iter([FakeResponse(503), FakeResponse(200, text="ok")])
    calls = with_fake_network(lambda url, params: next(attempts))
    text = estat_api.get_text(DATA_ENDPOINT, {"statsDataId": "x"}, context="試し", timeout_s=9)
    checks.add(text == "ok" and len(calls) == 2, "再試行して成功すれば返す（CSV は UTF-8 の文字列）", f"{len(calls)} 回")


def check_failures(checks: Checks) -> None:
    def failing(error: Exception) -> Callable[..., FakeResponse]:
        def respond(url: str, params: dict[str, object]) -> FakeResponse:
            raise error
        return respond

    cases: list[tuple[str, Callable[..., FakeResponse], str]] = [
        ("HTTP の誤り（400・文に appId つきの URL）", lambda url, params: FakeResponse(400), "HTTP 400"),
        ("接続の失敗（文に appId つきの URL）", failing(requests.ConnectionError(f"Max retries exceeded with url: /x?appId={FAKE_ID}")), "ConnectionError"),
        ("e-Stat の誤り（STATUS 100）", lambda url, params: FakeResponse(200, {"GET_STATS_DATA": {"RESULT": {"STATUS": 100, "ERROR_MSG": "不正"}}}), "e-Stat STATUS 100: 不正"),
        ("ほかの例外に appId が紛れた", failing(ValueError(f"unexpected appId={FAKE_ID} {FAKE_ID}")), "ValueError"),
    ]
    for label, responder, expected in cases:
        with_fake_network(responder)
        text = message_of(lambda: estat_api.get_json(DATA_ENDPOINT, {}, context="2025年 人口", root="GET_STATS_DATA", timeout_s=9))
        ok = text.startswith("取得に失敗しました（2025年 人口・3 回試行）") and expected in text and not leaks(text, FAKE_ID)
        checks.add(ok, f"失敗の文に appId を出さない：{label}", text)


def check_fetchers(checks: Checks) -> None:
    pipeline = Path(__file__).resolve().parent
    owners = [path.name for path in sorted(pipeline.glob("*.py"))
              if path.name not in ("estat_api.py", "estat_api_test.py") and '"appId"' in path.read_text(encoding="utf-8")]
    definers = [path.name for path in sorted(pipeline.glob("*.py"))
                if path.name != "estat_api.py" and re.search(r"^def app_id\(", path.read_text(encoding="utf-8"), re.M)]
    checks.add(not owners and not definers, "取得スクリプトは appId を自分で扱わない（estat_api.py だけ）", f"{owners}{definers}")
    users = [name for name in FETCHERS if "estat_api" in (pipeline / f"{name}.py").read_text(encoding="utf-8")]
    checks.add(len(users) == len(FETCHERS), "e-Stat を呼ぶ 5 本が共通の部品を使う", f"{users}")


def check_live(checks: Checks) -> None:
    """本物の e-Stat：成功（表の一覧 1 件）と、失敗（無い表・無い URL）。出す文に本物の appId が出ない。"""
    secret = estat_api.app_id()
    listed = estat_api.get_json(LIST_ENDPOINT, {"statsCode": "00200521", "limit": 1}, context="試し：表の一覧", root="GET_STATS_LIST", timeout_s=60)
    tables = listed["GET_STATS_LIST"]["DATALIST_INF"]  # type: ignore[index]
    checks.add("TABLE_INF" in tables, "本物：表の一覧を 1 件取れる（国勢調査）")
    missing_table = message_of(lambda: estat_api.get_json(DATA_ENDPOINT, {"statsDataId": "0000000000"}, context="試し：無い表", root="GET_STATS_DATA", timeout_s=60, retries=1))
    # 検査の表示も伏せてから出す（万一漏れていても、この画面に appId を出さない）
    checks.add("e-Stat STATUS" in missing_table and not leaks(missing_table, secret), "本物：無い表は STATUS と ERROR_MSG だけで落ちる",
               estat_api.redact(missing_table, secret))
    missing_path = message_of(lambda: estat_api.get_text(DATA_ENDPOINT.replace("getStatsData", "getStatsDataNope"), {}, context="試し：無い URL", timeout_s=60, retries=1))
    checks.add(missing_path.startswith("取得に失敗しました") and not leaks(missing_path, secret), "本物：無い URL（HTTP の誤り）も appId を出さない",
               estat_api.redact(missing_path, secret))


def main() -> int:
    checks = Checks()
    live = "--live" in sys.argv
    if live:
        check_live(checks)  # 差し替える前に本物を呼ぶ
    check_describe(checks)
    check_status(checks)
    check_calls(checks)
    check_failures(checks)
    check_fetchers(checks)
    print(f"\n{checks.total - checks.failed} / {checks.total} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
