#!/usr/bin/env bash
# Trae la última versión del código y reconstruye la web (sin perder datos:
# /var/data vive fuera del contenedor). Lo usa GitHub Actions en cada push a
# main y también se puede correr a mano:  sudo /opt/radar/deploy/actualizar.sh
set -euo pipefail
DIR="/opt/radar"
cd "$DIR"
git fetch origin main
git reset --hard origin/main
# .env se pasa a Compose con --env-file (soporta valores con espacios y comillas).
docker compose --env-file "$DIR/.env" -f deploy/docker-compose.yml up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true
echo "==> Desplegado $(git rev-parse --short HEAD) · $(date)"
docker compose --env-file "$DIR/.env" -f deploy/docker-compose.yml ps
