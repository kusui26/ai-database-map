"""水害ハザード・レイヤカタログ生成（Phase 0）。

`hazard_rules.py`（意味の単一の真実）から `src/shared/hazard/hazard-catalog.json` と、
目視レビュー用の `docs/hazard_layers.md` を書き出す。

    python3 pipeline/build_hazard_catalog.py           # 生成して上書き
    python3 pipeline/build_hazard_catalog.py --check   # 生成物が最新かだけ検査（差分があれば exit 1）

`--check` は「JSON を手で書き換えて rules と食い違う」事故を落とすためのゲート。
カタログは「コードが正」の契約物としてコミットする（メトリクス・カタログと同じ扱い）。
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hazard_rules import (  # noqa: E402
    DISCLAIMER_JA,
    GROUP_ORDER,
    LEVEL_ORDER,
    HazardLayer,
    build_layers,
    layer_to_dict,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "src" / "shared" / "hazard" / "hazard-catalog.json"
OUT_LABELS = ROOT / "docs" / "hazard_layers.md"

GROUP_LABELS: dict[str, str] = {
    "flood": "洪水",
    "inland_flood": "内水（雨水出水）",
    "storm_surge": "高潮",
    "tsunami": "津波",
    "landslide": "土砂災害",
    "terrain": "参考：地形",
    "realtime": "今の危険度（リアルタイム）",
}
CATALOG_VERSION = 1


def build_catalog(layers: list[HazardLayer]) -> dict[str, object]:
    return {
        "version": CATALOG_VERSION,
        "generatedFrom": "pipeline/hazard_rules.py",
        "layerCount": len(layers),
        "groups": GROUP_ORDER,
        "levels": LEVEL_ORDER,
        "disclaimerJa": DISCLAIMER_JA,
        "layers": [layer_to_dict(layer) for layer in layers],
    }


def render_json(catalog: dict[str, object]) -> str:
    return json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"


def _rank_line(rank: dict[str, object]) -> str:
    color = rank["color"] or "—"
    source = rank["colorSource"] or "未確定"
    return f"  - `{rank['order']}` {rank['labelJa']} — {rank['meaningJa']}〔{color}・{source}・{rank['level']}〕"


def render_labels(layers: list[HazardLayer]) -> str:
    lines: list[str] = [
        "# ハザード・レイヤカタログ（自動生成）",
        "",
        f"`pipeline/build_hazard_catalog.py` が `pipeline/hazard_rules.py` から生成。全 {len(layers)} レイヤ。",
        "設計の正は [`260824_flood.md`](./260824_flood.md) §3・§5.4。**このファイルは手で編集しない。**",
        "",
        "凡例: `key` — ラベル 〔グループ・年度・更新頻度〕 ／ 階級は `order` ラベル — 意味〔色・配色根拠・危険度〕",
        "",
    ]
    by_group = {group: [layer for layer in layers if layer.group == group] for group in GROUP_ORDER}
    for group in GROUP_ORDER:
        group_layers = by_group.get(group, [])
        lines.append(f"## {GROUP_LABELS[group]}（{group}）— {len(group_layers)} レイヤ")
        lines.append("")
        if not group_layers:
            lines.append("（このグループのレイヤはまだありません）")
            lines.append("")
            continue
        for layer in group_layers:
            vintage = f"{layer.vintage}年度" if layer.vintage else "年度なし"
            lines.append(f"### `{layer.key}` — {layer.labelJa} 〔{group}・{vintage}・{layer.updateCadence}〕")
            lines.append("")
            lines.append(layer.summaryJa)
            lines.append("")
            if layer.tile:
                lines.append(f"- タイル: `{layer.tile.url}`（z{layer.tile.minZoom}–{layer.tile.maxZoom}）")
            lines.append(f"- 出典: {layer.source}")
            lines.append(f"- ライセンス: {layer.license}")
            if layer.coverageNoteJa:
                lines.append(f"- 網羅性: {layer.coverageNoteJa}")
            if layer.fallbackLayersJa:
                lines.append(f"- 空白を埋める参考レイヤ: {'・'.join(layer.fallbackLayersJa)}")
            if layer.ranks:
                lines.append(f"- 階級（{layer.rankUnit or '区分'}）:")
                lines.extend(_rank_line(asdict(rank)) for rank in layer.ranks)
            else:
                lines.append(f"- 階級: 自前で持たない（公式凡例を参照 → {layer.legendUrl}）")
            lines.append("")
    return "\n".join(lines)


def write_if_changed(path: Path, text: str) -> bool:
    """内容が変わるときだけ書く（変わったら True）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    current = path.read_text(encoding="utf-8") if path.exists() else None
    if current == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def report(layers: list[HazardLayer]) -> None:
    per_group = Counter(layer.group for layer in layers)
    rank_total = sum(len(layer.ranks) for layer in layers)
    measured = sum(1 for layer in layers for rank in layer.ranks if rank.colorSource == "measured")
    unset = sum(1 for layer in layers for rank in layer.ranks if rank.color is None)
    print(f"✓ {OUT_JSON.relative_to(ROOT)} — {len(layers)} レイヤ / {rank_total} 階級")
    for group in GROUP_ORDER:
        print(f"    {group:14s} {per_group.get(group, 0):3d}")
    print(f"    配色: official {rank_total - measured - unset} / measured {measured} / 未確定 {unset}")
    print(f"✓ {OUT_LABELS.relative_to(ROOT)} — レイヤ一覧")


def main(argv: list[str]) -> int:
    layers = build_layers()
    keys = [layer.key for layer in layers]
    assert len(keys) == len(set(keys)), f"レイヤ key の重複: {keys}"
    assert all(layer.group in GROUP_ORDER for layer in layers), "未知のグループ"

    json_text = render_json(build_catalog(layers))
    labels_text = render_labels(layers)

    if "--check" in argv:
        stale = [
            path.relative_to(ROOT)
            for path, text in ((OUT_JSON, json_text), (OUT_LABELS, labels_text))
            if not path.exists() or path.read_text(encoding="utf-8") != text
        ]
        if stale:
            print(f"✗ 生成物が hazard_rules.py と食い違う: {', '.join(map(str, stale))}")
            print("  → python3 pipeline/build_hazard_catalog.py で再生成してください")
            return 1
        print("✓ 生成物は hazard_rules.py と一致している")
        return 0

    write_if_changed(OUT_JSON, json_text)
    write_if_changed(OUT_LABELS, labels_text)
    report(layers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
