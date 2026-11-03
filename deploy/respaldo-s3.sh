#!/usr/bin/env bash
# Respaldo diario de /var/data (store.json + uploads + snapshots):
#  1) comprime a /var/backups/radar/ (conserva 7 días)
#  2) si S3_BUCKET está definido en /opt/radar/.env, lo sube a S3 (conserva 30 días
#     vía regla de ciclo de vida del bucket, o lo que configures).
set -euo pipefail
set -a; [ -f /opt/radar/.env ] && . /opt/radar/.env; set +a
DEST=/var/backups/radar
mkdir -p "$DEST"
F="$DEST/radar-$(date +%F-%H%M).tar.gz"
tar czf "$F" -C /var data
find "$DEST" -name 'radar-*.tar.gz' -mtime +7 -delete
echo "$(date) respaldo local: $F ($(du -h "$F" | cut -f1))"
if [ -n "${S3_BUCKET:-}" ]; then
  aws s3 cp "$F" "s3://$S3_BUCKET/radar/" --only-show-errors && echo "$(date) subido a s3://$S3_BUCKET/radar/"
fi
