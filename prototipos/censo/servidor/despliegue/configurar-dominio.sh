#!/usr/bin/env bash
# Regenera /etc/caddy/Caddyfile según /var/censo/dominio.txt ("dominio correo", o vacío)
# y recarga Caddy. Lo ejecuta systemd (censo-dominio.path) cada vez que el portal
# guarda el dominio desde Administración; también se puede correr a mano:
#   sudo configurar-dominio.sh midominio.pe correo@midominio.pe
set -euo pipefail
PLANTILLAS=/opt/censo/prototipos/censo/servidor/despliegue
if [[ $# -ge 1 ]]; then DOMINIO="$1"; CORREO="${2:-}"; else
  DOMINIO="$(awk 'NR==1{print $1}' /var/censo/dominio.txt 2>/dev/null || true)"
  CORREO="$(awk 'NR==1{print $2}' /var/censo/dominio.txt 2>/dev/null || true)"
fi
if [[ -z "${DOMINIO:-}" ]]; then
  cp "$PLANTILLAS/Caddyfile.ip" /etc/caddy/Caddyfile
else
  sed -e "s|TU-DOMINIO.com|$DOMINIO|g" -e "s|directiva@$DOMINIO|${CORREO:-admin@$DOMINIO}|" "$PLANTILLAS/Caddyfile" > /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy
sleep 2; systemctl is-active caddy >/dev/null || { echo "ERROR: Caddy no arrancó. journalctl -u caddy -n 20"; exit 1; }
echo "Caddy configurado para: ${DOMINIO:-solo IP (http)}"
