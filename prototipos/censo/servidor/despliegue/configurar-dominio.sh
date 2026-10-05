#!/usr/bin/env bash
# Regenera /etc/caddy/Caddyfile según /var/censo/dominio.txt ("dominio correo", o vacío)
# y recarga Caddy. Lo ejecuta systemd (censo-dominio.path) cada vez que el portal
# guarda el dominio desde Administración; también se puede correr a mano:
#   sudo configurar-dominio.sh midominio.pe correo@midominio.pe
set -euo pipefail
PLANTILLAS=/opt/censo/prototipos/censo/servidor/despliegue
if [[ $# -ge 1 ]]; then DOMINIO="$1"; CORREO="${2:-}"; else read -r DOMINIO CORREO < <(cat /var/censo/dominio.txt 2>/dev/null || echo ""); fi
if [[ -z "${DOMINIO:-}" ]]; then
  cp "$PLANTILLAS/Caddyfile.ip" /etc/caddy/Caddyfile
else
  sed -e "s|TU-DOMINIO.com|$DOMINIO|g" -e "s|directiva@$DOMINIO|${CORREO:-admin@$DOMINIO}|" "$PLANTILLAS/Caddyfile" > /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy
echo "Caddy configurado para: ${DOMINIO:-solo IP (http)}"
