"""路線（運行系統）と駅の対応を作る（L1・2026-10-08・docs/261001_fix_user_feedback_ui.md §6.8.5）。

駅データ.jp の統合前の CSV（版は line_rules.SOURCE_VERSION）を読み、
  1. 駅レコード（路線 × 駅）をアプリの駅（grp）へ結ぶ。駅名の鍵（line_common.name_key）が同じで
     MATCH_RADIUS_M 以内の駅が候補。複数なら ①路線の事業者の会社名を持つ駅 ②駅名の完全一致 ③近い駅 の順に選ぶ。
     事業者 → S12 の会社名は、1 回目の結びつけで数えて決める（COMPANY_SHARE）。
  2. 直しの表（NAME_FIXES・STATION_ADDITIONS）を当てる。
  3. data/derived/ に書く：lines.csv・line_stations.csv（DB に入れる）、line_links.csv（駅レコードごとの
     結びつけ・監査用）、line_unassigned.csv（乗降がある／前回の投入から増えたのに、どの路線にも属さない駅）。

合否は validate_lines.py（独立の検証）が決める。ここで止まるのは規則の誤り（直しの先が見つからない・
使われない直しがある・足す駅が既に路線にある）だけ。

    python3 pipeline/build_lines.py
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import line_common as common  # noqa: E402
import line_rules as rules  # noqa: E402
from line_common import AppStation, Source  # noqa: E402

#: 駅の追加で、隣の駅からアプリの駅を探す範囲（m）。仙巌園は竜ケ水から 4.3km。
ADDITION_RADIUS_M = 10000.0


class RuleError(SystemExit):
    """直しの表の誤り（データではなく規則を直す）。"""


@dataclass(frozen=True)
class Link:
    """駅レコード 1 つの結びつけ。"""

    station: dict[str, str]
    target_name: str  # 照合に使った駅名（直しの表で読み替えたあと）
    app: AppStation | None
    method: str  # exact＝駅名が完全一致 / key＝鍵だけ一致 / none＝結べない
    by_operator: bool  # 候補を会社名で絞ったか
    fixed: bool  # 直しの表で読み替えたか
    distance_m: float | None


@dataclass(frozen=True)
class Member:
    """路線の駅 1 つ（順番は路線の中の並び）。"""

    grp: str
    source_station_cd: str  # 駅データ.jp の駅コード（追加した駅は空）
    source_name: str


class Matcher:
    """駅名の鍵 → アプリの駅。候補の選び方（会社名 → 完全一致 → 近さ）をここ 1 か所に持つ。"""

    def __init__(self, app: list[AppStation]) -> None:
        self.by_key: dict[str, list[AppStation]] = defaultdict(list)
        for station in app:
            self.by_key[station.key].append(station)

    def candidates(self, name: str, lon: float, lat: float, radius_m: float) -> list[tuple[AppStation, float]]:
        near = ((s, common.distance_m(lon, lat, s.lon, s.lat)) for s in self.by_key.get(common.name_key(name), []))
        return [(s, d) for s, d in near if d <= radius_m]

    def choose(
        self, name: str, lon: float, lat: float, operator: str | None
    ) -> tuple[AppStation | None, str, bool, float | None]:
        """会社名で絞り（絞れるときだけ）、その中で駅名の完全一致を優先し、最後は近さで選ぶ。

        会社名を先にするのは、同じ駅名の別の駅グループがあるとき（島原鉄道の「諫早」は S12 では
        「諫早（雲仙・島原口）」・JR の「諫早」とは別）に、完全一致だけでは他社の駅に当たるため。
        完全一致は、会社名で決まらないとき（富山＝JR・あいの風の「富山」と路面電車の「富山駅」）に効く。
        """
        found = self.candidates(name, lon, lat, rules.MATCH_RADIUS_M)
        if not found:
            return None, "none", False, None
        with_operator = [c for c in found if operator is not None and operator in c[0].operators]
        by_operator = 0 < len(with_operator) < len(found)
        pool = with_operator if by_operator else found
        exact = [c for c in pool if common.same_name(c[0].name, name)]
        station, distance = min(exact or pool, key=lambda c: c[1])
        return station, "exact" if exact else "key", by_operator, distance


def fix_for(station: dict[str, str], source: Source) -> rules.NameFix | None:
    company = source.company_of(station)["company_name"]
    line = source.line_name(station)
    for fix in rules.NAME_FIXES:
        if fix.company == company and fix.name == station["station_name"] and (not fix.lines or line in fix.lines):
            return fix
    return None


def link_all(source: Source, matcher: Matcher, company_operators: dict[str, str]) -> list[Link]:
    links = []
    for station in source.stations:
        fix = fix_for(station, source)
        name = fix.to if fix else station["station_name"]
        operator = company_operators.get(source.lines[station["line_cd"]]["company_cd"])
        app, method, by_operator, distance = matcher.choose(name, float(station["lon"]), float(station["lat"]), operator)
        links.append(Link(station, name, app, method, by_operator, fix is not None, distance))
    return links


def operator_shares(links: list[Link], source: Source) -> dict[str, list[tuple[str, float]]]:
    """事業者 → [(S12 の会社名, その事業者の駅に現れる割合)]（割合の大きい順）。"""
    votes: dict[str, Counter[str]] = defaultdict(Counter)
    totals: Counter[str] = Counter()
    for link in links:
        if link.app is None:
            continue
        company_cd = source.lines[link.station["line_cd"]]["company_cd"]
        totals[company_cd] += 1
        votes[company_cd].update(link.app.operators)
    return {cd: [(op, n / totals[cd]) for op, n in counter.most_common()] for cd, counter in votes.items()}


def company_operators(links: list[Link], source: Source) -> dict[str, str]:
    """事業者 → S12 の会社名。COMPANY_SHARE 以上に現れる会社名がちょうど 1 つなら対応とし、
    割合が REVIEW_SHARE 未満の事業者は REVIEWED_OPERATORS（人が確かめた対応・None は対応なし）を使う。"""
    mapping, ambiguous, unreviewed = {}, [], []
    for company_cd, shares in operator_shares(links, source).items():
        name = source.companies[company_cd]["company_name"]
        if name in rules.REVIEWED_OPERATORS:
            reviewed = rules.REVIEWED_OPERATORS[name]
            if reviewed is not None:
                mapping[company_cd] = reviewed
            continue
        chosen = [op for op, share in shares if share >= rules.COMPANY_SHARE]
        if len(chosen) != 1:
            ambiguous.append((name, chosen))
        elif shares[0][1] < rules.REVIEW_SHARE:
            unreviewed.append((name, shares[:2]))
        else:
            mapping[company_cd] = chosen[0]
    if ambiguous or unreviewed:
        raise RuleError(f"事業者 → 会社名を人が確かめる要がある（REVIEWED_OPERATORS に足す）：{ambiguous + unreviewed}")
    return mapping


def check_fixes_used(links: list[Link], source: Source) -> None:
    used = {fix for link in links if link.fixed and (fix := fix_for(link.station, source)) is not None}
    stale = [f"{fix.company} {fix.name}" for fix in rules.NAME_FIXES if fix not in used]
    if stale:
        raise RuleError(f"使われない名前の直しがある（原典が直った・名前が変わった？）：{stale}")
    broken = [f"{link.station['station_name']} → {link.target_name}" for link in links if link.fixed and link.app is None]
    if broken:
        raise RuleError(f"直しの先の駅がアプリに無い：{broken}")


def ordered_records(source: Source) -> dict[str, list[dict[str, str]]]:
    by_line: dict[str, list[dict[str, str]]] = defaultdict(list)
    for station in source.stations:
        by_line[station["line_cd"]].append(station)
    for records in by_line.values():
        records.sort(key=lambda s: int(s["e_sort"]))
    return by_line


def loop_lines(source: Source, records: dict[str, list[dict[str, str]]]) -> set[str]:
    """環状の路線（並びの最初と最後の駅が、隣の駅の CSV でつながっている）。"""
    edges: dict[str, set[frozenset[str]]] = defaultdict(set)
    for join in source.joins:
        edges[join["line_cd"]].add(frozenset((join["station_cd1"], join["station_cd2"])))
    return {
        line_cd for line_cd, recs in records.items()
        if len(recs) >= 3 and frozenset((recs[0]["station_cd"], recs[-1]["station_cd"])) in edges[line_cd]
    }


def base_members(records: list[dict[str, str]], link_by_cd: dict[str, Link]) -> list[Member]:
    """結べた駅レコードを並び順に（同じ駅グループは最初の 1 回だけ）。"""
    members, seen = [], set()
    for record in records:
        link = link_by_cd[record["station_cd"]]
        if link.app is None or link.app.grp in seen:
            continue
        seen.add(link.app.grp)
        members.append(Member(link.app.grp, record["station_cd"], record["station_name"]))
    return members


def add_station(
    members: list[Member], records: list[dict[str, str]], addition: rules.StationAddition, matcher: Matcher
) -> list[Member]:
    neighbor = next((r for r in records if r["station_name"] == addition.next_to), None)
    if neighbor is None:
        raise RuleError(f"足す駅の隣「{addition.next_to}」が {addition.line} に無い")
    found = matcher.candidates(addition.station, float(neighbor["lon"]), float(neighbor["lat"]), ADDITION_RADIUS_M)
    exact = [s for s, _ in found if common.same_name(s.name, addition.station)]
    if len(exact) != 1:
        raise RuleError(f"足す駅「{addition.station}」が隣の近くに 1 つに決まらない（{len(exact)} 件）")
    station = exact[0]
    if any(m.grp == station.grp for m in members):
        raise RuleError(f"足す駅「{addition.station}」は既に {addition.line} にある（原典が直った？）")
    at = next((i for i, m in enumerate(members) if m.source_station_cd == neighbor["station_cd"]), None)
    if at is None:
        raise RuleError(f"足す駅の隣「{addition.next_to}」がアプリの駅に結べていない（{addition.line}）")
    at = at if addition.side == "before" else at + 1
    return [*members[:at], Member(station.grp, "", addition.station), *members[at:]]


def line_members(
    source: Source, records: dict[str, list[dict[str, str]]], links: list[Link], matcher: Matcher
) -> dict[str, list[Member]]:
    link_by_cd = {link.station["station_cd"]: link for link in links}
    members = {line_cd: base_members(recs, link_by_cd) for line_cd, recs in records.items()}
    name_to_cd = {line["line_name"]: line_cd for line_cd, line in source.lines.items()}
    for addition in rules.STATION_ADDITIONS:
        line_cd = name_to_cd.get(addition.line)
        if line_cd is None:
            raise RuleError(f"足す先の路線「{addition.line}」が無い")
        members[line_cd] = add_station(members[line_cd], records[line_cd], addition, matcher)
    return members


def color(line: dict[str, str]) -> str:
    code = line["line_color_c"].strip()
    return f"#{code.upper()}" if len(code) == 6 else ""


def line_rows(
    source: Source, members: dict[str, list[Member]], operators: dict[str, str], loops: set[str]
) -> list[dict[str, object]]:
    rows = []
    for line_cd, line in sorted(source.lines.items(), key=lambda item: int(item[0])):
        if not members.get(line_cd):
            continue
        company = source.companies[line["company_cd"]]
        rows.append({
            "line_cd": int(line_cd), "name": line["line_name"], "formal_name": line["line_name_h"],
            "company_cd": int(line["company_cd"]), "company_name": company["company_name"],
            "company_short": company["company_name_r"], "operator": operators.get(line["company_cd"], ""),
            "color": color(line), "color_name": line["line_color_t"],
            "line_type": line["line_type"], "is_loop": line_cd in loops,
            "station_count": len(members[line_cd]), "source": f"駅データ.jp {rules.SOURCE_VERSION}",
        })
    return rows


def line_station_rows(members: dict[str, list[Member]]) -> list[dict[str, object]]:
    return [
        {"line_cd": int(line_cd), "grp": m.grp, "seq": seq, "source_station_cd": m.source_station_cd,
         "source_name": m.source_name}
        for line_cd, ms in sorted(members.items(), key=lambda item: int(item[0]))
        for seq, m in enumerate(ms, start=1)
    ]


def link_rows(links: list[Link], source: Source) -> list[dict[str, object]]:
    return [
        {"station_cd": link.station["station_cd"], "line_cd": link.station["line_cd"],
         "line_name": source.line_name(link.station), "company": source.company_of(link.station)["company_name"],
         "name": link.station["station_name"], "target_name": link.target_name,
         "grp": link.app.grp if link.app else "", "app_name": link.app.name if link.app else "",
         "method": link.method, "by_operator": link.by_operator, "fixed": link.fixed,
         "distance_m": round(link.distance_m) if link.distance_m is not None else ""}
        for link in links
    ]


def unassigned_rows(app: list[AppStation], members: dict[str, list[Member]]) -> list[dict[str, object]]:
    """乗降がある（最新年）か、前回の投入から増えたのに、どの路線にも属さない駅。"""
    assigned = {m.grp for ms in members.values() for m in ms}
    latest, present = common.latest_presence()
    loaded = set(common.LOADED_GRPS_TXT.read_text(encoding="utf-8").split()) if common.LOADED_GRPS_TXT.exists() else None
    routes = common.legal_routes()
    rows = []
    for station in app:
        is_new = loaded is not None and station.grp not in loaded
        if station.grp in assigned or not (station.grp in present or is_new):
            continue
        legal = routes.get(station.grp, set())
        not_in_source = bool(legal) and legal <= rules.NOT_IN_SOURCE_ROUTES
        rows.append({
            "grp": station.grp, "station_name": station.name, "operators": "・".join(sorted(station.operators)),
            "legal_routes": "・".join(f"{op} {route}" for op, route in sorted(legal)),
            f"pax_{latest}": station.grp in present, "new_since_load": is_new,
            "category": "対象外の路線" if not_in_source else "要対応",
        })
    return rows


def main() -> int:
    source = common.load_source()
    app = common.load_app_stations()
    matcher = Matcher(app)
    operators = company_operators(link_all(source, matcher, {}), source)
    links = link_all(source, matcher, operators)
    check_fixes_used(links, source)
    records = ordered_records(source)
    members = line_members(source, records, links, matcher)
    lines = line_rows(source, members, operators, loop_lines(source, records))
    unassigned = unassigned_rows(app, members)

    common.write_csv(common.LINES_CSV, common.LINE_COLUMNS, lines)
    common.write_csv(common.LINE_STATIONS_CSV, common.LINE_STATION_COLUMNS, line_station_rows(members))
    links_out = link_rows(links, source)
    common.write_csv(common.LINE_LINKS_CSV, list(links_out[0]), links_out)
    unassigned_columns = list(unassigned[0]) if unassigned else ["grp", "station_name", "category"]
    common.write_csv(common.LINE_UNASSIGNED_CSV, unassigned_columns, unassigned)
    report(source, links, lines, members, operators, unassigned)
    return 0


def report(
    source: Source, links: list[Link], lines: list[dict[str, object]], members: dict[str, list[Member]],
    operators: dict[str, str], unassigned: list[dict[str, object]],
) -> None:
    linked = [link for link in links if link.app is not None]
    methods = Counter(link.method for link in linked)
    print(f"駅データ.jp {rules.SOURCE_VERSION}：営業中の路線 {len(source.lines)}・駅レコード {len(links)}")
    print(f"  アプリの駅に結べた {len(linked)}（{len(linked) / len(links):.2%}）："
          f"完全一致 {methods['exact']}・鍵の一致 {methods['key']}・うち会社名で絞った {sum(lk.by_operator for lk in linked)}"
          f"・直しの表 {sum(lk.fixed for lk in linked)}")
    unlinked = Counter((source.company_of(lk.station)["company_name"], lk.station["station_name"])
                       for lk in links if lk.app is None)
    print(f"  結べない駅レコード {sum(unlinked.values())}：{dict(unlinked)}")
    print(f"  事業者 → 会社名 {len(operators)}")
    rows = sum(len(ms) for ms in members.values())
    loops = sum(1 for line in lines if line["is_loop"])
    print(f"路線 {len(lines)}（環状 {loops}）・路線の駅 {rows}（駅の追加 {len(rules.STATION_ADDITIONS)}）")
    todo = [u for u in unassigned if u["category"] == "要対応"]
    print(f"どの路線にも属さない駅（乗降あり・前回の投入から増えた）{len(unassigned)}：対象外の路線 "
          f"{len(unassigned) - len(todo)}・要対応 {len(todo)} {[u['station_name'] for u in todo][:20]}")
    print(f"→ {common.LINES_CSV.relative_to(common.ROOT)}・{common.LINE_STATIONS_CSV.name}・"
          f"{common.LINE_LINKS_CSV.name}・{common.LINE_UNASSIGNED_CSV.name}")


if __name__ == "__main__":
    raise SystemExit(main())
