-- 260903 PR-6 — 駅別ハザードの事前計算（docs/260828_research_claude_auth.md §5.3 ③・§10 PR-6）。
-- 決定 9：災害は指標ではない——metric_columns / station_values には入れず、**独立のテーブル**で持つ。
-- 値の投入は pipeline/load_station_hazard.py（ビルダー pipeline/build_station_hazard.ts の jsonl）。
-- 版管理（version / computed_at）を行ごとに持ち、統計指標のフルロードとは独立に再計算する。

create table public.station_hazard (
  station_id  smallint primary key references public.stations(id),
  grp         text not null unique,
  version     integer not null,
  computed_at timestamptz not null,
  -- summary は shared/hazard-summary.ts の StationHazardSummary（単一の真実・読み手が Zod 検証）。
  summary     jsonb not null
);

comment on table public.station_hazard is
  '駅別ハザードサマリ（事前計算・想定最大規模の静的区分。pointHazard と同じ組み立てをオフライン実行）';
comment on column public.station_hazard.summary is
  'shared/hazard-summary.ts の StationHazardSummary（jsonb・浸水ナビの実測は含めない）';

alter table public.station_hazard enable row level security;
create policy "public read station_hazard" on public.station_hazard
  for select to anon, authenticated using (true);
grant select on public.station_hazard to anon, authenticated;

-- get_hazard_summary / build_dataset include_hazard の入口（grps ≤ 500・§5.3 ③）。
create function public.station_hazard_summaries(grps text[])
returns table (grp text, version integer, computed_at timestamptz, summary jsonb)
language sql stable security invoker set search_path = ''
as $$
  select h.grp, h.version, h.computed_at, h.summary
  from public.station_hazard h
  where h.grp = any (grps)
  order by h.grp
  limit 500
$$;

grant execute on function public.station_hazard_summaries(text[]) to anon, authenticated;
