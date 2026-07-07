-- P2a — anon/authenticated を SELECT のみに厳格化（最小権限・.claude/CLAUDE.md §8）
-- Supabase の既定で付与される TRUNCATE / REFERENCES / TRIGGER を剥奪する。
-- PostgREST 経由では露出しない権限だが、防御的に最小権限へ揃える（SELECT は維持）。
revoke truncate, references, trigger
  on public.stations, public.metric_columns, public.station_values
  from anon, authenticated;
