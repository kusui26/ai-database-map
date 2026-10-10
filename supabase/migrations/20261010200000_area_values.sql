-- 261010 B5a — エリアの区域の値（docs/261001_fix_user_feedback_ui.md §6.12・docs/area_values.md）。
--
-- 行政区域（全国・都道府県・政令市・東京 23 区・市区町村・政令市の区）と沿線（路線の駅から 500m・1km・2km の円を
-- 重ねた範囲）の、人口（実績・推計）・事業所・従業者。**駅の値を足したものではない**（円が重なるので二重に数える）。
-- pipeline/build_area_values.py・build_line_corridors.py が作り、validate_area_values.py が独立に確かめ、
-- pipeline/load_area_values.py が投入する。
--
-- 設計上の要点：
--  ・行政区域は**公表値**（国勢調査・経済センサス）。将来推計人口は、国土数値情報の将来推計人口メッシュ（R6）を
--    市区町村ごとに足した値（2020〜2050 年は社人研の地域別推計と同じ値）。メッシュから作り直さない（§12-20）。
--  ・沿線は**メッシュの面積按分**（駅の半径の値と同じ方法・公表値が無いため）。
--  ・区域の指標は src/shared/catalog/area-catalog.json が正（コードが正・DB はミラー）。area_metrics.meta はその写し。
--  ・値は double precision（全国の人口 1.2 億人は real では 1 人単位で持てない）。
--  ・areas.missing は「無い値とその理由」（[{keys, reasonJa}]）。値が無いことを黙らない（浜松の区の再編・浜通りの推計など）。
--  ・parent_key は内訳の親（区 → 政令市、市区町村・政令市 → 都道府県、都道府県 → 全国）。東京 23 区（特別区部）は
--    23 の区を束ねる集まりで、23 の区の group_key がそれを指す（東京都の内訳に 23 区と特別区部を並べない）。
--  ・沿線の line_cd は lines に外部キーを張らない（load_lines.py が lines を truncate して入れ直すため）。
--    沿線が全路線 × 3 幅そろうことは、投入後の確認と pipeline/golden_area_values_test.py が見る。
--  ・B5a はデータだけ。共通 API（/api/areas・/api/areas/summary）は B5b で足す。

create table public.area_metrics (
  id   smallint primary key,
  key  text     not null unique,
  meta jsonb    not null
);

comment on table public.area_metrics is
  '区域の指標（src/shared/catalog/area-catalog.json の写し）。key は pop_2025・pop_pred_2024_2050・estab_n_2021 など。';

create table public.areas (
  id            smallint primary key,
  key           text     not null unique,
  kind          text     not null
    check (kind in ('country', 'prefecture', 'city', 'special_wards', 'municipality', 'ward', 'line')),
  code          text,
  line_cd       integer,
  width_m       smallint,
  name_ja       text     not null,
  label_ja      text     not null,
  prefecture    text,
  parent_key    text     references public.areas(key) deferrable initially deferred,
  group_key     text     references public.areas(key) deferrable initially deferred,
  station_count smallint,
  area_km2      double precision not null check (area_km2 > 0),
  missing       jsonb    not null default '[]'::jsonb,
  constraint areas_line_shape check ((kind = 'line') = (line_cd is not null and width_m is not null)),
  constraint areas_code_shape check ((kind in ('country', 'line')) = (code is null))
);

comment on table public.areas is
  'エリア（行政区域と沿線）。key は共通 API・URL・地図の操作で使う文字列（jp・pref:14・muni:14100・line:26001@1000）。';
comment on column public.areas.code is 'JIS コード（都道府県は 2 桁・市区町村は 5 桁）。全国と沿線は null。';
comment on column public.areas.name_ja is
  '名前（駅の市区町村 stations.municipality と同じ言い方：政令市の区は「横浜市港北区」）。沿線は路線の名前。';
comment on column public.areas.label_ja is '題に使う言い方（「神奈川県横浜市」「東急東横線の沿線（駅から 1km）」）。';
comment on column public.areas.parent_key is '内訳の親（区 → 政令市、市区町村・政令市 → 都道府県、都道府県 → 全国）。';
comment on column public.areas.group_key is '束ねる集まり（東京の 23 の区 → muni:13100）。';
comment on column public.areas.station_count is '沿線の駅の数（行政区域は null。駅の数は stations から数える）。';
comment on column public.areas.missing is '無い値とその理由（[{"keys": [...], "reasonJa": "..."}]）。';

create index areas_parent_idx on public.areas (parent_key);
create index areas_line_idx on public.areas (line_cd) where line_cd is not null;

create table public.area_values (
  area_id   smallint not null references public.areas(id) on delete cascade,
  metric_id smallint not null references public.area_metrics(id) on delete cascade,
  value     double precision not null,
  primary key (area_id, metric_id)
);

comment on table public.area_values is
  'エリア × 区域の指標の値。行政区域は公表値（推計は R6 の市区町村ごとの合計）、沿線はメッシュの面積按分。';

alter table public.area_metrics enable row level security;
alter table public.areas enable row level security;
alter table public.area_values enable row level security;
create policy "area_metrics は匿名でも読み取り可" on public.area_metrics
  for select to anon, authenticated using (true);
create policy "areas は匿名でも読み取り可" on public.areas
  for select to anon, authenticated using (true);
create policy "area_values は匿名でも読み取り可" on public.area_values
  for select to anon, authenticated using (true);
grant select on public.area_metrics to anon, authenticated;
grant select on public.areas to anon, authenticated;
grant select on public.area_values to anon, authenticated;
