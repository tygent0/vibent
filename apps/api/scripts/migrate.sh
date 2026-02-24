#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set, skipping migration"
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not installed, skipping migration"
  exit 0
fi

psql "$DATABASE_URL" -f sql/schema.sql
