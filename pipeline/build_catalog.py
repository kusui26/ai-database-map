"""P1 — メトリクス・カタログ生成。

`data/derived/station_dataset.csv`（668列）のヘッダを読み、値列（658）を CatalogEntry へ、
識別列（10）を駅属性へ振り分けて `src/shared/catalog/catalog.json` を出力する。
あわせて目視レビュー用の日本語ラベル一覧 `docs/catalog_labels.md` を出力する。

    python3 pipeline/build_catalog.py

カタログは「コードが正・DB はミラー」（plan_fable §2.2-③）の契約物としてコミットする。
"""

from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_rules import (  # noqa: E402
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    IDENTITY_COLUMNS,
    build_entry,
    entry_to_dict,
)

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "derived" / "station_dataset.csv"
OUT_JSON = ROOT / "src" / "shared" / "catalog" / "catalog.json"
OUT_LABELS = ROOT / "docs" / "catalog_labels.md"


def read_header() -> list[str]:
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return next(csv.reader(f))


def render_labels(entries: list, header_len: int) -> str:
    by_cat: dict[str, list] = defaultdict(list)
    for e in entries:
        by_cat[e.category].append(e)

    lines: list[str] = [
        "# メトリクス・カタログ ラベル一覧（自動生成）",
        "",
        f"`pipeline/build_catalog.py` が `station_dataset.csv`（{header_len}列）から生成。"
        f" 値列 {len(entries)} エントリ ＋ 駅属性 {len(IDENTITY_COLUMNS)}。",
        "",
        "凡例: `key` — ラベル 〔単位・format・rankable・⚠→信頼性フラグ〕",
        "",
    ]
    for cat in CATEGORY_ORDER:
        es = by_cat.get(cat, [])
        lines.append(f"## {CATEGORY_LABELS[cat]}（{cat}）— {len(es)}件")
        lines.append("")
        for e in es:
            meta = [e.unit or "—", e.format or "—", "rankable" if e.rankable else "not-rankable"]
            if e.reliabilityFlagKey:
                meta.append(f"⚠→{e.reliabilityFlagKey}")
            lines.append(f"- `{e.key}` — {e.labelJa} 〔{'・'.join(meta)}〕")
        lines.append("")

    lines.append("## 駅属性（識別・非指標）")
    lines.append("")
    for a in IDENTITY_COLUMNS:
        lines.append(f"- `{a['key']}` — {a['labelJa']}（{a['type']}）")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    header = read_header()
    identity_keys = {c["key"] for c in IDENTITY_COLUMNS}

    entries = [build_entry(col) for col in header if col not in identity_keys]

    # 早期の健全性チェック（詳細照合は validate_catalog.py）
    assert len(entries) + len(IDENTITY_COLUMNS) == len(header), "エントリ数と列数が不一致"
    keys = [e.key for e in entries]
    assert len(keys) == len(set(keys)), "key の重複"

    catalog = {
        "version": 1,
        "generatedFrom": "data/derived/station_dataset.csv",
        "columnCount": len(header),
        "stationAttributeCount": len(IDENTITY_COLUMNS),
        "entryCount": len(entries),
        "radii": [500, 1000, 2000, 5000, 10000, 20000],
        "categories": CATEGORY_ORDER,
        "stationAttributes": IDENTITY_COLUMNS,
        "entries": [entry_to_dict(e) for e in entries],
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    OUT_LABELS.write_text(render_labels(entries, len(header)) + "\n", encoding="utf-8")

    # サマリ
    per_cat = Counter(e.category for e in entries)
    print(f"✓ {OUT_JSON.relative_to(ROOT)} — {len(entries)} entries（列 {len(header)}／属性 {len(IDENTITY_COLUMNS)}）")
    for cat in CATEGORY_ORDER:
        print(f"    {cat:22s} {per_cat.get(cat, 0):4d}")
    print(f"    rankable {sum(1 for e in entries if e.rankable)} / flag {sum(1 for e in entries if e.kind == 'flag')}")
    print(f"✓ {OUT_LABELS.relative_to(ROOT)} — ラベル一覧")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
