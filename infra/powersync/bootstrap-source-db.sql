-- Prepares the application Postgres (Supabase) as a PowerSync source database.
--
-- Run once per database:
--   local stack:    pnpm infra:powersync:bootstrap
--   Supabase Cloud: psql "<direct connection string>" -v powersync_password='...' -f infra/powersync/bootstrap-source-db.sql
--
-- Requires the psql variable `powersync_password`. Idempotent (uses \gexec so the
-- variable can be interpolated; psql does not expand variables inside DO blocks).

\set ON_ERROR_STOP on

-- Replication role: read-only, bypasses RLS (Sync Streams handle per-user filtering).
SELECT format('CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD %L', :'powersync_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role')
\gexec

SELECT format('ALTER ROLE powersync_role WITH PASSWORD %L', :'powersync_password')
\gexec

GRANT USAGE ON SCHEMA public TO powersync_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;

-- Publication read by the PowerSync Service. Deliberately empty: tables are added
-- explicitly by the Drizzle migration that creates them, e.g.
--   ALTER PUBLICATION powersync ADD TABLE public.tasks;
SELECT 'CREATE PUBLICATION powersync'
WHERE NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync')
\gexec
