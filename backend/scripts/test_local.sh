#!/usr/bin/env bash
# Runs the backend tests against a local Postgres 17 (Homebrew) instead of the
# Neon test branch (2026-11-18, Hriday: the Neon run took ~30 min from India,
# ~0.3 s per round trip). Starts Postgres only for the run and stops it after
# (unless it was already running). The database is labelled 'test' in
# stackly_env, so conftest.py's guard accepts it exactly as it does Neon's.
#
# One-time setup: brew install postgresql@17
# Usage (from backend/): scripts/test_local.sh [pytest args], e.g.
#   scripts/test_local.sh -q
#   scripts/test_local.sh tests/test_news.py -k video
set -euo pipefail

PG=/opt/homebrew/opt/postgresql@17/bin
DATA=/opt/homebrew/var/postgresql@17
PORT=54329
DB=stackly_test
HOST=127.0.0.1

if [ ! -x "$PG/pg_ctl" ]; then
  echo "Postgres 17 isn't installed: brew install postgresql@17" >&2
  exit 1
fi

started=0
if ! "$PG/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  "$PG/pg_ctl" -D "$DATA" -l "$DATA/stackly-test.log" -w \
    -o "-p $PORT -c listen_addresses=$HOST -k /tmp -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
    start >/dev/null
  started=1
fi
stop() {
  if [ "$started" = 1 ]; then "$PG/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null; fi
}
trap stop EXIT

"$PG/createdb" -h "$HOST" -p "$PORT" "$DB" 2>/dev/null || true
"$PG/psql" -h "$HOST" -p "$PORT" -d "$DB" -q -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS stackly_env (name TEXT PRIMARY KEY); INSERT INTO stackly_env VALUES ('test') ON CONFLICT DO NOTHING;"

cd "$(dirname "$0")/.."
TEST_DATABASE_URL="postgresql://$USER@$HOST:$PORT/$DB" .venv/bin/python -m pytest -p no:cacheprovider "$@"
