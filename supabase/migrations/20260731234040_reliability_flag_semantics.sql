-- 信頼性フラグの意味づけを「除外用」と「注意喚起用」に分ける（260731）。
--
-- 問題：`flag_covid` は **被覆<100% ／ pre<2019 ／ |率|>100%** の OR で、意味の違う 3 条件が
-- 1 本に混ざっている（docs/passenger_aggregation.md §7）。アプリは信頼性フラグを
-- `reliabilityFlagKey` の 1 本で解決するため（散布・ランキング RPC・駅詳細バッジ・AI ツール）、
-- 「低分母を除外」と書かれた操作が、**被覆の都合で大駅を消していた**。
-- 実測：flag_covid=238 群のうち 136 群が被覆<100% を含み、新宿（326 万人/日）・横浜（210 万人/日）・
-- 新横浜・小田原・豊橋などが既定の散布から黙って落ちていた。真に低分母なのは |率|>100% の 85 群
-- （pre の中央値 51 人/日）だけ。詳細は docs/260731_reliability_flag_semantics.md。
--
-- 対応：
--   * `reliabilityFlagKey` ＝ **除外**に使う（値が信用できない）
--   * `noticeFlagKey`（新設）＝ **バッジ**に使う（読むとき注意が要る）
--   * rate_covid だけが両者で食い違う（除外は新設 flag_covid_lown／バッジは従来の flag_covid）
--
-- DDL は無く、metric_columns（catalog.json のミラー）と station_values の同期だけを行う。
-- 全量再投入（約 490 万行）を避けて対象を絞る：新カタログでも既存 585 エントリの id と値は不変で、
-- 変わるのは「meta への noticeFlagKey 追加」「rate_covid の除外フラグ差し替え」「新列 1 本の追加」だけ。

-- 1) 既存エントリに noticeFlagKey を補う。カタログの既定は「除外用＝注意喚起用」なので、
--    reliabilityFlagKey をそのまま写せば catalog.json と完全に一致する（rate_covid は 3) で上書き）。
update public.metric_columns
set meta = meta || jsonb_build_object('noticeFlagKey', meta -> 'reliabilityFlagKey')
where not (meta ? 'noticeFlagKey');

-- 2) 新しい低分母フラグ列（catalog.json の 586 番目＝末尾。既存 id は動かない）。
insert into public.metric_columns (id, key, meta)
values (
  586,
  'flag_covid_lown',
  '{"key": "flag_covid_lown", "baseMetric": "pax_flag", "kind": "flag", "category": "passenger", "labelJa": "乗降客数 コロナ前後増減率 低分母フラグ（|率|>100%＝小駅の分母ノイズ）", "unit": null, "format": null, "radiusM": null, "year": null, "yearBase": null, "vintage": null, "reliabilityFlagKey": null, "noticeFlagKey": null, "rankable": false, "higherIsBetter": null, "source": "国土数値情報「駅別乗降客数」(S12-25)", "license": "CC BY 4.0 相当（国土数値情報 利用約款・出典明記で商用可）"}'::jsonb
)
on conflict (id) do update set key = excluded.key, meta = excluded.meta;

-- 3) rate_covid：除外は低分母だけに絞り、注意喚起は従来の複合フラグを使う。
--    ランキング RPC（rank_by_column）は meta ->> 'reliabilityFlagKey' を読むため、
--    この 1 行で散布・ランキング・AI の除外が同時に正しくなる。
update public.metric_columns
set meta = meta || '{"reliabilityFlagKey": "flag_covid_lown", "noticeFlagKey": "flag_covid"}'::jsonb
where key = 'rate_covid';

-- 4) 複合フラグはラベルを「注意フラグ」に改める（除外用ではなくなったため）。
update public.metric_columns
set meta = meta
  || '{"labelJa": "乗降客数 コロナ前後増減率 注意フラグ（被覆<100%／pre<2019／|率|>100%）"}'::jsonb
where key = 'flag_covid';

-- 5) 新列の値。|rate_covid| > 100% を DB 内の rate_covid から導出する
--    （pipeline/build_pax_lown_flag.py が CSV に対して行うのと同じ規則）。
--    rate_covid を持たない駅は 0＝除外しない。全駅ぶん入れて CSV 由来の全量投入と一致させる。
delete from public.station_values where column_id = 586;

insert into public.station_values (column_id, station_id, value)
select
  586,
  s.id,
  case when abs(v.value) > 100 then 1 else 0 end
from public.stations s
left join public.station_values v
  on v.station_id = s.id
 and v.column_id = (select id from public.metric_columns where key = 'rate_covid');
