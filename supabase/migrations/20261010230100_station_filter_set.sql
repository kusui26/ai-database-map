-- 2026-10-10 B5 で見つけたこと 2（`docs/261001_fix_user_feedback_ui.md` §6.14・§6.15）：
-- 会社・法令上の路線・種別・路線（運行系統）で絞ると、駅を絞るすべての RPC が約 160ms 遅かった。
--
-- 原因：駅の絞り込みは「駅ごとに真偽を返す述語」（station_matches_filters・B2/L2）で、会社・路線などの条件だけを内側の関数
-- （station_matches_railway）に分けていた。内側は副問い合わせ（EXISTS）を持つ。PostgreSQL は副問い合わせを持つ SQL の関数を
-- 呼び出し側に展開しないので、条件があると全駅 9,273 のそれぞれで内側の関数を呼んでいた（1 回約 16µs）。内側の
-- `set search_path` を外しても 155ms → 148ms にしかならない（展開できない理由は SET ではなく副問い合わせ）。
--
-- 直し方：絞り込みを「条件に合う駅の集合を返す関数」（stations_matching_filters）にする。集合を返す SQL の関数は、副問い合わせを
-- 持っていても呼び出し側の FROM に展開される。会社・路線の条件は `s.id = any (select …)`（相関の無い副問い合わせ）で書くので、
-- 呼び出し側の問い合わせの中で 1 回だけ引いてハッシュにする（駅ごとに引き直さない・EXISTS のままだと計画が駅ごとの索引の
-- 引き直しを選ぶことがあった）。条件の意味は変えない：
--   - 会社だけ（法令上の路線・種別なし）：駅の運営会社（stations.operators）のどれか
--   - 法令上の路線・種別：station_routes の同じ行の会社と組（会社が無ければ路線・種別だけ）
--   - 路線（運行系統）：line_stations のどれかの路線の駅。ほかの条件とは AND
--
-- 実測（本番・汎用の計画・駅を数えるだけ）：路線 26001 160ms → 3ms、会社 東京地下鉄 173ms → 8ms、会社 JR東日本 165ms → 9ms、
-- 法令上の路線 東横線 161ms → 5ms、種別 4 162ms → 6ms。絞らない・都道府県・市区町村は変わらない（2〜4ms）。20 通りの条件で
-- 5 つの RPC の結果が以前と完全に同じ（`pipeline/golden_station_filter_test.py --trial`）。
--
-- 呼び出し側（rank_by_column・scatter_points・list_stations・area_station_stats・station_metric_values）は、引数も返り値も
-- 以前のまま（アプリはそのまま呼べる）。`from public.stations s where public.station_matches_filters(…)` を
-- `from public.stations_matching_filters(…) s` に替えただけで、ほかは 1 文字も変えない。古い 2 つの述語は最後に落とす
-- （絞り込みの定義は 1 つ）。
--
-- ⚠ stations_matching_filters は SET を持たない（持つと展開されない）。名前はすべてスキーマで修飾してある（search_path に頼らない）。
-- Supabase のリンタは「search_path が固定されていない」と注意を出す（以前の外側の述語と同じ）が、security invoker なので
-- 呼んだ人の権限でしか動かない。

-- --- 絞り込み（駅の集合・単一の定義） --------------------------------------------------------------
create function public.stations_matching_filters(
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
returns setof public.stations
language sql stable security invoker
as $$
  select s.*
  from public.stations s
  where
    -- 都道府県（どれか）
    (coalesce(pg_catalog.cardinality(prefs), 0) = 0 or s.prefecture operator(pg_catalog.=) any(prefs))
    -- 市区町村：名前か JIS コードの前方一致（「横浜市」で全区・空は絞らない・「%」を特別扱いしない）
    and (
      coalesce(muni, '') = ''
      or pg_catalog.starts_with(coalesce(s.municipality, ''), muni)
      or pg_catalog.starts_with(coalesce(s.municipality_code, ''), muni)
    )
    -- 範囲：4 値すべて揃ったときだけ効く（欠けは「絞らない」）
    and (
      west is null or south is null or east is null or north is null
      or s.geom operator(extensions.&&) extensions.st_makeenvelope(west, south, east, north, 4326)
    )
    -- 近傍：起点から near_radius_m 以内（楕円体の上の距離・3 値すべて揃ったときだけ効く）
    and (
      near_lon is null or near_lat is null or near_radius_m is null
      or extensions.st_dwithin(
           s.geom::extensions.geography,
           extensions.st_setsrid(extensions.st_makepoint(near_lon, near_lat), 4326)::extensions.geography,
           near_radius_m)
    )
    -- 会社・法令上の路線・種別：会社だけなら駅の運営会社のどれか。法令上の路線・種別は、同じ行の会社と組で
    and (
      (
        coalesce(pg_catalog.cardinality(routes), 0) = 0
        and coalesce(pg_catalog.cardinality(route_types), 0) = 0
        and (
          coalesce(pg_catalog.cardinality(ops), 0) = 0
          or pg_catalog.string_to_array(coalesce(s.operators, ''), '・') operator(pg_catalog.&&) ops
        )
      )
      or s.id operator(pg_catalog.=) any (
        select sr.station_id
        from public.station_routes sr
        where (coalesce(pg_catalog.cardinality(ops), 0) = 0 or sr.operator operator(pg_catalog.=) any(ops))
          and (
            (coalesce(pg_catalog.cardinality(routes), 0) > 0 and sr.route operator(pg_catalog.=) any(routes))
            or (coalesce(pg_catalog.cardinality(route_types), 0) > 0
                and sr.route_type operator(pg_catalog.=) any(route_types))
          )
      )
    )
    -- 路線（運行系統・L2）：どれかの路線の駅
    and (
      coalesce(pg_catalog.cardinality(line_cds), 0) = 0
      or s.id operator(pg_catalog.=) any (
        select ls.station_id
        from public.line_stations ls
        where ls.line_cd operator(pg_catalog.=) any(line_cds)
      )
    )
$$;

comment on function public.stations_matching_filters(
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) is
  '駅の絞り込みの単一の定義（条件に合う駅の集合）。呼び出し側の FROM に展開される（SET を付けない）。2026-10-10 の B5 の見つけたこと 2。';

grant execute on function public.stations_matching_filters(
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) to anon, authenticated;

-- --- 呼び出し側（引数・返り値・設定は以前のまま。絞り込みの行だけを替える） ---------------------------

-- 順位表：値の行に、条件に合う駅の集合を結ぶ（以前の述語と同じ駅・同じ順位）。
create or replace function public.rank_by_column(
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
    join public.stations_matching_filters(
           prefs, muni, ops, routes, route_types, line_cds,
           west, south, east, north, near_lon, near_lat, near_radius_m) s on s.id = v.station_id
    left join public.station_values fv
      on fv.station_id = v.station_id and fv.column_id = (select flag_id from fcol)
    where v.column_id = (select id from m)
      and (not exclude_lown or fv.value is distinct from 1)
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

-- 散布：2 つの指標の値の行に、条件に合う駅の集合を結ぶ。
create or replace function public.scatter_points(
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
-- extra_float_digits = 3 は 20261010230000（数を有効 6 桁に丸めない）で足した設定。作り直しても保つ。
language sql stable security invoker set search_path = '' set extra_float_digits = 3
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
    join public.stations_matching_filters(
           prefs, muni, ops, routes, route_types, line_cds,
           west, south, east, north, near_lon, near_lat, near_radius_m) s on s.id = v.station_id
    where mc.key in (x_key, y_key, x_flag_key, y_flag_key)
    group by s.id, s.grp, s.station_name
  ) t
  -- x と y の両方が揃った駅だけを返す（片方しか無い駅は散布に描けない・260804）。
  where x is not null and y is not null
$$;

-- 一覧：条件に合う駅の集合から、明示の駅・件数で切る（法令上の路線の引数名は routes_in のまま）。
create or replace function public.list_stations(
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
  from public.stations_matching_filters(
         prefs, muni, ops, routes_in, route_types, line_cds,
         west, south, east, north, near_lon, near_lat, near_radius_m) s
  where (grps is null or coalesce(array_length(grps, 1), 0) = 0 or s.grp = any (grps))
  order by s.pax_latest desc nulls last, s.grp
  limit least(greatest(coalesce(lim, 300), 1), 2000)
$$;

-- エリアの駅の分布（B5b）：駅の集合をそのまま picked にする。
create or replace function public.area_station_stats(
  keys text[],
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
language sql stable security invoker set search_path = '' set extra_float_digits = 3
as $$
  with picked as (
    select s.id, s.grp, s.label
    from public.stations_matching_filters(
           prefs, muni, ops, routes, route_types, line_cds,
           west, south, east, north, near_lon, near_lat, near_radius_m) s
  ),
  wanted as (
    select k.key, k.ord, m.id as column_id, f.id as flag_id
    from unnest(keys) with ordinality as k(key, ord)
    join public.metric_columns m on m.key = k.key
    left join public.metric_columns f on f.key = (m.meta ->> 'reliabilityFlagKey')
  ),
  vals as (
    select w.key, p.grp, p.label, v.value::text::numeric as value,
           coalesce(fv.value = 1, false) as flagged
    from wanted w
    join public.station_values v on v.column_id = w.column_id
    join picked p on p.id = v.station_id
    left join public.station_values fv on fv.column_id = w.flag_id and fv.station_id = p.id
  ),
  ranked as (
    select vals.key, vals.grp, vals.label, vals.value,
           row_number() over (partition by vals.key order by vals.value desc, vals.grp) as from_top,
           row_number() over (partition by vals.key order by vals.value asc, vals.grp) as from_bottom
    from vals
    where not vals.flagged
  ),
  stats as (
    select w.key, w.ord,
           count(v.value) filter (where not v.flagged) as n,
           count(v.value) filter (where v.flagged) as flagged_n,
           percentile_cont(0.25) within group (order by v.value::double precision) filter (where not v.flagged) as q1,
           percentile_cont(0.5) within group (order by v.value::double precision) filter (where not v.flagged) as median,
           percentile_cont(0.75) within group (order by v.value::double precision) filter (where not v.flagged) as q3
    from wanted w left join vals v on v.key = w.key
    group by w.key, w.ord
  )
  select jsonb_build_object(
    'station_count', (select count(*) from picked),
    'stats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', st.key,
               'n', st.n,
               'flagged_n', st.flagged_n,
               'q1', st.q1,
               'median', st.median,
               'q3', st.q3,
               'top', coalesce((
                 select jsonb_agg(jsonb_build_object('grp', r.grp, 'label', r.label, 'value', r.value) order by r.from_top)
                 from ranked r where r.key = st.key and r.from_top <= 3), '[]'::jsonb),
               'bottom', coalesce((
                 select jsonb_agg(jsonb_build_object('grp', r.grp, 'label', r.label, 'value', r.value) order by r.from_bottom)
                 from ranked r where r.key = st.key and r.from_bottom <= 3), '[]'::jsonb)
             ) order by st.ord)
      from stats st), '[]'::jsonb)
  )
$$;

-- 色分けの値（B5b）：駅の集合をそのまま picked にする。
create or replace function public.station_metric_values(
  column_key text,
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
language sql stable security invoker set search_path = '' set extra_float_digits = 3
as $$
  with m as (
    select mc.id, (mc.meta ->> 'reliabilityFlagKey') as flag_key
    from public.metric_columns mc where mc.key = column_key
  ),
  f as (
    select mc.id from public.metric_columns mc where mc.key = (select flag_key from m)
  ),
  picked as (
    select s.id, s.grp
    from public.stations_matching_filters(
           prefs, muni, ops, routes, route_types, line_cds,
           west, south, east, north, near_lon, near_lat, near_radius_m) s
  )
  select jsonb_build_object(
    'station_count', (select count(*) from picked),
    'values', coalesce((
      select jsonb_agg(jsonb_build_array(p.grp, v.value::text::numeric,
                                         case when v.value is not null and fv.value = 1 then 1 else 0 end)
                       order by p.id)
      from picked p
      left join public.station_values v on v.station_id = p.id and v.column_id = (select id from m)
      left join public.station_values fv on fv.station_id = p.id and fv.column_id = (select id from f)
    ), '[]'::jsonb)
  )
$$;

-- --- 古い述語を落とす（呼び出し側はもう使っていない・絞り込みの定義を 1 つにする） -------------------------
drop function public.station_matches_filters(
  smallint, text, text, text, text, extensions.geometry,
  text[], text, text[], text[], int[], int[],
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
);

drop function public.station_matches_railway(smallint, text, text[], text[], int[], int[]);
