-- P5f — 検索結果に search_label（label＋都道府県・全群で一意。docs/passenger_aggregation.md §8.1.1）を返す。
-- 同名・同一都道府県で運営会社違いの駅（尼崎型）をドロップダウンで区別するため。
-- 返り値の型が変わるため drop → create（CREATE OR REPLACE では戻り値型を変更できない）。
-- grant は drop で失われるため再付与する。RPC は既に search_label で ilike 検索済み（返していないだけ）。
drop function if exists public.search_stations(text);

create function public.search_stations(q text)
returns table (
  grp text, station_name text, label text, search_label text, prefecture text,
  lon double precision, lat double precision, pax_latest integer
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.label, s.search_label, s.prefecture, s.lon, s.lat, s.pax_latest
  from public.stations s
  where s.search_label ilike '%' || q || '%' or s.station_name ilike '%' || q || '%'
  -- 駅名一致を都道府県サフィックスのみ一致より優先し、同順位は乗降客数の多い順
  order by (case when s.station_name ilike '%' || q || '%' then 0 else 1 end),
           s.pax_latest desc nulls last
  limit 10
$$;

grant execute on function public.search_stations(text) to anon, authenticated;
