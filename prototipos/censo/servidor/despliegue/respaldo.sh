#!/usr/bin/env bash
# Copia comprimida de todos los datos (padrón, pagos, fotos, usuarios). Guárdala fuera del servidor.
# Para automatizar: sudo crontab -e  →  0 3 * * * /opt/censo/prototipos/censo/servidor/despliegue/respaldo.sh
set -euo pipefail
DESTINO="${1:-/var/censo-respaldos}"
mkdir -p "$DESTINO"
tar -czf "$DESTINO/censo-$(date +%F-%H%M).tgz" -C /var censo
ls -t "$DESTINO"/censo-*.tgz | tail -n +31 | xargs -r rm --   # conserva 30 copias
echo "Respaldo en $DESTINO"
