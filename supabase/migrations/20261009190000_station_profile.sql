-- 261009 B4 — 駅周辺のプロフィール：駅の値が、県内（と市内）の駅のなかで何位か
-- （docs/261001_fix_user_feedback_ui.md §6.4 B4）。
--
-- 「横浜駅の周辺はどんなエリア？」に 1 回で答えるため、駅×半径の要点（人口・地価・従業者…）に
-- **県内（あれば市内）での位置**を添える。位置は値の大きい順の順位（同じ値は同じ順位＝1 ＋ 自分より大きい駅の数）と、
-- 比べた駅の数（その指標の値がある駅だけ）。百分位や「上位 ◯%」の言い方はアプリのドメインが決める（ここは数えるだけ）。
--
-- 1) station_profile_ranks(in_grp, keys, area) — 駅 1 つ × 指標いくつか の順位を 1 回で返す。
--    - 県内＝駅と同じ都道府県の駅。市内＝市区町村の前方一致（政令市は「横浜市」で全区・B2 の muni と同じ比べ方）
--    - area は**駅自身がその中にあるときだけ**数える（違う市を渡されたら市内の列は null。自分のいない集合の順位を作らない）
--    - 駅に値が無い指標・知らない key は行を返さない（アプリの Zod とドメインが「位置なし」として扱う）
--    - 1 駅 11 指標で約 30〜50ms（東京都 654 駅・2026-10-09 実測）。駅ごとに呼ぶので、全駅を回す用途には使わない
-- 2) 新しい関数を足すだけ（既存の関数・表は変えない）＝アプリより先に当ててよい。

create function public.station_profile_ranks(
  in_grp text,
  keys text[],
  area text default null
)
returns table (
  key text,
  value double precision,
  pref_rank bigint,
  pref_total bigint,
  area_rank bigint,
  area_total bigint
)
language sql stable security invoker set search_path = ''
as $$
  with target as (
    select s.id, s.prefecture, s.municipality
    from public.stations s
    where s.grp = in_grp
  ),
  scope as (
    -- 市内は、駅自身がその中にあるときだけ（前方一致・「%」を特別扱いしない）
    select t.prefecture,
           case
             when coalesce(area, '') <> ''
              and pg_catalog.starts_with(coalesce(t.municipality, ''), area)
             then area
           end as area
    from target t
  ),
  own as (
    select mc.id as column_id, mc.key, v.value
    from public.metric_columns mc
    join public.station_values v on v.column_id = mc.id
    join target t on t.id = v.station_id
    where mc.key = any(keys)
  ),
  peers as (
    select o.key,
           o.value as own_value,
           v.value,
           (sc.area is not null and pg_catalog.starts_with(coalesce(s.municipality, ''), sc.area)) as in_area
    from own o
    cross join scope sc
    join public.station_values v on v.column_id = o.column_id
    join public.stations s on s.id = v.station_id
    where s.prefecture = sc.prefecture
  )
  select p.key,
         p.own_value::double precision,
         1 + count(*) filter (where p.value > p.own_value),
         count(*),
         case when bool_or(p.in_area) then 1 + count(*) filter (where p.in_area and p.value > p.own_value) end,
         case when bool_or(p.in_area) then count(*) filter (where p.in_area) end
  from peers p
  group by p.key, p.own_value
$$;

comment on function public.station_profile_ranks(text, text[], text) is
  '駅周辺のプロフィール（B4）：駅 in_grp の指標 keys が、県内（同じ都道府県）と市内（area の前方一致・駅がその中にあるときだけ）の駅のなかで何位か。順位は値の大きい順（同じ値は同じ順位）、total はその指標の値がある駅の数。値の無い指標・知らない key は行を返さない。';

grant execute on function public.station_profile_ranks(text, text[], text) to anon, authenticated;
