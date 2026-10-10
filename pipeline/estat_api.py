"""e-Stat API の共通部品（appId の読み方・呼び方・失敗の言い方・2026-10-10 B5 で見つけたこと 3）。

**appId と完全なリクエスト URL は出力しない**（`.claude/CLAUDE.md` §5）。requests の例外の文には URL（appId を含む）が入る：

  - `raise_for_status()` の HTTPError：`400 Client Error: Bad Request for url: https://api.e-stat.go.jp/…?appId=…`
  - 接続の失敗・時間切れ：`HTTPSConnectionPool(host=…): Max retries exceeded with url: /rest/3.0/app/…?appId=…`

以前の取得スクリプト 4 本（所得・15〜64 歳人口・産業別の事業所と従業者・売上）は、失敗したときにこの文をそのまま出していた。
ここでは失敗の理由を、例外の型・HTTP の状態・e-Stat の STATUS と ERROR_MSG だけで書く。出す前に、念のため appId の値と
`appId=…` を伏せる（ほかの例外の文に紛れ込んでも出さない）。appId は呼ぶときにここで足す（呼び出し側の引数に持たせない）。
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import TypeVar

import requests

ROOT = Path(__file__).resolve().parents[1]
#: e-Stat の RESULT.STATUS（0＝正常・1＝正常だが該当なし）。それ以外は誤り。
OK_STATUSES = frozenset({"0", "1"})
RETRIES = 3
#: 再試行の間隔（試行の回数 × この秒数）。
WAIT_S = 2.0
APP_ID_LINE = re.compile(r'\s*(?:export\s+)?ESTAT_APP_ID\s*=\s*"?([^"\s#]+)"?')
APP_ID_IN_TEXT = re.compile(r"appId=[^&\s'\"]*")
MASK = "***"

T = TypeVar("T")


class EstatError(RuntimeError):
    """e-Stat が誤りを返した（文は STATUS と ERROR_MSG だけ。URL も appId も含まない）。"""


def _app_id_or_none() -> str | None:
    env = ROOT / ".env"
    if not env.exists():
        return None
    for line in env.read_text(encoding="utf-8").splitlines():
        found = APP_ID_LINE.match(line)
        if found:
            return found.group(1)
    return None


def app_id() -> str:
    """`.env` から e-Stat の appId を読む（値は決してログに出さない）。"""
    if not (ROOT / ".env").exists():
        raise SystemExit(".env がありません（ESTAT_APP_ID が要ります）")
    found = _app_id_or_none()
    if found is None:
        raise SystemExit("ESTAT_APP_ID が .env にありません")
    return found


def redact(text: str, secret: str | None) -> str:
    """文から appId（`appId=…` と値そのもの）を伏せる。"""
    masked = APP_ID_IN_TEXT.sub(f"appId={MASK}", text)
    return masked.replace(secret, MASK) if secret else masked


def describe(error: BaseException) -> str:
    """失敗の言い方。URL を含みうる requests の例外は、型と HTTP の状態だけにする。"""
    if isinstance(error, requests.HTTPError) and error.response is not None:
        return f"HTTP {error.response.status_code}"
    if isinstance(error, requests.RequestException):
        return type(error).__name__
    return f"{type(error).__name__}: {error}"


def checked(payload: Mapping[str, object], root: str) -> Mapping[str, object]:
    """e-Stat の JSON の RESULT.STATUS を見る（誤りなら STATUS と ERROR_MSG で EstatError）。"""
    result = payload[root]["RESULT"]  # type: ignore[index]
    status = str(result["STATUS"])
    if status not in OK_STATUSES:
        raise EstatError(f"e-Stat STATUS {status}: {result.get('ERROR_MSG', '')}")
    return payload


def with_retry(call: Callable[[], T], context: str, retries: int = RETRIES, wait_s: float = WAIT_S) -> T:
    """呼んで返す（retries 回まで）。失敗したら、文脈と、URL も appId も含まない理由で落とす。"""
    last = ""
    for attempt in range(1, retries + 1):
        try:
            return call()
        except Exception as error:  # noqa: BLE001 — 理由を伏せて上位へ渡す
            last = describe(error)
            if attempt < retries:
                time.sleep(wait_s * attempt)
    raise SystemExit(redact(f"取得に失敗しました（{context}・{retries} 回試行）: {last}", _app_id_or_none()))


def get_response(endpoint: str, params: Mapping[str, object], timeout_s: float) -> requests.Response:
    """appId を足して GET する（HTTP の誤りは HTTPError）。"""
    response = requests.get(endpoint, params={"appId": app_id(), **params}, timeout=timeout_s)
    response.raise_for_status()
    return response


def get_json(
    endpoint: str,
    params: Mapping[str, object],
    *,
    context: str,
    root: str,
    timeout_s: float,
    retries: int = RETRIES,
    wait_s: float = WAIT_S,
) -> Mapping[str, object]:
    """JSON の API（getStatsData・getStatsList）を呼ぶ。`root` は応答の頭（`GET_STATS_DATA` など）で、STATUS を見る。"""
    return with_retry(lambda: checked(get_response(endpoint, params, timeout_s).json(), root), context, retries, wait_s)


def get_text(
    endpoint: str,
    params: Mapping[str, object],
    *,
    context: str,
    timeout_s: float,
    retries: int = RETRIES,
    wait_s: float = WAIT_S,
) -> str:
    """CSV の API（getSimpleStatsData）を呼ぶ（UTF-8 の文字列で返す）。"""
    def call() -> str:
        response = get_response(endpoint, params, timeout_s)
        response.encoding = "utf-8"
        return response.text
    return with_retry(call, context, retries, wait_s)
