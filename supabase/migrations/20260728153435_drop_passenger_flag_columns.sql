-- 乗降の信頼性フラグ flag_covid / flag_yoy を、他の lowbase/lown と同じ「flag 種別メトリクス」
-- （metric_columns + station_values）へ格上げしたため、stations テーブルの冗長な boolean 列を削除する。
-- 値は catalog.json → metric_columns/station_values に一元化する（単一の真実）。
-- ランキング除外(rank_by_column)・散布除外・駅詳細バッジは reliabilityFlagKey → station_values の
-- 値で解決するため、stations 側のこの2列は未使用（安全に削除できる）。
-- 手順: 本マイグレーション適用 → pipeline/load_to_supabase.py で metric_columns(585)＋station_values を再投入。
-- 参照: docs/260727_data_check.md
alter table public.stations drop column if exists flag_covid;
alter table public.stations drop column if exists flag_yoy;
