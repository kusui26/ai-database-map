-- 261008 B2 — 市区町村・地図の範囲・起点から N m（近傍）を、一覧・ランキング・散布の共通の絞り込みにする
-- （docs/261001_fix_user_feedback_ui.md §6.4 B2）。
--
-- 以前は、都道府県・市区町村・範囲・近傍の条件を rank_by_column・scatter_points・list_stations がそれぞれ書いていて、
-- 市区町村・範囲・近傍は list_stations にしか無かった。「横浜市で人口が増えている駅は？」をランキングで答えられず、
-- AI は神奈川県で代用していた（§6.1.2）。「竹橋から 5km で地価が高い駅は？」は 5km で絞れず、全国の順位で答えた（§6.1.1）。
--
-- 1) 述語 station_matches_filters() を、駅の列と**全部の条件**を受ける形に作り直す。都道府県・市区町村・範囲（bbox）・
--    近傍（near）・会社・法令上の路線・種別・路線（運行系統）の**単一の定義**で、条件どうしは AND（会社と法令上の路線・
--    種別の関係、路線どうしの OR は 260801・L2 のまま）。**2 段**にしてある：
--    - 外側（この述語）：都道府県・市区町村・範囲・近傍を見る。**PostgreSQL が呼び出し側の問い合わせに展開できる**形
--      （本文が副問い合わせを持たない 1 つの式・SET を付けない）にして、全駅で関数を呼ばずに済ませる。
--    - 内側（station_matches_railway）：会社・法令上の路線・種別・路線を見る（副問い合わせがあるので展開できない）。
--      会社・路線の条件が無いときは呼ばない。
--    1 段（全部を 1 つの関数）で書くと、副問い合わせのせいで展開されず全 9,273 駅で関数を呼ぶので、全国のランキングが
--    232ms → 312ms、東京都の一覧が 28ms → 228ms に遅くなった。2 段では 122ms・22ms（以前より速い・2026-10-08 実測）。
--    ⚠ 外側は展開のために `set search_path` を付けない（付けると展開されない）。代わりに本文の名前は**すべて修飾**し
--    （pg_catalog.* ・extensions.* ・public.*）、SECURITY INVOKER のままにしてある（ほかの関数は今までどおり固定）。
-- 2) rank_by_column / scatter_points / list_stations を、この述語で作り直す。市区町村（muni）・範囲・近傍を足し、
--    rank_by_column と list_stations は起点からの距離 dist_m（m）を返す（近傍のときだけ。AI に距離を作らせない）。
--    **引数の名前・並び・既定は以前のまま**で、足すのは末尾（default null）＝今のアプリもそのまま呼べる
--    （PostgREST は引数を名前で合わせる。返り値に増えた列は、アプリの Zod が読み捨てる）＝DB を先に当ててよい。
--    返り値の列が増えるので drop → create → grant（PostgREST は同名の多重定義を解決できない・260801 と同じ扱い）。
-- 3) 市区町村は前方一致のまま（「横浜市」で全区）、LIKE ではなく starts_with で比べる（「%」「_」を特別扱いしない）。
-- 4) station_catalog() — 全駅の名前・都道府県・市区町村・座標（AI の入口で起点の駅名・市区町村名を解決する索引）。
--    9,273 行は PostgREST の 1 回 1,000 行の上限を超えるので、jsonb 1 つで返す（stations_geojson と同じ扱い）。
-- 5) 旧 6 引数の述語は、呼び出し側をすべて移したあとで drop する。

-- --- 1) 述語（2 段） ---------------------------------------------------------
-- 内側：会社・法令上の路線・種別・路線（運行系統）。本文は 260801・L2 の定義のまま（副問い合わせがある）。
create function public.station_matches_railway(
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
        where sr.station_id = station_matches_railway.station_id
          and (coalesce(cardinality(ops), 0) = 0 or sr.operator = any(ops))
          and (
            (coalesce(cardinality(routes), 0) > 0 and sr.route = any(routes))
            or (coalesce(cardinality(route_types), 0) > 0 and sr.route_type = any(route_types))
          )
      )
    )
    -- 路線（運行系統・L2）：どれかの路線の駅
    and (
      coalesce(cardinality(line_cds), 0) = 0
      or exists (
        select 1
        from public.line_stations ls
        where ls.station_id = station_matches_railway.station_id
          and ls.line_cd = any(line_cds)
      )
    )
$$;

comment on function public.station_matches_railway(smallint, text, text[], text[], int[], int[]) is
  '駅の絞り込みの内側（会社・法令上の路線・種別・路線）。station_matches_filters から呼ぶ。直接は使わない。';

grant execute on function public.station_matches_railway(smallint, text, text[], text[], int[], int[])
  to anon, authenticated;

-- 外側：駅の絞り込みの単一の定義（呼び出し側の問い合わせに展開される形・名前はすべて修飾）。
create function public.station_matches_filters(
  station_id smallint,
  prefecture text,
  municipality text,
  municipality_code text,
  station_operators text,
  geom extensions.geometry,
  prefs text[],
  muni text,
  ops text[],
  routes text[],
  route_types int[],
  line_cds int[],
  west double precision,
  south double precision,
  east double precision,
  north double precision,
  near_lon double precision,
  near_lat double precision,
  near_radius_m double precision
)
returns boolean
language sql stable security invoker
as $$
  select
    -- 都道府県（どれか）
    (coalesce(pg_catalog.cardinality(prefs), 0) = 0 or prefecture operator(pg_catalog.=) any(prefs))
    -- 市区町村：名前か JIS コードの前方一致（「横浜市」で全区・空は絞らない・「%」を特別扱いしない）
    and (
      coalesce(muni, '') = ''
      or pg_catalog.starts_with(coalesce(municipality, ''), muni)
      or pg_catalog.starts_with(coalesce(municipality_code, ''), muni)
    )
    -- 範囲：4 値すべて揃ったときだけ効く（欠けは「絞らない」・260903 のまま）
    and (
      west is null or south is null or east is null or north is null
      or geom operator(extensions.&&) extensions.st_makeenvelope(west, south, east, north, 4326)
    )
    -- 近傍：起点から near_radius_m 以内（楕円体の上の距離・3 値すべて揃ったときだけ効く）
    and (
      near_lon is null or near_lat is null or near_radius_m is null
      or extensions.st_dwithin(
           geom::extensions.geography,
           extensions.st_setsrid(extensions.st_makepoint(near_lon, near_lat), 4326)::extensions.geography,
           near_radius_m)
    )
    -- 会社・法令上の路線・種別・路線：条件があるときだけ内側を呼ぶ
    and (
      (
        coalesce(pg_catalog.cardinality(ops), 0) = 0
        and coalesce(pg_catalog.cardinality(routes), 0) = 0
        and coalesce(pg_catalog.cardinality(route_types), 0) = 0
        and coalesce(pg_catalog.cardinality(line_cds), 0) = 0
      )
      or public.station_matches_railway(station_id, station_operators, ops, routes, route_types, line_cds)
    )
$$;

comment on function public.station_matches_filters(
  smallint, text, text, text, text, extensions.geometry,
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) is
  '駅の絞り込みの単一の定義。prefs=都道府県、muni=市区町村（名前・JIS コードの前方一致）、west..north=範囲、near_*=起点と半径(m)、ops=会社、routes=法令上の路線（S12）、route_types=事業者種別（routes と OR）、line_cds=路線（運行系統・どれか）。条件どうしは AND。展開のため search_path を固定しない（名前はすべて修飾）。';

grant execute on function public.station_matches_filters(
  smallint, text, text, text, text, extensions.geometry,
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) to anon, authenticated;

-- 起点からの距離（m・楕円体の上。起点が無ければ null）。ランキングと一覧が同じ式を使う。
create function public.station_distance_m(
  geom extensions.geometry,
  near_lon double precision,
  near_lat double precision
)
returns double precision
language sql immutable security invoker set search_path = ''
as $$
  select case
    when near_lon is null or near_lat is null then null
    else extensions.st_distance(
      geom::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(near_lon, near_lat), 4326)::extensions.geography
    )
  end
$$;

grant execute on function public.station_distance_m(extensions.geometry, double precision, double precision)
  to anon, authenticated;

-- --- 2a) ランキング --------------------------------------------------------
drop function if exists public.rank_by_column(
  text, text[], text, integer, integer, boolean, text[], text[], int[], int[]
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
  line_cds int[] default null,
  muni text default null,
  west double precision default null,
  south double precision default null,
  east double precision default null,
  north double precision default null,
  near_lon double precision default null,
  near_lat double precision default null,
  near_radius_m double precision default null
)
returns table (
  grp text, station_name text, label text, prefecture text,
  lon double precision, lat double precision,
  value double precision, flag_value double precision, rank bigint, total bigint,
  dist_m double precision
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
           v.value, fv.value as flag_value,
           public.station_distance_m(s.geom, near_lon, near_lat) as dist_m
    from public.station_values v
    join public.stations s on s.id = v.station_id
    left join public.station_values fv
      on fv.station_id = v.station_id and fv.column_id = (select flag_id from fcol)
    where v.column_id = (select id from m)
      and (not exclude_lown or fv.value is distinct from 1)
      and public.station_matches_filters(
            s.id, s.prefecture, s.municipality, s.municipality_code, s.operators, s.geom,
            prefs, muni, ops, routes, route_types, line_cds,
            west, south, east, north, near_lon, near_lat, near_radius_m)
  ),
  ranked as (
    select b.*,
           row_number() over (order by b.value * (case when lower(dir) = 'asc' then 1 else -1 end)) as rank,
           count(*) over () as total
    from base b
  )
  select grp, station_name, label, prefecture, lon, lat, value, flag_value, rank, total, dist_m
  from ranked
  order by rank
  limit lim offset off
$$;

grant execute on function public.rank_by_column(
  text, text[], text, integer, integer, boolean, text[], text[], int[], int[],
  text, double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) to anon, authenticated;

-- --- 2b) 散布 -----------------------------------------------------------------
drop function if exists public.scatter_points(text, text, text, text, text[], text[], text[], int[], int[]);

create function public.scatter_points(
  x_key text,
  y_key text,
  x_flag_key text default null,
  y_flag_key text default null,
  prefs text[] default null,
  ops text[] default null,
  routes text[] default null,
  route_types int[] default null,
  line_cds int[] default null,
  muni text default null,
  west double precision default null,
  south double precision default null,
  east double precision default null,
  north double precision default null,
  near_lon double precision default null,
  near_lat double precision default null,
  near_radius_m double precision default null
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
      and public.station_matches_filters(
            s.id, s.prefecture, s.municipality, s.municipality_code, s.operators, s.geom,
            prefs, muni, ops, routes, route_types, line_cds,
            west, south, east, north, near_lon, near_lat, near_radius_m)
    group by s.id, s.grp, s.station_name
  ) t
  -- x と y の両方が揃った駅だけを返す（片方しか無い駅は散布に描けない・260804）。
  where x is not null and y is not null
$$;

grant execute on function public.scatter_points(
  text, text, text, text, text[], text[], text[], int[], int[],
  text, double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) to anon, authenticated;

-- --- 2c) 駅の一覧（対象集合） -------------------------------------------------
drop function if exists public.list_stations(
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision,
  text[], integer
);

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
  n_op integer, pax_latest integer,
  dist_m double precision
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.label, s.prefecture,
         s.municipality, s.municipality_code,
         s.lon, s.lat, s.n_op, s.pax_latest,
         public.station_distance_m(s.geom, near_lon, near_lat) as dist_m
  from public.stations s
  where (grps is null or coalesce(array_length(grps, 1), 0) = 0 or s.grp = any (grps))
    and public.station_matches_filters(
          s.id, s.prefecture, s.municipality, s.municipality_code, s.operators, s.geom,
          prefs, muni, ops, routes_in, route_types, line_cds,
          west, south, east, north, near_lon, near_lat, near_radius_m)
  order by s.pax_latest desc nulls last, s.grp
  limit least(greatest(coalesce(lim, 300), 1), 2000)
$$;

grant execute on function public.list_stations(
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision,
  text[], integer
) to anon, authenticated;

-- --- 3) 全駅の索引（AI の入口で名前を解決する） ------------------------------
create function public.station_catalog()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'grp', s.grp,
      'name', s.station_name,
      'label', s.label,
      'prefecture', s.prefecture,
      'municipality', s.municipality,
      'municipality_code', s.municipality_code,
      'lon', s.lon,
      'lat', s.lat,
      'pax', s.pax_latest
    ) order by s.id),
    '[]'::jsonb
  )
  from public.stations s
$$;

comment on function public.station_catalog() is
  '全駅の名前・都道府県・市区町村・座標（AI の入口で起点の駅名・市区町村名を解決する索引）。1,000 行の上限を避けて jsonb 1 つで返す。';

grant execute on function public.station_catalog() to anon, authenticated;

-- --- 4) 旧述語（6 引数）を落とす（呼び出し側は上で移した） -----------------------
drop function if exists public.station_matches_filters(smallint, text, text[], text[], int[], int[]);
