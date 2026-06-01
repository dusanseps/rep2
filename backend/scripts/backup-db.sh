#!/usr/bin/env bash
set -euo pipefail

# Backup PostgreSQL DB do timestampovaneho suboru.
# Pouzitie:
#   DB_HOST=localhost DB_PORT=5432 DB_NAME=representative DB_USER=rep_test DB_PASSWORD=... ./scripts/backup-db.sh

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-./backups/db}"
mkdir -p "$BACKUP_DIR"

export PGPASSWORD="${DB_PASSWORD:-}"
OUT_FILE="$BACKUP_DIR/${DB_NAME:-representative}_${STAMP}.sql.gz"

pg_dump \
  -h "${DB_HOST:-localhost}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-rep_test}" \
  "${DB_NAME:-representative}" | gzip -9 > "$OUT_FILE"

unset PGPASSWORD

echo "DB backup created: $OUT_FILE"
