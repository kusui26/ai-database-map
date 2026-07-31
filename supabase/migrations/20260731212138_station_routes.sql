-- 路線フィルタ（docs/260730_scatter_plot_routes.md）。
--
-- 国土数値情報 S12 の路線名（S12_003）と事業者種別（S12_005）を駅グループに紐づけて保持する。
-- pipeline/build_station_routes.py が生成し、pipeline/load_station_routes.py が投入する（10,424 行）。
--
-- 設計上の要点：
--  ・路線名は会社をまたいで重複する（561 本中 28 本。「本線」は 10 社、「東海道線」は JR 3 社）。
--    そのため路線は (station_id, operator, route) を主キーとし、会社と組で扱えるようにする。
--  ・事業者種別は 1:JR新幹線 2:JR在来線 3:公営鉄道 4:民営鉄道 5:第三セクター。
--    「新幹線駅のみ」は種別 1 で厳密に表現できる（名前の部分一致に頼らない）。

create table public.station_routes (
  station_id smallint  not null references public.stations(id) on delete cascade,
  operator   text      not null,
  route      text      not null,
  route_type smallint  not null,
  primary key (station_id, operator, route)
);

comment on table public.station_routes is
  '駅グループ × 運営会社 × 路線（S12-25 由来）。route_type は 1:JR新幹線 2:JR在来線 3:公営 4:民営 5:第三セクター。';

create index station_routes_route_idx on public.station_routes (route);
create index station_routes_type_idx on public.station_routes (route_type);

alter table public.station_routes enable row level security;
create policy "station_routes は匿名でも読み取り可" on public.station_routes
  for select to anon, authenticated using (true);
grant select on public.station_routes to anon, authenticated;

-- --- 散布の絞り込みに路線・種別を追加 -------------------------------------
-- 旧シグネチャは必ず drop（残すと PostgREST がオーバーロードを解決できない）。
drop function if exists public.values_for_columns(text[], text[], text[]);

create function public.values_for_columns(
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
    and (
      -- 路線・種別が未指定：会社は従来どおり stations.operators で判定（挙動は不変）。
      (
        coalesce(cardinality(routes), 0) = 0
        and coalesce(cardinality(route_types), 0) = 0
        and (
          coalesce(cardinality(ops), 0) = 0
          or string_to_array(coalesce(s.operators, ''), '・') && ops
        )
      )
      -- 路線・種別が指定された：会社も station_routes の**同じ行**で判定する。
      -- （東京駅は JR東海の東海道新幹線と JR東日本の東北新幹線を持つため、独立に AND すると
      --   「東海旅客鉄道 × 東北新幹線」で誤ヒットする）。routes と route_types は OR。
      or exists (
        select 1
        from public.station_routes sr
        where sr.station_id = s.id
          and (coalesce(cardinality(ops), 0) = 0 or sr.operator = any(ops))
          and (
            (coalesce(cardinality(routes), 0) > 0 and sr.route = any(routes))
            or (coalesce(cardinality(route_types), 0) > 0 and sr.route_type = any(route_types))
          )
      )
    )
$$;

comment on function public.values_for_columns(text[], text[], text[], text[], int[]) is
  '散布用の値取得。prefs=都道府県、ops=運営会社（「・」分割の完全一致 OR）、routes=路線名、route_types=事業者種別。routes/route_types 指定時は会社条件も station_routes の同一行で判定する。';

grant execute on function public.values_for_columns(text[], text[], text[], text[], int[]) to anon, authenticated;

-- --- 路線の一覧（セレクタ・AI ツール用） ---------------------------------
create function public.route_names()
returns table(route text, station_count bigint, operators text[], route_types smallint[])
language sql stable security invoker set search_path = ''
as $$
  select sr.route,
         count(distinct sr.station_id)::bigint as station_count,
         array_agg(distinct sr.operator order by sr.operator) as operators,
         array_agg(distinct sr.route_type order by sr.route_type) as route_types
  from public.station_routes sr
  group by sr.route
  order by count(distinct sr.station_id) desc, sr.route
$$;

comment on function public.route_names() is
  '路線の一覧（路線名・駅グループ数・運営会社・事業者種別）。同名で会社が異なる路線があるため operators を持つ。';

grant execute on function public.route_names() to anon, authenticated;
