#!/usr/bin/env bash
# 共通API 統合スモーク（正常系＋異常系）。
# 使い方: BASE=http://localhost:3300 bash tests/api.smoke.sh
#         BASE=https://ai-database-map.vercel.app bash tests/api.smoke.sh   # 本番にも当てられる
# 前提: 別プロセスでサーバ稼働（pnpm build && pnpm start）・.env の SUPABASE_* が読める。
#
# ⚠ ハザードの 2 つ（11・12）は**本番にこそ当てる**。外部 API とサーバからの静的アセット読み出しに
#   依存していて、**画面は正常に見えるのに中身だけ欠ける**壊れ方をするので、ローカルだけでは気づけない
#   （実際、浸水ナビの取りこぼしはこの形で見逃していた・docs/260824_flood.md §6.3）。
set -uo pipefail
BASE="${BASE:-http://localhost:3300}"
pass=0
fail=0

HTTP=""
BODY=""
get() { # url [urlencoded query key=val ...]
  local url="$1"
  shift
  local args=(-s -w $'\n%{http_code}' -G)
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  local out
  out=$(curl "${args[@]}" "$url")
  HTTP="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}
ok() {
  pass=$((pass + 1))
  echo "  ✓ $1"
}
ng() {
  fail=$((fail + 1))
  echo "  ✗ FAIL: $1  [http=$HTTP body=${BODY:0:160}]"
}

echo "BASE=$BASE"

# 1) health
get "$BASE/api/health"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r .ok)" = true ]; } && ok "health = {ok:true}" || ng "health"

# 2) metrics（全件）
#    ⚠ 件数を焼き込まない。P3b 当時の 488 のまま残っていて、データ追加で 796 になった今も
#      落ち続けていた（＝スモークが「いつも赤」で誰も見なくなる）。**正確な件数は
#      tests/catalog.test.ts が固定している**ので、ここは「返ってきているか」だけを見る。
get "$BASE/api/metrics"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq '.entries | length')" -gt 0 ]; } &&
  ok "metrics（$(echo "$BODY" | jq '.entries | length') entries）" || ng "metrics"

# 3) metrics?category=population（絞り込み）
get "$BASE/api/metrics" "category=population"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '[.entries[].category] | unique | .[0]')" = population ]; } &&
  ok "metrics?category=population" || ng "metrics category"

# 4) stations?q=東京
get "$BASE/api/stations" "q=東京"
TOKYO_GRP=$(echo "$BODY" | jq -r '.[0].grp')
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.[0].stationName')" = 東京 ]; } &&
  ok "stations?q=東京 → #1 東京" || ng "stations q"

# 5) stations?bbox
get "$BASE/api/stations" "bbox=139.5,35.5,140.0,35.9"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq 'length')" -gt 0 ]; } && ok "stations?bbox" || ng "stations bbox"

# 6) stations?near
get "$BASE/api/stations" "near=139.767,35.681"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.[0].distM < 100')" = true ]; } &&
  ok "stations?near → 最寄 dist<100m" || ng "stations near"

# 7) geojson（全駅）
get "$BASE/api/stations/geojson"
NFEAT=$(echo "$BODY" | jq '.features | length')
{ [ "$HTTP" = 200 ] && [ "$NFEAT" = 9273 ]; } && ok "geojson 9273 features" || ng "geojson (features=$NFEAT)"

# 8) stations/[grp]（駅詳細・grp は '#' を含むためパスを URL エンコード）
GRP_ENC=$(jq -rn --arg s "$TOKYO_GRP" '$s|@uri')
get "$BASE/api/stations/$GRP_ENC"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq '.series | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '.station.stationName')" = 東京 ]; } &&
  ok "stations/[grp] 詳細（series あり）" || ng "station detail"

# 9) ranking
get "$BASE/api/ranking" "metric=pop_2020_1km" "order=desc" "limit=5"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq '.rows | length')" = 5 ] &&
  [ "$(echo "$BODY" | jq -r '.rows[0].rank')" = 1 ]; } && ok "ranking Top5" || ng "ranking"

# 10) growth
get "$BASE/api/growth" "x=pop_gr_2020_2015_2km" "y=rate_covid" "prefecture=千葉県"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq '.points | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '.clusterCount')" -ge 1 ]; } && ok "growth（散布＋クラスタ）" || ng "growth"

# 11) hazard/catalog（自己記述カタログ）
get "$BASE/api/hazard/catalog"
CATALOG="$BODY"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq '.layers | length')" -ge 15 ] &&
  [ "$(echo "$BODY" | jq -r '.disclaimerJa | length > 0')" = true ]; } &&
  ok "hazard/catalog（レイヤ＋免責）" || ng "hazard catalog"

# 12) hazard/point（亀有駅＝荒川・中川の氾濫域）
#     ここは「200 が返る」では足りない。**画面は正常に見えるのに中身が欠ける**劣化を捕まえる：
#     ①メッシュがサーバから読めているか（標高が返るか）②浸水ナビが届いているか（河川が返るか）。
#     ②は初回だけ落ちることがあるので、落ちたら 1 度だけ取り直す（`s-maxage=30` で再訪すれば取れる）。
get "$BASE/api/hazard/point" "lon=139.847" "lat=35.7645" "placeJa=亀有駅"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.verdict.level')" = danger ] &&
  [ "$(echo "$BODY" | jq -r '.hazards | length > 0')" = true ]; } &&
  ok "hazard/point（亀有＝danger・該当あり）" || ng "hazard point"

{ [ "$(echo "$BODY" | jq -r '.terrain.elevMeanM != null')" = true ]; } &&
  ok "hazard/point：標高が返る（サーバからメッシュを読めている）" || ng "hazard point mesh"

NRIVER=$(echo "$BODY" | jq '.rivers | length')
if [ "$NRIVER" = 0 ]; then
  sleep 35
  get "$BASE/api/hazard/point" "lon=139.847" "lat=35.7645" "placeJa=亀有駅"
  NRIVER=$(echo "$BODY" | jq '.rivers | length')
fi
[ "$NRIVER" -gt 0 ] &&
  ok "hazard/point：河川が返る（浸水ナビが届いている・$NRIVER 本）" ||
  ng "hazard point rivers（浸水ナビに届いていない）"

# 12b) 区域の**すぐ外**で「その場に留まる」と言わない（§6.2 の追記・PR-4d）。
#      実測で見つけた座標：土石流警戒区域の約 10m 外。ここが 'stay' に戻ったら落ちる。
get "$BASE/api/hazard/point" "lon=139.071025" "lat=35.124252" "placeJa=区域の縁"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.verdict.evacuation')" = null ] &&
  [ "$(echo "$BODY" | jq -r '[.neighbours[] | select(.source == "tile")] | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '.verdict.headlineJa | contains("20m")')" = true ]; } &&
  ok "hazard/point：区域のすぐ外は「留まってよい」と言わない" || ng "hazard point boundary"

# 12c) キキクル（表示専用）が地点の答えに混ざっていない（決定 5・§9.1）。
#      混ざっていると {basetime} 入りの URL を気象庁に投げ、無関係な注記も出る。
{ [ "$(echo "$BODY" | jq -r '[.coverageNotesJa[] | select(contains("10 分ごとに更新"))] | length')" -eq 0 ] &&
  [ "$(echo "$BODY" | jq -r '[.hazards[] | select(.layerKey | startswith("kikikuru"))] | length')" -eq 0 ]; } &&
  ok "hazard/point：キキクルは地点の答えに混ざらない（注記 $(echo "$BODY" | jq '.coverageNotesJa | length') 件）" ||
  ng "hazard point kikikuru leak"

# 13) hazard/alerts（いまの警戒状況）
#     平時はほぼ全域が「発表なし」なので、**中身ではなく骨格**を見る：
#     区域が解決できているか（＝逆ジオ＋対応表が動いているか）と、限界の 1 文が必ず入るか。
get "$BASE/api/hazard/alerts" "lon=139.847" "lat=35.7645" "placeJa=亀有駅"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.area.municipalityJa')" = 葛飾区 ] &&
  [ "$(echo "$BODY" | jq -r '.area.areas[0].code')" = 1312200 ]; } &&
  ok "hazard/alerts（区域を解決できている）" || ng "hazard alerts area"

# ⚠ 「土砂災害警戒情報」を限界として数えていたが、**r8 では危険度（コード 49）として拾えるようになった**
#    ので限界から外した（Phase 3 PR1）。ここが見るのは**避難情報の主語**——
#    「避難指示を出すのは市町村」と必ず書いてあることと、「安全」と言っていないこと。
{ [ "$(echo "$BODY" | jq -r '[.limitationsJa[] | select(contains("市町村"))] | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '[.limitationsJa[] | select(contains("避難情報"))] | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '.headlineJa | contains("安全")')" = false ]; } &&
  ok "hazard/alerts（限界を明示・「安全」と言わない）" || ng "hazard alerts wording"

# 13b) キキクル：カタログの `timesUrl` から最新時刻を解決し、実タイルが 200 で返るか。
#      これは**気象庁の配信を直接**叩く（自前サーバを経由しない設計・§7.4）。
#      配信の形が変わると、地図には 404 が並ぶだけで**何も出ないまま静かに壊れる**ので、ここで見る。
TIMES_URL=$(echo "$CATALOG" | jq -r '[.layers[] | select(.tile.timesUrl != null) | .tile.timesUrl][0]')
KIKI_URL=$(echo "$CATALOG" | jq -r '[.layers[] | select(.tile.timesUrl != null) | .tile.url][0]')
if [ -n "$TIMES_URL" ] && [ "$TIMES_URL" != null ]; then
  TIMES=$(curl -s --max-time 20 "$TIMES_URL")
  BT=$(echo "$TIMES" | jq -r '[.[] | select(.elements == null or (.elements | index("land")))] | max_by(.basetime) | .basetime')
  MB=$(echo "$TIMES" | jq -r '[.[] | select(.elements == null or (.elements | index("land")))] | max_by(.basetime) | .member')
  VT=$(echo "$TIMES" | jq -r '[.[] | select(.elements == null or (.elements | index("land")))] | max_by(.basetime) | .validtime')
  # 富山県のあたり（z=9）。色の有無は天気次第なので**見ない**——見るのは 200 が返ることだけ。
  TILE=${KIKI_URL//\{basetime\}/$BT}
  TILE=${TILE//\{member\}/$MB}
  TILE=${TILE//\{validtime\}/$VT}
  TILE=${TILE//\{z\}/9}
  TILE=${TILE//\{x\}/450}
  TILE=${TILE//\{y\}/199}
  HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$TILE")
  BODY="$TILE"
  { [ "$HTTP" = 200 ] && [ -n "$BT" ] && [ "$BT" != null ] && [[ "$TILE" != *"{"* ]]; } &&
    ok "キキクル：最新時刻（${BT}・${MB}）を差し込んでタイルが 200" || ng "kikikuru tile"
else
  ng "kikikuru timesUrl がカタログに無い"
fi

# 13c) hazard/evacuation（避難先）
#      平時でも中身が出る（指定の一覧は常にある）ので、**種別の絞り込み**まで見る。
#      ①亀有＝洪水で 1 件以上返る ②各件がその種別に指定されている ③限界の 3 点が入っている。
get "$BASE/api/hazard/evacuation" "lon=139.847" "lat=35.7645" "placeJa=亀有駅" "for=flood"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.forDisasterJa')" = 洪水 ] &&
  [ "$(echo "$BODY" | jq '.sites | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '[.sites[] | select(.disastersJa | index("洪水") | not)] | length')" -eq 0 ]; } &&
  ok "hazard/evacuation（洪水に対応した場所だけ・$(echo "$BODY" | jq '.sites | length') 件）" ||
  ng "hazard evacuation flood"

{ [ "$(echo "$BODY" | jq -r '[.limitationsJa[] | select(contains("開設されているか"))] | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '[.limitationsJa[] | select(contains("直線距離"))] | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '[.limitationsJa[] | select(contains("指定避難所"))] | length')" -gt 0 ] &&
  [ "$(echo "$BODY" | jq -r '.siteKindJa')" = 指定緊急避難場所 ]; } &&
  ok "hazard/evacuation（限界を明示・「開いている」と言わない）" || ng "hazard evacuation wording"

# 13d) 種別を変えると**別のレイヤ**を見る（洪水用を土砂災害に使い回さない・§11 リスク 10）
get "$BASE/api/hazard/evacuation" "lon=139.0786" "lat=35.1043" "placeJa=熱海駅" "for=landslide"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq -r '.forDisaster')" = landslide ] &&
  [ "$(echo "$BODY" | jq -r '[.sites[] | select(.disastersJa | index("崖崩れ・土石流・地滑り") | not)] | length')" -eq 0 ]; } &&
  ok "hazard/evacuation（土砂は土砂の指定だけ）" || ng "hazard evacuation landslide"

# 13d-2) 区域との重なりを**実際に答えている**か（§6.3 の優先順位を避難先にも適用・PR-4c）。
#        メッシュを持たない土砂でも、公式タイルの画素で答えられるようになった。
#        「不明」しか返らない状態に戻ったら落ちる。
get "$BASE/api/hazard/evacuation" "lon=136.99" "lat=36.85" "placeJa=氷見駅" "for=landslide"
{ [ "$HTTP" = 200 ] &&
  [ "$(echo "$BODY" | jq '[.sites[] | select(.hazardAreaSource == "tile")] | length')" -gt 0 ]; } &&
  ok "hazard/evacuation（土砂でも重なりを答える・タイル $(echo "$BODY" | jq '[.sites[] | select(.hazardAreaSource == "tile")] | length') 件）" ||
  ng "hazard evacuation area by tile"

# 13e) 異常系：災害種別が無い → 400（既定で洪水に倒さない・§11 リスク 10）
get "$BASE/api/hazard/evacuation" "lon=139.847" "lat=35.7645"
[ "$HTTP" = 400 ] && ok "hazard/evacuation：災害種別なし → 400" || ng "evacuation missing for should 400"

# 14) hazard/point 異常系：座標が無い → 400
get "$BASE/api/hazard/point" "lat=35.7645"
[ "$HTTP" = 400 ] && ok "hazard/point：座標なし → 400" || ng "hazard point missing lon should 400"

# 15) 異常系：不正 metric key → 400
get "$BASE/api/ranking" "metric=__not_a_metric__"
[ "$HTTP" = 400 ] && ok "不正 metric → 400" || ng "invalid metric should 400"

# 16) 異常系：rankable でない key → 400
get "$BASE/api/ranking" "metric=pop_lowbase_2020_1km"
[ "$HTTP" = 400 ] && ok "rankable 外 metric → 400" || ng "non-rankable should 400"

# 17) 異常系：存在しない駅 → 404
get "$BASE/api/stations/__nope__"
[ "$HTTP" = 404 ] && ok "未存在の駅 → 404" || ng "missing station should 404"

echo ""
echo "==== $pass passed / $fail failed ===="
[ "$fail" = 0 ] && echo "✅ ALL PASS" || echo "❌ FAILED"
exit "$fail"
