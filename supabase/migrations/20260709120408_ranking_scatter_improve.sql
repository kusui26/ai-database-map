-- P6c — 複数都道府県（prefs text[]）＋ランキングのページング（offset）・低分母除外・総件数（total）。
-- 引数の型・数が変わるため drop → create → grant（grant は drop で失われる）。
-- prefs は null / 空配列で全国、要素ありで any() フィルタ。

-- rank_by_column: pref text → prefs text[]、off/exclude_lown を追加、total（count over）を追加。
drop function if exists public.rank_by_column(text, text, text, integer);

create function public.rank_by_column(
  column_key text, prefs text[] default null, dir text default 'desc',
  lim integer default 50, off integer default 0, exclude_lown boolean default false
)
returns table (
  grp text, station_name text, label text, prefecture text,
  lon double precision, lat double precision,
  value double precision, flag_value double precision, rank bigint, total bigint
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
  ),
  base as (
    select s.grp, s.station_name, s.label, s.prefecture, s.lon, s.lat,
           v.value, fv.value as flag_value
    from public.station_values v
    join public.stations s on s.id = v.station_id
    left join public.station_values fv
      on fv.station_id = v.station_id and fv.column_id = (select flag_id from fcol)
    where v.column_id = (select id from m)
      and (coalesce(cardinality(prefs), 0) = 0 or s.prefecture = any(prefs))
      and (not exclude_lown or fv.value is distinct from 1)
  ),
  ranked as (
    select b.*,
           row_number() over (order by b.value * (case when lower(dir) = 'asc' then 1 else -1 end)) as rank,
           count(*) over () as total
    from base b
  )
  select grp, station_name, label, prefecture, lon, lat, value, flag_value, rank, total
  from ranked
  order by rank
  limit lim offset off
$$;

grant execute on function public.rank_by_column(text, text[], text, integer, integer, boolean)
  to anon, authenticated;

-- values_for_columns: pref text → prefs text[]。
drop function if exists public.values_for_columns(text[], text);

create function public.values_for_columns(column_keys text[], prefs text[] default null)
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
    and (coalesce(cardinality(prefs), 0) = 0 or s.prefecture = any(prefs))
$$;

grant execute on function public.values_for_columns(text[], text[]) to anon, authenticated;
