-- P3b — 全駅 GeoJSON を単一 jsonb 行で返す（PostgREST の max-rows=1000 を回避）。
-- 地図の全駅レイヤ用に FeatureCollection を SQL 側で組み立てる（1回配信＋CDNキャッシュ・plan §2.2-①）。
create or replace function public.stations_geojson()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'geometry', jsonb_build_object(
            'type', 'Point',
            'coordinates', jsonb_build_array(s.lon, s.lat)
          ),
          'properties', jsonb_build_object(
            'grp', s.grp,
            'name', s.station_name,
            'pax', s.pax_latest
          )
        )
        order by s.pax_latest desc nulls last
      ),
      '[]'::jsonb
    )
  )
  from public.stations s
$$;

grant execute on function public.stations_geojson() to anon, authenticated;
