-- 261010 B5b — エリア要約の共通 API の読み口（docs/261001_fix_user_feedback_ui.md §6.12.7）。
--
-- B5a の区域の値（areas・area_values）と、駅の値（station_values）を、共通 API（/api/areas・/api/areas/summary・
-- /api/stations/classes）が 1 回の往復で読めるようにする。値の意味づけ（年・増減・言い方・分け方）はアプリのドメイン
-- （src/domain/area-summary・src/domain/style）が持ち、ここは数えるだけ。
--
-- 1) area_station_counts()：区域ごとの駅の数（政令市＝区の駅・東京 23 区＝23 の区の駅・都道府県・全国。沿線は路線の駅）
-- 2) area_rows(keys, with_children)：区域の行と値（jsonb 1 つ）。with_children なら内訳の子（親・束ねる集まりが
--    その区域のもの）も一緒に返す——政令市 → 区、都道府県 → 市区町村、全国 → 都道府県、東京 23 区 → 23 の区
-- 3) area_catalog()：行政区域の一覧（駅の数・無い値の理由つき・1,961 行は PostgREST の 1,000 行の上限を超えるので jsonb）
-- 4) area_station_stats(keys, …絞り込み)：エリアの駅の値の分布——値のある駅の数・⚠ の駅の数・四分位（percentile_cont）・
--    上位と下位の 3 駅。**⚠（指標の信頼性フラグが 1）の値は分布から除く**（ランキングの「⚠ を除外」と同じ）
-- 5) station_metric_values(column_key, …絞り込み)：エリアの駅の値（色分けの入力）。全国 9,273 駅でも 1 回で返すため jsonb の
--    [grp, 値, ⚠] の並び。**値の無い駅も [grp, null, 0] で返す**（⚠ は値があるときだけ）——2 つのエリア（横浜市と神奈川県）を合わせて色分けするとき、
--    値の無い駅を二重に数えずに済む（駅の集合の和が正しく取れる）
--
-- 絞り込みの引数は rank_by_column・scatter_points と同じ名前・同じ述語（station_matches_filters・B2/L2）。エリアの文字列を
-- 絞り込みに写すのはアプリ（政令市は名前の前方一致「横浜市」、市区町村・区は JIS コード、東京 23 区は「131」、沿線は路線コード）。
--
-- ⚠ 数の書き出し：PostgREST の接続は extra_float_digits = 0 で、その設定のまま real を jsonb にすると**有効 6 桁に丸まる**
-- （20km 圏の人口 12,407,970 が 12,408,000 になる・2026-10-10 実測。既存の scatter_points も同じ）。jsonb を返す関数は
-- extra_float_digits = 3 を関数に付けて最短で正確な表記にし、駅の値は real → text → numeric で書き出す（24.3 は 24.3、
-- 12,345,678 は 12,345,678 のまま）。real → numeric の直の型変換は設定によらず有効 6 桁に丸めるので使わない。

create function public.area_station_counts()
returns table (area_id smallint, station_count bigint)
language sql stable security invoker set search_path = '' set extra_float_digits = 3
as $$
  with by_code as (
    select s.municipality_code as code, count(*) as n
    from public.stations s
    where s.municipality_code is not null
    group by s.municipality_code
  ),
  by_pref as (
    select s.prefecture as name, count(*) as n from public.stations s group by s.prefecture
  ),
  by_city as (
    select w.parent_key as key, sum(c.n) as n
    from public.areas w join by_code c on c.code = w.code
    where w.kind = 'ward'
    group by w.parent_key
  ),
  by_group as (
    select w.group_key as key, sum(c.n) as n
    from public.areas w join by_code c on c.code = w.code
    where w.group_key is not null
    group by w.group_key
  )
  select a.id,
         case a.kind
           when 'line' then a.station_count::bigint
           when 'country' then (select count(*) from public.stations)
           when 'prefecture' then coalesce(p.n, 0)
           when 'city' then coalesce(ci.n, 0)::bigint
           when 'special_wards' then coalesce(g.n, 0)::bigint
           else coalesce(c.n, 0)
         end
  from public.areas a
  left join by_code c on c.code = a.code and a.kind in ('municipality', 'ward')
  left join by_pref p on p.name = a.prefecture and a.kind = 'prefecture'
  left join by_city ci on ci.key = a.key
  left join by_group g on g.key = a.key
$$;

comment on function public.area_station_counts() is
  '区域ごとの駅の数（政令市＝区の駅・東京 23 区＝23 の区の駅・沿線＝路線の駅）。area_rows・area_catalog から呼ぶ。';

create function public.area_rows(keys text[], with_children boolean default false)
returns jsonb
language sql stable security invoker set search_path = '' set extra_float_digits = 3
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a.key,
           'kind', a.kind,
           'code', a.code,
           'line_cd', a.line_cd,
           'width_m', a.width_m,
           'name', a.name_ja,
           'label', a.label_ja,
           'prefecture', a.prefecture,
           'parent_key', a.parent_key,
           'group_key', a.group_key,
           'area_km2', a.area_km2,
           'missing', a.missing,
           'station_count', c.station_count,
           'values', coalesce(v.vals, '{}'::jsonb)
         ) order by a.id), '[]'::jsonb)
  from public.areas a
  join public.area_station_counts() c on c.area_id = a.id
  left join lateral (
    select jsonb_object_agg(m.key, av.value) as vals
    from public.area_values av join public.area_metrics m on m.id = av.metric_id
    where av.area_id = a.id
  ) v on true
  where a.key = any(keys)
     or (with_children and (a.parent_key = any(keys) or a.group_key = any(keys)))
$$;

comment on function public.area_rows(text[], boolean) is
  '区域の行と値（jsonb）。with_children なら内訳の子（parent_key・group_key がその区域のもの）も返す。';

create function public.area_catalog()
returns jsonb
language sql stable security invoker set search_path = '' set extra_float_digits = 3
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a.key,
           'kind', a.kind,
           'code', a.code,
           'name', a.name_ja,
           'label', a.label_ja,
           'prefecture', a.prefecture,
           'parent_key', a.parent_key,
           'group_key', a.group_key,
           'station_count', c.station_count,
           'missing', a.missing
         ) order by a.id), '[]'::jsonb)
  from public.areas a
  join public.area_station_counts() c on c.area_id = a.id
  where a.kind <> 'line'
$$;

comment on function public.area_catalog() is
  '行政区域の一覧（駅の数・無い値の理由つき）。沿線は lines の路線コードと幅で作る（line:<路線コード>@<幅>）。';

create function public.area_station_stats(
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
    from public.stations s
    where public.station_matches_filters(
            s.id, s.prefecture, s.municipality, s.municipality_code, s.operators, s.geom,
            prefs, muni, ops, routes, route_types, line_cds,
            west, south, east, north, near_lon, near_lat, near_radius_m)
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

comment on function public.area_station_stats(
  text[], text[], text[], text[], int[], int[], text,
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) is
  'エリアの駅の値の分布（四分位・上位と下位の 3 駅）。⚠ の値は除いて数え、数だけ返す。知らない key は返らない。';

create function public.station_metric_values(
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
    from public.stations s
    where public.station_matches_filters(
            s.id, s.prefecture, s.municipality, s.municipality_code, s.operators, s.geom,
            prefs, muni, ops, routes, route_types, line_cds,
            west, south, east, north, near_lon, near_lat, near_radius_m)
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

comment on function public.station_metric_values(
  text, text[], text[], text[], int[], int[], text,
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) is
  'エリアの駅の値（色分けの入力）：{station_count, values: [[grp, 値, ⚠ なら 1]]}。値の無い駅は [grp, null, 0]。';

grant execute on function public.area_station_counts() to anon, authenticated;
grant execute on function public.area_rows(text[], boolean) to anon, authenticated;
grant execute on function public.area_catalog() to anon, authenticated;
grant execute on function public.area_station_stats(
  text[], text[], text[], text[], int[], int[], text,
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) to anon, authenticated;
grant execute on function public.station_metric_values(
  text, text[], text[], text[], int[], int[], text,
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) to anon, authenticated;
