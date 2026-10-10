-- 2026-10-10 B5 で見つけたこと 1（`docs/261001_fix_user_feedback_ui.md` §6.14・§6.15）：
-- jsonb で返す 2 つの関数が、駅の値（station_values.value・real）を有効 6 桁に丸めて返していた。
--
-- Supabase はサーバの設定（構成ファイル）で extra_float_digits = 0。この設定のまま real を jsonb にすると、real の文字の
-- 書き方（有効 6 桁）を通して数になる——東京都の 20km の人口 12,407,970 は 12,408,000 に、竹橋の 5km の 2015 年の人口
-- 1,163,836 は 1,163,840 になった。
--   - scatter_points：散布の点（`/api/growth`・AI の compareGrowth）。東京都の 20km の人口で 654 駅中 631 駅がずれる
--   - dataset_rows：データセットの CSV（build_dataset）・おすすめ駅の材料・エリア要約の沿線の内訳
-- 関数に extra_float_digits = 3 を付けると、関数の中の書き出しは「最短で正確な表記」になる（24.3 は 24.3・12407970 は 12407970）。
-- 本体は変えない。B5b の関数（area_rows・area_station_stats・station_metric_values）と同じ設定。
--
-- 表で返す関数（rank_by_column・station_bundle・station_profile_ranks）は double precision で返すので値を失わない
-- （有効 15 桁で書かれる。real の 9.8 は 9.80000019073486 と端数が見えるが、表示はカタログの書式で丸める）。ここでは変えない。
-- scatter_points は次の migration（絞り込みを駅の集合にする）で作り直す——そこでもこの設定を保つ。

alter function public.dataset_rows(text[], text[]) set extra_float_digits = 3;

alter function public.scatter_points(
  text, text, text, text, text[], text[], text[], int[], int[], text,
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision
) set extra_float_digits = 3;
