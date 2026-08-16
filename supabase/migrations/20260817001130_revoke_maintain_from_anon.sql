-- 260817 — anon / authenticated から MAINTAIN も剥がす（20260816234947 の積み残し）。
--
-- PostgreSQL 17 で追加された MAINTAIN（VACUUM / ANALYZE / REINDEX / CLUSTER /
-- REFRESH MATERIALIZED VIEW / LOCK TABLE）は、Supabase の既定
-- （supabase_admin が public スキーマの新規テーブルに `arwdDxtm` を付与）に含まれる。
-- 前のマイグレーションでは INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER だけを剥がしたため、
-- 実測すると anon の ACL は `rm`（SELECT ＋ MAINTAIN）のまま残っていた。
--
-- PostgREST 経由では VACUUM も LOCK TABLE も発行できない（任意 SQL を実行できない）ので
-- 到達経路は無いが、「anon は SELECT のみ」を字義どおりにするために剥がす。
-- ⚠ MAINTAIN は PG17 以降にしか無いので、バージョンを見てから実行する（PG15/16 では何もしない）。

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke maintain on tables from anon, authenticated';
  end if;
end
$$;
