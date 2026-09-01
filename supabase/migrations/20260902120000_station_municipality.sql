-- 260902 PR-4 — 市区町村列と list_stations（docs/260828_research_claude_auth.md §5.3・§9.2 決定 10）。
-- 値の投入は pipeline/load_municipality.py（サイドカー CSV・N03 2026 空間結合）。
-- 方針は既存 RPC と同じ: security invoker（RLS 適用）・search_path='' で完全 schema 修飾・動的 SQL なし。

alter table public.stations
  add column municipality text,
  add column municipality_code text;

comment on column public.stations.municipality is
  '市区町村名（政令市は市名＋区名。N03 行政区域を代表点に空間結合・pipeline/build_municipality.py）';
comment on column public.stations.municipality_code is 'JIS 市区町村コード（N03_007・5 桁）';

-- 「横浜市で」= 前方一致で区を束ねる（like ''横浜市%''）。text_pattern_ops で前方一致に索引を効かせる。
create index stations_municipality_idx on public.stations (municipality text_pattern_ops);
create index stations_municipality_code_idx on public.stations (municipality_code text_pattern_ops);

-- 1) list_stations — 分析グレードの入口（対象集合を作る・値は返さない・§5.3）。
--    muni は市区町村名の前方一致（例「横浜市」「横浜市西区」）または JIS コードの前方一致（例「141」）。
create function public.list_stations(
  prefs text[] default null,
  muni text default null,
  lim integer default 300
)
returns table (
  grp text, station_name text, label text, prefecture text,
  municipality text, municipality_code text,
  lon double precision, lat double precision,
  n_op integer, pax_latest integer
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.label, s.prefecture,
         s.municipality, s.municipality_code,
         s.lon, s.lat, s.n_op, s.pax_latest
  from public.stations s
  where (prefs is null or coalesce(array_length(prefs, 1), 0) = 0 or s.prefecture = any (prefs))
    and (muni is null or muni = ''
         or s.municipality like muni || '%'
         or s.municipality_code like muni || '%')
  order by s.pax_latest desc nulls last, s.grp
  limit least(greatest(coalesce(lim, 300), 1), 2000)
$$;

grant execute on function public.list_stations(text[], text, integer) to anon, authenticated;

-- 2) search_stations に municipality を追加（返り値の型が変わるため drop → create・grant 再付与。
--    既存の順位付け・limit は 20260709090514 の定義を変えない）。
drop function if exists public.search_stations(text);

create function public.search_stations(q text)
returns table (
  grp text, station_name text, label text, search_label text, prefecture text,
  municipality text,
  lon double precision, lat double precision, pax_latest integer
)
language sql stable security invoker set search_path = ''
as $$
  select s.grp, s.station_name, s.label, s.search_label, s.prefecture,
         s.municipality,
         s.lon, s.lat, s.pax_latest
  from public.stations s
  where s.search_label ilike '%' || q || '%' or s.station_name ilike '%' || q || '%'
  -- 駅名一致を都道府県サフィックスのみ一致より優先し、同順位は乗降客数の多い順
  order by (case when s.station_name ilike '%' || q || '%' then 0 else 1 end),
           s.pax_latest desc nulls last
  limit 10
$$;

grant execute on function public.search_stations(text) to anon, authenticated;
