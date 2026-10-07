"""路線（運行系統）と駅の対応を独立に検証する（L1・2026-10-08・docs/261001_fix_user_feedback_ui.md §6.8.5）。

build_lines.py の結果（data/derived/lines.csv・line_stations.csv・line_links.csv・line_unassigned.csv）を、
**build の照合のコードを使わずに**、原典（駅データ.jp）・アプリの駅・S12 の路線から確かめる。

  1. 網羅：営業中の駅レコードはすべて結べている（結べなくてよいのは UNLINKED_OK だけ）。直しの表が全部効いている
  2. 形：路線・路線の駅の重複や番号の飛びが無い。駅数が合う
  3. 取り違えの兆候：①路線の会社名に合う同名の駅を飛ばしていない ②路線の会社名を持つ駅が 300m 以内にあるのに別の駅に結んでいない
  4. 事業者 → 会社名：割合が低い事業者は人が確かめた表（REVIEWED_OPERATORS）にある
  5. 固定の確認（LINE_CHECKS・EXPECTED_LOOPS）：利用者が言う路線になっている・直しが効いている
  6. どの路線にも属さない駅（乗降がある／前回の投入から増えた）に「要対応」が無い
  7. （参考）法令上の路線 1 本との一致の割合
  8. --osm：主な系統を OpenStreetMap の系統と突き合わせる（ネットワークを使う。結果は data/derived/osm_cache/ にキャッシュ）

    python3 pipeline/validate_lines.py          # 全 PASS で exit 0
    python3 pipeline/validate_lines.py --osm    # OSM との突き合わせも行う
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import line_common as common  # noqa: E402
import line_rules as rules  # noqa: E402
from line_common import AppStation  # noqa: E402

#: 「路線の会社名を持つ駅がすぐそばにある」とみなす距離（m）。同じ駅の別の駅グループを拾うための近さ。
NEARBY_OPERATOR_M = 300.0
#: OSM の停車位置からアプリの駅を探す範囲（m）。
OSM_MATCH_M = 1000.0
OSM_CACHE = common.DERIVED / "osm_cache"
OVERPASS_ENDPOINTS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")


class Checks:
    def __init__(self) -> None:
        self.results: list[tuple[bool, str, str]] = []

    def add(self, ok: bool, name: str, detail: str = "") -> None:
        self.results.append((ok, name, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")

    @property
    def failed(self) -> int:
        return sum(1 for ok, _, _ in self.results if not ok)


def load_outputs() -> tuple[dict[str, dict[str, str]], list[dict[str, str]], list[dict[str, str]], list[dict[str, str]]]:
    lines = {row["line_cd"]: row for row in common.read_csv(common.LINES_CSV)}
    members = common.read_csv(common.LINE_STATIONS_CSV)
    links = common.read_csv(common.LINE_LINKS_CSV)
    unassigned = common.read_csv(common.LINE_UNASSIGNED_CSV)
    return lines, members, links, unassigned


def check_coverage(checks: Checks, source: common.Source, links: list[dict[str, str]]) -> None:
    by_cd = {link["station_cd"]: link for link in links}
    missing = [s["station_cd"] for s in source.stations if s["station_cd"] not in by_cd]
    checks.add(not missing, "営業中の駅レコードがすべて結びつけの表にある", f"{len(source.stations)} 件（欠け {len(missing)}）")
    unlinked = {(link["company"], link["name"]) for link in links if not link["grp"]}
    unexpected = unlinked - set(rules.UNLINKED_OK)
    stale = set(rules.UNLINKED_OK) - unlinked
    checks.add(not unexpected, "結べない駅レコードは UNLINKED_OK だけ", f"{sorted(unexpected)}" if unexpected else f"{len(unlinked)} 駅")
    checks.add(not stale, "UNLINKED_OK に、もう結べるものが無い", f"{sorted(stale)}" if stale else "")
    fixed = {(link["company"], link["name"]) for link in links if link["fixed"] == "True"}
    unused = [f"{f.company} {f.name}" for f in rules.NAME_FIXES if (f.company, f.name) not in fixed]
    checks.add(not unused, "名前の直しがすべて効いている", f"{len(rules.NAME_FIXES)} 件" + (f"・効いていない {unused}" if unused else ""))


def check_shape(checks: Checks, lines: dict[str, dict[str, str]], members: list[dict[str, str]], app: dict[str, AppStation]) -> None:
    by_line: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in members:
        by_line[row["line_cd"]].append(row)
    dup = [cd for cd, rows in by_line.items() if len({r["grp"] for r in rows}) != len(rows)]
    checks.add(not dup, "同じ路線に同じ駅が 2 回出ない", f"{dup[:5]}" if dup else f"{len(members)} 行")
    gaps = [cd for cd, rows in by_line.items() if sorted(int(r["seq"]) for r in rows) != list(range(1, len(rows) + 1))]
    checks.add(not gaps, "路線の駅の番号が 1 から飛ばずに並ぶ", f"{gaps[:5]}" if gaps else "")
    counts = [cd for cd, line in lines.items() if int(line["station_count"]) != len(by_line.get(cd, []))]
    checks.add(not counts, "路線の駅数が路線の駅の行数と合う", f"{counts[:5]}" if counts else f"{len(lines)} 路線")
    orphans = sorted({r["grp"] for r in members} - set(app))
    checks.add(not orphans, "路線の駅はすべてアプリの駅", f"{orphans[:5]}" if orphans else "")
    additions = {(lines[r["line_cd"]]["name"], app[r["grp"]].name) for r in members if not r["source_station_cd"]}
    expected = {(a.line, a.station) for a in rules.STATION_ADDITIONS}
    checks.add(additions == expected, "足した駅は STATION_ADDITIONS どおり", f"{sorted(additions)}")


def operator_of_line(lines: dict[str, dict[str, str]], line_cd: str) -> str | None:
    return lines[line_cd]["operator"] or None


def check_mislinks(
    checks: Checks, source: common.Source, links: list[dict[str, str]], lines: dict[str, dict[str, str]],
    app_list: list[AppStation],
) -> None:
    """取り違えの兆候。build の選び方（会社名 → 完全一致 → 近さ）を使わず、結果だけを原典の座標から見直す。"""
    by_name: dict[str, list[AppStation]] = defaultdict(list)
    for station in app_list:
        by_name[station.name].append(station)
    record = {s["station_cd"]: s for s in source.stations}
    app = {s.grp: s for s in app_list}
    skipped_exact, missed_operator, distances = [], [], []
    for link in links:
        if not link["grp"]:
            continue
        src = record[link["station_cd"]]
        lon, lat = float(src["lon"]), float(src["lat"])
        chosen = app[link["grp"]]
        operator = operator_of_line(lines, link["line_cd"])
        distances.append(common.distance_m(lon, lat, chosen.lon, chosen.lat))
        fits = (lambda s: operator is None or operator in s.operators)
        exact_near = [s for s in by_name.get(link["target_name"], [])
                      if common.distance_m(lon, lat, s.lon, s.lat) <= rules.MATCH_RADIUS_M]
        if not common.same_name(chosen.name, link["target_name"]) and any(fits(s) for s in exact_near) and not fits(chosen):
            skipped_exact.append(f"{link['line_name']} {link['name']} → {chosen.name}")
        if operator is not None and operator not in chosen.operators:
            near_operator = [s for s in app_list if operator in s.operators
                             and common.distance_m(lon, lat, s.lon, s.lat) <= NEARBY_OPERATOR_M]
            if near_operator:
                missed_operator.append(f"{link['line_name']} {link['name']} → {chosen.name}（近くに {near_operator[0].name}）")
    checks.add(max(distances) <= rules.MATCH_RADIUS_M, "結んだ駅との距離が上限以内",
               f"中央値 {statistics.median(distances):.0f}m・99% {sorted(distances)[int(len(distances) * 0.99)]:.0f}m・最大 {max(distances):.0f}m")
    checks.add(not skipped_exact, "会社名に合う同名の駅を飛ばしていない", f"{skipped_exact[:5]}" if skipped_exact else "")
    checks.add(not missed_operator, "路線の会社名を持つ駅がすぐそばにあるのに、別の駅へ結んでいない",
               f"{missed_operator[:5]}" if missed_operator else "")


def check_operators(checks: Checks, source: common.Source, links: list[dict[str, str]], lines: dict[str, dict[str, str]], app: dict[str, AppStation]) -> None:
    votes: dict[str, Counter[str]] = defaultdict(Counter)
    totals: Counter[str] = Counter()
    for link in links:
        if link["grp"]:
            totals[link["company"]] += 1
            votes[link["company"]].update(app[link["grp"]].operators)
    low = sorted(name for name, c in votes.items() if c.most_common(1)[0][1] / totals[name] < rules.REVIEW_SHARE)
    unreviewed = [name for name in low if name not in rules.REVIEWED_OPERATORS]
    checks.add(not unreviewed, "対応の割合が低い事業者は、人が確かめた表にある", f"低い {low}" + (f"・未確認 {unreviewed}" if unreviewed else ""))
    stale = [name for name in rules.REVIEWED_OPERATORS if name not in votes]
    checks.add(not stale, "人が確かめた表に、もう無い事業者が残っていない", f"{stale}" if stale else "")
    insane = [name for name, op in rules.REVIEWED_OPERATORS.items() if op is not None and name in votes and op not in votes[name]]
    checks.add(not insane, "人が確かめた会社名は、その事業者の駅に実際に現れる", f"{insane}" if insane else "")
    company_by_line = {cd: source.companies[line["company_cd"]]["company_name"] for cd, line in source.lines.items()}
    blank = [line["name"] for cd, line in lines.items()
             if not line["operator"] and rules.REVIEWED_OPERATORS.get(company_by_line[cd], "") is not None]
    checks.add(not blank, "会社名の無い路線は、人が「対応なし」と決めた事業者のものだけ", f"{blank[:5]}" if blank else "")


def check_fixed(checks: Checks, lines: dict[str, dict[str, str]], members: list[dict[str, str]], app: dict[str, AppStation]) -> None:
    names_by_line: dict[str, list[str]] = defaultdict(list)
    for row in members:
        names_by_line[lines[row["line_cd"]]["name"]].append(app[row["grp"]].name)
    for check in rules.LINE_CHECKS:
        names = names_by_line.get(check.line, [])
        problems = []
        if check.count is not None and len(names) != check.count:
            problems.append(f"駅数 {len(names)}（期待 {check.count}）")
        problems += [f"「{n}」が無い" for n in check.include if n not in names]
        problems += [f"「{n}」が入っている" for n in check.exclude if n in names]
        checks.add(not problems, f"固定の確認：{check.line}", "・".join(problems) or f"{len(names)} 駅")
    loops = {line["name"] for line in lines.values() if line["is_loop"] == "True"}
    missing = [name for name in rules.EXPECTED_LOOPS if name not in loops]
    checks.add(not missing, "環状の路線が環状になっている", f"{sorted(loops)}" + (f"・欠け {missing}" if missing else ""))


def check_unassigned(checks: Checks, members: list[dict[str, str]], unassigned: list[dict[str, str]], app: dict[str, AppStation]) -> None:
    todo = [row["station_name"] for row in unassigned if row["category"] == "要対応"]
    checks.add(not todo, "どの路線にも属さない駅に「要対応」が無い（新駅・改称は直しの表へ）",
               f"{todo}" if todo else f"対象外の路線 {len(unassigned)} 駅（ケーブルカーなど）")
    latest, present = common.latest_presence()
    assigned = {row["grp"] for row in members}
    expected = {grp for grp in present if grp in app and grp not in assigned}
    listed = {row["grp"] for row in unassigned if row.get(f"pax_{latest}") == "True"}
    checks.add(expected == listed, f"{latest} 年に乗降があり路線に属さない駅の一覧が、独立に数え直したものと一致",
               f"{len(expected)} 駅" + (f"・差 {sorted(expected ^ listed)[:5]}" if expected != listed else ""))


def legal_route_summary(members: list[dict[str, str]], lines: dict[str, dict[str, str]]) -> None:
    """（参考）路線ごとに、法令上の路線 1 本で駅がどこまで表せるか（§6.8.1 の数字）。合否には使わない。"""
    legal: dict[tuple[str, str], set[str]] = defaultdict(set)
    for grp, pairs in common.legal_routes().items():
        for pair in pairs:
            legal[pair].add(grp)
    by_line: dict[str, set[str]] = defaultdict(set)
    for row in members:
        by_line[row["line_cd"]].add(row["grp"])
    tally: Counter[str] = Counter()
    for grps in by_line.values():
        if len(grps) < 2:
            continue
        best = max(legal.values(), key=lambda s: (len(grps & s), -len(s - grps)))
        tally["一致" if best == grps else "余分あり" if grps <= best else "欠け"] += 1
    total = sum(tally.values())
    print(f"（参考）法令上の路線 1 本と比べた {total} 路線：" + "・".join(f"{k} {v}（{v / total:.0%}）" for k, v in tally.items()))


def overpass(query: str) -> dict[str, object]:
    data = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(3):
        for endpoint in OVERPASS_ENDPOINTS:
            request = urllib.request.Request(endpoint, data=data, headers={"User-Agent": "ai-database-map/validate_lines"})
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    return json.load(response)
            except Exception as error:  # noqa: BLE001 — 混雑（504）は別の窓口・間を置いて試し直す
                last = error
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass に届かない（{OVERPASS_ENDPOINTS}）：{last}")


def osm_stops(relation: int, refresh: bool) -> list[dict[str, object]]:
    path = OSM_CACHE / f"relation_{relation}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    query = (f'[out:json][timeout:90];relation({relation});'
             '(node(r:"stop");node(r:"stop_entry_only");node(r:"stop_exit_only"););out body;')
    nodes = [e for e in overpass(query)["elements"] if e.get("type") == "node" and e.get("tags", {}).get("name")]
    stops = [{"name": n["tags"]["name"], "lon": n["lon"], "lat": n["lat"]} for n in nodes]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(stops, ensure_ascii=False), encoding="utf-8")
    return stops


def osm_grp(stop: dict[str, object], app_list: list[AppStation]) -> str | None:
    """OSM の停車位置 → アプリの駅（名前の鍵が同じで 1km 以内、無ければ 300m 以内の最寄り）。"""
    lon, lat, key = float(stop["lon"]), float(stop["lat"]), common.name_key(str(stop["name"]))
    near = [(common.distance_m(lon, lat, s.lon, s.lat), s) for s in app_list if abs(s.lat - lat) < 0.02 and abs(s.lon - lon) < 0.02]
    named = [(d, s) for d, s in near if s.key == key and d <= OSM_MATCH_M]
    if named:
        return min(named, key=lambda x: x[0])[1].grp
    close = [(d, s) for d, s in near if d <= NEARBY_OPERATOR_M]
    return min(close, key=lambda x: x[0])[1].grp if close else None


def check_osm(checks: Checks, lines: dict[str, dict[str, str]], members: list[dict[str, str]], app_list: list[AppStation], refresh: bool) -> None:
    app = {s.grp: s for s in app_list}
    grps_by_name: dict[str, set[str]] = defaultdict(set)
    for row in members:
        grps_by_name[lines[row["line_cd"]]["name"]].add(row["grp"])
    for check in rules.OSM_CHECKS:
        ours = set().union(*(grps_by_name.get(name, set()) for name in check.lines))
        stops = [stop for relation in check.relations for stop in osm_stops(relation, refresh)]
        matched = [(stop, osm_grp(stop, app_list)) for stop in stops]
        theirs = {grp for _, grp in matched if grp}
        unmatched = sorted({str(stop["name"]) for stop, grp in matched if grp is None})
        jaccard = len(ours & theirs) / len(ours | theirs) if ours | theirs else 0.0
        only_ours = sorted(app[g].name for g in ours - theirs)
        only_osm = sorted(app[g].name for g in theirs - ours)
        detail = f"重なり {jaccard:.2f}（ここ {len(ours)}・OSM {len(theirs)}）"
        if only_ours or only_osm or unmatched:
            detail += f"・ここだけ {only_ours[:6]}・OSM だけ {only_osm[:6]}・OSM で結べない {unmatched[:4]}"
        checks.add(jaccard >= rules.OSM_MIN_JACCARD, f"OSM：{'＋'.join(check.lines)}（{check.note}）", detail)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--osm", action="store_true", help="OpenStreetMap の系統とも突き合わせる（ネットワークを使う）")
    parser.add_argument("--refresh-osm", action="store_true", help="OSM のキャッシュを使わずに取り直す")
    args = parser.parse_args()

    source = common.load_source()
    app_list = common.load_app_stations()
    app = {s.grp: s for s in app_list}
    lines, members, links, unassigned = load_outputs()
    checks = Checks()
    check_coverage(checks, source, links)
    check_shape(checks, lines, members, app)
    check_mislinks(checks, source, links, lines, app_list)
    check_operators(checks, source, links, lines, app)
    check_fixed(checks, lines, members, app)
    check_unassigned(checks, members, unassigned, app)
    legal_route_summary(members, lines)
    if args.osm or args.refresh_osm:
        check_osm(checks, lines, members, app_list, args.refresh_osm)
    print(f"\n{len(checks.results) - checks.failed} / {len(checks.results)} PASS")
    return 0 if checks.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
