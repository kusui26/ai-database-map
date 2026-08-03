-- 散布の取得を「駅 1 行」に畳んで軽くする（260804）。
--
-- これまでの values_for_columns は **縦持ち**（1 駅 × 指標キーごとに 1 行）で返していた。
-- 散布は x・y と、それぞれの信頼性フラグの最大 4 キーを使うため、1 駅あたり最大 4 行になり、
-- grp と station_name が 4 回ずつ重複する。実測（読み取りのみの試算）：
--   現状（縦持ち）  DB 5,272ms / JSON 2,978KB
--   ピボット        DB 1,345ms / JSON   658KB   ← 約 1/4 の時間・約 1/4.5 のデータ量
-- （docs/260803_processing_speed.md §4-⑤・§14）
--
-- 汎用のピボットは動的 SQL が要る（本リポジトリでは禁止）ため、**散布に必要な 4 スロットを
-- 引数で受ける専用 RPC** にする。絞り込みの述語は station_matches_filters() を共有し、
-- 意味が散布・ランキングでズレないようにする（260801 と同じ方針）。
--
-- values_for_columns は本 PR 以降は未使用になるが、**この移行では残す**。
-- DB を先に適用してからアプリを配信するため、切り替えの間だけ旧コードが呼びうるため。
-- 配信が落ち着いたあとの別マイグレーションで drop する。

create or replace function public.scatter_points(
  x_key text,
  y_key text,
  x_flag_key text default null,
  y_flag_key text default null,
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
      and public.station_matches_filters(s.id, s.operators, ops, routes, route_types)
    group by s.id, s.grp, s.station_name
  ) t
  -- x と y の両方が揃った駅だけを返す（片方しか無い駅は散布に描けない）。
  -- 従来はこの間引きをアプリ側で行っていたが、DB で落としたほうが転送量が減る。
  where x is not null and y is not null
$$;

grant execute on function public.scatter_points(
  text, text, text, text, text[], text[], text[], int[]
) to anon, authenticated;
