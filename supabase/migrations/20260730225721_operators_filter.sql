-- 散布図の「運営会社」フィルタ（docs/260730_scatter_plot_operators_filter.md）。
--
-- ① values_for_columns に ops（運営会社の配列）を追加し、DB 側で絞り込む。
--    stations.operators は「pax 規模降順・『・』連結」の 1 文字列（P5d）。部分一致だと
--    「京成電鉄」が「新京成電鉄」に、「札幌市」が「一般社団法人札幌市交通事業振興公社」に
--    誤ヒットするため、**『・』で分割した配列との重なり（&&）＝完全一致の OR** で判定する。
-- ② operator_names(): セレクタ用の会社一覧（社名＋駅数・多い順）。
--
-- security invoker・search_path='' ・動的 SQL なし（既存 RPC の方針を踏襲）。

-- 2 引数版を残すと PostgREST がオーバーロードを一意に解決できないため、必ず drop してから作る。
drop function if exists public.values_for_columns(text[], text[]);

create function public.values_for_columns(
  column_keys text[],
  prefs text[] default null,
  ops text[] default null
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
      coalesce(cardinality(ops), 0) = 0
      or string_to_array(coalesce(s.operators, ''), '・') && ops
    )
$$;

comment on function public.values_for_columns(text[], text[], text[]) is
  '散布用の値取得。prefs=都道府県（空/null=全国）、ops=運営会社（空/null=全社・「・」分割の完全一致 OR）。max-rows 回避のため単一 jsonb で返す。';

grant execute on function public.values_for_columns(text[], text[], text[]) to anon, authenticated;

create function public.operator_names()
returns table(name text, station_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select o.name, count(*)::bigint as station_count
  from public.stations s
  cross join lateral unnest(string_to_array(coalesce(s.operators, ''), '・')) as o(name)
  where o.name <> ''
  group by o.name
  order by count(*) desc, o.name
$$;

comment on function public.operator_names() is
  '運営会社の一覧（社名と駅グループ数・多い順）。散布図の会社セレクタと AI ツールが参照する。';

grant execute on function public.operator_names() to anon, authenticated;
