-- 261008 L1 — 路線（運行系統）と駅の対応（docs/261001_fix_user_feedback_ui.md §6.8）。
--
-- アプリの「路線」を、国土数値情報 S12 の**法令上の路線**（station_routes）ではなく、利用者が呼ぶ路線
-- （**運行系統**・駅データ.jp）で持つ。S12 の「山手線」は 17 駅、利用者の言う環状は 30 駅（§6.8.1）。
-- pipeline/build_lines.py が生成し（validate_lines.py が独立に検証）、pipeline/load_lines.py が投入する。
--
-- 設計上の要点：
--  ・駅データ.jp の路線コード（line_cd）をそのまま主キーにする。原典は取り直さない（版 2024-04-26 で固定・§12-19）。
--  ・operator は S12 の会社名（stations.operators・station_routes.operator と同じ語彙）。事業者 → 会社名は build が
--    数で決め、割合の低い事業者は人が確かめる（line_rules.REVIEWED_OPERATORS）。線路の持ち主（神戸高速鉄道）は null。
--  ・line_stations は駅グループ（stations.id）単位。同じ駅グループは 1 路線に 1 回。seq は路線の中の並び
--    （駅データ.jp の e_sort に、2024-04 版に無い駅を直しの表で差し込んだもの）。環状は is_loop。
--  ・既存の station_routes（法令上の路線）は残す（URL の互換・「詳しい条件」・§12-17）。
--  ・L1 はデータだけ。共通の条件 `lines`（station_matches_filters）と /api/lines は L2 で足す。

create table public.lines (
  line_cd       integer  primary key,
  name          text     not null,
  formal_name   text     not null,
  company_cd    integer  not null,
  company_name  text     not null,
  company_short text     not null,
  operator      text,
  color         text,
  color_name    text,
  line_type     smallint not null,
  is_loop       boolean  not null,
  station_count smallint not null check (station_count > 0),
  source        text     not null
);

comment on table public.lines is
  '路線（運行系統・駅データ.jp 由来）。name は利用者の呼び方（JR山手線・東京メトロ東西線）、formal_name は正式名。';
comment on column public.lines.operator is
  'S12 の会社名（stations.operators と同じ語彙）。自分の会社名が S12 に無い事業者（線路の持ち主）は null。';
comment on column public.lines.line_type is
  '駅データ.jp の路線区分：0 その他・1 新幹線・2 一般・3 地下鉄・4 路面電車・5 モノレール／新交通。';
comment on column public.lines.source is '原典と版（例：駅データ.jp 2024-04-26）。';

create table public.line_stations (
  line_cd    integer  not null references public.lines(line_cd) on delete cascade,
  station_id smallint not null references public.stations(id) on delete cascade,
  seq        smallint not null check (seq > 0),
  primary key (line_cd, station_id),
  unique (line_cd, seq)
);

comment on table public.line_stations is '路線 × 駅グループ。seq は路線の中の並び（1 から）。';

-- 駅 → 路線（L2 の共通の条件「この路線の駅か」で引く向き）。
create index line_stations_station_idx on public.line_stations (station_id);

alter table public.lines enable row level security;
alter table public.line_stations enable row level security;
create policy "lines は匿名でも読み取り可" on public.lines
  for select to anon, authenticated using (true);
create policy "line_stations は匿名でも読み取り可" on public.line_stations
  for select to anon, authenticated using (true);
grant select on public.lines to anon, authenticated;
grant select on public.line_stations to anon, authenticated;
