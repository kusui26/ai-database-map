-- P2a — 初期スキーマ（AI Database Map）
-- 論理モデル: metric × radius × year（メトリクス・カタログ）
-- 物理モデル: 列レジストリ方式（plan_fable §2.2-②／省サイズ・ランキング高速）
-- セキュリティ: RLS 有効・anon/authenticated は SELECT のみ（書込は service_role/postgres）。.claude/CLAUDE.md §8。
--
-- 拡張は Supabase 慣例で extensions スキーマに置き、migration（postgres ロール実行）でも
-- 確実に解決できるよう PostGIS 関数・型・trgm opclass を明示的に schema 修飾する。

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- 駅（1行1駅グループ・識別11列＋pax_latest＋geom）
create table public.stations (
  id             smallint primary key,               -- 1..9273（station_values の外部キー・省サイズ）
  grp            text not null unique,               -- 駅グループID（自然キー）
  station_name   text not null,
  label          text not null,
  search_label   text not null,
  prefecture     text not null,
  lon            double precision not null,
  lat            double precision not null,
  n_op           smallint,
  pax_latest     integer,                            -- 最新年の乗降客数（P2b で算出）
  level_complete boolean,
  flag_yoy       boolean,
  flag_covid     boolean,
  geom           extensions.geometry(Point, 4326)
                   generated always as
                   (extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)) stored
);

comment on table public.stations is '駅グループ（1行1駅・識別11列＋pax_latest＋geom generated）';

-- メトリクス・カタログの DB ミラー（正は src/shared/catalog/catalog.json）
create table public.metric_columns (
  id   smallint primary key,        -- 列ID（station_values.column_id が参照）
  key  text not null unique,        -- CSV列名＝安定ID（例 'pop_2020_1km'）
  meta jsonb not null               -- CatalogEntry のミラー
);

comment on table public.metric_columns is 'メトリクス・カタログのDBミラー（正は catalog.json・投入整合とSQL検証用）';

-- 値（列レジストリ・NaN は行を作らない・PK 先頭=column_id でランキングは連続スキャン）
create table public.station_values (
  column_id  smallint not null references public.metric_columns(id),
  station_id smallint not null references public.stations(id),
  value      double precision not null,
  primary key (column_id, station_id)
);

comment on table public.station_values is '駅×指標の値（ロング・NaN非格納）。PK(column_id, station_id)。';

-- インデックス
create index stations_geom_gix       on public.stations using gist (geom);
create index stations_search_trgm    on public.stations using gin (search_label extensions.gin_trgm_ops);
create index stations_name_trgm      on public.stations using gin (station_name extensions.gin_trgm_ops);
create index stations_prefecture_idx on public.stations (prefecture);
create index station_values_station_idx on public.station_values (station_id);  -- 駅詳細（1駅の全指標取得）用

-- RLS（3テーブル有効化＋読み取り公開ポリシーのみ）
alter table public.stations       enable row level security;
alter table public.metric_columns enable row level security;
alter table public.station_values enable row level security;

create policy "public read stations"       on public.stations       for select to anon, authenticated using (true);
create policy "public read metric_columns" on public.metric_columns for select to anon, authenticated using (true);
create policy "public read station_values" on public.station_values for select to anon, authenticated using (true);

-- 明示 GRANT（プロジェクト設定「Automatically expose new tables」OFF のため手動付与）
grant usage on schema public to anon, authenticated;
grant select on public.stations, public.metric_columns, public.station_values to anon, authenticated;
