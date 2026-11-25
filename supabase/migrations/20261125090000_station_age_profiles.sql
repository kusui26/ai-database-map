-- 261125 人口の年齢 PR-3 — 年齢別の人口のグラフ用の表（docs/261122_PLAN_population_improvement.md §3.5・§5）。
--
-- 駅詳細の人口タブの「年齢別の人口」（積み上げ縦棒・2015〜2050 年）の材料。駅 × 6 半径 × 8 年の 4 区分の人数と、
-- 実績の年（2015・2020）の**補う前の**年齢不詳（⚠「年齢不詳が多い地域です（2020年 23%）」の分子）。
-- pipeline/build_station_age.py が作る data/derived/station_age_profiles.csv を、pipeline/load_station_age.py が入れる。
--
-- 設計上の要点：
--  ・値の表（station_values）に入れない。値の表の列はどれもカタログの指標になり、順位・色分けの選択肢と AI の一覧に並ぶ
--    （192 列・約 110MB）。グラフにしか使わないので、1 駅 1 行の配列にまとめる（約 8MB・TOAST の閾値より小さい）。
--  ・人数は integer。4 区分の和は既存の総数の列（pop_<年>_*・pop_pred_2024_<年>_*）と 1 人単位で一致する（PR-1）。
--    計画の時点の案は real だったが、同じ 4 バイトで 1,677 万人を超えても 1 人単位で持てる integer にした。
--  ・並び：counts は [半径][年][区分]（6 × 8 × 4 = 192）、unknown は [半径][実績の年]（6 × 2 = 12）。
--    半径 500・1000・2000・5000・10000・20000 m、年 2015・2020・2025・2030・2035・2040・2045・2050、
--    区分 0〜14・15〜64・65〜74・75 歳以上（下から積む順）。
--    **並びを知っているのは、この関数（station_age_profile）と投入（load_station_age.py）だけ**。アプリは関数の行（半径・年・
--    区分の名前つき）を読む。2 つが食い違えば pipeline/golden_station_age_profile_test.py が落ちる（CSV の全行と照合する）。
--  ・stations の truncate cascade（load_to_supabase.py の全量の投入）で消えるので、全量の投入のたびに入れ直す
--    （line_stations と同じ扱い）。
--  ・新しい表と関数を足すだけ（既存の関数・表は変えない）＝アプリより先に当ててよい。

create table public.station_age_profiles (
  station_id smallint  primary key references public.stations(id),
  counts     integer[] not null,
  unknown    integer[] not null,
  constraint station_age_profiles_counts_shape check (
    array_ndims(counts) = 1 and cardinality(counts) = 192
    and array_position(counts, null) is null and 0 <= all (counts)
  ),
  constraint station_age_profiles_unknown_shape check (
    array_ndims(unknown) = 1 and cardinality(unknown) = 12
    and array_position(unknown, null) is null and 0 <= all (unknown)
  )
);

comment on table public.station_age_profiles is
  '駅 × 半径 × 年の年齢 4 区分の人数（人口タブの「年齢別の人口」の材料・261122 §3.5）。読むのは station_age_profile(in_grp)。';
comment on column public.station_age_profiles.counts is
  '[半径 6][年 8][区分 4] の人数（年齢不詳を市区町村の不詳補完値に合わせて割り振った値。和は既存の総数の列）。';
comment on column public.station_age_profiles.unknown is
  '[半径 6][実績の年 2]（2015・2020）の補う前の年齢不詳の人数（⚠ の割合の分子）。';

alter table public.station_age_profiles enable row level security;
create policy "station_age_profiles は匿名でも読み取り可" on public.station_age_profiles
  for select to anon, authenticated using (true);
-- 既定の権限（20260816234947・20260817001130）で書き込みは付かないが、表ごとにも明示する（多層防御）。
revoke insert, update, delete, truncate, references, trigger
  on public.station_age_profiles from anon, authenticated;
grant select on public.station_age_profiles to anon, authenticated;

-- 駅 1 つの年齢（48 行＝6 半径 × 8 年・半径 → 年の順）。知らない駅は 0 行。
-- projected は推計の年（R6・2025〜）か。どの年が推計かも並びと同じくここだけが知っていて、アプリはこの列で読む。
-- 推計の年の age_unknown は null（年齢不詳は国勢調査にしかない）。
create function public.station_age_profile(in_grp text)
returns table (
  radius_m    integer,
  year        integer,
  projected   boolean,
  age0_14     integer,
  age15_64    integer,
  age65_74    integer,
  age75plus   integer,
  age_unknown integer
)
language sql stable security invoker set search_path = ''
as $$
  select r.radius_m,
         y.year,
         y.ord > 2,
         p.counts[b.base + 1],
         p.counts[b.base + 2],
         p.counts[b.base + 3],
         p.counts[b.base + 4],
         case when y.ord <= 2 then p.unknown[b.unknown_at] end
  from public.stations s
  join public.station_age_profiles p on p.station_id = s.id
  cross join unnest(array[500, 1000, 2000, 5000, 10000, 20000]) with ordinality as r(radius_m, ord)
  cross join unnest(array[2015, 2020, 2025, 2030, 2035, 2040, 2045, 2050]) with ordinality as y(year, ord)
  cross join lateral (
    select (((r.ord - 1) * 8 + (y.ord - 1)) * 4)::integer as base,
           ((r.ord - 1) * 2 + y.ord)::integer as unknown_at
  ) b
  where s.grp = in_grp
  order by r.ord, y.ord
$$;

comment on function public.station_age_profile(text) is
  '駅 in_grp の年齢 4 区分（0〜14・15〜64・65〜74・75 歳以上）の人数を、6 半径 × 8 年（2015〜2050）の 48 行で返す。2015・2020 年は国勢調査（年齢不詳を補った値・age_unknown は補う前の不詳）、2025 年からは R6 推計（projected = true・age_unknown は null）。';

grant execute on function public.station_age_profile(text) to anon, authenticated;
