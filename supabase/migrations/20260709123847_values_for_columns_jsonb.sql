-- P6c 修正 — 散布図（全国）で values_for_columns が PostgREST の max-rows=1000 に切られ、
-- 先頭1000行が片方の指標だけになり (x,y) ペアが 0 → 点が出ない不具合。
-- stations_geojson と同じく「単一 jsonb で返す」形にして行上限を回避する。
-- 返却は散布に必要な最小列（grp・station_name・key・value）のみ。

drop function if exists public.values_for_columns(text[], text[]);

create function public.values_for_columns(column_keys text[], prefs text[] default null)
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
$$;

grant execute on function public.values_for_columns(text[], text[]) to anon, authenticated;
