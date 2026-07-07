-- P2c — RPC / クエリ層（検索・空間・ランキング・散布・駅詳細）。
-- 方針: security invoker（RLS 適用）・search_path='' で完全 schema 修飾・動的 SQL なし。
-- メトリクス列の指定は key を metric_columns で照合して column_id に解決する（ホワイトリスト）。
-- 生カラム名を SQL に連結しないため注入不能。全関数 anon/authenticated に EXECUTE 付与。

-- 1) 駅名検索（trgm＋ILIKE・pax_latest 降順・≤10）
create or replace function public.search_stations(q text)
returns table (
  grp text, station_name text, label text, prefecture text,
  lon double precision, lat double precision, pax_latest integer
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.label, s.prefecture, s.lon, s.lat, s.pax_latest
  from public.stations s
  where s.search_label ilike '%' || q || '%' or s.station_name ilike '%' || q || '%'
  -- 駅名一致を都道府県サフィックスのみ一致より優先し、同順位は乗降客数の多い順
  order by (case when s.station_name ilike '%' || q || '%' then 0 else 1 end),
           s.pax_latest desc nulls last
  limit 10
$$;

-- 2) bbox 内の駅（GiST index を && で使用・pax_latest 降順）
create or replace function public.stations_in_bbox(
  west double precision, south double precision,
  east double precision, north double precision,
  lim integer default 2000
)
returns table (
  grp text, station_name text, prefecture text,
  lon double precision, lat double precision, pax_latest integer
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.prefecture, s.lon, s.lat, s.pax_latest
  from public.stations s
  where s.geom operator(extensions.&&)
        extensions.st_makeenvelope(west, south, east, north, 4326)
  order by s.pax_latest desc nulls last
  limit lim
$$;

-- 3) 最寄駅 k 件（<-> KNN で高速・距離は geography で正確なメートル）
create or replace function public.nearest_stations(
  in_lon double precision, in_lat double precision, k integer default 10
)
returns table (
  grp text, station_name text, prefecture text,
  lon double precision, lat double precision, dist_m double precision
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.prefecture, s.lon, s.lat,
         extensions.st_distance(
           s.geom::extensions.geography,
           extensions.st_setsrid(extensions.st_makepoint(in_lon, in_lat), 4326)::extensions.geography
         ) as dist_m
  from public.stations s
  order by s.geom operator(extensions.<->)
           extensions.st_setsrid(extensions.st_makepoint(in_lon, in_lat), 4326)
  limit k
$$;

-- 4) 指標ランキング（key を metric_columns で検証・asc/desc・都道府県絞り・信頼性フラグ同梱）
create or replace function public.rank_by_column(
  column_key text, pref text default null, dir text default 'desc', lim integer default 20
)
returns table (
  grp text, station_name text, label text, prefecture text,
  lon double precision, lat double precision,
  value double precision, flag_value double precision, rank bigint
)
language sql stable security invoker set search_path = ''
as $$
  with m as (
    select id, (meta ->> 'reliabilityFlagKey') as flag_key
    from public.metric_columns where key = column_key
  ),
  fcol as (
    select id as flag_id from public.metric_columns
    where key = (select flag_key from m)
  )
  select s.grp, s.station_name, s.label, s.prefecture, s.lon, s.lat,
         v.value,
         fv.value as flag_value,
         row_number() over (
           order by v.value * (case when lower(dir) = 'asc' then 1 else -1 end)
         ) as rank
  from public.station_values v
  join public.stations s on s.id = v.station_id
  left join public.station_values fv
    on fv.station_id = v.station_id and fv.column_id = (select flag_id from fcol)
  where v.column_id = (select id from m)
    and (pref is null or s.prefecture = pref)
  order by v.value * (case when lower(dir) = 'asc' then 1 else -1 end)
  limit lim
$$;

-- 5) 複数指標の一括取得（散布図の x/y・都道府県絞り。key[] を metric_columns で検証）
create or replace function public.values_for_columns(column_keys text[], pref text default null)
returns table (
  grp text, station_name text, prefecture text,
  lon double precision, lat double precision, key text, value double precision
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.prefecture, s.lon, s.lat, mc.key, v.value
  from public.metric_columns mc
  join public.station_values v on v.column_id = mc.id
  join public.stations s on s.id = v.station_id
  where mc.key = any(column_keys)
    and (pref is null or s.prefecture = pref)
$$;

-- 6) 駅詳細（1駅の全指標を key つきで一括取得。P5 の駅詳細パネル用）
create or replace function public.station_bundle(in_grp text)
returns table (key text, value double precision)
language sql stable security invoker set search_path = ''
as $$
  select mc.key, v.value
  from public.stations s
  join public.station_values v on v.station_id = s.id
  join public.metric_columns mc on mc.id = v.column_id
  where s.grp = in_grp
$$;

-- anon/authenticated に EXECUTE を付与（RLS は各関数内の SELECT に適用される）
grant execute on function
  public.search_stations(text),
  public.stations_in_bbox(double precision, double precision, double precision, double precision, integer),
  public.nearest_stations(double precision, double precision, integer),
  public.rank_by_column(text, text, text, integer),
  public.values_for_columns(text[], text),
  public.station_bundle(text)
to anon, authenticated;
