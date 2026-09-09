#!/bin/sh
# Applies bootstrap-source-db.sql to the local Supabase Postgres via the `db` compose service.
# Reads POWERSYNC_REPLICATION_PASSWORD from the repo-root .env.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .env ]; then
  echo "Missing .env at repo root (copy .env.example)" >&2
  exit 1
fi

POWERSYNC_REPLICATION_PASSWORD="$(grep -E '^POWERSYNC_REPLICATION_PASSWORD=' .env | head -n1 | cut -d= -f2- | tr -d '"'"'")"
if [ -z "$POWERSYNC_REPLICATION_PASSWORD" ]; then
  echo "POWERSYNC_REPLICATION_PASSWORD is not set in .env" >&2
  exit 1
fi

docker compose -f compose.yaml -f compose.local.yaml exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v powersync_password="$POWERSYNC_REPLICATION_PASSWORD" \
  < infra/powersync/bootstrap-source-db.sql

echo "PowerSync source database bootstrapped."
