#!/usr/bin/env bash
# P3b — 共通API 統合スモーク（正常系＋異常系）。
# 使い方: BASE=http://localhost:3300 bash tests/api.smoke.sh
# 前提: 別プロセスでサーバ稼働（pnpm build && pnpm start）・.env の SUPABASE_* が読める。
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
get "$BASE/api/metrics"
{ [ "$HTTP" = 200 ] && [ "$(echo "$BODY" | jq '.entries | length')" = 488 ]; } && ok "metrics 488 entries" || ng "metrics"

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

# 11) 異常系：不正 metric key → 400
get "$BASE/api/ranking" "metric=__not_a_metric__"
[ "$HTTP" = 400 ] && ok "不正 metric → 400" || ng "invalid metric should 400"

# 12) 異常系：rankable でない key → 400
get "$BASE/api/ranking" "metric=pop_lowbase_2020_1km"
[ "$HTTP" = 400 ] && ok "rankable 外 metric → 400" || ng "non-rankable should 400"

# 13) 異常系：存在しない駅 → 404
get "$BASE/api/stations/__nope__"
[ "$HTTP" = 404 ] && ok "未存在の駅 → 404" || ng "missing station should 404"

echo ""
echo "==== $pass passed / $fail failed ===="
[ "$fail" = 0 ] && echo "✅ ALL PASS" || echo "❌ FAILED"
exit "$fail"
