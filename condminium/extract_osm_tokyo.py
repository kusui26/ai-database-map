#!/usr/bin/env python3
"""
OpenStreetMap (Overpass API) から東京都内の集合住宅（マンション等）を抽出し CSV 出力する。

- APIキー不要。公開エンドポイント Overpass API を利用。
- 対象: building=apartments かつ name タグを持つ建物（東京都 admin_level=4 の領域内）。
- 出力カラム: 緯度, 経度, 住所, マンション名
"""
import csv
import re
import sys
import time
import requests

# 公開 Overpass API エンドポイント（混雑時に順にフォールバック）
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
ENDPOINT = ENDPOINTS[0]
HEADERS = {
    "User-Agent": "tokyo-mansion-extractor/1.0 (research; contact kensuke26grampus@gmail.com)"
}
OUTPUT = "OpenStreetMap_tokyo_sample.csv"

# 対象: building が住居系、または name にマンション系のキーワードを含む建物
QUERY = """
[out:json][timeout:600];
area["name"="東京都"]["admin_level"="4"]->.tokyo;
(
  nwr["building"~"^(apartments|residential|house|detached|dormitory)$"]["name"](area.tokyo);
  nwr["building"]["name"~"(マンション|ハイツ|コーポ|レジデンス|ハイム|メゾン|パレス|プラザ|タワー|ヒルズ|ガーデン|シティ|テラス|アパート|荘)"](area.tokyo);
);
out center;
"""

# --- マンション名として不要な「ラベルだけ」の行を判定するためのパターン群 ---

# 名前が数字・記号・空白のみ（半角/全角）。例: "1","２","20","1-2"
NUMERIC_ONLY = re.compile(r"^[0-9０-９\-\s\.,、・]+$")

# 単独英字（＋任意の区切り・数字）。例: "A","A-1","B2","C-3","Ａ－１","D"
SINGLE_LETTER = re.compile(r"^[A-Za-zＡ-Ｚａ-ｚ][\-－—]?[0-9０-９]*$")

# 実名を伴わない棟/号/館/番ラベル全般の判定。
# 本体が英数字・号棟館番街・第・方角・区切り記号のみ（= かな/カタカナ/一般漢字を含まない）で、
# かつ designation 文字（号棟館番街）を含むものを「ラベルのみ」とみなす。
# 例: "1号","1号館","2番街","10号棟","4号棟・5号棟","1番館","A棟","東棟"
# 「○○マンション3号棟」「PHOENIX初台弐番館」等は実名（かな/漢字）を含むのでマッチせず残す。
_LABEL_CHARS = r"0-9A-Za-zＡ-Ｚａ-ｚ０-９号棟館番街第東西南北中央左右・\-－—,、\.／/（）() 　"
ALL_LABEL = re.compile(rf"^[{_LABEL_CHARS}]+$")
HAS_DESIGNATION = re.compile(r"[号棟館番街]")


def is_unwanted(name: str) -> bool:
    """マンション名として不要な行（仮称・寮・棟/号などのラベルのみ）かどうか。"""
    if "仮称" in name:            # (仮称)○○ など建設前の仮名称
        return True
    if "寮" in name:              # 社宅・寮
        return True
    if NUMERIC_ONLY.match(name):  # 数字・記号のみ
        return True
    if SINGLE_LETTER.match(name):  # A / A-1 / B2 など単独英字ラベル
        return True
    if ALL_LABEL.match(name) and HAS_DESIGNATION.search(name):  # 実名なしの棟/号/番ラベル
        return True
    return False


# 出力する住所の分割列（OSM addr:* タグ → 列名）
ADDR_COLUMNS = ["郵便番号", "都道府県", "市区町村", "町名", "丁目", "番", "号"]


def split_address(tags: dict) -> dict:
    """分割された addr:* タグを正規化して各住所列の辞書を返す。"""
    neighbourhood = tags.get("addr:neighbourhood", "").strip()  # 丁目
    # 「4」のように数字だけの場合は「4丁目」に正規化
    if neighbourhood and neighbourhood.isdigit():
        neighbourhood = f"{neighbourhood}丁目"

    block = tags.get("addr:block_number", "").strip()           # 街区(番)
    block = block.rstrip("番")  # 「1番」→「1」に正規化

    return {
        "郵便番号": tags.get("addr:postcode", "").strip(),
        # province は保有率が低いので、東京都データでは未設定なら東京都を補完
        "都道府県": (tags.get("addr:province") or "東京都").strip(),
        "市区町村": tags.get("addr:city", "").strip(),
        "町名": tags.get("addr:quarter", "").strip(),
        "丁目": neighbourhood,
        "番": block,
        "号": tags.get("addr:housenumber", "").strip(),
    }


def fetch():
    """複数エンドポイント × リトライで Overpass からデータ取得。"""
    print("Overpass API へ問い合わせ中...（数十秒〜数分かかる場合があります）", file=sys.stderr)
    last_err = None
    for endpoint in ENDPOINTS:
        for attempt in range(1, 4):  # 各エンドポイント最大3回
            try:
                resp = requests.post(endpoint, data={"data": QUERY},
                                     headers=HEADERS, timeout=650)
                resp.raise_for_status()
                return resp.json().get("elements", [])
            except (requests.HTTPError, requests.ConnectionError,
                    requests.Timeout) as e:
                last_err = e
                wait = attempt * 15
                print(f"  失敗 ({endpoint} 試行{attempt}): {e} → {wait}秒待機して再試行",
                      file=sys.stderr)
                time.sleep(wait)
        print(f"  → 次のミラーへ切替", file=sys.stderr)
    raise RuntimeError(f"全エンドポイントで取得に失敗しました: {last_err}")


def main():
    elements = fetch()
    print(f"取得要素数: {len(elements)}", file=sys.stderr)

    rows = []
    for e in elements:
        tags = e.get("tags", {})
        name = (tags.get("name") or "").strip()
        if not name:
            continue
        # 名前が数字・記号のみ（団地の棟番号など）はマンション名ではないので除外
        if NUMERIC_ONLY.match(name):
            continue
        # 仮称・寮・棟ラベルのみの行を除外（実名＋棟番号は残す）
        if is_unwanted(name):
            continue

        # 座標: node はそのまま、way/relation は center
        if e["type"] == "node":
            lat, lon = e.get("lat"), e.get("lon")
        else:
            c = e.get("center", {})
            lat, lon = c.get("lat"), c.get("lon")
        if lat is None or lon is None:
            continue

        row = {"緯度": lat, "経度": lon}
        row.update(split_address(tags))
        row["マンション名"] = name
        rows.append(row)

    # マンション名でソート（任意）
    rows.sort(key=lambda r: r["マンション名"])

    fieldnames = ["緯度", "経度"] + ADDR_COLUMNS + ["マンション名"]
    with open(OUTPUT, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"書き出し完了: {OUTPUT} ({len(rows)} 件)", file=sys.stderr)


if __name__ == "__main__":
    main()
