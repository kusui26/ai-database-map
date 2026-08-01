-- ランキングにも散布と同じ絞り込み（運営会社・路線・事業者種別）を入れる（260801）。
--
-- ランキングは `total`（count(*) over ()）と limit/offset を SQL で計算しているため、
-- 絞り込みをアプリ層で後から間引くと**件数もページ境界も壊れる**。RPC 自体に条件を足す。
--
-- 述語は散布（values_for_columns）とまったく同じでなければならない。同じ 20 行を 2 か所に
-- 複製すると片方だけ直して仕様がズレるため、**station_matches_filters() に 1 本化**して
-- 両方から呼ぶ（docs/260801_ranking_filter.md §3）。単純な SQL 関数なので Postgres が
-- インライン展開でき、性能は実測 86–294ms と現行同等。

-- 1) 絞り込みの単一の定義。
--    * 路線・種別が未指定：会社は従来どおり stations.operators を「・」分割で判定（既存挙動の保存）。
--    * 路線・種別が指定  ：会社も station_routes の**同じ行**で判定する。東京駅は JR東海の
--      東海道新幹線と JR東日本の東北新幹線を持つため、独立に AND すると
--      「東海旅客鉄道 × 東北新幹線」が誤ヒットする（0 件であるべき）。
--    * routes と route_types は OR。
create or replace function public.station_matches_filters(
  station_id smallint,
  station_operators text,
  ops text[],
  routes text[],
  route_types int[]
)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select
    (
      coalesce(cardinality(routes), 0) = 0
      and coalesce(cardinality(route_types), 0) = 0
      and (
        coalesce(cardinality(ops), 0) = 0
        or string_to_array(coalesce(station_operators, ''), '・') && ops
      )
    )
    or exists (
      select 1
      from public.station_routes sr
      where sr.station_id = station_matches_filters.station_id
        and (coalesce(cardinality(ops), 0) = 0 or sr.operator = any(ops))
        and (
          (coalesce(cardinality(routes), 0) > 0 and sr.route = any(routes))
          or (coalesce(cardinality(route_types), 0) > 0 and sr.route_type = any(route_types))
        )
    )
$$;

grant execute on function public.station_matches_filters(smallint, text, text[], text[], int[])
  to anon, authenticated;

-- 2) 散布：述語を共有関数に置き換える（引数・戻り値は不変＝アプリ側は無改変）。
create or replace function public.values_for_columns(
  column_keys text[],
  prefs text[] default null,
  ops text[] default null,
  routes text[] default null,
  route_types int[] default null
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'grp', s.grp,
      'station_name', s.station_name,
      'key', mc.key,
      'value', v.value
    )),
    '[]'::jsonb
  )
  from public.metric_columns mc
  join public.station_values v on v.column_id = mc.id
  join public.stations s on s.id = v.station_id
  where mc.key = any(column_keys)
    and (coalesce(cardinality(prefs), 0) = 0 or s.prefecture = any(prefs))
    and public.station_matches_filters(s.id, s.operators, ops, routes, route_types)
$$;

-- 3) ランキング：ops / routes / route_types を追加。引数の数が変わるため drop → create → grant
--    （PostgREST は同名の多重定義を解決できないので、旧版を必ず落とす）。
drop function if exists public.rank_by_column(text, text[], text, integer, integer, boolean);

create function public.rank_by_column(
  column_key text,
  prefs text[] default null,
  dir text default 'desc',
  lim integer default 50,
  off integer default 0,
  exclude_lown boolean default false,
  ops text[] default null,
  routes text[] default null,
  route_types int[] default null
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
      and public.station_matches_filters(s.id, s.operators, ops, routes, route_types)
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

grant execute on function public.rank_by_column(
  text, text[], text, integer, integer, boolean, text[], text[], int[]
) to anon, authenticated;
