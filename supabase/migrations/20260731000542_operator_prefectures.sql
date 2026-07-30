-- 運営会社ごとの都道府県を返す（docs/260730_scatter_plot_prefecture_to_operaters.md）。
--
-- 散布モーダルで「都道府県 ⇄ 運営会社」の選択肢を連動させるための対応表。
-- （会社 × 都道府県）は 8,507 通りのうち実在が 289 通り（3.4%）しかなく、
-- 候補を絞らないと 96.6% の組合せが 0 件になるため、UI 側で選択肢を出し分ける。
--
-- 戻り値の型が変わるため drop → create（PostgREST のスキーマキャッシュ都合でも必要）。

drop function if exists public.operator_names();

create function public.operator_names()
returns table(name text, station_count bigint, prefectures text[])
language sql stable security invoker set search_path = ''
as $$
  select o.name,
         count(*)::bigint as station_count,
         array_agg(distinct s.prefecture order by s.prefecture) as prefectures
  from public.stations s
  cross join lateral unnest(string_to_array(coalesce(s.operators, ''), '・')) as o(name)
  where o.name <> ''
  group by o.name
  order by count(*) desc, o.name
$$;

comment on function public.operator_names() is
  '運営会社の一覧（社名・駅グループ数・走行する都道府県）。散布図の会社セレクタと都道府県との連動に使う。';

grant execute on function public.operator_names() to anon, authenticated;
