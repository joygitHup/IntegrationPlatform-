#!/bin/bash
# 每天凌晨 pg_dump，默认保留 14 天
# cron: 0 3 * * * /path/to/backup_postgres.sh
set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://integration:integration@localhost:5432/integration}"
OUT_DIR="${BACKUP_DIR:-/var/backups/integration-platform}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$OUT_DIR"
DATE=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/integration-$DATE.sql.gz"

pg_dump "$DB_URL" | gzip > "$FILE"
echo "[$(date)] backup done → $FILE ($(du -h "$FILE" | cut -f1))"

find "$OUT_DIR" -name "integration-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date)] retention cleanup done"
