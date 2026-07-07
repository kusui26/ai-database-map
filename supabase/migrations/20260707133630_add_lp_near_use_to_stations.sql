-- P2b — 最寄地価公示地点の用途区分（lp_near_use）を stations に保持する。
-- station_values は数値（float8）専用のため、唯一のカテゴリ文字列メトリクスである
-- lp_near_use は駅レベルの属性として stations に置く（catalog には metric として残す）。
alter table public.stations add column lp_near_use text;

comment on column public.stations.lp_near_use is '最寄地価公示地点の用途区分（住宅地/商業地 等・カテゴリ文字列。数値でないため station_values ではなく stations に保持）';
