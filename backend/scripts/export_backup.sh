#!/usr/bin/env bash
# S15 (master plan): a READ-ONLY weekly export of the production database, for
# Hriday to run on his own Mac (the production connection string is Sensitive
# in Vercel; Claude never sees it). Decision 2026-11-24: an encrypted folder on
# the Mac plus Google Drive.
#
# Usage:
#   export BACKUP_DATABASE_URL='postgresql://...'   # paste from Neon, main branch (read-only role if you have one)
#   backend/scripts/export_backup.sh ~/StacklyBackups
#
# It runs pg_dump inside a read-only transaction, compresses the dump and
# encrypts it with a passphrase you type (openssl AES-256). Copy the .enc file
# to Google Drive. To restore later: openssl enc -d -aes-256-cbc -pbkdf2 -in FILE.enc | gunzip > dump.sql
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL first (see the comment at the top).}"
out_dir="${1:-$HOME/StacklyBackups}"
mkdir -p "$out_dir"
chmod 700 "$out_dir"
stamp=$(date +%Y-%m-%d)
file="$out_dir/stackly-$stamp.sql.gz.enc"
PGOPTIONS='-c default_transaction_read_only=on' \
  pg_dump --no-owner --no-privileges "$BACKUP_DATABASE_URL" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -out "$file"
chmod 600 "$file"
echo "Saved $file ($(du -h "$file" | cut -f1)). Now copy it to Google Drive."
