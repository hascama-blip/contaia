#!/bin/sh
# Arranque del contenedor: si entra como root, entrega la carpeta de datos al
# usuario "node" (solo los archivos que aún no son suyos) y ejecuta la app SIN
# privilegios. Si ya entra como otro usuario, ejecuta la app tal cual.
set -e
DATA="${DATA_DIR:-/var/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  find "$DATA" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
