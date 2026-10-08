-- 261008 L2 — 路線（運行系統）を、一覧・ランキング・散布・データセット・おすすめの共通の絞り込みにする
-- （docs/261001_fix_user_feedback_ui.md §6.8.5 L2）。データは L1（20261008090000_lines.sql）。
--
-- 1) 述語 station_matches_filters() に line_cds（駅データ.jp の路線コード）を足す。意味は「どれかの路線の駅」
--    （路線どうしは OR）で、ほかの条件（会社・法令上の路線・種別）とは AND。B2（市区町村・範囲）も同じ形で足す。
-- 2) rank_by_column / scatter_points / list_stations に line_cds を足す。引数の数が変わるので drop → create → grant
--    （PostgREST は同名の多重定義を解決できない・260801 と同じ扱い）。line_cds は default null なので、
--    **line_cds を渡さない今のアプリもそのまま呼べる**（PostgREST は引数を名前で合わせる）＝DB を先に当ててよい。
-- 3) 旧 station_matches_filters（5 引数）は、呼び出し側を 6 引数へ移したあとで drop する。
-- 4) line_names() — 路線の一覧（GET /api/lines・自己記述の表面）。駅のある都道府県（駅の多い順）つき。

-- --- 1) 述語（6 引数） -----------------------------------------------------
create function public.station_matches_filters(
  station_id smallint,
  station_operators text,
  ops text[],
  routes text[],
  route_types int[],
  line_cds int[]
)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select
    (
      -- 会社・法令上の路線・種別（260801 の定義のまま）
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
    )
    -- 路線（運行系統・L2）：どれかの路線の駅。ほかの条件とは AND。
    and (
      coalesce(cardinality(line_cds), 0) = 0
      or exists (
        select 1
        from public.line_stations ls
        where ls.station_id = station_matches_filters.station_id
          and ls.line_cd = any(line_cds)
      )
    )
$$;

comment on function public.station_matches_filters(smallint, text, text[], text[], int[], int[]) is
  '駅の絞り込みの単一の定義。ops=会社、routes=法令上の路線（S12）、route_types=事業者種別（routes と OR）、line_cds=路線（運行系統・どれか）。ほかの条件とは AND。';

grant execute on function public.station_matches_filters(smallint, text, text[], text[], int[], int[])
  to anon, authenticated;

-- --- 2a) ランキング --------------------------------------------------------
drop function if exists public.rank_by_column(
  text, text[], text, integer, integer, boolean, text[], text[], int[]
);

create function public.rank_by_column(
  column_key text,
  prefs text[] default null,
  dir text default 'desc',
  lim integer default 50,
  off integer default 0,
  exclude_lown boolean default false,
  ops text[] default null,
  routes text[] default null,
  route_types int[] default null,
  line_cds int[] default null
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
      and public.station_matches_filters(s.id, s.operators, ops, routes, route_types, line_cds)
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
  text, text[], text, integer, integer, boolean, text[], text[], int[], int[]
) to anon, authenticated;

-- --- 2b) 散布 -----------------------------------------------------------------
drop function if exists public.scatter_points(text, text, text, text, text[], text[], text[], int[]);

create function public.scatter_points(
  x_key text,
  y_key text,
  x_flag_key text default null,
  y_flag_key text default null,
  prefs text[] default null,
  ops text[] default null,
  routes text[] default null,
  route_types int[] default null,
  line_cds int[] default null
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'grp', grp,
      'station_name', station_name,
      'x', x,
      'y', y,
      'x_flag', x_flag,
      'y_flag', y_flag
    )),
    '[]'::jsonb
  )
  from (
    select
      s.grp,
      s.station_name,
      max(v.value) filter (where mc.key = x_key) as x,
      max(v.value) filter (where mc.key = y_key) as y,
      max(v.value) filter (where x_flag_key is not null and mc.key = x_flag_key) as x_flag,
      max(v.value) filter (where y_flag_key is not null and mc.key = y_flag_key) as y_flag
    from public.metric_columns mc
    join public.station_values v on v.column_id = mc.id
    join public.stations s on s.id = v.station_id
    where mc.key in (x_key, y_key, x_flag_key, y_flag_key)
      and (coalesce(cardinality(prefs), 0) = 0 or s.prefecture = any(prefs))
      and public.station_matches_filters(s.id, s.operators, ops, routes, route_types, line_cds)
    group by s.id, s.grp, s.station_name
  ) t
  -- x と y の両方が揃った駅だけを返す（片方しか無い駅は散布に描けない・260804）。
  where x is not null and y is not null
$$;

grant execute on function public.scatter_points(
  text, text, text, text, text[], text[], text[], int[], int[]
) to anon, authenticated;

-- --- 2c) 駅の一覧（対象集合） -------------------------------------------------
drop function if exists public.list_stations(
  text[], text, text[], text[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision,
  text[], integer
);

-- muni は市区町村名の前方一致（例「横浜市」）または JIS コードの前方一致。
-- bbox は 4 値すべて・near は 3 値すべて揃ったときだけ効く（欠けは「絞らない」・260903 のまま）。
create function public.list_stations(
  prefs text[] default null,
  muni text default null,
  ops text[] default null,
  routes_in text[] default null,
  route_types int[] default null,
  line_cds int[] default null,
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
    and public.station_matches_filters(s.id, s.operators, ops, routes_in, route_types, line_cds)
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
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision,
  text[], integer
) to anon, authenticated;

-- --- 3) 旧述語（5 引数）を落とす（呼び出し側は上で 6 引数へ移した） ---------------
drop function if exists public.station_matches_filters(smallint, text, text[], text[], int[]);

-- --- 4) 路線の一覧（GET /api/lines） ------------------------------------------
create function public.line_names()
returns table (
  line_cd integer, name text, formal_name text, company_name text, company_short text,
  operator text, color text, color_name text, line_type smallint, is_loop boolean,
  station_count smallint, prefectures text[], source text
)
language sql stable security invoker set search_path = ''
as $$
  select l.line_cd, l.name, l.formal_name, l.company_name, l.company_short,
         l.operator, l.color, l.color_name, l.line_type, l.is_loop, l.station_count,
         (
           select array_agg(p.prefecture order by p.n desc, p.prefecture)
           from (
             select s.prefecture, count(*) as n
             from public.line_stations ls
             join public.stations s on s.id = ls.station_id
             where ls.line_cd = l.line_cd
             group by s.prefecture
           ) p
         ) as prefectures,
         l.source
  from public.lines l
  order by l.line_cd
$$;

comment on function public.line_names() is
  '路線（運行系統・駅データ.jp）の一覧。prefectures は駅のある都道府県（駅の多い順）。';

grant execute on function public.line_names() to anon, authenticated;
