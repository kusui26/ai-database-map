-- P5d — 運営会社名（operators）を stations に保持する。
-- notebook が station_operator_detail.csv の運営会社を grp で集約し、pax 規模の降順で
-- 「・」連結した単一文字列（例「東日本旅客鉄道・東京地下鉄・東海旅客鉄道」）を
-- station_dataset.csv の operators 列に出力する。文字列属性のため station_values では
-- なく stations に置く（lp_near_use と同じ扱い）。
alter table public.stations add column operators text;

comment on column public.stations.operators is '運営会社名（pax規模降順・「・」連結・カード表示用。数値でないため station_values ではなく stations に保持）';
