#!/usr/bin/env bash
# Aplica una versión del sitio del Instituto Mutualista en el servidor.
# Va dentro del ZIP que descarga el código de despliegue (publicar-lightsail.sh codigo):
# lo ejecuta ese código con sudo, después de comprobar la huella SHA-256 del ZIP.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
DOMINIO="__DOMINIO__"
CORREO="__CORREO__"
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo: sudo bash $0"; exit 1; }
echo "== Instituto Mutualista · versión $(cat "$AQUI/VERSION") =="

install -m 755 "$AQUI/instalar-lightsail.sh" /usr/local/sbin/instalar-lightsail.sh

# Respaldo de la versión que estaba publicada (se guardan las 5 últimas).
if [ -f /var/www/instituto/index.html ]; then
  mkdir -p /var/backups/instituto
  tar -czf "/var/backups/instituto/sitio-$(date +%Y%m%d-%H%M%S).tar.gz" -C /var/www instituto
  ls -1t /var/backups/instituto/sitio-*.tar.gz | tail -n +6 | xargs -r rm -f
  echo "Respaldo de la versión anterior en /var/backups/instituto"
fi

# Las actualizaciones llegan solo con un código de despliegue: se apaga la sincronización
# automática con el bucket que dejó la primera instalación.
if [ -f /etc/cron.d/instituto-web ]; then
  rm -f /etc/cron.d/instituto-web
  echo "Sincronización automática con el bucket: desactivada."
fi

codigo=0
/usr/local/sbin/instalar-lightsail.sh "$AQUI/sitio.zip" "$DOMINIO" "$CORREO" || codigo=$?
echo "$(date '+%F %T') versión $(cat "$AQUI/VERSION") aplicada (instalador: $codigo)" >> /var/log/instituto-despliegues.log

# Comprobación final desde el propio servidor.
local_url="http://127.0.0.1/"; extra=(-H "Host: ${DOMINIO:-localhost}")
if [ -n "$DOMINIO" ] && [ -s "/etc/letsencrypt/live/$DOMINIO/fullchain.pem" ]; then
  local_url="https://$DOMINIO/"; extra=(--resolve "$DOMINIO:443:127.0.0.1")
fi
titulo=$(curl -fsS --max-time 10 "${extra[@]}" "$local_url" 2>/dev/null | grep -o '<title>[^<]*</title>' | head -n1 || true)
echo
if [ -n "$titulo" ] && [ "$codigo" = 0 ]; then
  echo "LISTO: el servidor responde en $local_url con $titulo"
elif [ -n "$titulo" ]; then
  echo "PUBLICADO CON AVISO: el sitio responde en $local_url, pero el instalador avisó un problema (código $codigo). Lee los mensajes de arriba."
else
  echo "ERROR: el servidor no responde en $local_url. Lee los mensajes de arriba."; exit 1
fi
