-- 260903 PR-5 — build_dataset と対象集合セレクタの共通化（docs/260828_research_claude_auth.md §5.3・§10 PR-5）。
-- 1) list_stations に operators / routes / route_types・bbox・near・grps を追加（PR-4 の ⚠ を解消）。
--    絞り込みの述語は rank_by_column / scatter_points と同じ station_matches_filters()（単一の定義・260801）。
-- 2) dataset_rows — 駅×指標のロング値を 1 回の RPC で jsonb に束ねる（build_dataset の材料・max-rows 回避）。
-- 方針は既存 RPC と同じ: security invoker（RLS 適用）・search_path='' で完全 schema 修飾・動的 SQL なし。

-- 引数が変わるため drop → create → grant（PostgREST は同名の多重定義を解決できない・260801 と同じ扱い）。
drop function if exists public.list_stations(text[], text, integer);

-- muni は市区町村名の前方一致（例「横浜市」「横浜市西区」）または JIS コードの前方一致。
-- bbox は 4 値すべて・near は 3 値すべて揃ったときだけ効く（欠けは「絞らない」）。
create function public.list_stations(
  prefs text[] default null,
  muni text default null,
  ops text[] default null,
  routes_in text[] default null,
  route_types int[] default null,
  west double precision default null,
  south double precision default null,
  east double precision default null,
  north double precision default null,
  near_lon double precision default null,
  near_lat double precision default null,
  near_radius_m double precision default null,
  grps text[] default null,
  lim integer default 300
)
returns table (
  grp text, station_name text, label text, prefecture text,
  municipality text, municipality_code text,
  lon double precision, lat double precision,
  n_op integer, pax_latest integer
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.label, s.prefecture,
         s.municipality, s.municipality_code,
         s.lon, s.lat, s.n_op, s.pax_latest
  from public.stations s
  where (prefs is null or coalesce(array_length(prefs, 1), 0) = 0 or s.prefecture = any (prefs))
    and (muni is null or muni = ''
         or s.municipality like muni || '%'
         or s.municipality_code like muni || '%')
    and (grps is null or coalesce(array_length(grps, 1), 0) = 0 or s.grp = any (grps))
    and public.station_matches_filters(s.id, s.operators, ops, routes_in, route_types)
    and (west is null or south is null or east is null or north is null
         or s.geom operator(extensions.&&) extensions.st_makeenvelope(west, south, east, north, 4326))
    and (near_lon is null or near_lat is null or near_radius_m is null
         or extensions.st_dwithin(
              s.geom::extensions.geography,
              extensions.st_setsrid(
                extensions.st_makepoint(near_lon, near_lat), 4326
              )::extensions.geography,
              near_radius_m))
  order by s.pax_latest desc nulls last, s.grp
  limit least(greatest(coalesce(lim, 300), 1), 2000)
$$;

grant execute on function public.list_stations(
  text[], text, text[], text[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision,
  text[], integer
) to anon, authenticated;

-- dataset_rows — grp → {key → value} の jsonb を 1 応答で返す（PostgREST の max-rows を跨がない）。
-- key は metric_columns への内部結合＝ホワイトリスト（生カラム名を SQL に連結しない）。
-- 未知キーは行を作らないだけ（検証はアプリ層のカタログが先に行う）。
create function public.dataset_rows(grps text[], keys text[])
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.grp, t.vals), '{}'::jsonb)
  from (
    select s.grp, jsonb_object_agg(mc.key, v.value) as vals
    from public.station_values v
    join public.stations s on s.id = v.station_id
    join public.metric_columns mc on mc.id = v.column_id
    where s.grp = any (grps) and mc.key = any (keys)
    group by s.grp
  ) t
$$;

grant execute on function public.dataset_rows(text[], text[]) to anon, authenticated;
