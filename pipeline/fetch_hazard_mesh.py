"""水害ハザードの原典データを取得する（Phase 1b・`docs/260824_flood.md` §8.2 PR1）。

取るのは 3 つだけ。決定 4 で「メッシュ化は洪水・内水のみ」と決めてあるので、
高潮・津波・土砂は**表示（タイル）専用**で、ここでは落とさない。

| データ | 中身 | 単位 |
|---|---|---|
| **A31b** 洪水浸水想定区域（1次メッシュ単位）| 計画規模・想定最大規模・浸水継続時間・家屋倒壊 2 種 | **1 次メッシュごと** |
| **A51** 雨水出水（内水）浸水想定区域 | 浸水深 | 都道府県ごと（中は市町村別）|
| **G04-d** 標高・傾斜度 5 次メッシュ | 平均・最低標高・海面下フラグ | **1 次メッシュごと** |

⚠ プランは A31a（河川単位）を挙げていたが、**A31b（1 次メッシュ単位）を使う**。
中身は同じ原典（A31b は A31a をオーバレイして 1 次メッシュで切ったもの）で、
①**出力の単位（1 次メッシュ）とファイルの単位が一致**するので巨大ファイルをメモリに載せずに済み、
②総量も小さい（SHP で 4.3GB 対 5.9GB）。理由は `docs/260824_flood.md` §5.8 に記録した。

    python3 pipeline/fetch_hazard_mesh.py            # 未取得ぶんだけ落とす（何度でも実行可）
    python3 pipeline/fetch_hazard_mesh.py --list     # 落とさずに対象一覧と総量だけ出す

落としたものは `data/hazard_raw/`（gitignore）に置く。コミットされるのはコードだけ。
"""

from __future__ import annotations

import html
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "hazard_raw"

DATALIST = "https://nlftp.mlit.go.jp/ksj/gml/datalist/{page}.html"
DOWNLOAD = "https://nlftp.mlit.go.jp/ksj/gml/data/{identifier}/{release}/{name}"
USER_AGENT = "Mozilla/5.0 (AI Database Map / hazard mesh pipeline)"

# 同時接続数。相手は官公庁のサイトなので、速度より行儀を優先する。
MAX_WORKERS = 3
# 1 ファイルのタイムアウト（秒）。最大 341MB のファイルがある。
DOWNLOAD_TIMEOUT_S = 900
# 失敗時の再試行回数と待ち（秒）。
RETRY_COUNT = 3
RETRY_WAIT_S = 5


@dataclass(frozen=True)
class Source:
    """取得対象の 1 系統。"""

    identifier: str  # 'A31b' など、ダウンロード URL の識別子
    release: str  # 'A31b-25' など、年度版のディレクトリ名
    page: str  # datalist のページ名
    pattern: str  # ファイル名の正規表現（この系統のものだけ拾う）
    labelJa: str


SOURCES: list[Source] = [
    Source(
        identifier="A31b",
        release="A31b-25",
        page="KsjTmplt-A31b-2025",
        pattern=r"A31b-25_\d+_\d{4}_SHP\.zip",
        labelJa="洪水浸水想定区域（1次メッシュ単位・2025年度）",
    ),
    Source(
        identifier="A51",
        release="A51-25",
        page="KsjTmplt-A51-2025",
        pattern=r"A51-25_\d+_GML\.zip",
        labelJa="雨水出水（内水）浸水想定区域（2025年度）",
    ),
    Source(
        identifier="G04-d",
        release="G04-d-11",
        page="KsjTmplt-G04-d",
        pattern=r"G04-d-11_\d{4}-jgd_GML\.zip",
        labelJa="標高・傾斜度5次メッシュ（2011年度）",
    ),
]


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read().decode("utf-8", "replace")
    except urllib.error.URLError as error:
        raise RuntimeError(f"ページを取得できません: {url}") from error


def parse_file_sizes(page_html: str, pattern: str) -> dict[str, float]:
    """datalist のダウンロード表から {ファイル名: MB} を読む（対象パターンのみ）。"""
    sizes: dict[str, float] = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
        cells = [
            re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", cell)).strip())
            for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        ]
        name = next((m[0] for c in cells if (m := re.findall(pattern, c))), None)
        size = next((c for c in cells if re.fullmatch(r"[\d.]+MB", c)), None)
        if name is not None:
            sizes[name] = float(size[:-2]) if size else 0.0
    return sizes


def list_targets() -> list[tuple[Source, str, float]]:
    """全系統の (系統, ファイル名, MB) を datalist から集める。"""
    targets: list[tuple[Source, str, float]] = []
    for source in SOURCES:
        page_html = fetch_text(DATALIST.format(page=source.page))
        sizes = parse_file_sizes(page_html, source.pattern)
        if not sizes:
            raise RuntimeError(f"ダウンロード対象が 0 件: {source.page}（ページ構造が変わった可能性）")
        targets.extend((source, name, mb) for name, mb in sorted(sizes.items()))
    return targets


def download(source: Source, name: str) -> tuple[str, str]:
    """1 ファイルを取得する（既にあれば何もしない）。戻り値は (ファイル名, 状態)。"""
    destination = RAW_DIR / name
    if destination.exists() and destination.stat().st_size > 0:
        return name, "skip"
    url = DOWNLOAD.format(identifier=source.identifier, release=source.release, name=name)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    temporary = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as response:
                temporary.write_bytes(response.read())
            temporary.rename(destination)
            return name, "ok"
        except Exception as error:  # noqa: BLE001 — 原因を残して再試行する
            temporary.unlink(missing_ok=True)
            if attempt == RETRY_COUNT:
                return name, f"NG({type(error).__name__}: {error})"
            time.sleep(RETRY_WAIT_S * attempt)
    return name, "NG(unreachable)"


def report_plan(targets: list[tuple[Source, str, float]]) -> None:
    for source in SOURCES:
        mine = [t for t in targets if t[0] is source]
        have = sum(1 for _, name, _ in mine if (RAW_DIR / name).exists())
        total_mb = sum(mb for _, _, mb in mine)
        print(f"  {source.labelJa}: {len(mine)} ファイル / {total_mb:,.0f} MB（取得済み {have}）")


def main(argv: list[str]) -> int:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    targets = list_targets()
    print(f"対象 {len(targets)} ファイル")
    report_plan(targets)
    if "--list" in argv:
        return 0

    pending = [(source, name) for source, name, _ in targets if not (RAW_DIR / name).exists()]
    print(f"未取得 {len(pending)} ファイルを取得します（同時 {MAX_WORKERS} 本）")
    failures: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for name, status in executor.map(lambda item: download(*item), pending):
            done += 1
            if status.startswith("NG"):
                failures.append(f"{name} {status}")
            if done % 25 == 0 or done == len(pending):
                print(f"    {done}/{len(pending)} 完了", flush=True)

    total_bytes = sum(path.stat().st_size for path in RAW_DIR.glob("*.zip"))
    print(f"✓ {RAW_DIR.relative_to(ROOT)} — {len(list(RAW_DIR.glob('*.zip')))} ファイル / {total_bytes / 1e9:.2f} GB")
    if failures:
        print(f"✗ 失敗 {len(failures)} 件（再実行すれば続きから取得します）")
        for line in failures[:20]:
            print("   ", line)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
