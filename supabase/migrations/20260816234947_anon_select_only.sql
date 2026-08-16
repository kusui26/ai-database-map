-- 260816 — anon / authenticated を**本当に SELECT のみ**にする（最小権限・.claude/CLAUDE.md §5）。
--
-- 既存の 20260707131804_tighten_anon_grants.sql は TRUNCATE / REFERENCES / TRIGGER しか剥がして
-- おらず、**Supabase の既定（public スキーマの新規テーブルに ALL を付与）で入る
-- INSERT / UPDATE / DELETE が残っていた**。東京リージョンへの作り直し（docs/260816_supabase_restart.md）
-- でスキーマを全数点検して見つけた。適用直後の実測：
--
--   anon.stations       = DELETE, INSERT, SELECT, UPDATE
--   anon.station_routes = DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   （station_routes は tighten_anon_grants より後に作られたので、その revoke も効いていない）
--
-- 実害は無かった：4 テーブルとも RLS 有効で、ポリシーは anon/authenticated への **SELECT だけ**。
-- 書き込みは RLS で弾かれる。それでも「権限そのものを持たせない」ほうが多層防御として正しく、
-- README / docs の「anon は SELECT のみ」という記述とも一致する。
--
-- 投入パイプライン（pipeline/load_to_supabase.py）は postgres ロールで接続するため影響しない。
-- ⚠ 以後 public に足すテーブルにも既定で書き込み権限が付かなくなる（必要なら明示的に grant する）。

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- 読み取りは従来どおり（RLS のポリシーと合わせて二重に効かせる）。
grant select on all tables in schema public to anon, authenticated;

-- 今後 postgres が public に作るテーブルにも、書き込み権限を既定で付けない。
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables
  from anon, authenticated;
