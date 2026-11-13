#!/bin/bash
# Runs once on first Postgres start (empty volume).
# App DB = $POSTGRES_DB (with pgvector). Separate DBs for bundled services.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EOSQL

for db in twenty chatwoot langfuse litellm; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE $db OWNER $POSTGRES_USER;"
done
